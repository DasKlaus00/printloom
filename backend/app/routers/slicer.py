"""Schnittstelle für das OrcaSlicer-Plugin (orca-plugin/printloom_orca.py).

Eine eigene, kleine API statt der Endpunkte der Oberfläche: Das Plugin läuft in der
Version, die der Nutzer irgendwann heruntergeladen hat, nicht in der des Servers.
`API_VERSION` steigt nur bei Änderungen, die ein älteres Plugin brechen würden.

Alles Urteilen passiert HIER, mit derselben Logik wie in Farm und Bibliothek
(Crash-Check, Fachhöhe, AMS-Zuordnung, Einreihen). Das Plugin zeigt nur an — so
können Slicer und Farm nie unterschiedlich entscheiden.
"""
from __future__ import annotations

import logging
import os
import tempfile
import zipfile
import zlib
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app import paths
from app.db.database import SessionLocal
from app.models.models import Device, PrinterType
from app.services import (ams_match, bambu_manager, crash_check, farm_settings, print_file,
                          printer_models, rack_logic, rack_store, spool_check)

router = APIRouter()
logger = logging.getLogger(__name__)

API_VERSION = 1
PRINT_TYPES = {".3mf", ".gcode"}
# Größer wird kein Platten-G-code — ein Deckel, damit ein kaputter Client nicht die
# Platte vollschreibt. 1 GB entpackt entspricht einem zweitägigen Druck.
MAX_BYTES = 1024 * 1024 * 1024
_CHUNK = 1024 * 1024

# Aus dem Roh-Telegramm des Druckers nur, was der Geräte-Tab in Orca braucht.
# Bewusst NICHT „fun" & Co.: daran schaltet Orca Bambu-eigene Wege frei (direkter
# Datei-Tunnel zum Drucker), die am Plugin vorbeigingen.
STATE_KEYS = ("gcode_state", "mc_percent", "mc_remaining_time", "subtask_name",
              "layer_num", "total_layer_num", "nozzle_temper", "nozzle_target_temper",
              "bed_temper", "bed_target_temper", "chamber_temper", "nozzle_diameter",
              "nozzle_type", "ams", "vt_tray")


# ── Hilfen ────────────────────────────────────────────────────────────────────

def _printer(db, device_id: Optional[int] = None) -> Optional[Device]:
    q = db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB)
    if device_id is not None:
        q = q.filter(Device.id == device_id)
    return q.first()


def _dev_model(device: Device) -> str:
    """Bambu-Modellcode („BL-P001") — Orca vergleicht ihn mit dem Drucker-Profil und
    sperrt sonst den Druckknopf („anderes Druckermodell")."""
    model = printer_models.by_id(device.model) or printer_models.by_id(
        printer_models.from_serial(device.serial_number))
    codes = (model or {}).get("dev_models") or ()
    return codes[0] if codes else ""


def _live_ams(device: Optional[Device]) -> dict:
    """AMS-Block des Druckers über die bestehende Verbindung (nie eine zweite)."""
    if device is None:
        return {}
    raw = bambu_manager.fetch_status(device, want_ams=True, max_wait=3.0) or {}
    return (raw.get("print") or {}).get("ams") or {}


async def _receive(request: Request, dest: Path) -> int:
    """Rohen Body nach `dest` schreiben; gzip (Content-Encoding) wird entpackt.
    Das Plugin schickt den G-code gepackt — ein Zehntel der Daten."""
    gz = "gzip" in (request.headers.get("content-encoding") or "").lower()
    inflate = zlib.decompressobj(16 + zlib.MAX_WBITS) if gz else None
    total = 0

    def _write(data: bytes) -> None:
        nonlocal total
        total += len(data)
        if total > MAX_BYTES:
            raise HTTPException(413, "Datei zu groß")
        out.write(data)

    with open(dest, "wb") as out:
        async for chunk in request.stream():
            if not inflate:
                _write(chunk)
                continue
            # In begrenzten Stücken entpacken: ein winziger, präparierter Block darf
            # nicht erst komplett im Speicher aufgehen, bevor MAX_BYTES greift.
            data = inflate.decompress(chunk, _CHUNK)
            while data:
                _write(data)
                data = inflate.decompress(inflate.unconsumed_tail, _CHUNK) \
                    if inflate.unconsumed_tail else b""
        if inflate:
            _write(inflate.flush())
    if total == 0:
        raise HTTPException(400, "Leere Datei")
    return total


def _units(path: str, ftype: str) -> list:
    """Druck-Einheiten wie in der Bibliothek: Mehr-Platten-.3mf → eine je Platte,
    sonst eine ohne Plattenangabe (die Farm nimmt dann die einzige Platte darin)."""
    if ftype != ".3mf":
        return [(None, None, None)]
    plates = print_file.list_plates(path)
    if len(plates) <= 1:
        return [(None, None, None)]
    try:
        with zipfile.ZipFile(path) as zf:
            names = print_file.plate_names(zf)
    except (OSError, zipfile.BadZipFile):
        names = {}
    return [(p, len(plates), names.get(str(p)) or None) for p in plates]


def _analyze(path: str, ftype: str, plate, ams_raw: dict) -> dict:
    """Crash-Zone, Fachhöhe und Spulen für EINE Druck-Einheit."""
    crash = crash_check.scan_file(path, ftype, plate) or {"crash_risk": False, "max_z_mm": None}
    crash.update(crash_check.limits())
    rack = rack_store.load()
    h = print_file.object_height(path, ftype, plate, rack.get("height_margin_pct", 15.0))
    height_mm = h.get("computed_height_mm") or 0.0
    height = {"max_z_mm": h.get("max_z_mm"), "height_mm": height_mm}
    if height_mm > 0:
        height.update(rack_logic.storable(height_mm, rack))
    usage = print_file.filament_usage(path, ftype, plate)
    exact = bool(farm_settings.read().get("exact_color_only", False))
    return {"plate": plate, "crash": crash, "height": height,
            "spool": spool_check.check(usage, ams_raw, exact)}


def _analyze_units(path: str, ftype: str, units: list) -> list:
    db = SessionLocal()
    try:
        ams_raw = _live_ams(_printer(db))
    finally:
        db.close()
    return [_analyze(path, ftype, plate, ams_raw) for plate, _, _ in units]


# ── Endpunkte ─────────────────────────────────────────────────────────────────

@router.get("/info")
def info():
    """Verbindungstest des Plugins: Version, Drucker und die Grenzwerte der Farm."""
    from app.routers.system import _get_current_version
    db = SessionLocal()
    try:
        printers = [{"id": d.id, "name": d.name, "model": d.model or "",
                     "dev_model": _dev_model(d)}
                    for d in db.query(Device).filter(
                        Device.device_type == PrinterType.BAMBU_LAB).all()]
    finally:
        db.close()
    rack = rack_store.load()
    return {
        "api": API_VERSION,
        "version": _get_current_version(),
        "printers": printers,
        "limits": {
            "crash": crash_check.limits(),
            "rack": {"slot_height_mm": rack.get("slot_height_mm"),
                     "slot_tolerance_mm": rack_logic.tolerance_of(rack),
                     "slots_per_rack": rack.get("slots_per_rack"),
                     "num_racks": rack.get("num_racks"),
                     "max_height_mm": rack_logic.storable(0, rack)["max_height_mm"]},
        },
    }


@router.post("/check")
async def check(request: Request):
    """Farm-Check direkt nach dem Slicen: der Platten-G-code als Body (gerne gzip).
    Nichts wird gespeichert — die Datei verschwindet nach der Prüfung."""
    fd, tmp = tempfile.mkstemp(prefix="printloom_check_", suffix=".gcode")
    os.close(fd)
    try:
        await _receive(request, Path(tmp))
        return (await run_in_threadpool(_analyze_units, tmp, ".gcode", [(None, None, None)]))[0]
    finally:
        try:
            os.remove(tmp)
        except OSError as e:
            logger.warning(f"Prüf-Datei nicht gelöscht: {e}")


@router.post("/upload")
async def upload(request: Request, filename: str, queue: bool = True):
    """Gesliceten Druck in die Bibliothek legen und (Standard) einreihen.

    Body = die Datei selbst (.gcode.3mf oder .gcode). Antwort mit Job-IDs und dem
    Farm-Check je Platte — derselbe wie nach dem Slicen, jetzt mit der echten Datei."""
    from app.routers import autofarm, files
    name = os.path.basename((filename or "").replace("\\", "/")).strip()
    ftype = Path(name).suffix.lower()
    if not name or ftype not in PRINT_TYPES:
        raise HTTPException(400, "Nur .3mf und .gcode")
    dest = files.new_upload_path(name)
    try:
        size = await _receive(request, dest)
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    db = SessionLocal()
    try:
        row = files.register_upload(db, dest, name, size)
        file_id, file_name = row.id, row.original_filename
    finally:
        db.close()
    units = await run_in_threadpool(_units, str(dest), ftype)
    job_ids = await autofarm.add_library_jobs(file_id, file_name, units) if queue else []
    checks = await run_in_threadpool(_analyze_units, str(dest), ftype, units)
    return {"file_id": file_id, "file_name": file_name, "queued": bool(job_ids),
            "job_ids": job_ids, "checks": checks}


@router.get("/printer/state")
def printer_state(device_id: Optional[int] = None):
    """Druckerzustand für Orcas Geräte-Tab — nur die Felder aus STATE_KEYS."""
    db = SessionLocal()
    try:
        device = _printer(db, device_id)
        if device is None:
            raise HTTPException(404, "Kein Bambu-Lab-Drucker eingerichtet")
        dev = {"id": device.id, "name": device.name, "dev_model": _dev_model(device)}
        raw = bambu_manager.fetch_status(device, want_ams=True, max_wait=2.0) or {}
        connected = bambu_manager.is_connected(device)
    finally:
        db.close()
    report = raw.get("print") or {}
    return {"connected": connected, "device": dev,
            "print": {k: report[k] for k in STATE_KEYS if k in report}}


@router.get("/overview")
def overview():
    """Farm auf einen Blick, für den Printloom-Tab in Orca. Liest nur Zustände, die
    Printloom ohnehin hält — keine Anfrage an den Drucker."""
    from app.routers import autofarm
    farm = autofarm._farm
    jobs = list(farm["jobs"]) if farm["running"] else list(
        autofarm._read_config(autofarm.QUEUE_PATH, {"jobs": []}).get("jobs", []))
    current = next((j for j in jobs if j.get("id") == farm.get("current_job_id")), None)

    def _job(j):
        return {"id": j.get("id"), "name": j.get("fileName") or "", "plate": j.get("plate"),
                "plate_name": j.get("plateName") or "", "status": j.get("status") or "pending",
                "progress": j.get("progress") or 0}

    open_jobs = [j for j in jobs if (j.get("status") or "pending") not in ("done",)]
    rack = rack_store.load()
    slots = list((rack.get("slots") or {}).values())
    free = sum(1 for s in slots if (s or {}).get("status", "free") in ("free", "ready"))

    db = SessionLocal()
    try:
        device = _printer(db)
        printer, ams = None, []
        if device is not None:
            report = ((bambu_manager.last_status(device) or {}).get("print") or {})
            printer = {"name": device.name, "connected": bambu_manager.is_connected(device),
                       "state": report.get("gcode_state") or "",
                       "progress": report.get("mc_percent"),
                       "remaining_min": report.get("mc_remaining_time"),
                       "layer": report.get("layer_num"),
                       "total_layers": report.get("total_layer_num"),
                       "nozzle": report.get("nozzle_temper"),
                       "bed": report.get("bed_temper"),
                       "chamber": report.get("chamber_temper"),
                       "subtask": report.get("subtask_name") or ""}
            for s in ams_match.slots_from_raw(report.get("ams") or {}):
                ams.append({"label": spool_check.tray_label(s["gid"]), "type": s["type"],
                            "color": s["color"][:6], "remain": s["remain"]})
    finally:
        db.close()

    return {
        "farm": {"running": farm["running"], "paused": farm["paused"], "idle": farm["idle"],
                 "stopping": farm["stopping"], "error": farm.get("error"),
                 "countdown": farm.get("start_countdown") or 0,
                 "current": _job(current) if current else None},
        "jobs": {"pending": sum(1 for j in jobs if (j.get("status") or "pending") == "pending"),
                 "done": sum(1 for j in jobs if j.get("status") == "done"),
                 "error": sum(1 for j in jobs if j.get("status") == "error"),
                 "list": [_job(j) for j in open_jobs[:15]]},
        "rack": {"total": len(slots), "free": free, "occupied": len(slots) - free,
                 "empty_plates": autofarm._magazine_count()},
        "printer": printer,
        "ams": ams,
    }


@router.get("/plugin")
def download_plugin():
    """Das Plugin zum Installieren in Orca (Plugins → „Lokales Plugin installieren").
    Kommt vom Server, damit Plugin und Printloom-Version zusammenpassen."""
    path = paths.orca_plugin_file()
    if not path.is_file():
        raise HTTPException(404, "Plugin-Datei fehlt in dieser Installation")
    return FileResponse(path, filename="printloom_orca.py", media_type="text/x-python")
