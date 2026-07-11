from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.schemas.schemas import MacroExecutionRequest, MacroExecutionResponse
from datetime import datetime
import httpx

router = APIRouter()

# Macro names for Klipper
VALID_MACROS = {
    "GRAB_FROM_SLOT_1", "GRAB_FROM_SLOT_2", "GRAB_FROM_SLOT_3",
    "GRAB_FROM_SLOT_4", "GRAB_FROM_SLOT_5", "GRAB_FROM_SLOT_6",
    "STORE_TO_SLOT_1", "STORE_TO_SLOT_2", "STORE_TO_SLOT_3",
    "STORE_TO_SLOT_4", "STORE_TO_SLOT_5", "STORE_TO_SLOT_6",
    "OPEN_DOOR_BAMBU_X_ONE_C", "CLOSE_DOOR_BAMBU_X_ONE_C",
    "EJECT_FROM_BAMBULAB_X_ONE_C", "LOAD_ONTO_BAMBULAB_X_ONE_C",
    "OTTOEJECT_HOME", "PARK_OTTOEJECT", "TEST_STORAGE_RACK_CONFIGURATION"
}

@router.post("/macro", response_model=MacroExecutionResponse)
async def execute_macro(request: MacroExecutionRequest, db: Session = Depends(get_db)):
    """Execute a Klipper macro via Moonraker API"""
    
    # Validate macro name
    if request.macro_name not in VALID_MACROS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid macro. Valid macros: {', '.join(sorted(VALID_MACROS))}"
        )
    
    # Get Klipper device
    klipper_device = db.query(Device).filter(
        Device.device_type == PrinterType.KLIPPER
    ).first()
    
    if not klipper_device:
        raise HTTPException(
            status_code=400,
            detail="Klipper device not configured"
        )
    
    if not klipper_device.is_active:
        raise HTTPException(
            status_code=400,
            detail="Klipper device is not active"
        )
    
    try:
        # Execute macro via Moonraker API
        url = f"http://{klipper_device.ip_address}:{klipper_device.port}/printer/gcode/script"
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                json={"script": request.macro_name}
            )
        
        if response.status_code == 200:
            return MacroExecutionResponse(
                success=True,
                macro_name=request.macro_name,
                message="Macro executed successfully",
                timestamp=datetime.utcnow()
            )
        else:
            return MacroExecutionResponse(
                success=False,
                macro_name=request.macro_name,
                message=f"Macro execution failed: {response.text}",
                timestamp=datetime.utcnow()
            )
    
    except Exception as e:
        return MacroExecutionResponse(
            success=False,
            macro_name=request.macro_name,
            message=f"Error executing macro: {str(e)}",
            timestamp=datetime.utcnow()
        )

@router.get("/macros")
async def list_macros():
    """List available macros"""
    return {
        "macros": sorted(VALID_MACROS),
        "total": len(VALID_MACROS)
    }


@router.get("/app-ops")
async def list_app_ops():
    """Printloom-eigene Operationen (Drucker-Tab-Geometrie → G-code), die in Sequenzen
    als app_op-Schritt frei nutzbar sind — wie Geräte-Macros, aber immer App-G-code."""
    from app.services.ottoeject_motion import APP_OPS
    return {"ops": APP_OPS}

@router.get("/macro/{macro_name}")
async def get_macro_info(macro_name: str):
    """Get information about a specific macro"""
    if macro_name not in VALID_MACROS:
        raise HTTPException(status_code=404, detail="Macro not found")
    
    macro_descriptions = {
        "GRAB_FROM_SLOT_1": "Grab part from slot 1",
        "GRAB_FROM_SLOT_2": "Grab part from slot 2",
        "GRAB_FROM_SLOT_3": "Grab part from slot 3",
        "GRAB_FROM_SLOT_4": "Grab part from slot 4",
        "GRAB_FROM_SLOT_5": "Grab part from slot 5",
        "GRAB_FROM_SLOT_6": "Grab part from slot 6",
        "STORE_TO_SLOT_1": "Store part to slot 1",
        "STORE_TO_SLOT_2": "Store part to slot 2",
        "STORE_TO_SLOT_3": "Store part to slot 3",
        "STORE_TO_SLOT_4": "Store part to slot 4",
        "STORE_TO_SLOT_5": "Store part to slot 5",
        "STORE_TO_SLOT_6": "Store part to slot 6",
        "OPEN_DOOR_BAMBU_X_ONE_C": "Open Bambu Lab X1C door",
        "CLOSE_DOOR_BAMBU_X_ONE_C": "Close Bambu Lab X1C door",
        "EJECT_FROM_BAMBULAB_X_ONE_C": "Eject plate from Bambu Lab X1C",
        "LOAD_ONTO_BAMBULAB_X_ONE_C": "Load plate onto Bambu Lab X1C",
        "OTTOEJECT_HOME": "Home OTTOeject system",
        "PARK_OTTOEJECT": "Park OTTOeject in safe position",
        "TEST_STORAGE_RACK_CONFIGURATION": "Test storage rack configuration"
    }
    
    return {
        "macro_name": macro_name,
        "description": macro_descriptions.get(macro_name, "No description available")
    }

@router.post("/emergency-stop")
async def emergency_stop(db: Session = Depends(get_db)):
    """Emergency stop all operations"""
    # Deactivate all devices
    devices = db.query(Device).all()
    for device in devices:
        device.is_active = False
        db.add(device)
    db.commit()
    
    return {
        "success": True,
        "message": "Emergency stop activated - all devices deactivated"
    }

@router.post("/resume")
async def resume_operations(db: Session = Depends(get_db)):
    """Resume operations after emergency stop"""
    # Reactivate all devices
    devices = db.query(Device).all()
    for device in devices:
        device.is_active = True
        db.add(device)
    db.commit()
    
    return {
        "success": True,
        "message": "Operations resumed"
    }

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


@router.post("/klipper/gcode")
async def send_klipper_gcode(request: dict, db: Session = Depends(get_db)):
    """Send raw GCode to Klipper via Moonraker (Z move, jog, single-step test). Returns as
    soon as the move has started — never holds the request open for the whole physical
    motion (see _fire_moonraker_script)."""
    gcode = request.get("gcode", "").strip()
    if not gcode:
        raise HTTPException(400, "Kein GCode angegeben")

    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    # RACK=-Nummern in die Geräte-Zählung spiegeln (Printloom R1 = am Drucker,
    # Geräte-Macro Regal 1 = am Homing-Punkt rechts) — siehe mirror_rack_params.
    gcode = _mirror_for_device(gcode)

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    running = await _fire_moonraker_script(url, gcode)
    return {"success": True, "gcode": gcode, "running": running}


@router.get("/klipper/position")
async def get_klipper_position(db: Session = Depends(get_db)):
    """Query current toolhead position from Moonraker."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/objects/query?toolhead"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json()
        th = data.get("result", {}).get("status", {}).get("toolhead", {})
        pos = th.get("position", [0, 0, 0, 0])
        return {
            "success": True,
            "x": round(pos[0], 2),
            "y": round(pos[1], 2),
            "z": round(pos[2], 2),
            "homed_axes": th.get("homed_axes", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/ottoeject/variables")
async def get_ottoeject_variables(db: Session = Depends(get_db)):
    """Read _GLOBAL_VARS from Klipper/Moonraker (storage calibration)."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = (
        f"http://{klipper.ip_address}:{klipper.port}"
        "/printer/objects/query?gcode_macro%20_GLOBAL_VARS"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker Fehler: {r.text}")
        data = r.json()
        variables = (
            data.get("result", {})
                .get("status", {})
                .get("gcode_macro _GLOBAL_VARS", {})
        )
        return {"success": True, "variables": variables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


_ALLOWED_VARS = {
    "global_x_unclamp",
    "global_y_engage",
    "global_first_z_flat",
    "global_slot_gap",
    "global_y_pullback_limit",
}


@router.post("/ottoeject/variables")
async def set_ottoeject_variables(variables: dict, db: Session = Depends(get_db)):
    """Set _GLOBAL_VARS at runtime via SET_GCODE_VARIABLE (resets on Klipper restart)."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    lines = [
        f"SET_GCODE_VARIABLE MACRO=_GLOBAL_VARS VARIABLE={k} VALUE={float(v)}"
        for k, v in variables.items()
        if k in _ALLOWED_VARS
    ]
    if not lines:
        raise HTTPException(400, "Keine gültigen Variablen übergeben")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json={"script": "\n".join(lines)})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker Fehler: {r.text}")
        return {"success": True, "message": "Variablen aktualisiert", "applied": list(variables.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/info")
async def get_klipper_info(db: Session = Depends(get_db)):
    """Query Klipper firmware state via Moonraker /printer/info."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/info"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json().get("result", {})
        state = data.get("state", "unknown")
        return {
            "success": True,
            "state": state,
            "state_message": data.get("state_message", ""),
            "ready": state == "ready",
            "software_version": data.get("software_version", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/configs")
async def list_klipper_configs(db: Session = Depends(get_db)):
    """List config files available in Moonraker's config root."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    url = f"http://{klipper.ip_address}:{klipper.port}/server/files/list?root=config"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json().get("result", [])
        files = [
            {"filename": f["filename"], "size": f.get("size", 0), "modified": f.get("modified", 0)}
            for f in data if isinstance(f, dict) and f.get("filename", "").endswith(".cfg")
        ]
        return {"files": sorted(files, key=lambda x: x["filename"])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/config/{filename:path}")
async def read_klipper_config(filename: str, db: Session = Depends(get_db)):
    """Read a single .cfg file from Moonraker's config root."""
    if not filename.endswith(".cfg"):
        raise HTTPException(400, "Nur .cfg Dateien erlaubt")
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    url = f"http://{klipper.ip_address}:{klipper.port}/server/files/config/{filename}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
        if r.status_code == 404:
            raise HTTPException(404, f"Datei '{filename}' nicht gefunden")
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return {"filename": filename, "content": r.text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/status")
async def get_control_status(db: Session = Depends(get_db)):
    """Get overall control system status"""
    devices = db.query(Device).all()
    active_devices = sum(1 for d in devices if d.is_active)
    
    return {
        "total_devices": len(devices),
        "active_devices": active_devices,
        "devices": [
            {
                "id": d.id,
                "name": d.name,
                "type": d.device_type.value,
                "is_active": d.is_active,
                "ip_address": d.ip_address
            }
            for d in devices
        ]
    }


# ── OTTOeject-Geometrie: Printloom kennt ALLE Koordinaten (Single Source) ────
# Statt Klipper-Macros erzeugt Printloom die G-code-Sequenzen aus dieser Geometrie.
from app.services import storage as _storage
from app.services import ottoeject_motion as _motion
from app.paths import db_path

GEOMETRY_PATH = db_path("ottoeject_geometry.json")


def _rack_config() -> dict | None:
    """Globale Rack-Konfiguration (Configuration → Rack Configuration) — eine Quelle
    für Regalzahl / Fächer / Magazin-Fach."""
    try:
        from app.routers.rack_manager import _load as _rack_load
        return _rack_load()
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
    g = _motion.merge_defaults(_storage.read_json(GEOMETRY_PATH, None))
    return _motion.apply_rack_config(g, _rack_config())


def _geometry_from_request(request: dict) -> dict:
    """Geometrie aus dem Request (Vorschau/Test mit ungespeicherten Werten) ODER die
    gespeicherte — in beiden Fällen Regalzahl/Fächer/Magazin global überlagern."""
    geom = request.get("geometry")
    if geom is None:
        return _load_geometry()
    return _motion.apply_rack_config(geom, _rack_config())


@router.get("/ottoeject/geometry")
async def get_ottoeject_geometry():
    """Gespeicherte Geometrie (mit Defaults aufgefüllt)."""
    return {"success": True, "geometry": _load_geometry()}


@router.put("/ottoeject/geometry")
async def put_ottoeject_geometry(geometry: dict):
    """Geometrie speichern (Printloom merkt sich alle Positionen)."""
    merged = _motion.merge_defaults(geometry)
    _storage.write_json(GEOMETRY_PATH, merged)
    return {"success": True, "geometry": merged}


@router.post("/ottoeject/op")
async def run_ottoeject_op(request: dict, db: Session = Depends(get_db)):
    """Eine OTTOeject-Bewegung aus der gespeicherten Geometrie erzeugen und live senden.

    Body: {op: grab|store|eject|load|open_door|close_door|approach|park|home,
           rack?, slot?, nolift?, geometry?}
    `geometry` optional = Vorschau/Test mit ungespeicherten Werten (sonst gespeicherte).
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
        )
    except ValueError as e:
        raise HTTPException(400, str(e))

    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    # Falls ein gcode_override ein Geräte-Macro mit RACK=… aufruft: Nummer spiegeln.
    script = _mirror_for_device(script)
    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    running = await _fire_moonraker_script(url, script)
    return {"success": True, "op": op, "script": script, "running": running}


@router.post("/ottoeject/preview")
async def preview_ottoeject_op(request: dict):
    """Nur die G-code-Sequenz zeigen (ohne zu senden) — für die Anzeige."""
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
        )
    except ValueError as e:
        raise HTTPException(400, str(e))
    # Vorschau zeigt exakt das, was gesendet würde (inkl. gespiegelter RACK=-Nummern).
    return {"success": True, "op": op, "script": _mirror_for_device(script)}
