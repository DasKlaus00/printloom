"""Bambu-Drucker: Direktdruck, Status, Kamera, Einstellungen, AMS-Aktionen.

Die Auswertung der Druckdateien liegt in app/services/print_file.py, der
AMS-Abgleich in app/services/ams_match.py — beides teilen sich Direktdruck und
Farm, damit sie nie unterschiedlich entscheiden.
"""
import asyncio
import json
import logging
import os
import re
import threading
import time
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session

from app.db.database import get_db, SessionLocal
from app.models.models import Device, PrinterType, UploadedFile
from app.services import ams_match, bambu_manager, camera, device_settings, print_file, storage
from app.services.bambu_ftp import BambuFTP

router = APIRouter()
logger = logging.getLogger(__name__)

# ── AMS Send-Diagnostics ─────────────────────────────────────────────────────
from app.paths import db_path, UPLOADS_DIR
SEND_DIAG_PATH = db_path("send_diagnostics.json")
_diag_sessions: list = []


def _diag_load():
    global _diag_sessions
    try:
        if os.path.exists(SEND_DIAG_PATH):
            with open(SEND_DIAG_PATH) as f:
                _diag_sessions = json.load(f)
    except Exception:
        _diag_sessions = []

def _diag_save():
    try:
        storage.write_json(SEND_DIAG_PATH, _diag_sessions)
    except Exception:
        pass

def _diag_begin(filename: str, file_id: int) -> dict:
    sess = {
        "ts":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "file":    filename,
        "file_id": file_id,
        "steps":   [],
        "result":  "running",
    }
    _diag_sessions.insert(0, sess)
    while len(_diag_sessions) > 30:
        _diag_sessions.pop()
    return sess

def _diag_add(sess: dict, title: str, lines: list, ok: bool = True):
    sess["steps"].append({"title": title, "lines": lines, "ok": ok})
    _diag_save()

def _diag_finish(sess: dict, result: str):
    sess["result"] = result
    _diag_save()

_diag_load()

HISTORY_PATH = db_path("print_history.json")

def _append_history(entry: dict):
    try:
        history = storage.read_json(HISTORY_PATH, [])
        history.insert(0, entry)
        history = history[:200]  # keep last 200
        storage.write_json(HISTORY_PATH, history)
    except Exception as e:
        logger.warning(f"print history write failed: {e}")


def _utc_marked(ts):
    """Zeitstempel mit Zeitzonen-Marker zurückgeben.

    Bis v1.1.18 wurde hier `datetime.utcnow().isoformat()` geschrieben: UTC, aber
    OHNE Marker. `new Date("2026-08-18T16:30:00")` liest so etwas im Browser als
    LOKALE Zeit — im Sommer zeigte die Anzeige zwei Stunden zu früh. Alles andere in
    Printloom (Farm-Log, HMS-Historie, Timeline, farm_completed) schreibt lokale Zeit
    und stimmte; in einer App lagen damit zwei Konventionen.

    Geschrieben wird jetzt UTC MIT Marker. Damit Bestandseinträge nicht plötzlich in
    die andere Richtung verrutschen, bekommt ein Eintrag ohne Marker hier beim Lesen
    denselben nachgetragen — er war ja bereits UTC.
    """
    if not isinstance(ts, str) or not ts:
        return ts
    tail = ts[10:]                       # hinter dem Datum: T…, evtl. Offset/Z
    if ts.endswith("Z") or "+" in tail or "-" in tail:
        return ts
    return ts + "+00:00"


@router.get("/history")
def get_history():
    if not os.path.exists(HISTORY_PATH):
        return {"items": []}
    try:
        with open(HISTORY_PATH) as f:
            items = json.load(f)
        if isinstance(items, list):
            for it in items:
                if isinstance(it, dict) and "ts" in it:
                    it["ts"] = _utc_marked(it["ts"])
        return {"items": items}
    except Exception:
        return {"items": []}


# ── Snapshots ────────────────────────────────────────────────────────────────

SNAP_DIR = UPLOADS_DIR / "snapshots"
_SNAP_NAME = re.compile(r"snap_\d+_\d{8}_\d{6}\.jpg")

def _get_webcam_url(db: Session, device_id: int) -> str:
    return device_settings.get(db, device_id).get("webcam_url", "")


def _camera_enabled(db: Session, device_id: int) -> bool:
    """Camera on/off toggle. Absent = enabled, so a freshly added printer shows it."""
    return device_settings.get(db, device_id).get("camera_enabled", True) is not False


async def capture_snapshot(device_id: int) -> Optional[str]:
    """Best-effort webcam grab for the AutoFarm loop. Uses the configured webcam_url
    if set, otherwise the printer's built-in camera (X1 → RTSPS, P1/A1 → Port 6000;
    camera.py picks the right one). Returns the saved filename or None if unavailable.
    Never raises."""
    db = SessionLocal()
    settings = {}
    try:
        if not _camera_enabled(db, device_id):
            return None  # Kamera per Toggle aus → keine (auto.) Snapshots
        webcam_url = _get_webcam_url(db, device_id)
        settings = device_settings.get(db, device_id)
        device = db.query(Device).filter(Device.id == device_id).first()
        ip, code = (device.ip_address, device.access_code) if device else (None, None)
        if device:
            # Force-load the attributes the MQTT/camera client needs before the
            # session closes (the instance is detached afterwards → DetachedInstanceError).
            _ = (device.serial_number, device.use_tls, device.mqtt_port, device.id)
            db.expunge(device)
    finally:
        db.close()
    try:
        SNAP_DIR.mkdir(parents=True, exist_ok=True)
        if webcam_url:
            async with httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(webcam_url, follow_redirects=True)
                r.raise_for_status()
                img_bytes = r.content
        elif ip and code:
            # Kamera global deaktiviert (Energiesparmodus) → kein ffmpeg-Snapshot,
            # auch das Kammerlicht nicht anfassen. Externe webcam_url oben bleibt.
            from app.services import appsettings
            if appsettings.camera_disabled():
                return None
            loop = asyncio.get_running_loop()
            if device:
                _ensure_chamber_light_async(device)
            img_bytes = await loop.run_in_executor(
                camera.executor, camera.single_frame, device, settings)
        else:
            return None
        if not img_bytes:
            return None
        fname = f"snap_{device_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        (SNAP_DIR / fname).write_bytes(img_bytes)
        return fname
    except Exception as e:
        logger.warning(f"capture_snapshot failed: {e}")
        return None


def _ensure_chamber_light(device, on: bool = True) -> None:
    """Best-effort: switch the X1C chamber LED on so the camera isn't black.
    Nutzt die persistente Verbindung (bambu_manager) — KEIN eigener Connect/Disconnect
    pro Kamerabild mehr (das war eine Hauptquelle der Verbindungsabbrüche). Never raises."""
    try:
        bambu_manager.set_chamber_light(device, on)
    except Exception as e:
        logger.warning(f"chamber light toggle failed for device {device.id}: {e}")


_light_last_sent: dict = {}   # device_id → monotonic ts des letzten "Licht an"
_LIGHT_DEDUPE_S = 60.0


def _ensure_chamber_light_async(device, on: bool = True) -> None:
    """Fire-and-forget light toggle so it never delays the camera stream/first frame.
    Dedupe: Kamera-Stream/-Frame/-Snapshot rufen das bei JEDEM Zugriff — dasselbe
    "an" nicht öfter als einmal pro Minute je Drucker über MQTT schicken."""
    if on:
        now = time.monotonic()
        last = _light_last_sent.get(device.id, 0)
        if now - last < _LIGHT_DEDUPE_S:
            return
        _light_last_sent[device.id] = now
    threading.Thread(target=_ensure_chamber_light, args=(device, on), daemon=True).start()


@router.get("/camera/{device_id}")
def camera_stream(device_id: int, db: Session = Depends(get_db)):
    """Live MJPEG stream from the printer's built-in camera. The backend picks the
    right protocol per model (X1 → RTSPS:322 via ffmpeg, P1/A1 → JPEG:6000). Served
    as multipart/x-mixed-replace so a plain <img> shows the live image — no Home
    Assistant, just the printer IP + access code."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(404, "Gerät nicht gefunden")
    # Global deaktiviert (System → Kamera): klare Meldung VOR Licht/Stream.
    from app.services import appsettings
    if appsettings.camera_disabled():
        raise HTTPException(503, "Kamera in Printloom deaktiviert (System → Kamera) — Energiesparmodus")
    settings = device_settings.get(db, device_id)
    boundary = "ottoframe"

    # DB-Sitzung JETZT freigeben. Bei einer StreamingResponse räumt FastAPI die
    # get_db-Abhängigkeit erst auf, wenn der Stream endet — ein offener Kamera-Stream
    # hielt also stundenlang eine Verbindung aus dem SQLite-Pool fest. Zwei Tabs mit
    # Kamera plus die üblichen Abfragen ließen den Pool volllaufen, und dann warten
    # ALLE Requests (auch die ausgelieferten JS-Chunks) — „die Seite lädt nicht".
    # `device` ist danach losgelöst; die geladenen Spalten bleiben lesbar (close()
    # verfällt keine Attribute), und mehr braucht der Stream nicht.
    db.expunge(device)
    db.close()

    # Turn the chamber light on (non-blocking, so it can't delay the first frame).
    _ensure_chamber_light_async(device)

    # Geteilter Hub: EIN Client pro Drucker, alle Zuschauer teilen sich die Frames
    # (X1C erlaubt nur einen RTSP-Client, P1/A1 nur einen Port-6000-Client; mehrere
    # warfen sich früher gegenseitig raus). stream() wirft bei Verbindungs-/Auth-/
    # Liveview-Fehlern sofort → echtes HTTP 502 mit dem Grund.
    # Pull the FIRST frame synchronously so connection/auth/LAN failures surface as a
    # real HTTP 502 (→ the <img> onError fires and the UI shows the actual reason).
    # Otherwise StreamingResponse would already be committed and a failed camera would
    # just stream nothing → a silent black box with no error.
    try:
        frame_iter = camera.stream(device, settings)
        first = next(frame_iter)
    except StopIteration:
        raise HTTPException(502, "Kamera lieferte kein Bild (LAN-Modus am Drucker aktiv?)")
    except Exception as e:
        logger.warning(f"camera_stream first-frame failed for device {device_id}: {e}")
        raise HTTPException(502, f"Drucker-Kamera nicht erreichbar: {e}")

    def _part(img: bytes) -> bytes:
        return (b"--" + boundary.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(img)).encode() + b"\r\n\r\n"
                + img + b"\r\n")

    def gen():
        try:
            yield _part(first)
            for img in frame_iter:
                yield _part(img)
        except Exception as e:
            logger.warning(f"camera_stream ended for device {device_id}: {e}")
        finally:
            frame_iter.close()

    return StreamingResponse(
        gen(), media_type=f"multipart/x-mixed-replace; boundary={boundary}"
    )


@router.get("/camera/{device_id}/frame")
def camera_frame(device_id: int, db: Session = Depends(get_db)):
    """Single JPEG frame from the built-in camera (for snapshots / fallback).
    Backend picks the protocol per model (X1 → RTSPS, P1/A1 → Port 6000)."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(404, "Gerät nicht gefunden")
    from app.services import appsettings
    if appsettings.camera_disabled():
        raise HTTPException(503, "Kamera in Printloom deaktiviert (System → Kamera) — Energiesparmodus")
    settings = device_settings.get(db, device_id)
    _ensure_chamber_light_async(device)
    try:
        img = camera.single_frame(device, settings)
    except Exception as e:
        raise HTTPException(502, f"Kamera nicht erreichbar: {e}")
    if not img:
        raise HTTPException(502, "Kein Kamerabild empfangen")
    return Response(content=img, media_type="image/jpeg")


# ── Home-Assistant-Kamera-Proxy ───────────────────────────────────────────────
# Auf neuerer X1C-Firmware (≥01.11) lehnt der Drucker die einfache Port-6000-
# Kamera-Auth ab (er antwortet mit ff ff ff ff). Home Assistant (ha-bambulab) holt
# das Bild über Bambus proprietäre Methode und ist damit der "eine Client". Wir
# greifen den Stream von HA ab: HA bleibt alleiniger Kamera-Client, App + HA + App
# können gleichzeitig zusehen. Das HA-Token bleibt serverseitig (geht nie an den
# Browser); der Browser sieht nur diese same-origin-Proxy-URL.

def _get_ha_cam_cfg(db: Session, device_id: int):
    """(ha_url, token, entity) aus den Geräte-Einstellungen oder None."""
    s = device_settings.get(db, device_id)
    ha_url = (s.get("ha_url") or "").rstrip("/")
    token = s.get("ha_token") or ""
    entity = s.get("ha_camera") or ""
    return (ha_url, token, entity) if (ha_url and token and entity) else None


@router.get("/ha-camera/{device_id}")
async def ha_camera_stream(device_id: int, db: Session = Depends(get_db)):
    """Live-MJPEG der X1C-Kamera, durchgereicht von Home Assistant.
    Reicht HAs camera_proxy_stream (multipart/x-mixed-replace) 1:1 an den Browser
    weiter; das HA-Token bleibt serverseitig."""
    cfg = _get_ha_cam_cfg(db, device_id)
    if not cfg:
        raise HTTPException(400, "Home-Assistant-Kamera nicht konfiguriert (URL/Token/Entity fehlt)")
    # Wie beim eigenen Kamera-Stream: die Sitzung sofort zurückgeben, sonst bleibt
    # sie über die gesamte Stream-Dauer aus dem Pool ausgebucht.
    db.close()
    ha_url, token, entity = cfg
    upstream = f"{ha_url}/api/camera_proxy_stream/{entity}"
    headers = {"Authorization": f"Bearer {token}"}
    # read=None → der MJPEG-Stream läuft unbegrenzt, nur Connect bekommt ein Timeout.
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None), follow_redirects=True)
    try:
        req = client.build_request("GET", upstream, headers=headers)
        resp = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(502, f"Home Assistant nicht erreichbar: {e}")
    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        hint = "Token ungültig?" if resp.status_code == 401 else \
               "Entity-ID falsch?" if resp.status_code == 404 else ""
        raise HTTPException(502, f"HA-Kamera HTTP {resp.status_code} {hint}".strip())
    ctype = resp.headers.get("content-type", "multipart/x-mixed-replace; boundary=frame")

    async def gen():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        except Exception as e:
            logger.info(f"HA-Kamera-Stream beendet (device {device_id}): {e}")
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type=ctype)


@router.get("/ha-camera/{device_id}/test")
async def ha_camera_test(device_id: int, db: Session = Depends(get_db)):
    """Schneller Verbindungstest für die Konfigurations-UI → {ok, detail}."""
    cfg = _get_ha_cam_cfg(db, device_id)
    if not cfg:
        return {"ok": False, "detail": "Nicht konfiguriert — URL, Token und Entity-ID nötig."}
    ha_url, token, entity = cfg
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            r = await client.get(f"{ha_url}/api/camera_proxy/{entity}",
                                 headers={"Authorization": f"Bearer {token}"})
    except Exception as e:
        return {"ok": False, "detail": f"HA nicht erreichbar: {e}"}
    if r.status_code == 200 and r.content[:3] == b"\xff\xd8\xff":
        return {"ok": True, "detail": f"Bild empfangen ({len(r.content)} Bytes) ✓"}
    if r.status_code == 401:
        return {"ok": False, "detail": "401 — Token ungültig oder abgelaufen."}
    if r.status_code == 404:
        return {"ok": False, "detail": "404 — Entity-ID nicht gefunden."}
    if r.status_code == 200:
        return {"ok": False, "detail": "Antwort ist kein JPEG — Kamera in HA aktiv?"}
    return {"ok": False, "detail": f"HA-Kamera HTTP {r.status_code}"}


@router.post("/snapshot/{device_id}")
async def take_snapshot(device_id: int, db: Session = Depends(get_db)):
    """Aktuellen Webcam-Frame speichern."""
    webcam_url = _get_webcam_url(db, device_id)
    if not webcam_url:
        raise HTTPException(status_code=400, detail="Keine Webcam-URL für dieses Gerät konfiguriert")
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(webcam_url, follow_redirects=True)
            r.raise_for_status()
            img_bytes = r.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Webcam nicht erreichbar: {e}")
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    fname = f"snap_{device_id}_{ts}.jpg"
    (SNAP_DIR / fname).write_bytes(img_bytes)
    return {"filename": fname, "url": f"/api/printer/snapshots/{fname}", "timestamp": ts}


@router.get("/snapshots/{filename}")
def serve_snapshot(filename: str):
    """Einzelnen Snapshot als Bild zurückgeben."""
    # Nur Namen, die capture_snapshot/take_snapshot selbst erzeugen — kein Pfad,
    # kein "..", kein Backslash (unter Windows ein Trennzeichen).
    if not _SNAP_NAME.fullmatch(filename or ""):
        raise HTTPException(status_code=404, detail="Snapshot nicht gefunden")
    f = SNAP_DIR / filename
    if not f.is_file():
        raise HTTPException(status_code=404, detail="Snapshot nicht gefunden")
    return FileResponse(str(f), media_type="image/jpeg")


def _get_bambu_device(device_id: int, db: Session) -> Device:
    device = db.query(Device).filter(
        Device.id == device_id,
        Device.device_type == PrinterType.BAMBU_LAB
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Bambu Lab Gerät nicht gefunden")
    return device


@router.get("/plates/{file_id}")
def list_file_plates(file_id: int, db: Session = Depends(get_db)):
    """List the plate numbers inside a multi-plate .3mf (empty for single/.gcode).
    `names` = vom Slicer vergebene Platten-Namen ({"1": "…"}), soweit vorhanden.
    Synchron (def) → Threadpool: öffnet das ZIP-Archiv zweimal."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type != ".3mf" or not os.path.exists(file.file_path):
        return {"plates": [], "names": {}}
    try:
        with zipfile.ZipFile(file.file_path, 'r') as zf:
            names = print_file.plate_names(zf)
    except Exception:
        names = {}
    return {"plates": print_file.list_plates(file.file_path), "names": names}


def _diag_file_lines(file) -> tuple:
    """Für die Sende-Diagnose: konfigurierte AMS-Slots (project_settings) und die
    tatsächlich gedruckten Filamente (slice_info) als Textzeilen."""
    if file.file_type != '.3mf':
        return (["(G-Code-Datei — keine project_settings verfügbar)"],
                ["(G-Code-Datei — keine slice_info verfügbar)"])
    slot_lines, used_lines = [], []
    try:
        with zipfile.ZipFile(file.file_path, 'r') as z:
            names_z = z.namelist()
            cfg = next((n for n in names_z if 'project_settings' in n.lower()), None)
            if cfg:
                ps = json.loads(z.read(cfg))
                types = ps.get('filament_type', [])
                colors = ps.get('filament_colour', [])
                profiles = ps.get('filament_settings_id', [])
                n_temps = ps.get('nozzle_temperature', [])
                for i in range(max(len(types), len(colors), 1)):
                    slot_lines.append(
                        f"  A{i+1}:  {types[i] if i < len(types) else '?':<8}"
                        f"  {(profiles[i] if i < len(profiles) else ''):<24}"
                        f"  {(colors[i] if i < len(colors) else ''):<10}"
                        f"  {(str(n_temps[i]) + '°' if i < len(n_temps) else '')}")
            else:
                slot_lines.append("project_settings.config nicht im ZIP")

            si = next((n for n in names_z if 'slice_info' in n.lower()), None)
            if si:
                root = ET.fromstring(z.read(si))
                for fil in root.iter("filament"):
                    a = fil.attrib
                    fid = a.get("id", "?")
                    used_lines.append(
                        f"  id={fid} → A{fid}:  {a.get('type',''):<8}  {a.get('color',''):<10}"
                        f"  {a.get('used_m','?')}m  {a.get('used_g','?')}g  ← tatsächlich gedruckt")
                if not used_lines:
                    used_lines.append("Keine <filament>-Einträge in slice_info.config")
            else:
                used_lines.append("slice_info.config nicht im ZIP")
    except Exception as e:
        slot_lines.append(f"FEHLER: {e}")
    return slot_lines, used_lines


@router.post("/send/{device_id}/{file_id}")
async def send_file_to_printer(device_id: int, file_id: int, use_ams: bool = True, ams_slot: Optional[int] = None,
                               plate: Optional[int] = None, db: Session = Depends(get_db)):
    """Datei per FTPS auf den Drucker laden und Druck per MQTT starten.
    `plate`: bei Multi-Plate-.3mf GENAU diese Platte drucken (sonst die erste)."""
    from app.routers.control import assert_released
    from app.services import farm_settings
    assert_released(db)
    device = _get_bambu_device(device_id, db)

    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in (".3mf", ".gcode"):
        raise HTTPException(status_code=400, detail="Nur .3mf und .gcode Dateien können gesendet werden")
    loop = asyncio.get_running_loop()

    # ── Diagnose-Session starten ─────────────────────────────────
    sess = _diag_begin(file.original_filename, file_id)
    _diag_add(sess, "Datei & Einstellungen", [
        f"Datei:        {file.original_filename}",
        f"Typ:          {file.file_type}",
        f"Größe:        {round(file.file_size / 1024, 1)} KB",
        f"Drucker:      {device.name}  ({device.ip_address})",
        f"AMS aktiv:    {use_ams}",
        f"Slot-Override:{f'  A{ams_slot+1} (Index {ams_slot})' if ams_slot is not None else '  keiner'}",
    ])
    slot_lines, used_lines = await loop.run_in_executor(None, _diag_file_lines, file)
    _diag_add(sess, "Konfigurierte AMS-Slots  (project_settings.config)", slot_lines)
    _diag_add(sess, "Tatsächlich gedruckte Filamente  (slice_info.config)", used_lines)

    print_name = print_file.make_print_name(file.original_filename)

    # ── MQTT (persistente Verbindung, bambu_manager) ─────────────
    connected = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
    if not connected:
        _diag_add(sess, "MQTT-Verbindung", ["Verbindung FEHLGESCHLAGEN"], ok=False)
        _diag_finish(sess, "error")
        raise HTTPException(status_code=502, detail="MQTT-Verbindung zum Drucker fehlgeschlagen")
    _diag_add(sess, "MQTT-Verbindung", ["OK"])

    # ── AMS-Mapping bestimmen (sicher wie die Auto-Farm) ─────────
    # Dieselbe Logik wie die Farm: echtes Material+Farbe der Datei, Live-AMS-Abgleich
    # (NIE materialübergreifend), pro-Datei manuelle Zuordnung — und ABBRUCH, wenn das
    # passende Filament gar nicht geladen ist (statt PETG mit PLA zu drucken).
    diag_mapping: list = []
    if not use_ams:
        ams_mapping = []
        diag_mapping.append("AMS deaktiviert (use_ams=False) — kein Mapping gesendet")
    elif ams_slot is not None:
        ams_mapping = await loop.run_in_executor(
            None, lambda: print_file.file_ams_mapping(file.file_path, file.file_type,
                                                      ams_slot_override=ams_slot, diag=diag_mapping))
    else:
        f_types, f_colors = await loop.run_in_executor(
            None, print_file.read_filament_info, file.file_path, file.file_type, plate)
        ams_raw = await bambu_manager.fresh_ams(device)
        manual = ams_match.file_map(file_id)
        exact_only = bool(farm_settings.read().get("exact_color_only", False))

        def _refuse(detail):
            _diag_add(sess, "AMS-Mapping bestimmen", [detail], ok=False)
            _diag_finish(sess, "error")
            raise HTTPException(status_code=400, detail=detail)

        if manual:
            bad = ams_match.material_mismatch(f_types, manual, ams_raw)
            if bad:
                _refuse(f"Manuelle AMS-Zuordnung passt nicht zum Material ({bad}) — bitte im Datei-Browser korrigieren.")
            ams_mapping = ams_match.parse_manual(manual)
            diag_mapping.append(f"Manuelle pro-Datei-Zuordnung: {ams_mapping}")
        else:
            _mapping, missing = ams_match.match_confident(f_types, f_colors, ams_raw, exact_only)
            if missing:
                desc = ", ".join((f"{m['type'] or '?'} {m['color'] or ''}".strip() + f" ({m['reason']})") for m in missing)
                _refuse(f"Druck abgebrochen — passendes Filament fehlt im AMS: {desc}. Richtige Spule laden, im Datei-Browser zuordnen, oder über Auto Farm drucken.")
            ams_mapping = ams_match.match_live(f_types, f_colors, ams_raw)
            diag_mapping.append(f"Live-Match (Material+Farbe, nie materialübergreifend): {ams_mapping}")
        # Auf Slicer-Slot-Positionen heben (Datei druckt z. B. nur mit Filament 3
        # → [-1, -1, Tray]); no-op wenn die Filamente ohnehin 1..n sind.
        expanded = await loop.run_in_executor(
            None, ams_match.expand_to_slots, ams_mapping, file.file_path, file.file_type, plate)
        if expanded != ams_mapping:
            diag_mapping.append(f"Auf Slicer-Slots gehoben (unbenutzte = -1): {expanded}")
            ams_mapping = expanded
    _diag_add(sess, "AMS-Mapping bestimmen", diag_mapping)

    # ── Multi-Plate: gewählte Platte als Einzel-Platten-.3mf ─────
    upload_path, repack_tmp, plate_param, note = await loop.run_in_executor(
        None, print_file.upload_plan, file.file_path, file.file_type, plate)
    if note:
        _diag_add(sess, "Multi-Plate umpacken", [note], ok=repack_tmp is not None)

    # ── FTP-Upload ───────────────────────────────────────────────
    ftp = BambuFTP(device.ip_address, device.access_code)
    try:
        upload_ok = await loop.run_in_executor(bambu_manager.executor, ftp.upload_file, upload_path, print_name)
    finally:
        if repack_tmp:
            try:
                os.remove(repack_tmp)
            except OSError:
                pass
    if not upload_ok:
        _diag_add(sess, "FTP-Upload", [f"Dateiname: {print_name}", "FEHLGESCHLAGEN"], ok=False)
        _diag_finish(sess, "error")
        raise HTTPException(status_code=502, detail="FTP-Upload zum Drucker fehlgeschlagen")
    _diag_add(sess, "FTP-Upload", [f"Dateiname: {print_name}", "OK"])

    # ── Druckstart (über die persistente Verbindung) ─────────────
    await asyncio.sleep(3)
    print_ok = await loop.run_in_executor(
        bambu_manager.executor,
        lambda: bambu_manager.start_print(device, print_name, use_ams=use_ams,
                                          ams_mapping=ams_mapping, plate_param=plate_param))
    await asyncio.sleep(2)

    _diag_add(sess, "MQTT-Befehl  project_file", [
        f"Dateiname:   {print_name}",
        f"ams_mapping: {ams_mapping}",
        f"use_ams:     {use_ams}",
        f"plate_param: {plate_param}",
        f"Ergebnis:    {'OK' if print_ok else 'FEHLGESCHLAGEN'}",
    ], ok=print_ok)
    _diag_finish(sess, "ok" if print_ok else "error")

    if not print_ok:
        raise HTTPException(status_code=502, detail="Druckstart fehlgeschlagen (project_file)")

    return {
        "success": True,
        "message": f"'{file.original_filename}' gestartet (AMS: {ams_mapping})",
        "device":      device.name,
        "file":        file.original_filename,
        "method":      "project_file",
        "ams_mapping": ams_mapping,
    }


@router.post("/gcode/{device_id}")
async def send_gcode(device_id: int, gcode: str, db: Session = Depends(get_db)):
    """Direkte GCode-Zeilen an den Drucker senden (kein Datei-Upload nötig)."""
    device = _get_bambu_device(device_id, db)
    loop = asyncio.get_running_loop()

    # Über die persistente Verbindung (bambu_manager) senden — kein eigener Connect.
    ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.send_gcode, device, gcode)
    await asyncio.sleep(2)
    response = bambu_manager.last_status(device)

    if not ok:
        raise HTTPException(status_code=502, detail="GCode konnte nicht gesendet werden")

    return {"success": True, "gcode": gcode, "printer_response": response}


# ── Live-Status-Cache aus dem Auto-Farm ──────────────────────────────────────
# Während die Farm druckt, hält sie EINE persistente MQTT-Verbindung und liest
# den Druckerstatus ohnehin laufend (autofarm._wait_print). Diese Funktion füttert
# das letzte Roh-Telegramm hier ein, sodass /status es ohne EIGENE (konkurrierende)
# MQTT-Verbindung ausliefern kann. Der X1C erlaubt nur wenige Verbindungen — so
# entfällt das 15-s-Poll-Connect der Steuerung, solange die Farm läuft.
_LIVE: dict = {"t": 0.0, "raw": None, "dev": None}
_LIVE_TTL = 35.0   # s — etwas über dem Standard-Poll (20 s) der Farm
_last_hist_state: dict = {}   # device_id -> letzter geloggter FINISH/FAILED-Zustand (Anti-Spam)


def publish_live_status(raw: dict, device_id=None):
    """Vom Auto-Farm bei jedem Poll aufgerufen: letztes Drucker-Telegramm cachen."""
    if raw:
        _LIVE["t"] = time.monotonic()
        _LIVE["raw"] = raw
        _LIVE["dev"] = device_id


def _status_from_raw(raw: dict) -> dict:
    """Baut die /status-Antwort aus einem Roh-Telegramm (ohne MQTT/History)."""
    p = raw.get("print", {}) if raw else {}
    gcode_state = p.get("gcode_state", "IDLE")
    ams_units = []
    ams_data  = p.get("ams", {})
    tray_now  = 255
    if isinstance(ams_data, dict):
        try:
            tray_now = int(str(ams_data.get("tray_now", "255")))
        except (ValueError, TypeError):
            tray_now = 255
        for unit in (ams_data.get("ams") or []):
            slots = []
            for tray in (unit.get("tray") or []):
                slots.append({
                    "id":     int(tray.get("id", 0)),
                    "type":   tray.get("tray_type", ""),
                    "color":  tray.get("tray_color", ""),
                    "brand":  tray.get("tray_sub_brands") or tray.get("tray_id_name", ""),
                    "remain": tray.get("remain", -1),
                })
            ams_units.append({
                "id":       int(unit.get("id", 0)),
                "temp":     unit.get("temp", 0),
                "humidity": unit.get("humidity", 0),
                "slots":    slots,
            })
    return {
        "online":       True,
        "status":       gcode_state.lower(),
        "gcode_state":  gcode_state,
        "is_printing":  gcode_state == "RUNNING",
        "progress":     p.get("mc_percent", 0),
        "nozzle_temp":        p.get("nozzle_temper",        0),
        "nozzle_target_temp": p.get("nozzle_target_temper", 0),
        "bed_temp":           p.get("bed_temper",           0),
        "bed_target_temp":    p.get("bed_target_temper",    0),
        "remaining_min":      p.get("mc_remaining_time",    0),
        "subtask_name":       p.get("subtask_name",         ""),
        "ams_units":    ams_units,
        # Roh-AMS-Block (mit tray_type/tray_color/id) — das Frontend (FileLibrary,
        # AutoFarm, AMS-Lernen) liest r.data.ams.ams. OHNE dieses Feld wäre das AMS
        # für die UI immer leer („No AMS detected" / 0 Filamente gelernt).
        "ams":          ams_data if isinstance(ams_data, dict) else {},
        "tray_active":  tray_now,
        "raw": raw,
    }


@router.get("/status/{device_id}")
async def get_printer_status(device_id: int, db: Session = Depends(get_db)):
    """Druckerstatus aus der EINEN persistenten MQTT-Verbindung (bambu_manager) —
    kein Connect pro Poll mehr. Der Cache wird laufend über dieselbe Verbindung
    aktualisiert; nur wenn noch nichts/keine AMS da ist, wird einmal pushall angefragt."""
    device = _get_bambu_device(device_id, db)
    loop = asyncio.get_running_loop()

    # Notbremse: Antwort NIE länger als 10 s aufhalten (hängende Status-Requests
    # hielten sonst DB-Sessions → Pool voll → die ganze App hing). Timeout räumt
    # noch nicht gestartete Executor-Jobs aus der Warteschlange (Future-Cancel).
    try:
        raw = await asyncio.wait_for(
            loop.run_in_executor(bambu_manager.executor, bambu_manager.fetch_status, device),
            timeout=10.0)
    except asyncio.TimeoutError:
        raw = bambu_manager.last_status(device)

    # Fallback: Farm-Live-Cache (Legacy), falls der Manager (noch) nichts hat.
    if raw is None and _LIVE["raw"] is not None and (time.monotonic() - _LIVE["t"]) < _LIVE_TTL \
            and _LIVE.get("dev") in (None, device_id):
        resp = _status_from_raw(_LIVE["raw"])
        resp["source"] = "farm"
        return resp
    if raw is None:
        return {"status": "offline", "message": "Keine Verbindung zum Drucker", "online": False}

    p = raw.get("print", {}) if raw else {}
    gcode_state = p.get("gcode_state", "IDLE")

    # FINISH/FAILED nur beim ZUSTANDSWECHSEL loggen (sonst Spam bei jedem Poll, da der
    # Cache dauerhaft frisch ist).
    if gcode_state in ("FINISH", "FAILED") and _last_hist_state.get(device_id) != gcode_state:
        _append_history({
            "ts":         datetime.now(timezone.utc).isoformat(),
            "device":     device.name,
            "device_id":  device_id,
            "state":      gcode_state,
            "file":       p.get("subtask_name", ""),
            "progress":   p.get("mc_percent", 0),
            "layer":      p.get("layer_num", 0),
            "total_layers": p.get("total_layer_num", 0),
        })
    _last_hist_state[device_id] = gcode_state

    return _status_from_raw(raw)


# ── Drucker-Einstellungen (was man sonst am Display einstellt) ───────────────

@router.get("/settings/{device_id}")
async def get_printer_settings(device_id: int, db: Session = Depends(get_db)):
    """Aktuelle Drucker-Einstellungen (KI-Erkennung, Geschwindigkeit, Auto-Recovery,
    Kammerlicht) aus dem letzten MQTT-Push-Report. Felder, die der Drucker (noch)
    nicht gemeldet hat, sind null — die UI zeigt dann „—" statt zu raten."""
    device = _get_bambu_device(device_id, db)
    from app.services import bambu_settings
    loop = asyncio.get_running_loop()
    try:
        raw = await asyncio.wait_for(
            loop.run_in_executor(bambu_manager.executor, bambu_manager.fetch_status, device),
            timeout=8.0)
    except asyncio.TimeoutError:
        raw = bambu_manager.last_status(device)
    if raw is None:
        return {"online": False, "settings": {}}
    return {"online": True, "settings": bambu_settings.read_settings(raw)}


@router.post("/settings/{device_id}")
async def set_printer_settings(device_id: int, body: dict, db: Session = Depends(get_db)):
    """Eine oder mehrere Einstellungen setzen: {"first_layer_inspector": true, …}.
    Jede Einstellung wird als eigenes MQTT-Kommando geschickt."""
    device = _get_bambu_device(device_id, db)
    from app.services import bambu_settings
    if not isinstance(body, dict) or not body:
        raise HTTPException(400, "Keine Einstellung übergeben")
    loop = asyncio.get_running_loop()
    applied, failed = [], {}
    for key, value in body.items():
        try:
            cmd = bambu_settings.build_command(key, value)
        except ValueError as e:
            failed[key] = str(e)
            continue
        ok = await loop.run_in_executor(bambu_manager.executor,
                                        bambu_manager.publish_command, device, cmd)
        if ok:
            applied.append(key)
        else:
            failed[key] = "MQTT-Senden fehlgeschlagen"
    if not applied and failed:
        raise HTTPException(502, "; ".join(f"{k}: {v}" for k, v in failed.items()))
    # Frischen Report anfragen, damit die UI den neuen Zustand zeitnah sieht.
    await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
    return {"success": True, "applied": applied, "failed": failed}


@router.post("/calibrate/{device_id}")
async def calibrate_printer(device_id: int, body: dict = None, db: Session = Depends(get_db)):
    """Kalibrierung der X1-Serie starten (Bett-Nivellierung / Vibrations-
    kompensation / Motorgeräusch). Alle drei zusammen dauern ~16 Minuten und
    blockieren den Drucker — deshalb nur starten, wenn er idle ist."""
    device = _get_bambu_device(device_id, db)
    from app.services import bambu_settings
    options = (body or {}).get("options") or list(bambu_settings.CALIBRATION_BITS)
    raw = bambu_manager.last_status(device) or {}
    state = (raw.get("print", {}) or {}).get("gcode_state", "")
    if state in ("RUNNING", "PREPARE", "SLICING", "PAUSE"):
        raise HTTPException(409, f"Drucker ist beschäftigt ({state}) — Kalibrierung nicht möglich")
    try:
        cmd = bambu_settings.build_calibration(options)
    except ValueError as e:
        raise HTTPException(400, str(e))
    loop = asyncio.get_running_loop()
    ok = await loop.run_in_executor(bambu_manager.executor,
                                    bambu_manager.publish_command, device, cmd)
    if not ok:
        raise HTTPException(502, "Kalibrierung konnte nicht gestartet werden (MQTT)")
    return {"success": True, "options": options,
            "message": "Kalibrierung gestartet — dauert je nach Umfang bis ~16 Minuten"}


@router.get("/send-diagnostics")
async def get_send_diagnostics():
    """Letzte Sende-Diagnose-Sessions zurückgeben."""
    return {"sessions": _diag_sessions}


# ── AMS-Aktionen (Steuerung): Slot neu einlesen, Filament laden/entladen ─────

def _ams_guard_not_printing(device):
    """Laden/Entladen nur, wenn gerade kein Druck läuft (PAUSE ist ok — da ist
    Filamentwechsel am Gerät ausdrücklich erlaubt)."""
    raw = bambu_manager.last_status(device) or {}
    state = (raw.get("print", {}) or {}).get("gcode_state", "")
    if state in ("RUNNING", "PREPARE", "SLICING"):
        raise HTTPException(409, f"Drucker druckt gerade ({state}) — Filamentwechsel nicht möglich")


async def _ams_publish(device, cmd: dict) -> None:
    loop = asyncio.get_running_loop()
    ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.publish_command, device, cmd)
    if not ok:
        raise HTTPException(502, "Keine MQTT-Verbindung zum Drucker")


@router.post("/ams/{device_id}/load")
async def ams_load_filament(device_id: int, body: dict, db: Session = Depends(get_db)):
    """Filament aus einem AMS-Fach in den Extruder laden (ams_change_filament).
    Zieltemperatur aus den Tray-Infos (nozzle_temp_max), Fallback 240 °C."""
    device = _get_bambu_device(device_id, db)
    try:
        tray = int(body.get("tray", -1))
    except (TypeError, ValueError):
        tray = -1
    if not 0 <= tray <= 15:
        raise HTTPException(400, "tray (0–15) fehlt")
    _ams_guard_not_printing(device)
    temp = 240
    raw = bambu_manager.last_status(device) or {}
    for unit in ((raw.get("print", {}).get("ams", {}) or {}).get("ams") or []):
        for t in (unit.get("tray") or []):
            try:
                if int(unit.get("id", 0)) * 4 + int(t.get("id", 0)) == tray and t.get("nozzle_temp_max"):
                    temp = int(float(t["nozzle_temp_max"]))
            except (TypeError, ValueError):
                pass
    await _ams_publish(device, {"print": {
        "sequence_id": str(int(time.time())), "command": "ams_change_filament",
        "target": tray, "curr_temp": temp, "tar_temp": temp,
    }})
    return {"success": True, "tray": tray, "temp": temp,
            "message": f"Laden aus Slot {tray + 1} gestartet ({temp} °C) — dauert ~1 Minute"}


@router.post("/ams/{device_id}/unload")
async def ams_unload_filament(device_id: int, db: Session = Depends(get_db)):
    """Aktuelles Filament aus dem Extruder zurück ins AMS entladen."""
    device = _get_bambu_device(device_id, db)
    _ams_guard_not_printing(device)
    await _ams_publish(device, {"print": {
        "sequence_id": str(int(time.time())), "command": "unload_filament",
    }})
    return {"success": True, "message": "Entladen gestartet — dauert ~1 Minute"}


@router.post("/ams/{device_id}/read")
async def ams_read_slot(device_id: int, body: dict, db: Session = Depends(get_db)):
    """Einen AMS-Slot neu einlesen (RFID, ams_get_rfid) — z. B. wenn eine Spule
    nicht erkannt wurde. Danach einen Vollreport anstoßen, damit die UI das
    Ergebnis zeitnah sieht."""
    device = _get_bambu_device(device_id, db)
    try:
        ams_id, slot_id = int(body.get("ams_id", -1)), int(body.get("slot_id", -1))
    except (TypeError, ValueError):
        ams_id = slot_id = -1
    if not (0 <= ams_id <= 3 and 0 <= slot_id <= 3):
        raise HTTPException(400, "ams_id/slot_id (0–3) fehlt")
    # Beide sequence-Schreibweisen mitschicken — die Doku nennt für ams_get_rfid
    # ausnahmsweise "sequenceId"; ein überzähliges Feld ignoriert die Firmware.
    await _ams_publish(device, {"print": {
        "sequence_id": str(int(time.time())), "sequenceId": str(int(time.time())),
        "command": "ams_get_rfid", "ams_id": ams_id, "slot_id": slot_id,
    }})
    return {"success": True, "message": f"Slot A{ams_id + 1}-{slot_id + 1} wird neu eingelesen"}


@router.delete("/send-diagnostics")
async def clear_send_diagnostics():
    """Diagnose-Log zurücksetzen."""
    global _diag_sessions
    _diag_sessions = []
    _diag_save()
    return {"success": True}
