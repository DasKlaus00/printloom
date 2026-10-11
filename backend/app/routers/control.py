"""OTTOeject steuern: Notaus, Makros, G-code, Einmessen, Geometrie.

Alles, was den Arm bewegt, geht über `_klipper(db, bewegt=True)` — dort sitzt die
Notaus-Sperre. Bis v1.1.34 beachtete nur der Makro-Knopf einen ausgelösten Notaus;
Joggen, G-code und die Drucker-Tab-Bewegungen fuhren trotzdem los.
"""
import asyncio
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.paths import db_path
from app.schemas.schemas import MacroExecutionRequest, MacroExecutionResponse
from app.services import geometry_check as _geometry_check
from app.services import ottoeject_motion as _motion
from app.services import rack_store
from app.services import storage as _storage

logger = logging.getLogger(__name__)

router = APIRouter()

GEOMETRY_PATH = db_path("ottoeject_geometry.json")

NOTAUS_AKTIV = ("Notaus aktiv — erst „Betrieb fortsetzen“ (Steuerung), dann wieder bewegen.")

# Geräte-Makros, die der Steuerungs-Tab direkt auslösen darf.
VALID_MACROS = {
    "GRAB_FROM_SLOT_1", "GRAB_FROM_SLOT_2", "GRAB_FROM_SLOT_3",
    "GRAB_FROM_SLOT_4", "GRAB_FROM_SLOT_5", "GRAB_FROM_SLOT_6",
    "STORE_TO_SLOT_1", "STORE_TO_SLOT_2", "STORE_TO_SLOT_3",
    "STORE_TO_SLOT_4", "STORE_TO_SLOT_5", "STORE_TO_SLOT_6",
    "OPEN_DOOR_BAMBU_X_ONE_C", "CLOSE_DOOR_BAMBU_X_ONE_C",
    "EJECT_FROM_BAMBULAB_X_ONE_C", "LOAD_ONTO_BAMBULAB_X_ONE_C",
    "OTTOEJECT_HOME", "PARK_OTTOEJECT", "TEST_STORAGE_RACK_CONFIGURATION"
}


# ── Klipper / Moonraker ──────────────────────────────────────────────────────
def _klipper(db: Session, bewegt: bool = False) -> Device:
    """Der OTTOeject. `bewegt=True` für alles, was den Arm fahren lässt: dann ist
    ein ausgelöster Notaus ein Grund abzulehnen (409) — auch wenn Klipper selbst
    den Notaus gar nicht bestätigt hat."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    if bewegt and not klipper.is_active:
        raise HTTPException(409, NOTAUS_AKTIV)
    return klipper


def _base(klipper: Device) -> str:
    return f"http://{klipper.ip_address}:{klipper.port}"


async def _moonraker_get(klipper: Device, path: str, timeout: float = 5.0):
    """GET an Moonraker → Response. Nicht erreichbar / Fehlerstatus → 502 mit Grund."""
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            r = await client.get(f"{_base(klipper)}{path}")
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")
    if r.status_code == 404:
        raise HTTPException(404, "Nicht gefunden")
    if r.status_code != 200:
        raise HTTPException(502, f"Moonraker: {r.text}")
    return r


async def _toolhead(klipper: Device) -> dict:
    """Klipper-Objekt `toolhead` (Position, referenzierte Achsen, Achsgrenzen)."""
    r = await _moonraker_get(klipper, "/printer/objects/query?toolhead")
    try:
        return (r.json().get("result", {}).get("status", {}) or {}).get("toolhead", {}) or {}
    except Exception as e:
        raise HTTPException(502, f"Unerwartete Antwort von Moonraker: {e}")


# Moonraker's /printer/gcode/script blocks until the G-code has FULLY executed. For a
# manual trigger/test that is fragile: a real grab/eject/place move runs 20-60 s — longer
# than any sane HTTP timeout, and longer than a reverse proxy (or the vite dev proxy) in
# front of Printloom will hold the connection open. The socket gets reset before a result
# arrives → the browser shows "Network Error". For a trigger we only need Klipper to ACCEPT
# and START the move; once it is running, that is success. So we wait a short window: the
# move finishes fast → report done; it is still moving when the window elapses → report
# started (it keeps running on the machine). Only a fast rejection (unknown macro, not
# homed) or an unreachable host is a real error.
_MOONRAKER_TRIGGER_TIMEOUT = httpx.Timeout(connect=5.0, read=10.0, write=10.0, pool=5.0)


def _force_absolute(script: str) -> str:
    """G90 (absolute Positionierung) VOR jedem Klipper-Script erzwingen. Der OTTOeject
    kann nach Homing/manuellem Jog relativ (G91) stehen; auch die Geräte-Macros
    (EJECT_FROM…/GRAB_FROM_RACK…) setzen selbst kein G90 → ihre internen G1-Moves liefen
    dann als Offset ab Ist-Position und fahren aus dem Bereich. Idempotent (kein Doppel-G90,
    falls das Script — z. B. aus build_op — bereits mit G90 beginnt)."""
    s = (script or "").lstrip()
    return script if s.upper().startswith("G90") else "G90\n" + script


async def _fire_moonraker_script(url: str, script: str) -> bool:
    """POST a G-code script to Moonraker and wait briefly. Returns True if the move is
    still running when the wait window elapsed, False if it already finished. Raises
    HTTPException on a real failure (Klipper rejected it, or the host is unreachable)."""
    script = _force_absolute(script)
    try:
        async with httpx.AsyncClient(timeout=_MOONRAKER_TRIGGER_TIMEOUT) as client:
            r = await client.post(url, json={"script": script})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return False
    except httpx.ReadTimeout:
        # Connected + command sent, but the move is still running → treat as started.
        return True
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


async def _send_script(db: Session, script: str) -> tuple:
    """Script an den OTTOeject (Notaus-Sperre, RACK=-Spiegelung) → (gesendet, läuft)."""
    klipper = _klipper(db, bewegt=True)
    script = _mirror_for_device(script)
    running = await _fire_moonraker_script(f"{_base(klipper)}/printer/gcode/script", script)
    return script, running


# ── Makros ───────────────────────────────────────────────────────────────────
@router.post("/macro", response_model=MacroExecutionResponse)
async def execute_macro(request: MacroExecutionRequest, db: Session = Depends(get_db)):
    """Ein Geräte-Makro ausführen und auf das Ende warten (Homing, Parken …)."""
    if request.macro_name not in VALID_MACROS:
        raise HTTPException(400, f"Invalid macro. Valid macros: {', '.join(sorted(VALID_MACROS))}")
    klipper = _klipper(db, bewegt=True)

    def antwort(ok: bool, msg: str):
        return MacroExecutionResponse(success=ok, macro_name=request.macro_name,
                                      message=msg, timestamp=datetime.now(timezone.utc))
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{_base(klipper)}/printer/gcode/script",
                                         json={"script": request.macro_name})
    except Exception as e:
        return antwort(False, f"Error executing macro: {e}")
    if response.status_code == 200:
        return antwort(True, "Macro executed successfully")
    return antwort(False, f"Macro execution failed: {response.text}")


@router.get("/app-ops")
async def list_app_ops():
    """Printloom-eigene Operationen (Drucker-Tab-Geometrie → G-code), die in Sequenzen
    als app_op-Schritt frei nutzbar sind — wie Geräte-Macros, aber immer App-G-code."""
    return {"ops": _motion.APP_OPS}


# ── Notaus ───────────────────────────────────────────────────────────────────
PRINTER_PAUSE_TIMEOUT_S = 8.0   # je Drucker — ein toter Drucker darf den Notaus nicht aufhalten


async def _klipper_estop(db: Session) -> list:
    """M112 an jeden OTTOeject. Gleichzeitig, mit kurzem Zeitlimit."""
    from app.services.moonraker import MoonrakerAPI
    arme = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).all()
    ergebnisse = await asyncio.gather(
        *(MoonrakerAPI(d).emergency_stop() for d in arme), return_exceptions=True)
    return [{"name": d.name, "ok": r is True} for d, r in zip(arme, ergebnisse)]


async def _pause_printers(db: Session) -> list:
    """Jeden Bambu-Drucker pausieren — PAUSE, nicht Abbruch: eine Pause lässt sich
    fortsetzen, ein abgebrochener Druck nicht. Bei einem Drucker, der gerade nicht
    druckt, ist die Pause wirkungslos und schadet nicht."""
    from app.services import bambu_manager
    loop = asyncio.get_running_loop()
    drucker = db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB).all()

    async def eins(d):
        try:
            return await asyncio.wait_for(
                loop.run_in_executor(bambu_manager.executor,
                                     bambu_manager.print_command, d, "pause"),
                timeout=PRINTER_PAUSE_TIMEOUT_S)
        except Exception:
            return False

    ergebnisse = await asyncio.gather(*(eins(d) for d in drucker))
    return [{"name": d.name, "ok": bool(r)} for d, r in zip(drucker, ergebnisse)]


def notaus_aktiv(db: Session) -> bool:
    """Steht ein Notaus an? Merkmal: gesperrte Geräte (bis „Betrieb fortsetzen")."""
    geraete = db.query(Device).all()
    return bool(geraete) and any(not d.is_active for d in geraete)


def assert_released(db: Session) -> None:
    """Für Abläufe, die den Arm oder einen Drucker in Gang setzen (Farm, Stresstest,
    Direktdruck): bei aktivem Notaus ablehnen."""
    if notaus_aktiv(db):
        raise HTTPException(409, NOTAUS_AKTIV)


@router.post("/emergency-stop")
async def emergency_stop(db: Session = Depends(get_db)):
    """NOTAUS — Bewegung SOFORT anhalten.

    Bis v1.1.33 setzte dieser Endpunkt nur `is_active = False` in der Datenbank. Das
    beachtete ausschließlich der manuelle Makro-Endpunkt: Farm, Stresstest, Joggen
    und Einlernen fuhren weiter. Schlimmer noch: weil der Notaus die Position als
    unbekannt markierte, fuhr die nächste Farm-Bewegung erst eine Referenzfahrt und
    machte dann einfach weiter. Ein Notaus, der nicht anhält.

    Reihenfolge ist Absicht: ZUERST der Arm (M112 schaltet in Klipper die Motoren
    ab), dann alles andere. Jeder Schritt ist für sich abgesichert — scheitert einer,
    laufen die übrigen trotzdem. Die Antwort sagt genau, was gegriffen hat; nie ein
    500 und nie „aktiviert", wenn der Arm nicht angehalten wurde.
    """
    # 1. Arm anhalten — das Einzige, was in den ersten Millisekunden zählt.
    try:
        arme = await _klipper_estop(db)
    except Exception as e:
        logger.error(f"Notaus: Klipper nicht erreichbar: {e}")
        arme = []
    arm_ok = bool(arme) and all(a["ok"] for a in arme)

    # 2. Printloom-Abläufe anhalten, damit nach dem Klipper-Neustart nichts weiterfährt.
    angehalten = []
    try:
        from app.routers import autofarm
        angehalten = autofarm.halt_all("Notaus")
        # Nach einem Notaus steht der Arm irgendwo — vor der nächsten Bewegung MUSS
        # referenziert werden (Phase 3.7).
        autofarm.mark_position_unknown("Notaus")
    except Exception as e:
        logger.warning(f"Notaus: Abläufe nicht angehalten: {e}")

    # 3. Drucker pausieren.
    try:
        drucker = await _pause_printers(db)
    except Exception as e:
        logger.warning(f"Notaus: Drucker nicht pausiert: {e}")
        drucker = []

    # 4. Geräte sperren — hält jede Bewegung bis „Fortsetzen" zurück.
    try:
        for device in db.query(Device).all():
            device.is_active = False
            db.add(device)
        db.commit()
    except Exception as e:
        logger.warning(f"Notaus: Geräte nicht gesperrt: {e}")

    if not arme:
        meldung = "Kein OTTOeject eingerichtet — es gab keinen Arm anzuhalten."
    elif arm_ok:
        meldung = "Arm angehalten (Klipper-Notaus)."
    else:
        meldung = ("ARM NICHT ANGEHALTEN — Klipper hat den Notaus nicht bestätigt. "
                   "Strom des OTTOeject trennen!")
    return {
        "success": arm_ok or not arme,
        "arm_stopped": arm_ok,
        "arms": arme,
        "printers": drucker,
        "halted": angehalten,
        "message": meldung,
    }


@router.post("/resume")
async def resume_operations(db: Session = Depends(get_db)):
    """Nach dem Notaus wieder freigeben.

    Klipper steht nach M112 im Zustand „shutdown" und nimmt bis zum Firmware-Neustart
    keinen Befehl an — ohne diesen Schritt bliebe der Arm nach „Fortsetzen" trotzdem
    stumm. Die Farm startet NICHT von selbst wieder: wer nach einem Notaus weitermacht,
    soll das bewusst tun. Die erste Bewegung referenziert automatisch (needs_home)."""
    from app.services.moonraker import MoonrakerAPI
    arme = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).all()
    neu = await asyncio.gather(*(MoonrakerAPI(d).firmware_restart() for d in arme),
                               return_exceptions=True)

    for device in db.query(Device).all():
        device.is_active = True
        db.add(device)
    db.commit()

    fehlgeschlagen = [d.name for d, r in zip(arme, neu) if r is not True]
    return {
        "success": not fehlgeschlagen,
        "restarted": [d.name for d, r in zip(arme, neu) if r is True],
        "failed": fehlgeschlagen,
        "message": ("Betrieb freigegeben — die Farm startet nicht von selbst, die erste "
                    "Bewegung referenziert." if not fehlgeschlagen else
                    f"Klipper-Neustart fehlgeschlagen: {', '.join(fehlgeschlagen)}"),
    }


@router.get("/emergency-state")
async def emergency_state(db: Session = Depends(get_db)):
    """Ist ein Notaus aktiv? Steht in der Datenbank — sonst wüsste die Oberfläche nach
    dem Neuladen der Seite nichts davon, und „Fortsetzen" bliebe ausgegraut."""
    return {"active": notaus_aktiv(db)}


# ── Klipper direkt ───────────────────────────────────────────────────────────
@router.post("/klipper/gcode")
async def send_klipper_gcode(request: dict, db: Session = Depends(get_db)):
    """Send raw GCode to Klipper via Moonraker (Z move, jog, single-step test). Returns as
    soon as the move has started — never holds the request open for the whole physical
    motion (see _fire_moonraker_script). RACK=-Nummern werden in die Geräte-Zählung
    gespiegelt (Printloom R1 = am Drucker, Geräte-Macro Regal 1 = am Homing-Punkt)."""
    gcode = request.get("gcode", "").strip()
    if not gcode:
        raise HTTPException(400, "Kein GCode angegeben")
    gcode, running = await _send_script(db, gcode)
    return {"success": True, "gcode": gcode, "running": running}


@router.get("/klipper/position")
async def get_klipper_position(db: Session = Depends(get_db)):
    """Aktuelle Werkzeugposition aus Moonraker."""
    th = await _toolhead(_klipper(db))
    pos = th.get("position", [0, 0, 0, 0])
    return {"success": True, "x": round(pos[0], 2), "y": round(pos[1], 2),
            "z": round(pos[2], 2), "homed_axes": th.get("homed_axes", "")}


@router.get("/klipper/info")
async def get_klipper_info(db: Session = Depends(get_db)):
    """Zustand der Klipper-Firmware (Moonraker /printer/info)."""
    r = await _moonraker_get(_klipper(db), "/printer/info")
    data = r.json().get("result", {})
    state = data.get("state", "unknown")
    return {"success": True, "state": state, "state_message": data.get("state_message", ""),
            "ready": state == "ready", "software_version": data.get("software_version", "")}


@router.get("/klipper/configs")
async def list_klipper_configs(db: Session = Depends(get_db)):
    """.cfg-Dateien im Konfig-Ordner von Moonraker."""
    r = await _moonraker_get(_klipper(db), "/server/files/list?root=config")
    files = [
        {"filename": f["filename"], "size": f.get("size", 0), "modified": f.get("modified", 0)}
        for f in r.json().get("result", [])
        if isinstance(f, dict) and f.get("filename", "").endswith(".cfg")
    ]
    return {"files": sorted(files, key=lambda x: x["filename"])}


@router.get("/klipper/config/{filename:path}")
async def read_klipper_config(filename: str, db: Session = Depends(get_db)):
    """Eine .cfg aus dem Konfig-Ordner lesen (nur lesend)."""
    if not filename.endswith(".cfg"):
        raise HTTPException(400, "Nur .cfg Dateien erlaubt")
    try:
        r = await _moonraker_get(_klipper(db), f"/server/files/config/{filename}", timeout=10.0)
    except HTTPException as e:
        if e.status_code == 404:
            raise HTTPException(404, f"Datei '{filename}' nicht gefunden")
        raise
    return {"filename": filename, "content": r.text}


@router.get("/status")
async def get_control_status(db: Session = Depends(get_db)):
    """Übersicht der eingerichteten Geräte."""
    devices = db.query(Device).all()
    return {
        "total_devices": len(devices),
        "active_devices": sum(1 for d in devices if d.is_active),
        "devices": [{"id": d.id, "name": d.name, "type": d.device_type.value,
                     "is_active": d.is_active, "ip_address": d.ip_address}
                    for d in devices],
    }


# ── OTTOeject-Geometrie: Printloom kennt ALLE Koordinaten (Single Source) ────
# Statt Klipper-Macros erzeugt Printloom die G-code-Sequenzen aus dieser Geometrie.
def _rack_config() -> dict | None:
    """Globale Rack-Konfiguration — eine Quelle für Regalzahl / Fächer / Magazin-Fach."""
    try:
        return rack_store.load()
    except Exception:
        return None


def _mirror_for_device(script: str) -> str:
    """RACK=-Nummern für das Gerät spiegeln: Printloom zählt R1 = Regal am Drucker,
    die Klipper-Macros auf dem OTTOeject zählen Regal 1 = am Homing-Punkt (rechts).
    Übersetzung passiert IMMER erst beim Senden — Anzeige bleibt Printloom-Zählung."""
    try:
        return _motion.mirror_rack_params(script, (_rack_config() or {}).get("num_racks"))
    except Exception:
        return script


def _load_geometry() -> dict:
    """Gespeicherte Geometrie — die EINZIGE Quelle für alle X-Positionen, in der vollen
    Form (ein Block je Drucker/Regal, absolute Werte): so liest die Oberfläche genau
    die Zahlen, die auch gefahren werden."""
    g = _motion.merge_defaults(_storage.read_json(GEOMETRY_PATH, None))
    g = _motion.apply_rack_config(g, _rack_config())
    return _motion.expand(_motion.apply_layout(g, None))


def _geometry_from_request(request: dict) -> dict:
    """Geometrie aus dem Request (Vorschau/Test mit ungespeicherten Werten) ODER die
    gespeicherte — in beiden Fällen Regalzahl/Fächer/Magazin global überlagern."""
    geom = request.get("geometry")
    if geom is None:
        return _load_geometry()
    return _motion.apply_layout(_motion.apply_rack_config(geom, _rack_config()), None)


@router.get("/ottoeject/geometry")
async def get_ottoeject_geometry():
    """Gespeicherte Geometrie (mit Defaults aufgefüllt)."""
    return {"success": True, "geometry": _load_geometry()}


@router.put("/ottoeject/geometry")
async def put_ottoeject_geometry(geometry: dict):
    """Geometrie speichern (Printloom merkt sich alle Positionen).

    Gespeichert wird IMMER — der Nutzer soll zwischendurch abspeichern können. Die
    Antwort enthält aber das Prüfergebnis (`check`), damit die UI unplausible Werte
    sofort zeigt, statt sie stillschweigend zu übernehmen. Gesendet wird eine
    fehlerhafte Bewegung ohnehin nicht (siehe /ottoeject/op)."""
    merged = _motion.merge_defaults(geometry)
    _storage.write_json(GEOMETRY_PATH, merged)
    return {"success": True, "geometry": merged,
            "check": _geometry_check.check_geometry(_load_geometry())}


@router.post("/ottoeject/geometry/check")
async def check_ottoeject_geometry(request: dict = None):
    """Geometrie prüfen, ohne zu speichern (Vorschau beim Einstellen).
    Body: {geometry?} — ohne Angabe wird die gespeicherte geprüft."""
    geom = _geometry_from_request(request or {})
    return {"success": True, "check": _geometry_check.check_geometry(geom)}


@router.get("/ottoeject/limits")
async def get_ottoeject_limits(db: Session = Depends(get_db)):
    """Achsgrenzen vom Gerät lesen (Klipper `toolhead.axis_maximum`).

    Damit muss niemand raten, wie weit seine X-Schiene reicht: einmal holen, in der
    Geometrie speichern — danach wird jede Bewegung vor dem Senden dagegen geprüft."""
    limits = _geometry_check.limits_from_toolhead(await _toolhead(_klipper(db)))
    if not limits:
        raise HTTPException(502, "Moonraker hat keine Achsgrenzen gemeldet "
                                 "(toolhead.axis_maximum fehlt)")
    return {"success": True, "limits": limits, "standard": _geometry_check.STANDARD_LIMITS}


@router.post("/ottoeject/jog")
async def jog_ottoeject(request: dict, db: Session = Depends(get_db)):
    """Einmessen: den Arm um einen kleinen Weg verfahren und die neue Position melden.

    Body: {axis: "x"|"y"|"z", delta: mm, feed?: mm/min}

    Der Weg wird VORHER gegen die Achsgrenzen geprüft (sofern bekannt) und gegen 0 —
    beim Einmessen tippt man sich sonst schnell aus der Achse, und Klipper bricht dann
    mitten in der Bewegung ab. Gesendet wird absolut (Zielposition), nicht relativ:
    G91 würde nach einem Fehlschlag auf einer unbekannten Ist-Position aufsetzen.
    """
    axis = str(request.get("axis", "")).strip().lower()
    if axis not in ("x", "y", "z"):
        raise HTTPException(400, "Achse muss x, y oder z sein")
    try:
        delta = float(request.get("delta"))
    except (TypeError, ValueError):
        raise HTTPException(400, "Kein gültiger Weg (delta)")
    if delta == 0:
        raise HTTPException(400, "Weg ist 0")
    if abs(delta) > 100:
        raise HTTPException(400, "Einzelschritt beim Einmessen ist auf 100 mm begrenzt")

    klipper = _klipper(db, bewegt=True)

    # Ist-Position lesen — ohne sie wüssten wir das Ziel nicht und könnten es nicht prüfen.
    try:
        th = await _toolhead(klipper)
    except HTTPException as e:
        raise HTTPException(502, f"Position nicht lesbar: {e.detail}")
    pos = th.get("position") or []
    homed = str(th.get("homed_axes", "")).lower()
    if axis not in homed:
        raise HTTPException(400, f"Achse {axis.upper()} ist nicht referenziert — erst homen")
    try:
        current = float(pos[{"x": 0, "y": 1, "z": 2}[axis]])
    except (IndexError, TypeError, ValueError):
        raise HTTPException(502, "Position nicht lesbar (unerwartete Antwort)")

    target = round(current + delta, 3)
    limits = _geometry_check.limits_from(_load_geometry())
    if target < 0:
        raise HTTPException(400, f"{axis.upper()} {target:g} mm läge unter dem Endschalter (0 mm)")
    if limits.get(axis) is not None and target > limits[axis]:
        raise HTTPException(400, f"{axis.upper()} {target:g} mm läge über der Achsgrenze "
                                 f"{limits[axis]:g} mm")

    try:
        feed = max(60, min(6000, int(request.get("feed", 1500))))
    except (TypeError, ValueError):
        feed = 1500
    script = f"G90\nG1 {axis.upper()}{target:g} F{feed}\nM400"
    running = await _fire_moonraker_script(f"{_base(klipper)}/printer/gcode/script", script)
    return {"success": True, "axis": axis, "from": round(current, 3), "to": target,
            "running": running}


@router.post("/ottoeject/op")
async def run_ottoeject_op(request: dict, db: Session = Depends(get_db)):
    """Eine OTTOeject-Bewegung aus der gespeicherten Geometrie erzeugen und live senden.

    Body: {op: grab|store|eject|load|open_door|close_door|approach|park|home,
           rack?, slot?, printer?, nolift?, geometry?, force?}
    `geometry` optional = Vorschau/Test mit ungespeicherten Werten (sonst gespeicherte).
    `printer` = id des Druckers bei Drucker-Operationen (ohne Angabe: der erste).
    `force` = Achsprüfung übergehen (nur für den bewussten Ausnahmefall).
    """
    op = (request.get("op") or "").strip()
    if not op:
        raise HTTPException(400, "Keine Operation angegeben")
    geom = _geometry_from_request(request)
    try:
        script = _motion.build_op(
            geom, op,
            rack=int(request.get("rack", 1) or 1),
            slot=int(request.get("slot", 1) or 1),
            nolift=request.get("nolift"),
            check=not request.get("force"),
            printer=request.get("printer"),
        )
    except (_geometry_check.GeometryError, ValueError) as e:
        # Bewegung würde die Achse verlassen → NICHT senden. Klipper würde sie mitten
        # im Ablauf abbrechen; hier kommt stattdessen eine Meldung mit Achse und Wert.
        raise HTTPException(400, str(e))
    # Falls ein gcode_override ein Geräte-Macro mit RACK=… aufruft: Nummer spiegeln.
    script, running = await _send_script(db, script)
    return {"success": True, "op": op, "script": script, "running": running}


@router.post("/ottoeject/preview")
async def preview_ottoeject_op(request: dict):
    """Nur die G-code-Sequenz zeigen (ohne zu senden) — für die Anzeige."""
    op = (request.get("op") or "").strip()
    if not op:
        raise HTTPException(400, "Keine Operation angegeben")
    geom = _geometry_from_request(request)
    rack = int(request.get("rack", 1) or 1)
    slot = int(request.get("slot", 1) or 1)
    printer = request.get("printer")
    # `template` = die eingebaute Bewegung MIT Platzhaltern statt fertiger
    # Koordinaten — Startpunkt zum Bearbeiten, der über alle Regale/Fächer gilt.
    if request.get("template"):
        try:
            return {"success": True, "op": op, "template": True,
                    "script": _motion.op_template(geom, op, rack=rack, slot=slot)}
        except ValueError as e:
            raise HTTPException(400, str(e))
    try:
        # Vorschau prüft NICHT (check=False): sie soll auch unplausiblen G-code zeigen
        # können — die Probleme kommen daneben als `problems` mit.
        script = _motion.build_op(geom, op, rack=rack, slot=slot,
                                  nolift=request.get("nolift"), check=False,
                                  printer=printer)
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Vorschau zeigt exakt das, was gesendet würde (inkl. gespiegelter RACK=-Nummern).
    # Geprüft wird der eben gebaute G-code (das Spiegeln ändert nur RACK=-Nummern,
    # keine Koordinaten) — kein zweiter Aufbau nötig.
    return {"success": True, "op": op, "script": _mirror_for_device(script),
            "problems": _geometry_check.check_script(script, geom, op, rack, slot, printer)}
