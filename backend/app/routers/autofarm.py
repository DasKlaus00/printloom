"""
AutoFarm backend executor
=========================
Continuous-mode farm: runs as a persistent background loop.
New jobs can be enqueued at any time via POST /enqueue.
The loop idles when the queue is empty and picks up new jobs automatically.
"""
import asyncio
import io
import json
import logging
import math
import os
import zipfile
from datetime import datetime, timedelta
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from app.db.database import SessionLocal
from app.models.models import Device, PrinterType, UploadedFile
from app.services.bambu_ftp import BambuFTP
from app.services import storage
from app.services import bambu_manager
from app.services import ottoeject_motion as _motion
from app.routers.printer import _make_print_name, _get_ams_mapping, _read_filament_info, _match_ams_live, _expand_mapping_to_slots, _get_plate_gcode_param, _list_plates, _repack_single_plate, _ams_match_confident, _ams_slots_from_raw, capture_snapshot, publish_live_status
from app.routers.rack_manager import analyze_3mf_height, analyze_gcode_height, _load as _rack_load
from app.services import hms
from app.services import rack_logic as _rack_logic
from app.services import geometry_check as _geometry_check
from app.services import stress_test as _stress_service
from app.services.rack_logic import (
    slots_needed as _slots_needed_base,
    is_blocked_from_below as _is_blocked_base,
    DEFAULT_SLOT_TOLERANCE_MM,
)

logger = logging.getLogger(__name__)
router = APIRouter()

from app.paths import db_path

SLOTS_PATH    = db_path("rack_slots.json")
SEQ_PATH      = db_path("farm_sequences.json")
SETTINGS_PATH = db_path("farm_settings.json")
QUEUE_PATH    = db_path("farm_queue.json")
LOG_PATH      = db_path("farm_log.txt")
STATS_PATH    = db_path("farm_stats.json")
HISTORY_PATH  = db_path("farm_history.json")
TIMELINE_PATH = db_path("farm_timeline.json")
COMPLETED_PATH = db_path("farm_completed.json")   # Historie: abgeschlossene Druck-Jobs
STATE_PATH    = db_path("farm_state.json")        # Laufzustand — überlebt den Neustart
HMS_PATH      = db_path("farm_hms.json")          # Drucker-Fehler mit Zeitstempel
TIMELINE_MAX  = 1000  # keep the most recent N events
COMPLETED_MAX = 2000  # keep the most recent N completed jobs (Historie)
HMS_MAX       = 300   # keep the most recent N printer errors (HMS-Historie)
HISTORY_KEEP  = 8     # rolling samples per file for the duration average

SEQ_SCHEMA_VERSION = "5.0.0"  # bump when default sequences change structurally

HOMING_3MF_PATH = db_path("printloom_homing.3mf")
FILE_AMSMAP_PATH = db_path("file_ams_map.json")   # pro Datei manuell gewählte AMS-Slots {file_id: "gid,gid"}
GEOMETRY_PATH = db_path("ottoeject_geometry.json")  # Drucker-Geometrie (Drucker-Tab) — opt-in App-G-code

_DEFAULT_SETTINGS = {"poll_interval": 20, "min_print_minutes": 0, "use_ams": True,
                     "hms_ignore": ["0C00-0100-0001-0004"],
                     # Energie & Kosten (Roadmap 3.1/3.2/3.4) — reine Zahlen, keine Geheimnisse
                     "power_price_eur_kwh":   0.30,
                     "machine_rate_eur_h":    0.0,
                     "filament_price_eur_kg": 20.0,
                     "idle_off_min":          0,    # 0 = Auto-Abschaltung aus
                     # Zeitlimit EINER OTTOeject-Bewegung (s) — danach gilt sie als
                     # hängend (Phase 3.3). Ein Griff über mehrere Regale darf dauern.
                     "move_timeout_s":        180,
                     # Watchdog (Roadmap 1.1/1.7)
                     "conn_alarm":            True,  # Push bei wiederholtem Verbindungsverlust (1.1)
                     "progress_stall_min":    0,     # 0 = aus; sonst Pause bei N min ohne Fortschritt (1.7)
                     # Fehlerstrategie (Roadmap 1.3) — {error_key: action}; leer = Defaults
                     "error_strategy":        {},
                     "failed_retries":        1,     # Wiederholungen bei FAILED vor der gewählten Aktion
                     # Zeitzone des Nutzers (IANA, z. B. "Europe/Berlin") — der Container
                     # läuft i. d. R. in UTC; die Betriebszeiten müssen aber in der lokalen
                     # Zeit des Nutzers ausgewertet werden. Frontend liefert sie automatisch.
                     "timezone": "",
                     # Magnet-Greifer: vor dem Auswerfen warten, bis die Druckplatte
                     # kalt genug ist. Die Magnete halten eine warme Platte nicht —
                     # der Arm käme leer zurück, ohne dass es jemand merkt.
                     "cool_before_eject":       True,
                     "cool_temp_c":             30.0,
                     "cool_timeout_min":        30,
                     # Betriebszeiten (Roadmap 2.5) — neue Jobs nur im Zeitfenster starten
                     "operating_hours_enabled": False,
                     # Pro Wochentag (Index 0=Mo … 6=So) ein eigenes Fenster.
                     "operating_schedule": [
                         {"enabled": True, "start": "22:00", "end": "06:00"} for _ in range(7)
                     ],
                     # Legacy-Felder (vor v1.0.59) — nur noch für Migration alter Configs:
                     "operating_start":         "22:00",
                     "operating_end":           "06:00",
                     "operating_days":          [0, 1, 2, 3, 4, 5, 6],  # 0=Mo … 6=So
                     # „Nur exakte Farbe" (1.4): True → es wird NICHT auf eine nur
                     # ähnliche Ersatzfarbe ausgewichen. Ohne exakten Treffer pausiert
                     # die Farm (manuelle AMS-Zuordnung), statt falsch zu drucken.
                     "exact_color_only":        False}

# ── Homing .3mf generator ────────────────────────────────────
_HOMING_GCODE = """; Printloom Homing Sequence
G28 ; Home all axes
G1 Z200 F3000 ; Move bed to loading position (fast — same feed as the cycle's Z200 move)
M400 ; Wait for moves to complete
"""
_HOMING_CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/><Default Extension="gcode" ContentType="text/x.gcode"/><Default Extension="config" ContentType="text/xml"/></Types>'
_HOMING_RELS = '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'
_HOMING_MODEL = '<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">Printloom</metadata><resources/><build/></model>'
_HOMING_SETTINGS = '<?xml version="1.0" encoding="utf-8"?><config><plate><metadata key="plater_id" value="1"/><metadata key="gcode_file" value="Metadata/plate_1.gcode"/><metadata key="thumbnail_file" value=""/></plate></config>'
_HOMING_SLICE = '<?xml version="1.0" encoding="utf-8"?><config><header><value key="gcode_version" val="1.0.0.0"/><value key="source_file" val="printloom_homing.3mf"/><value key="nozzle_diameter" val="0.4"/></header><plates><plate><metadata key="index" val="1"/><metadata key="skipped" val="0"/><metadata key="gcode_file" val="Metadata/plate_1.gcode"/></plate></plates><filaments/></config>'

def _build_3mf(gcode: str) -> bytes:
    """Wrap arbitrary G-code into a minimal printable .3mf (single plate)."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml",          _HOMING_CONTENT_TYPES)
        zf.writestr("_rels/.rels",                  _HOMING_RELS)
        zf.writestr("3D/3dmodel.model",             _HOMING_MODEL)
        zf.writestr("Metadata/plate_1.gcode",       gcode)
        zf.writestr("Metadata/model_settings.config", _HOMING_SETTINGS)
        zf.writestr("Metadata/slice_info.config",   _HOMING_SLICE)
    return buf.getvalue()

def _build_homing_3mf() -> bytes:
    return _build_3mf(_HOMING_GCODE)

def _move_3mf_path(z: int, feed: int) -> str:
    """Cached one-shot move .3mf for `G1 Z{z} F{feed}` + M400 (position-confirmed)."""
    path = db_path(f"move_z{int(z)}_f{int(feed)}.3mf")
    if not os.path.exists(path):
        gcode = (
            "; Printloom Position Move\n"
            f"G1 Z{int(z)} F{int(feed)} ; move bed to position\n"
            "M400 ; wait for moves to complete\n"
        )
        try:
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, "wb") as f:
                f.write(_build_3mf(gcode))
        except Exception as e:
            logger.warning(f"move .3mf build failed: {e}")
    return path

def _read_config(path: str, default):
    return storage.read_json(path, default)

def _write_config(path: str, data):
    storage.write_json(path, data)

# ── Module-level state ───────────────────────────────────────
_farm: dict = {
    "running":          False,
    "stopping":         False,
    "paused":           False,
    "idle":             False,  # Warteschlange leer → wartet auf neue Jobs (kein Auto-Stop)
    "start_countdown":  0,      # Sekunden bis zum Start des nächsten Jobs (Header-Anzeige)
    "current_job_id":   None,
    "current_job_idx":  -1,
    "seq_step_idx":     0,
    "seq_step_total":   0,
    "seq_step_label":   "",
    "log":              [],
    "jobs":             [],
    "error":            None,
    "started_at":       None,
    "stop_reason":      None,  # "completed" | "manual" | None
    "_last_gcode_time": None,  # loop.time() when last Bambu gcode step was sent
    # Was hält der Greifer? (Phase 3.2) — nach einem Abbruch die einzige Info darüber,
    # ob noch eine Platte am Arm hängt. Wird mitgesichert (farm_state.json).
    "arm":              {"holding": "none", "from": "", "job_id": None},
    # Nach Notaus/Abbruch ist die Position unbekannt → vor der nächsten Bewegung homen.
    "needs_home":       False,
    # Unterbrochener Lauf aus einer früheren Sitzung (wird beim Import gefüllt).
    "recovery":         None,
    "_current_job_name": "",
    "_current_job_slot": "",
}
_task: Optional[asyncio.Task] = None


# ── Utilities ────────────────────────────────────────────────
def _read_stats() -> dict:
    return storage.read_json(STATS_PATH, {
        "total_jobs": 0, "successful_jobs": 0, "failed_jobs": 0,
        "total_print_min": 0, "total_kwh": 0.0, "total_filament_g": 0.0,
        "errors": {}, "since": None})


def _write_stats(data: dict):
    try:
        storage.write_json(STATS_PATH, data)
    except Exception as e:
        logger.warning(f"stats write failed: {e}")


def _record_success(print_min: int = 0, kwh: float = 0.0, filament_g=None):
    s = _read_stats()
    s["total_jobs"]      = s.get("total_jobs", 0) + 1
    s["successful_jobs"] = s.get("successful_jobs", 0) + 1
    s["total_print_min"] = s.get("total_print_min", 0) + max(0, print_min)
    s["total_kwh"]       = round(s.get("total_kwh", 0.0) + max(0.0, kwh), 4)
    # Filament nur addieren, wenn die Datei es hergibt. None (Fremdformat/alter
    # Slicer) NICHT als 0 verbuchen — sonst sähe die Materialkostenzeile wie eine
    # vollständige Rechnung aus, obwohl Jobs darin fehlen. Deshalb zählt
    # `filament_jobs` mit, wie viele Jobs überhaupt beitragen konnten.
    if filament_g:
        s["total_filament_g"] = round(s.get("total_filament_g", 0.0) + max(0.0, float(filament_g)), 2)
        s["filament_jobs"]    = s.get("filament_jobs", 0) + 1
    if not s.get("since"):
        s["since"] = datetime.now().isoformat()
    _write_stats(s)


# Einstellungen, die eine LAUFENDE Farm nachzieht. Bewusst nur
# ENTSCHEIDUNGSGRUNDLAGEN (was tun wir bei Fehler X, wann darf gedruckt werden) —
# Laufzeit-Zustand wie Jobs, Greifer-Inhalt oder Fach-Belegung bleibt unberührt.
# Den mitten im Lauf zu ersetzen wäre kein Nachziehen, sondern ein Neustart.
def _live_settings(s: dict) -> dict:
    return {
        "hms_ignore":              {hms.normalize_code(c) for c in (s.get("hms_ignore") or [])},
        "conn_alarm":              bool(s.get("conn_alarm", True)),
        "progress_stall_min":      int(s.get("progress_stall_min", 0) or 0),
        "error_strategy":          dict(s.get("error_strategy") or {}),
        "failed_retries":          max(0, int(s.get("failed_retries", 1) or 0)),
        "operating_hours_enabled": bool(s.get("operating_hours_enabled", False)),
        "move_timeout_s":          int(s.get("move_timeout_s", 180) or 180),
        "operating_schedule":      _operating_schedule(s),
        "operating_tz":            str(s.get("timezone", "") or ""),
        "exact_color_only":        bool(s.get("exact_color_only", False)),
        "cool_before_eject":       bool(s.get("cool_before_eject", True)),
        "cool_temp_c":             float(s.get("cool_temp_c", 30.0) or 30.0),
        "cool_timeout_min":        max(0, int(s.get("cool_timeout_min", 30) or 0)),
    }


def _refresh_live_settings() -> None:
    """Geänderte Einstellungen in den laufenden Lauf übernehmen.

    Bis v1.1.18 war alles davon beim Start eingefroren: wer im Dauerbetrieb die
    Fehlerstrategie, die Betriebszeiten oder die HMS-Liste änderte, bekam
    „Gespeichert." zu sehen — wirksam wurde es erst beim nächsten Start der Farm,
    und das stand nirgends. Genau ein Wert (idle_off_min) wurde live gelesen.

    Neu geparst wird nur, wenn sich die Datei geändert hat — sonst läge hier ein
    JSON-Lesevorgang je Schleifendurchlauf.
    """
    try:
        mtime = os.path.getmtime(SETTINGS_PATH)
    except OSError:
        return
    if _farm.get("_settings_mtime") == mtime:
        return
    _farm["_settings_mtime"] = mtime
    _farm.update(_live_settings(_read_config(SETTINGS_PATH, _DEFAULT_SETTINGS)))


async def _job_filament_g(job: dict):
    """Filamentverbrauch (g) des gedruckten Jobs — plattengenau aus der Datei.

    Erst am Druckende gelesen und nicht beim Einreihen: das kostet EINEN Header-Lesevorgang
    nach einem Druck, der Stunden gelaufen ist, und gilt dafür für JEDEN Weg in die
    Warteschlange (Bibliothek, Projekt, Planer) statt nur für einen.
    """
    try:
        from app.routers.files import filament_grams
        db = SessionLocal()
        try:
            f = db.query(UploadedFile).filter(UploadedFile.id == job.get("fileId")).first()
            path, ftype = (f.file_path, f.file_type) if f else (None, None)
        finally:
            db.close()
        if not path or not os.path.exists(path):
            return None
        return await asyncio.get_event_loop().run_in_executor(
            None, filament_grams, path, ftype, job.get("plate"))
    except Exception as e:
        logger.warning(f"filament grams for job failed: {e}")
        return None


def _record_failure(error_msg: str = ""):
    s = _read_stats()
    s["total_jobs"]  = s.get("total_jobs", 0) + 1
    s["failed_jobs"] = s.get("failed_jobs", 0) + 1
    if error_msg:
        errs = s.get("errors", {})
        key  = error_msg[:70]
        errs[key] = errs.get(key, 0) + 1
        s["errors"] = errs
    if not s.get("since"):
        s["since"] = datetime.now().isoformat()
    _write_stats(s)


# ── Per-file duration history (B.2 — real ETA from past runs) ─────────────────
# farm_history.json: { "<file_id>": {"samples": [min, …], "avg_min": x, "n": k} }
def _read_history() -> dict:
    data = storage.read_json(HISTORY_PATH, {})
    return data if isinstance(data, dict) else {}


def _record_duration(file_id, minutes: float, kwh: float = 0.0):
    """Append a measured full-cycle duration (wall-clock running→done, in minutes)
    and energy (kWh) for a file; keep rolling averages over the last HISTORY_KEEP runs."""
    if file_id is None or minutes <= 0:
        return
    try:
        hist = _read_history()
        key  = str(file_id)
        entry = hist.get(key) or {}
        samples = [float(x) for x in entry.get("samples", []) if x] + [round(float(minutes), 1)]
        samples = samples[-HISTORY_KEEP:]
        out = {
            "samples": samples,
            "avg_min": round(sum(samples) / len(samples), 1),
            "n":       len(samples),
        }
        if kwh and kwh > 0:
            ksamples = [float(x) for x in entry.get("kwh_samples", []) if x] + [round(float(kwh), 4)]
            ksamples = ksamples[-HISTORY_KEEP:]
            out["kwh_samples"] = ksamples
            out["avg_kwh"]     = round(sum(ksamples) / len(ksamples), 4)
        elif entry.get("avg_kwh"):
            out["kwh_samples"] = entry.get("kwh_samples", [])
            out["avg_kwh"]     = entry["avg_kwh"]
        hist[key] = out
        storage.write_json(HISTORY_PATH, hist)
    except Exception as e:
        logger.warning(f"history write failed: {e}")


# ── Smart-Plug-Anbindung (Roadmap 3.1/3.2) ───────────────────────────────────
def _device_settings(device_id: int) -> dict:
    from app.models.models import SystemConfig
    db = SessionLocal()
    try:
        row = db.query(SystemConfig).filter(SystemConfig.key == f"device_settings_{device_id}").first()
        if row:
            try: return json.loads(row.value)
            except Exception: return {}
        return {}
    finally:
        db.close()


async def _read_energy_kwh(device_id: int):
    """Kumulierter Energiezähler der Steckdose (kWh) oder None, wenn nicht konfiguriert."""
    from app.services import power
    s = _device_settings(device_id)
    if not power.plug_configured(s):
        return None
    return (await power.read_power(s)).get("energy_kwh")


async def _idle_shutdown_after(device_id: int, minutes: int):
    """Wartet `minutes` und schaltet die Steckdose ab, sofern die Farm bis dahin
    nicht wieder läuft. Abgekoppelte Task am Ende eines Farm-Laufs (3.2)."""
    from app.services import power
    try:
        await asyncio.sleep(max(1, minutes) * 60)
        if _farm["running"]:
            return  # Farm wieder aktiv → nicht abschalten
        s = _device_settings(device_id)
        if power.plug_configured(s) and await power.set_plug(s, False):
            _log(f"⏻ Auto-Abschaltung: Steckdose nach {minutes} min Leerlauf ausgeschaltet")
    except asyncio.CancelledError:
        pass
    except Exception as e:
        logger.warning(f"idle shutdown failed: {e}")


def _record_event(etype: str, job: str = "", detail: str = ""):
    """Append a printer-utilization event ({ts,type,job,detail}) for the timeline.
    Types: farm_start, farm_stop, print_start, print_done, error, eject."""
    try:
        events = storage.read_json(TIMELINE_PATH, [])
        events.append({
            "ts":     datetime.now().isoformat(),
            "type":   etype,
            "job":    job or "",
            "detail": detail or "",
        })
        if len(events) > TIMELINE_MAX:
            events = events[-TIMELINE_MAX:]
        storage.write_json(TIMELINE_PATH, events)
    except Exception as e:
        logger.warning(f"timeline write failed: {e}")


# ── Laufzustand sichern (Phase 3.1/3.2) ──────────────────────────────────────
# `_farm` lag bisher NUR im Speicher. Ein Neustart — auch der durch das eigene
# In-App-Update! — ließ den Drucker weiterdrucken, während die Farm einfach weg
# war: kein Auswurf, kein Einlagern, und niemand wusste, ob eine Platte im
# Greifer hing. Deshalb wird der Zustand bei jedem Schritt mitgeschrieben.
#
# WICHTIG: Nach einem Neustart wird NICHT automatisch weitergefahren. Der Arm
# steht an unbekannter Stelle, evtl. mit Platte — das muss ein Mensch bestätigen.
# Printloom meldet nur, was unterbrochen wurde (siehe /recovery).

# Was der Greifer hält: "none" | "empty" (leere Platte) | "printed" (fertiger Druck)
_ARM_EMPTY = {"holding": "none", "from": "", "job_id": None}


def _persist_state():
    """Aktuellen Laufzustand wegschreiben (billig: kleine Datei, atomar)."""
    try:
        storage.write_json(STATE_PATH, {
            "running":        bool(_farm.get("running")),
            "paused":         bool(_farm.get("paused")),
            "current_job_id": _farm.get("current_job_id"),
            "job_name":       _farm.get("_current_job_name") or "",
            "slot":           _farm.get("_current_job_slot") or "",
            "step_idx":       _farm.get("seq_step_idx"),
            "step_total":     _farm.get("seq_step_total"),
            "step_label":     _farm.get("seq_step_label") or "",
            "arm":            _farm.get("arm") or dict(_ARM_EMPTY),
            "needs_home":     bool(_farm.get("needs_home")),
            "bambu_id":       _farm.get("bambu_id"),
            "saved_at":       datetime.now().isoformat(),
        })
    except Exception as e:
        logger.warning(f"farm state persist failed: {e}")


def _clear_state():
    """Sauberes Ende → nichts mehr zu bergen."""
    try:
        storage.write_json(STATE_PATH, {"running": False, "arm": dict(_ARM_EMPTY),
                                        "needs_home": bool(_farm.get("needs_home"))})
    except Exception as e:
        logger.warning(f"farm state clear failed: {e}")


def _load_recovery() -> dict | None:
    """Beim Start prüfen, ob ein Lauf unterbrochen wurde. Gibt den Zustand zurück,
    wenn beim letzten Speichern noch etwas lief (oder der Arm etwas hielt)."""
    try:
        s = storage.read_json(STATE_PATH, None)
    except Exception:
        return None
    if not isinstance(s, dict):
        return None
    arm = s.get("arm") or {}
    if not s.get("running") and arm.get("holding", "none") == "none":
        return None
    return s


def _set_arm(holding: str, from_slot: str = "", job_id=None):
    """Greifer-Zustand mitschreiben — nach einem Abbruch ist das die einzige
    Information darüber, ob noch eine Platte am Arm hängt."""
    _farm["arm"] = {"holding": holding, "from": from_slot or "", "job_id": job_id}
    _persist_state()


def mark_position_unknown(reason: str = ""):
    """Von außen aufrufbar (Notaus): Die Ist-Position des Arms gilt als unbekannt —
    vor der nächsten Bewegung wird referenziert."""
    _farm["needs_home"] = True
    _persist_state()
    if reason:
        _log(f"⌂ {reason}: Position des OTTOeject gilt als unbekannt — "
             f"vor der nächsten Bewegung wird referenziert.")


def _record_hms(code: str, severity: str, text: str, action: str = ""):
    """Drucker-Fehler in die durchsuchbare Historie schreiben (neueste zuerst).
    Bisher tauchten HMS-Codes nur im Live-Log auf und waren nach einem Neustart weg —
    genau dann, wenn man wissen will, ob ein Fehler schon einmal auftrat."""
    try:
        items = storage.read_json(HMS_PATH, [])
        if not isinstance(items, list):
            items = []
        items.insert(0, {
            "ts":       datetime.now().isoformat(),
            "code":     code,
            "severity": severity,
            "text":     text or "",
            "action":   action or "",
            "job":      _farm.get("_current_job_name") or "",
        })
        storage.write_json(HMS_PATH, items[:HMS_MAX])
    except Exception as e:
        logger.warning(f"hms history write failed: {e}")


def _init_recovery():
    """Beim Start des Backends prüfen, ob ein Lauf unterbrochen wurde (Neustart,
    Update, Absturz). Das Ergebnis landet in _farm["recovery"] und wird der UI
    gemeldet — fortgesetzt wird NICHTS von allein: der Arm steht an unbekannter
    Stelle und hält womöglich eine Platte."""
    rec = _load_recovery()
    if not rec:
        return
    _farm["recovery"] = rec
    _farm["arm"] = rec.get("arm") or dict(_ARM_EMPTY)
    _farm["needs_home"] = True      # Position nach dem Abbruch unbekannt
    logger.warning("Unterbrochener Farm-Lauf gefunden: %s (Schritt: %s)",
                   rec.get("job_name") or "?", rec.get("step_label") or "?")


_init_recovery()


def _record_completed(job: dict, status: str, started_at, ended_at,
                      duration_min: float, reason: str = ""):
    """Einen abgeschlossenen Job in die Historie schreiben (neueste zuerst).
    status: 'done' | 'error' | 'ejected'. Enthält Datum + Anfang/Ende-Uhrzeit."""
    try:
        items = storage.read_json(COMPLETED_PATH, [])
        if not isinstance(items, list):
            items = []
        s_iso = started_at.isoformat() if hasattr(started_at, "isoformat") else (started_at or "")
        e_iso = ended_at.isoformat() if hasattr(ended_at, "isoformat") else (ended_at or "")
        items.insert(0, {
            "fileId":     job.get("fileId"),
            "fileName":   job.get("fileName", ""),
            "plate":      job.get("plate"),
            "plateTotal": job.get("plateTotal"),
            "plateName":  job.get("plateName") or "",
            "slot":       job.get("slot"),
            "status":     status,
            "reason":     reason or "",
            "started_at": s_iso,
            "ended_at":   e_iso,
            "duration_min": round(float(duration_min), 1) if duration_min else None,
        })
        if len(items) > COMPLETED_MAX:
            items = items[:COMPLETED_MAX]
        storage.write_json(COMPLETED_PATH, items)
    except Exception as e:
        logger.warning(f"completed-history write failed: {e}")


def _log(msg: str):
    ts  = datetime.now().strftime("%H:%M:%S")
    day = datetime.now().strftime("%Y-%m-%d")
    entry = f"{ts} — {msg}"
    _farm["log"].insert(0, entry)
    if len(_farm["log"]) > 200:
        _farm["log"] = _farm["log"][:200]
    logger.info(f"[AutoFarm] {msg}")
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(f"{day} {entry}\n")
    except Exception:
        pass


def _set_job(job_id: int, updates: dict):
    for j in _farm["jobs"]:
        if j["id"] == job_id:
            j.update(updates)
            return


def _rack_update(slot: str, status: str, file_name: str = None, object_height_mm: float = None,
                 empty_plate: bool = None):
    """Fach-Zustand schreiben. `empty_plate` nur mitgeben, wenn sich die Markierung
    „hier liegt eine leere Platte" wirklich ändert (Aufbau ohne Magazin) — sonst
    bleibt sie, wie sie ist."""
    try:
        if not os.path.exists(SLOTS_PATH):
            return
        with open(SLOTS_PATH) as f:
            data = json.load(f)
        s = data["slots"].get(str(slot))
        if s is None:
            return
        s["status"] = status
        if file_name is not None:
            s["file_name"] = file_name
        if object_height_mm is not None:
            s["object_height_mm"] = object_height_mm
        if status == "free":
            s["object_height_mm"] = None
        if empty_plate is not None:
            s["empty_plate"] = bool(empty_plate)
        storage.write_json(SLOTS_PATH, data)
    except Exception as e:
        logger.warning(f"rack slot update failed: {e}")


def _rack_data() -> dict:
    """slots.json lesen (leeres Dict bei Fehler) — für die Platten-Quelle."""
    try:
        if os.path.exists(SLOTS_PATH):
            with open(SLOTS_PATH) as f:
                return json.load(f) or {}
    except Exception:
        pass
    return {}


# Dünne Wrapper um die reine Platten-Quellen-Logik (app/services/rack_logic.py):
# lesen nur slots.json nach, die Entscheidungen selbst stehen dort — dieselben
# Funktionen nutzt der Rack Manager, damit Farm und UI nie auseinanderlaufen.
def _magazine_slot_cfg(data: dict = None) -> int:
    """Konfiguriertes Magazin-Fach; 0 = KEIN Magazin (Platten liegen in den normalen
    Fächern und werden von dort gegriffen — Setup-Assistent „7. Fach = normales Fach")."""
    return _rack_logic.magazine_slot_of(_rack_data() if data is None else data)


def _plate_source(data: dict = None) -> tuple:
    """Woher kommt die NÄCHSTE leere Platte? → (rack, slot, from_magazine).
    Siehe rack_logic.plate_source (mit/ohne Magazin, Griff von oben nach unten)."""
    return _rack_logic.plate_source(_rack_data() if data is None else data)


def _reserved_source_slots(data: dict) -> set:
    """Fächer, in denen (ohne Magazin) noch LEERE Platten für den Nachschub liegen.
    Die dürfen NICHT als Ablageziel vergeben werden — sonst legt der Arm einen
    fertigen Druck auf eine bereits belegte Position (Kollision)."""
    return _rack_logic.reserved_source_slots(data)


def _magazine_count() -> int:
    """Wie viele LEERE Platten stehen bereit? Mit Magazin die Summe der Zähler, ohne
    Magazin die Zahl der als bestückt markierten Fächer (rack_logic)."""
    try:
        if os.path.exists(SLOTS_PATH):
            with open(SLOTS_PATH) as f:
                d = json.load(f)
            if d.get("magazine_counts") or _rack_logic.uses_marks(d):
                return max(0, _rack_logic.empty_plate_count(d))
            # Legacy: max_plates minus belegte Slots
            max_p    = int(d.get("max_plates", 4))
            occupied = sum(1 for s in d.get("slots", {}).values()
                           if s.get("status") in ("done", "printing"))
            return max(0, max_p - occupied)
    except Exception:
        pass
    return 4


def _slot_tolerance(data: dict = None) -> float:
    """Konfigurierte Fächer-Toleranz (mm) aus der Regal-Config; Default 20.
    Wird `data` (bereits geladene slots.json) übergeben, wird nicht neu gelesen."""
    if data is None:
        try:
            with open(SLOTS_PATH) as f:
                data = json.load(f)
        except Exception:
            data = {}
    try:
        return float(data.get("slot_tolerance_mm", DEFAULT_SLOT_TOLERANCE_MM))
    except (TypeError, ValueError):
        return DEFAULT_SLOT_TOLERANCE_MM


def _stacked_pct(data: dict = None) -> float:
    """Nutzbarer Anteil der Fachhöhe, wenn im Fach darüber schon eine Platte liegt."""
    if data is None:
        try:
            with open(SLOTS_PATH) as f:
                data = json.load(f)
        except Exception:
            data = {}
    return _rack_logic.stacked_pct_of(data)


# Dünne Wrapper um die reine Logik (app/services/rack_logic.py): ziehen die
# konfigurierte Toleranz, sofern keine explizit übergeben wird.
def _slots_needed(height_mm: float, slot_h: float, tol: float = None) -> int:
    if tol is None:
        tol = _slot_tolerance()
    return _slots_needed_base(height_mm, slot_h, tol)


def _is_blocked_from_below(rack: int, slot_num: int, slots: dict, slot_h: float,
                           tol: float = None, pct: float = None) -> bool:
    if tol is None:
        tol = _slot_tolerance()
    if pct is None:
        pct = _stacked_pct()
    return _is_blocked_base(rack, slot_num, slots, slot_h, tol, pct)


def _find_slot_for_height(height_mm: float, exclude_job_id: int = None) -> Optional[str]:
    try:
        if not os.path.exists(SLOTS_PATH):
            return None
        with open(SLOTS_PATH) as f:
            data = json.load(f)
        slots  = data.get("slots", {})
        nr     = int(data.get("num_racks", 3))
        spr    = int(data.get("slots_per_rack", 6))
        slot_h = float(data.get("slot_height_mm", 50))
        tol    = _slot_tolerance(data)
        pct    = _stacked_pct(data)
        mag    = _rack_logic.magazine_slot_of(data)
        needed = _slots_needed(height_mm, slot_h, tol)

        # Exclude the current job so its placeholder slot isn't locked against itself
        taken = {j["slot"] for j in _farm.get("jobs", [])
                 if j.get("status") not in ("done", "error")
                 and j.get("slot")
                 and j.get("id") != exclude_job_id}
        # Ohne Magazin liegen in den unteren Fächern noch LEERE Platten als Nachschub —
        # die sind physisch belegt, obwohl ihr Status „free" ist. Niemals als Ziel
        # vergeben, sonst legt der Arm den fertigen Druck auf eine liegende Platte.
        taken |= _reserved_source_slots(data)

        for r in range(1, nr + 1):
            for s in range(1, spr - needed + 2):
                if s + needed - 1 > spr:
                    break
                # Liegt über dem obersten belegten Fach schon eine Platte (Magazin,
                # Leerplatte, eingelagerter Druck), passt nur noch ein Bruchteil der
                # Fachhöhe: die Platte fährt erhöht ein und braucht die Luft.
                if not _rack_logic.fits_below(
                        height_mm, needed,
                        _rack_logic.slot_has_plate(r, s + needed, slots, mag, taken),
                        slot_h, tol, pct):
                    continue
                if all(
                    slots.get(f"{r}-{s+i}", {}).get("status", "free") in ("free", "ready")
                    and f"{r}-{s+i}" not in taken
                    and not _is_blocked_from_below(r, s + i, slots, slot_h, tol, pct)
                    for i in range(needed)
                ):
                    return f"{r}-{s}"
        return None
    except Exception as e:
        logger.warning(f"_find_slot_for_height error: {e}")
        return None


async def _assign_slot_for_height(job: dict, height_mm: float):
    while not _farm["stopping"]:
        try:
            with open(SLOTS_PATH) as f:
                data = json.load(f)
        except Exception:
            return
        slot_h  = float(data.get("slot_height_mm", 50))
        spr     = int(data.get("slots_per_rack", 6))
        nr      = int(data.get("num_racks", 3))
        max_h   = spr * slot_h * nr  # absolute max across all racks

        # Was maximal in EIN Regal passt: alle Fächer voll ausgenutzt — über dem
        # obersten liegt aber das Magazin, dort gilt nur der Stapel-Anteil. Ohne
        # diese Grenze würde ein zu hohes Objekt endlos auf ein Fach warten, das es
        # nie geben kann („Regal voll", obwohl das Regal leer ist).
        rack_max = _rack_logic.height_limit(
            spr, slot_h, _slot_tolerance(data),
            plate_above=_rack_logic.magazine_slot_of(data) > 0,
            stacked_pct=_stacked_pct(data))
        if _slots_needed(height_mm, slot_h) > spr or height_mm > rack_max:
            _log(f"⚠ Objekt {height_mm:.0f}mm zu hoch (max {rack_max:.0f}mm/Rack) — Farm pausiert")
            _farm["paused"] = True
            _farm["error"]  = (f"Objekt {height_mm:.0f}mm zu hoch — im Drucker lassen, "
                                "manuell entnehmen, dann fortsetzen")
            while _farm["paused"] and not _farm["stopping"]:
                await asyncio.sleep(0.5)
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            _farm["error"] = None
            continue

        new_slot = _find_slot_for_height(height_mm, exclude_job_id=job.get("id"))
        if new_slot is None:
            action = _estrat("no_slot")
            if action == "stop":
                _log(f"⚠ Kein freies Fach für {height_mm:.0f}mm — Farm wird gestoppt (Strategie)")
                _farm["stopping"] = True
                raise RuntimeError("Gestoppt")
            if action == "skip":
                _log(f"⚠ Kein freies Fach für {height_mm:.0f}mm — Job übersprungen (Strategie)")
                raise RuntimeError(f"Kein freies Fach für {height_mm:.0f}mm")
            # Standard: Regal voll → die fertige Platte WARTET IM DRUCKER, bis genug
            # zusammenhängende Fächer übereinander frei sind. Sobald Platz da ist,
            # geht es automatisch weiter — KEIN manuelles Fortsetzen nötig.
            boeden = _slots_needed(height_mm, slot_h)
            if not _farm.get("_no_slot_logged"):
                _log(f"📦 Regal voll — {height_mm:.0f}mm braucht {boeden} freie Fächer übereinander. "
                     f"Druck wartet im Drucker, bis Platz frei ist…")
                _farm["_no_slot_logged"] = True
            _farm["error"] = (f"Regal voll — {boeden} freie Fächer übereinander nötig "
                              f"({height_mm:.0f}mm). Platz schaffen — der Druck wartet im Drucker.")
            # Pause respektieren, aber NICHT selbst pausieren (auto-weiter sobald Platz).
            while _farm["paused"] and not _farm["stopping"]:
                await asyncio.sleep(0.5)
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            await asyncio.sleep(5)
            continue

        # Reset old placeholder slot if GRAB_FROM_RACK wrongly set it to 'printing'
        old_slot = job.get("slot")
        if old_slot and old_slot != new_slot:
            try:
                if data.get("slots", {}).get(str(old_slot), {}).get("status") == "printing":
                    _rack_update(old_slot, "free")
                    _log(f"♻ Platzhalter-Fach {old_slot} freigegeben")
            except Exception:
                pass

        # Platz gefunden → falls zuvor „Regal voll" gewartet wurde, Banner aufräumen.
        if _farm.get("_no_slot_logged"):
            _farm.pop("_no_slot_logged", None)
            if (_farm.get("error") or "").startswith("Regal voll"):
                _farm["error"] = None
            _log("✓ Platz im Regal frei geworden — fahre fort")

        # Reserve actual slot as 'printing' + store height for clearance blocking
        _rack_update(new_slot, "printing", job.get("fileName", ""), object_height_mm=height_mm)
        _set_job(job["id"], {"slot": new_slot, "object_height_mm": height_mm})
        slot_h = float(data.get("slot_height_mm", 50))
        boeden = _slots_needed(height_mm, slot_h)
        _log(f"📏 Objekt {height_mm:.0f}mm → Fach {new_slot} reserviert ({boeden} {'Boden' if boeden == 1 else 'Böden'})")
        return
    raise RuntimeError("Gestoppt")


async def _notify(msg: str):
    try:
        from app.routers.system import _read_notif, _send_telegram
        cfg = _read_notif()
        if cfg.get("enabled") and cfg.get("telegram_bot_token") and cfg.get("telegram_chat_id"):
            await _send_telegram(cfg["telegram_bot_token"], cfg["telegram_chat_id"], msg)
    except Exception:
        pass
    # Web-Push (PWA) — best-effort, never blocks the farm.
    try:
        from app.services import push
        loop = asyncio.get_event_loop()
        # strip simple Markdown for a clean push body; first line = title
        clean = msg.replace("*", "").replace("`", "").strip()
        lines = [ln for ln in clean.split("\n") if ln.strip()]
        title = lines[0] if lines else "Printloom"
        body  = "\n".join(lines[1:]) if len(lines) > 1 else ""
        await loop.run_in_executor(None, lambda: push.send_to_all(title, body, "/"))
    except Exception:
        pass


async def _send_print_cmd(cmd: str):
    """Pause/Resume/Stop an den X1C senden (best effort), damit die Farm-Bedienung
    den Drucker direkt mitsteuert. Nutzt eine kurze eigene MQTT-Verbindung."""
    bid = _farm.get("bambu_id")
    if not bid:
        return
    db = SessionLocal()
    try:
        device = db.query(Device).filter(
            Device.id == bid, Device.device_type == PrinterType.BAMBU_LAB).first()
    finally:
        db.close()
    if not device:
        return
    loop = asyncio.get_event_loop()
    try:
        # Über die persistente Verbindung (bambu_manager) — kein eigener Connect/Disconnect.
        if cmd not in ("pause", "resume", "stop"):
            return
        ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.print_command, device, cmd)
        if ok:
            _log(f"⏯ Drucker: {cmd} gesendet")
        else:
            _log(f"⚠ Drucker-{cmd}: keine MQTT-Verbindung")
    except Exception as e:
        _log(f"⚠ Drucker-{cmd} fehlgeschlagen: {e}")


# ── Step implementations ─────────────────────────────────────
# ── Der OTTOeject ist EINE geteilte Ressource (Phase 4.6) ────────────────────
# Mehrere Drucker können gleichzeitig drucken — der Arm kann immer nur an EINER
# Station sein. Jede Bewegung läuft deshalb durch diese Sperre. Bei einem einzigen
# Drucker ändert das nichts (die Sperre ist nie umkämpft); bei zweien verhindert
# sie den Fall, der sonst sicher kommt: zwei Drucker werden gleichzeitig fertig,
# beide schicken den Arm los.
_arm_lock = asyncio.Lock()
_arm_holder: Optional[str] = None      # wer den Arm gerade hat (für die Anzeige)
_arm_waiting: list = []                # wer wartet (Reihenfolge = Warteschlange)


class arm_access:
    """`async with arm_access("printer-1", "Auswerfen"):` — belegt den Arm.

    Reentrant über eine Ebene hinaus wird bewusst NICHT unterstützt: verschachtelte
    Bewegungen gibt es nicht, und ein stiller Reentrant würde die Sperre wertlos
    machen."""

    def __init__(self, who: str = "", what: str = ""):
        self.who, self.what = who or "farm", what or ""

    async def __aenter__(self):
        global _arm_holder
        if _arm_lock.locked() and _arm_holder != self.who:
            _arm_waiting.append(self.who)
            _log(f"⏳ {self.who} wartet auf den OTTOeject (belegt von {_arm_holder})")
        await _arm_lock.acquire()
        if self.who in _arm_waiting:
            _arm_waiting.remove(self.who)
        _arm_holder = self.who
        return self

    async def __aexit__(self, *exc):
        global _arm_holder
        _arm_holder = None
        _arm_lock.release()
        return False


def arm_status() -> dict:
    return {"busy": _arm_lock.locked(), "holder": _arm_holder, "waiting": list(_arm_waiting)}


class _MoveTimeout(RuntimeError):
    """Eine OTTOeject-Bewegung hat nicht innerhalb des Zeitlimits geantwortet.
    Eigener Typ, damit die Fehlerstrategie „move_timeout" darauf reagieren kann —
    ein hängender Arm ist etwas anderes als ein abgelehnter Befehl."""


def _move_timeout() -> float:
    """Zeitlimit für EINE Bewegung (s). Ein Griff über mehrere Regale darf lange
    dauern, deshalb großzügig und einstellbar."""
    try:
        v = float(_farm.get("move_timeout_s")
                  or _read_config(SETTINGS_PATH, _DEFAULT_SETTINGS).get("move_timeout_s", 180))
    except (TypeError, ValueError):
        v = 180.0
    return max(30.0, min(900.0, v))


async def _do_macro(name: str, _recover: bool = True):
    db = SessionLocal()
    try:
        klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
        if not klipper:
            raise RuntimeError("Klipper nicht konfiguriert")
        url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    finally:
        db.close()

    # Nach Notaus / hängender Bewegung ist die Ist-Position unbekannt. Dann VOR der
    # nächsten Bewegung referenzieren — sonst fährt der erste Move von einer falschen
    # Annahme aus los (Phase 3.7). Homing selbst räumt das Flag ab.
    if _farm.get("needs_home") and "OTTOEJECT_HOME" not in name.upper():
        _log("⌂ Position unbekannt (Notaus/Abbruch) — referenziere zuerst…")
        _farm["needs_home"] = False
        try:
            await _do_macro("OTTOEJECT_HOME", _recover=False)
        except Exception as e:
            _farm["needs_home"] = True
            raise RuntimeError(f"Referenzfahrt vor der Bewegung fehlgeschlagen: {e}")
        _persist_state()
    elif "OTTOEJECT_HOME" in name.upper():
        _farm["needs_home"] = False

    # Geräte-Macros zählen Regal 1 = am Homing-Punkt (rechts), Printloom R1 = am
    # Drucker → RACK=-Nummern erst hier beim Senden spiegeln (mirror_rack_params).
    send = name
    try:
        send = _motion.mirror_rack_params(name, (_rack_load() or {}).get("num_racks"))
    except Exception:
        send = name
    if send != name:
        _log(f"↔ Geräte-Zählung (Regal 1 = Homing rechts): {send}")

    # Absolute Positionierung erzwingen: Die Geräte-Macros (EJECT_FROM…/GRAB_FROM_RACK…)
    # setzen selbst KEIN G90 — steht der OTTOeject nach Homing/Jog relativ (G91), fahren
    # ihre internen G1-Moves als Offset ab Ist-Position → out of range / falsches Z.
    # G90 vor JEDEM Send (idempotent, kein Doppel-G90 wenn schon vorhanden).
    if not send.lstrip().upper().startswith("G90"):
        send = "G90\n" + send

    # Moonraker antwortet erst, wenn die Bewegung DURCH ist. Bleibt sie hängen
    # (Riemen rutscht, Endschalter prellt, Klipper wartet auf etwas), lief die Farm
    # bisher in einen nackten httpx-Timeout und meldete „Network Error" — ohne den
    # Arm zu parken. Jetzt: klare Meldung, damit die Fehlerstrategie „move_timeout"
    # greifen kann (Phase 3.3).
    limit = _move_timeout()
    try:
        # Der Arm ist eine geteilte Ressource: nur EINE Bewegung zur Zeit, egal
        # wie viele Drucker laufen (Phase 4.6).
        async with arm_access(_farm.get("printer_module") or "farm", name[:40]):
            async with httpx.AsyncClient(timeout=limit) as client:
                r = await client.post(url, json={"script": send})
    except httpx.ReadTimeout:
        raise _MoveTimeout(f"{name}: keine Rückmeldung nach {int(limit)} s — Bewegung hängt")
    except httpx.HTTPError as e:
        raise RuntimeError(f"{name}: OTTOeject nicht erreichbar ({e})")
    if r.status_code == 200:
        return

    body = r.text or ""
    # OTTOeject-Steppermotoren schalten nach Leerlauf (Klipper idle_timeout, Standard
    # 10 Min) ab und verlieren dabei das Homing. Der nächste Bewegungsbefehl — z. B.
    # GRAB_FROM_RACK beim ersten Job nach einer Wartephase (leere Warteschlange,
    # Magazin-Auffüllen, Regal voll) — wird dann mit „Must home axis first" abgelehnt.
    # In dem Fall einmal automatisch homen und den Befehl wiederholen → selbstheilend,
    # kein abgebrochener Job. (OTTOEJECT_HOME selbst niemals rekursiv wiederholen.)
    if (_recover and "must home axis first" in body.lower()
            and "OTTOEJECT_HOME" not in name.upper()):
        _log("⚠ OTTOeject war nicht referenziert (Motoren nach Leerlauf aus) — homen und erneut versuchen…")
        await _do_macro("OTTOEJECT_HOME", _recover=False)
        await _do_macro(name, _recover=False)
        return
    raise RuntimeError(f"{name} fehlgeschlagen: {body[:120]}")


async def _do_bambu_gcode(gcode: str, device: Device):
    loop = asyncio.get_event_loop()
    # Über die persistente Verbindung (bambu_manager) senden — kein eigener Connect.
    sent = await loop.run_in_executor(bambu_manager.executor, bambu_manager.send_gcode, device, gcode)
    await asyncio.sleep(1)
    if not sent:
        raise RuntimeError(f"GCode fehlgeschlagen: {gcode[:40]}")


def _effective_filaments(file_id, fpath: str, ftype: str, plate=None) -> tuple:
    """Die im Druck WIRKLICH verwendeten Filamente (Material+Farbe) — immer aus der
    Datei selbst, plattengenau. KEIN „festnageln"/Override mehr: das echte Material
    der Datei zählt, sonst druckt z. B. PETG mit PLA."""
    return _read_filament_info(fpath, ftype, plate)


# ── Pro-Datei manuell gewählte AMS-Slots (vom Nutzer im Datei-Browser) ──────
def _file_ams_map(file_id) -> str:
    try:
        return str(storage.read_json(FILE_AMSMAP_PATH, {}).get(str(file_id), "") or "")
    except Exception:
        return ""


def _save_file_ams_map(file_id, ams_map: str):
    data = storage.read_json(FILE_AMSMAP_PATH, {})
    if (ams_map or "").strip():
        data[str(file_id)] = ams_map.strip()
    else:
        data.pop(str(file_id), None)
    storage.write_json(FILE_AMSMAP_PATH, data)


def _job_manual_map(job: dict) -> str:
    """Manuelle AMS-Zuordnung eines Jobs: zuerst der Job selbst, sonst die pro Datei
    im Browser gespeicherte Zuordnung."""
    return (job.get("amsMap") or "").strip() or _file_ams_map(job.get("fileId"))


def _material_base(t: str) -> str:
    return (t or "").upper().strip().split()[0] if t else ""


def _material_mismatch(types: list, ams_map_str: str, ams_raw: dict) -> str:
    """Sicherheitsnetz: prüft, ob eine MANUELLE AMS-Zuordnung das Material kreuzt
    (z. B. Datei PETG → Slot PLA). Gibt eine Klartext-Beschreibung der Konflikte
    zurück, oder '' wenn alle Materialien passen."""
    slots = {s["gid"]: s for s in _ams_slots_from_raw(ams_raw)}
    gids = []
    for x in str(ams_map_str).split(","):
        x = x.strip()
        if x.lstrip("-").isdigit():
            gids.append(int(x))
    bad = []
    for i, ftype in enumerate(types):
        if i >= len(gids):
            continue
        slot = slots.get(gids[i])
        if not slot:
            bad.append(f"Slot {gids[i]} leer/unbekannt")
            continue
        fb, sb = _material_base(ftype), _material_base(slot.get("type"))
        if fb and sb and fb != sb and fb not in (slot.get("type") or "").upper() and sb not in (ftype or "").upper():
            bad.append(f"{ftype}→{slot.get('type')}")
    return ", ".join(bad)


async def _do_send_file(job: dict, device: Device, use_ams: bool):
    loop = asyncio.get_event_loop()
    db = SessionLocal()
    try:
        file = db.query(UploadedFile).filter(UploadedFile.id == job["fileId"]).first()
        if not file:
            raise RuntimeError(f"Datei {job['fileId']} nicht gefunden")

        print_name = _make_print_name(file.original_filename)
        # Persistente Verbindung (bambu_manager) — kein eigener Connect/Disconnect.
        connected = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
        if not connected:
            raise RuntimeError("MQTT-Verbindung fehlgeschlagen")

        ams_map_str = _job_manual_map(job)   # Job-Map oder pro-Datei im Browser gewählt

        if not use_ams:
            ams_mapping = []
            _log("AMS deaktiviert")

        elif ams_map_str:
            try:
                ams_mapping = [int(x.strip()) for x in ams_map_str.split(',') if x.strip().lstrip('-').isdigit()]
                if not ams_mapping:
                    raise ValueError("empty")
                _log(f"AMS-Mapping: {ams_mapping} (manuell)")
            except Exception:
                _log(f"⚠ AMS-Mapping '{ams_map_str}' ungültig — Auto-Matching")
                ams_map_str = ''

        if use_ams and not ams_map_str:
            _log("AMS-Status abfragen…")
            await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
            await asyncio.sleep(3.0)
            raw = bambu_manager.last_status(device)
            ams_raw = (raw.get("print", {}).get("ams", {}) if raw else {})

            if not ams_raw or not ams_raw.get("ams"):
                _log("AMS-Daten leer — nochmal…")
                await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
                await asyncio.sleep(3.0)
                raw = bambu_manager.last_status(device)
                ams_raw = (raw.get("print", {}).get("ams", {}) if raw else {})

            fil_types, fil_colors = await loop.run_in_executor(
                None, _effective_filaments, file.id, file.file_path, file.file_type, job.get("plate")
            )
            _log(f"Filamente in Datei: {list(zip(fil_types, fil_colors))}")

            if ams_raw and ams_raw.get("ams"):
                ams_mapping = await loop.run_in_executor(
                    None, _match_ams_live, fil_types, fil_colors, ams_raw
                )
                _log(f"AMS-Match (Live): {ams_mapping}")
            else:
                _log("⚠ Kein Live-AMS — Fallback aus Datei")
                ams_mapping = await loop.run_in_executor(
                    None, _get_ams_mapping, file.file_path, file.file_type, None
                )
                _log(f"AMS-Mapping (Datei): {ams_mapping}")

        if use_ams and ams_mapping:
            # Auf Slicer-Slot-Positionen heben: druckt die Datei z. B. nur mit
            # Filament 3, erwartet der X1C [-1, -1, Tray] — ein Eintrag pro
            # BENUTZTEM Filament ordnet sonst Filament 1 zu und lässt Filament 3
            # leer („AMS-Zuordnung passt nicht"). No-op bei Filamenten 1..n.
            expanded = await loop.run_in_executor(
                None, _expand_mapping_to_slots, ams_mapping, file.file_path, file.file_type, job.get("plate")
            )
            if expanded != ams_mapping:
                _log(f"AMS-Mapping auf Slicer-Slots gehoben (unbenutzte = -1): {expanded}")
                ams_mapping = expanded

        # Multi-Plate: gewählte Platte als Einzel-Platten-.3mf umpacken — der X1C
        # parst sonst das GESAMTE Projekt (z. B. 16 Platten ≈ 38 MB → minutenlang
        # „Vorbereitung 100 %"). Bambu Studio schickt selbst auch nur EINE Platte.
        upload_path, repack_tmp, plate_param = file.file_path, None, ""
        if file.file_type == '.3mf':
            plates = _list_plates(file.file_path)
            if len(plates) > 1:
                target = int(job.get("plate") or plates[0])
                try:
                    upload_path = await loop.run_in_executor(None, _repack_single_plate, file.file_path, target)
                    repack_tmp = upload_path
                    plate_param = "Metadata/plate_1.gcode"
                    _log(f"📦 Multi-Plate ({len(plates)} Platten) — Platte {target} einzeln umgepackt "
                         f"({os.path.getsize(upload_path) / 1e6:.1f} statt {os.path.getsize(file.file_path) / 1e6:.1f} MB)")
                except Exception as e:
                    _log(f"⚠ Umpacken fehlgeschlagen ({e}) — sende Originaldatei")
                    upload_path, repack_tmp = file.file_path, None
                    plate_param = _get_plate_gcode_param(file.file_path, job.get("plate"))
            else:
                plate_param = _get_plate_gcode_param(file.file_path, job.get("plate"))

        ftp = BambuFTP(device.ip_address, device.access_code)
        up = await loop.run_in_executor(bambu_manager.executor, ftp.upload_file, upload_path, print_name)
        if repack_tmp:
            try:
                os.remove(repack_tmp)
            except OSError:
                pass
        if not up:
            raise RuntimeError("FTP-Upload fehlgeschlagen")

        _log(f"Plate-GCode: {plate_param or 'n/a'}")

        await asyncio.sleep(5)
        ok = await loop.run_in_executor(
            bambu_manager.executor,
            lambda: bambu_manager.start_print(device, print_name, use_ams=use_ams, ams_mapping=ams_mapping, plate_param=plate_param)
        )
        await asyncio.sleep(2)

        if not ok:
            raise RuntimeError("Druckstart fehlgeschlagen")

        _log(f"'{file.original_filename}' gestartet (AMS: {ams_mapping})")
    finally:
        db.close()


def _slot_vars(slot: str) -> tuple[str, str]:
    """Parse 'rack-slot' composite ID into (rack_num, slot_num) strings."""
    parts = str(slot).split("-")
    return (parts[0], parts[1]) if len(parts) == 2 else ("1", str(slot))


def _stack_vars() -> tuple[str, str]:
    """Return (stack_rack, stack_slot) — Quelle der nächsten LEEREN Platte.

    Mit Magazin: erstes Regal mit Bestand > 0, Fach = Magazin-Fach (z. B. 7).
    Ohne Magazin: erstes Regal mit Bestand > 0, Fach = Bestand (oberste noch
    belegte Position) — siehe _plate_source. Alle leer → R1 als neutraler
    Fallback (vorher das LETZTE Regal: ein vor der Leer-Pause aufgelöster Griff
    fuhr dann nach dem Auffüllen zu R3, obwohl nur R1 Platten hatte)."""
    try:
        d = _rack_data()
        if d:
            # Sobald es einen Bestand gibt — Zähler ODER markierte Fächer — entscheidet
            # die Platten-Quelle. Nur ohne beides bleibt der alte feste stack_slot.
            if d.get("magazine_counts") or _rack_logic.uses_marks(d):
                rack, slot, _ = _plate_source(d)
                return str(rack), str(slot)
            mag_slot = str(_magazine_slot_cfg(d) or 1)
            return str(d.get("stack_rack", "1")), str(d.get("stack_slot", mag_slot))
    except Exception:
        pass
    return "1", "7"


async def _magazine_gate() -> tuple:
    """Vor einem Griff: Magazin leer → OTTOeject PARKEN, Farm pausieren und auf
    Auffüllen + Fortsetzen warten; danach neu HOMEN. Gibt das DANN aktive Magazin
    (stack_rack, stack_slot) zurück — nach dem Auffüllen kann ein ANDERES Regal
    aktiv sein als vor der Pause (der vorab aufgelöste Wert schickte den Arm
    sonst z. B. zu R3, obwohl nur R1 aufgefüllt wurde)."""
    with_mag = _magazine_slot_cfg() > 0
    was_empty = False
    if _magazine_count() <= 0:
        was_empty = True
        _log("📦 Magazin leer — OTTOeject parkt. Platten auffüllen, Magazin-Zähler setzen, dann fortsetzen."
             if with_mag else
             "📦 Keine leeren Platten mehr in den Fächern — OTTOeject parkt. Platten einlegen, "
             "die Fächer im Regal-Panel mit ▭ als bestückt markieren, dann fortsetzen.")
        try:
            await _do_macro("PARK_OTTOEJECT")
        except Exception as e:
            _log(f"⚠ Parken fehlgeschlagen ({e}) — pausiere trotzdem")
        _farm["paused"] = True
        _farm["error"]  = ("Magazin leer — Platten auffüllen, Zähler anpassen, dann fortsetzen"
                           if with_mag else
                           "Keine leeren Platten in den Fächern — einlegen und im Regal-Panel "
                           "als bestückt markieren, dann fortsetzen")
    while _farm["paused"] and not _farm["stopping"]:
        await asyncio.sleep(0.5)
    if _farm["stopping"]:
        raise RuntimeError("Gestoppt")
    if _magazine_count() <= 0:
        raise RuntimeError("Magazin leer — abgebrochen" if with_mag
                           else "Keine leeren Platten in den Fächern — abgebrochen")
    _farm["error"] = None
    if was_empty:
        _log("📦 Nachschub da — Referenzfahrt vor dem Griff…")
        await _do_macro("OTTOEJECT_HOME")
    return _stack_vars()


def _decrement_magazine(rack: int = None, slot: int = None):
    """Eine leere Platte ist entnommen — Bestand nachziehen.

    MIT Magazin: Zähler des aktiven Regals (erster mit Zähler > 0) −1.
    OHNE Magazin: die Markierung des Fachs löschen, aus dem gegriffen wurde. Ohne
    Angabe wird das Fach genommen, das die Quelle gerade meldet — also genau das
    eben gegriffene (der Bestand ist noch unverändert)."""
    try:
        if not os.path.exists(SLOTS_PATH):
            return
        with open(SLOTS_PATH) as f:
            d = json.load(f)

        if _rack_logic.magazine_slot_of(d) <= 0:
            if rack is None or slot is None:
                rack, slot, _ = _rack_logic.plate_source(d)
            key = f"{int(rack)}-{int(slot)}"
            s = (d.get("slots") or {}).get(key)
            if isinstance(s, dict) and s.get("empty_plate"):
                s["empty_plate"] = False
                storage.write_json(SLOTS_PATH, d)
                _log(f"📥 Leerplatte aus Fach {key} entnommen — "
                     f"{_rack_logic.empty_plate_count(d)} verbleibend")
            return

        counts = d.get("magazine_counts")
        if counts:
            for i, cnt in enumerate(counts):
                if int(cnt) > 0:
                    d["magazine_counts"][i] = max(0, int(cnt) - 1)
                    storage.write_json(SLOTS_PATH, d)
                    _log(f"📦 Magazin R{i+1}: {d['magazine_counts'][i]} Platten verbleibend")
                    return
    except Exception as e:
        logger.warning(f"_decrement_magazine failed: {e}")


async def _read_live_ams(device: Device) -> dict:
    """Read live AMS status from the printer (with one retry). Returns {} if unavailable."""
    loop = asyncio.get_event_loop()
    # Persistente Verbindung (bambu_manager) — kein eigener Connect.
    connected = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
    if not connected:
        return {}
    ams_raw = {}
    for _ in range(2):
        await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
        await asyncio.sleep(3.0)
        raw = bambu_manager.last_status(device)
        ams_raw = (raw.get("print", {}).get("ams", {}) if raw else {})
        if ams_raw and ams_raw.get("ams"):
            return ams_raw
    return ams_raw or {}


async def _read_live_print(device: Device, max_age: float = 8.0) -> dict:
    """Live printer `print` status dict, cached briefly so conditional steps don't
    each hammer the printer. Returns {} if unavailable."""
    loop = asyncio.get_event_loop()
    cache = _farm.get("_status_cache")
    if cache and (loop.time() - cache["t"]) < max_age:
        return cache["data"]
    # Persistente Verbindung (bambu_manager) — kein eigener Connect.
    connected = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
    if not connected:
        return (cache or {}).get("data", {})
    for _ in range(2):
        await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
        await asyncio.sleep(2.0)
        raw = bambu_manager.last_status(device)
        p = (raw or {}).get("print", {})
        if p:
            _farm["_status_cache"] = {"t": loop.time(), "data": p}
            return p
    return (cache or {}).get("data", {})


# Sequence-condition fields → live MQTT status keys.
_COND_FIELDS = {
    "nozzle_temp":  "nozzle_temper",
    "bed_temp":     "bed_temper",
    "chamber_temp": "chamber_temper",
    "gcode_state":  "gcode_state",
}


async def _eval_condition(cond: dict, device: Device) -> tuple:
    """Evaluate a step's condition against live printer status → (passed, text).
    Fail-open: if status can't be read, returns True so a farm step is never blocked
    purely by a momentary status-read failure."""
    check = (cond.get("check") or "").strip()
    op    = (cond.get("op") or "==").strip()
    raw_v = cond.get("value")
    field = _COND_FIELDS.get(check)
    if not field:
        return True, f"unbekannte Bedingung '{check}'"
    p = await _read_live_print(device)
    if not p or field not in p:
        return True, f"{check} nicht lesbar (fail-open)"
    cur = p.get(field)
    if check == "gcode_state":
        cur_s, val_s = str(cur).upper(), str(raw_v).upper()
        passed = (cur_s != val_s) if op == "!=" else (cur_s == val_s)
        return passed, f"{check}={cur_s} {op} {val_s}"
    try:
        cur_n, val_n = float(cur), float(raw_v)
    except (TypeError, ValueError):
        return True, f"{check} nicht numerisch (fail-open)"
    passed = {
        "<":  cur_n <  val_n, "<=": cur_n <= val_n,
        ">":  cur_n >  val_n, ">=": cur_n >= val_n,
        "==": cur_n == val_n, "!=": cur_n != val_n,
    }.get(op, False)
    return passed, f"{check}={cur_n:g} {op} {val_n:g}"


COOL_POLL_S = 20.0          # Abstand zwischen zwei Temperatur-Abfragen


def _cool_needed() -> bool:
    """Gilt die Abkühl-Wartezeit für diesen Aufbau?

    Nur mit dem Magnet-Greifer. Der Klemm-Greifer hält die Platte mechanisch —
    ihn warten zu lassen wäre verschenkte Zeit bei jedem Zyklus."""
    if not _farm.get("cool_before_eject", True):
        return False
    try:
        geom = _farm.get("geometry") or _load_farm_geometry()
        return _motion.gripper_motion(geom) == "magnet"
    except Exception:
        return False


async def _await_bed_cool(device: Device) -> None:
    """Vor dem Auswerfen warten, bis die Druckplatte kalt genug ist.

    Die Magnete halten eine WARME Platte nicht: erst um die 30 °C reicht die
    Haftkraft. Fährt der Arm vorher los, bleibt die Platte im Drucker liegen und
    er kommt leer zurück — ohne Fehlermeldung, denn er kann nicht fühlen, ob
    etwas am Greifer hängt. Der Zyklus liefe weiter, als wäre nichts gewesen.

    Läuft das Zeitlimit ab, wird TROTZDEM ausgeworfen (fail-open) und die Meldung
    sagt, mit welcher Temperatur. Ein Zyklus, der ewig steht, wäre schlimmer —
    und ob es an der Platte oder am Thermometer lag, weiß hier niemand.
    """
    if not _cool_needed():
        return
    ziel = float(_farm.get("cool_temp_c", 30.0) or 30.0)
    grenze_min = max(0.0, float(_farm.get("cool_timeout_min", 30) or 0))
    loop = asyncio.get_event_loop()
    start = loop.time()
    gemeldet = False
    while True:
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")
        p = await _read_live_print(device, max_age=COOL_POLL_S / 2)
        roh = (p or {}).get("bed_temper")
        try:
            ist = float(roh)
        except (TypeError, ValueError):
            # Ohne Messwert nicht blockieren: dieselbe Fail-open-Regel wie bei den
            # Schritt-Bedingungen — ein Lesefehler darf keinen Zyklus anhalten.
            _log("❄ Bett-Temperatur nicht lesbar — wird ohne Warten ausgeworfen")
            return
        if ist <= ziel:
            if gemeldet:
                _log(f"❄ Bett auf {ist:.0f} °C — Auswerfen kann losgehen")
            return
        if grenze_min and (loop.time() - start) >= grenze_min * 60:
            _log(f"❄ ⚠ Nach {grenze_min:g} min noch {ist:.0f} °C (Ziel {ziel:.0f} °C) — "
                 f"es wird trotzdem ausgeworfen. Der Magnet könnte die Platte "
                 f"liegen lassen.")
            return
        if not gemeldet:
            _log(f"❄ Bett {ist:.0f} °C — warte auf {ziel:.0f} °C "
                 f"(der Magnet hält eine warme Platte nicht)")
            gemeldet = True
        _farm["seq_step_label"] = f"Abkühlen — Bett {ist:.0f} °C / Ziel {ziel:.0f} °C"
        await asyncio.sleep(COOL_POLL_S)


async def _wait_bambu_finish(device: Device, label: str = "Bewegung", timeout: float = 180.0):
    """Wait until the printer reports the one-shot move/homing print as done
    (gcode_state FINISH/IDLE) → confirms the bed is truly in position.

    Uses ONE persistent MQTT connection for the whole wait (the X1C limits
    concurrent connections, so reconnecting every poll was flaky and could stall
    silently until timeout). Logs progress every few seconds so it never *looks*
    frozen. Fail-safe: returns after `timeout` instead of hanging; raises only on
    farm stop."""
    loop = asyncio.get_event_loop()
    start = loop.time()
    seen_running = False
    last_log = -999.0
    # Über die EINE persistente Verbindung (bambu_manager) warten — einmal sicherstellen,
    # danach nur den laufend aktualisierten Cache lesen (paho reconnectet selbst).
    await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
    while not _farm["stopping"]:
        while _farm["paused"] and not _farm["stopping"]:
            await asyncio.sleep(0.5)
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")

        elapsed = loop.time() - start
        if elapsed > timeout:
            _log(f"⚠ {label}: FINISH-Timeout ({timeout:.0f}s) — fahre fort")
            return

        if not bambu_manager.is_connected(device):
            if elapsed - last_log >= 5:
                _log(f"… {label}: warte auf Drucker-Verbindung ({elapsed:.0f}s)")
                last_log = elapsed
            await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
            await asyncio.sleep(3)
            continue

        # Nudge a fresh full-status push, then read the latest pushed report.
        try:
            await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
        except Exception:
            pass
        await asyncio.sleep(2)
        raw = bambu_manager.last_status(device) or {}
        state = raw.get("print", {}).get("gcode_state", "")

        if state in ("RUNNING", "PREPARE", "SLICING", "PAUSE"):
            seen_running = True

        if elapsed - last_log >= 5:
            _log(f"… {label}: warte auf FINISH (Status: {state or '—'}, {elapsed:.0f}s)")
            last_log = elapsed

        # A homing/move-only .3mf has no real print body, so the X1C marks it
        # FAILED at the end even though the motion (incl. M400) completed. Once
        # we've seen it RUN, treat FAILED as "movement done" — the bed IS in
        # position. We deliberately do NOT send a stop/clear here: that could
        # move the bed back off Z200, and a new print starts fine from FAILED.
        if state == "FAILED" and seen_running:
            _log(f"✓ {label} — Bewegung abgeschlossen (Bambu wertet den reinen "
                 f"Homing/Move-Druck als FAILED — harmlos, Position erreicht)")
            return

        # Done once we see FINISH/IDLE — either after having seen it run, or
        # after a short settle for very fast moves that skipped RUNNING.
        if state in ("FINISH", "IDLE") and (seen_running or elapsed > 12):
            _log(f"✓ {label} — Position erreicht (FINISH)")
            return

        await asyncio.sleep(1)
    raise RuntimeError("Gestoppt")


async def _ensure_ams_ready(job: dict, device: Device, use_ams: bool):
    """Block (pause the farm) until the job's filaments confidently match the live
    AMS, or the user has set a manual mapping. Guarantees a file whose filaments
    don't match what's loaded is never printed unattended ('manuelle Festlegung')."""
    if not use_ams:
        return

    loop = asyncio.get_event_loop()
    db = SessionLocal()
    try:
        file = db.query(UploadedFile).filter(UploadedFile.id == job["fileId"]).first()
        fpath, ftype = (file.file_path, file.file_type) if file else (None, None)
    finally:
        db.close()
    if not fpath:
        return
    types, colors = await loop.run_in_executor(None, _effective_filaments, job["fileId"], fpath, ftype, job.get("plate"))
    if not types or all(not t for t in types):
        return  # no filament info in file (older format) → cannot validate

    notified = False
    while not _farm["stopping"]:
        ams_raw = await _read_live_ams(device)
        manual = _job_manual_map(job)
        if manual:
            # Manuelle Zuordnung (Job oder pro-Datei im Browser) — vertrauen, ABER
            # niemals materialübergreifend: das Material muss zur Datei passen.
            bad = _material_mismatch(types, manual, ams_raw)
            if not bad:
                _set_job(job["id"], {"needs_ams": False, "ams_missing": []})
                _farm["error"] = None
                return
            desc = f"manuelle Zuordnung kreuzt Material ({bad}) — bitte korrigieren"
            missing = [{"type": "", "color": "", "reason": desc}]
        else:
            _, missing = _ams_match_confident(types, colors, ams_raw, _farm.get("exact_color_only", False))
            if not missing:
                _set_job(job["id"], {"needs_ams": False, "ams_missing": []})
                _farm["error"] = None
                return
            desc = ", ".join(
                (f"{m['type'] or '?'} {m['color'] or ''}".strip() + f" ({m['reason']})")
                for m in missing
            )
        _log(f"⚠ AMS-Abgleich für {job['fileName']}: {desc} — manuelle Festlegung notwendig")
        _set_job(job["id"], {"needs_ams": True, "ams_missing": missing})
        action = _estrat("ams_unmatched")
        if action == "stop":
            _log("⚠ AMS-Abgleich fehlt — Farm wird gestoppt (Strategie)")
            _farm["stopping"] = True
            raise RuntimeError("Gestoppt")
        if action == "skip":
            _log(f"⚠ AMS-Abgleich fehlt — Job übersprungen (Strategie): {desc}")
            await _notify(f"⚠ *Printloom — AMS fehlt, Job übersprungen*\n`{job['fileName']}`\n{desc}")
            raise RuntimeError(f"AMS-Abgleich fehlgeschlagen — {desc}")
        _farm["paused"] = True
        _farm["error"] = f"Manuelle AMS-Festlegung notwendig für {job['fileName']} — {desc}"
        if not notified:
            await _notify(f"⚠ *Printloom — AMS-Festlegung nötig*\n`{job['fileName']}`\n{desc}")
            notified = True
        while _farm["paused"] and not _farm["stopping"]:
            await asyncio.sleep(0.5)
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")
        # nach dem Fortsetzen erneut prüfen (Nutzer hat ggf. neu zugeordnet/getauscht)
        _farm["error"] = None
    raise RuntimeError("Gestoppt")


# ── Fehlerstrategie (Roadmap 1.3) ────────────────────────────────────────────
# Pro Fehlerart eine Aktion: 'pause' (warten), 'skip' (Job als Fehler, nächster),
# 'stop' (Farm anhalten), 'ignore' (weiterlaufen), 'eject' (nur print_failed:
# fehlgeschlagene Platte bergen — Z200 → Tür auf → Auswurf → Einlagern — dann weiter
# mit dem nächsten Job). print_failed-Default ist 'eject', weil 'skip' die kaputte
# Platte im Drucker lässt und der nächste Zyklus blind darauf laden würde (Kollision).
_ERROR_DEFAULTS = {
    "hms":             "pause",
    "print_failed":    "eject",
    "connection_lost": "skip",
    "progress_stall":  "pause",
    "no_slot":         "pause",
    "ams_unmatched":   "pause",
    # Hängende Bewegung (Phase 3.3): Standard „pause" — der Arm steht an unbekannter
    # Stelle, evtl. mit Platte. Einfach weiterfahren wäre die schlechteste Option.
    "move_timeout":    "pause",
}


def _estrat(key: str) -> str:
    return (_farm.get("error_strategy") or {}).get(key) or _ERROR_DEFAULTS.get(key, "pause")


class _EjectRecovered(RuntimeError):
    """FAILED-Druck, dessen Platte per 'eject'-Strategie geborgen (ausgeworfen +
    eingelagert) wurde. Signalisiert der Hauptschleife: Job als Fehler werten, aber das
    Fach als BELEGT lassen (die Platte liegt jetzt darin) und mit dem nächsten Job
    weitermachen (der lädt automatisch eine frische Platte und startet)."""


def _eject_recovery_steps(seq_next: list) -> list:
    """Bergungs-Sequenz für die aktuelle (fehlgeschlagene) Platte = alle Schritte NACH
    dem wait_print-Schritt des Zyklus (Z200 → homen → auswerfen → einlagern), mit einem
    vorangestellten „Tür öffnen" (falls der Zyklus eine Tür-Op nutzt), damit die Platte
    erreichbar ist, obwohl der Druck mit geschlossener Tür fehlschlug. Nutzt die eigenen
    Makros/App-Ops aus seq_next (respektiert die Drucker-Geometrie). prep/parallel werden
    entfernt → alles läuft inline & sequenziell (sicher bei der Bergung)."""
    steps = seq_next or []
    wp = next((i for i, s in enumerate(steps) if s.get("type") == "wait_print"), None)
    tail = steps[wp + 1:] if wp is not None else []

    def _is_open_door(s: dict) -> bool:
        t = s.get("type")
        v = str(s.get("value", "")).upper()
        return (t == "macro" and "OPEN_DOOR" in v) or (t == "app_op" and s.get("value") == "open_door")

    recovery: list = []
    door = next((s for s in steps if _is_open_door(s)), None)
    if door and not (tail and _is_open_door(tail[0])):
        recovery.append({**door, "prep": False, "parallel": False, "optional": True})
    for s in tail:
        recovery.append({**s, "prep": False, "parallel": False})
    return recovery


# ── Betriebszeiten (Roadmap 2.5) ─────────────────────────────
def _local_now() -> datetime:
    """Aktuelle Zeit in der Zeitzone des Nutzers. Der Container läuft meist in UTC;
    ohne diese Korrektur würden die Betriebszeiten gegen UTC geprüft (Bug: Farm
    startet erst Stunden später). Fällt ohne/ungültige TZ auf die Containerzeit zurück."""
    tz = _farm.get("operating_tz")
    if tz:
        try:
            from zoneinfo import ZoneInfo
            return datetime.now(ZoneInfo(tz)).replace(tzinfo=None)
        except Exception:
            pass
    return datetime.now()


def _parse_hhmm(s: str) -> int:
    """'HH:MM' → Minuten seit Mitternacht; ungültig → 0."""
    try:
        h, m = str(s).split(":")
        return (int(h) % 24) * 60 + (int(m) % 60)
    except Exception:
        return 0


def _norm_day(d) -> dict:
    """Einen Wochentag-Eintrag normalisieren: {enabled, start, end}."""
    d = d or {}
    return {
        "enabled": bool(d.get("enabled", True)),
        "start":   str(d.get("start", "22:00")),
        "end":     str(d.get("end", "06:00")),
    }


def _operating_schedule(settings: dict) -> list:
    """7-Tage-Plan (Index 0=Mo … 6=So) aus den Settings ziehen. Fehlt der neue
    `operating_schedule`, wird er aus den Legacy-Feldern (operating_days +
    operating_start/end) migriert."""
    sched = settings.get("operating_schedule")
    if isinstance(sched, list) and len(sched) == 7:
        return [_norm_day(d) for d in sched]
    days  = settings.get("operating_days") or [0, 1, 2, 3, 4, 5, 6]
    start = str(settings.get("operating_start", "22:00"))
    end   = str(settings.get("operating_end", "06:00"))
    return [{"enabled": (i in days), "start": start, "end": end} for i in range(7)]


def _now_in_operating_window(now: datetime = None) -> bool:
    """True, wenn Betriebszeiten aus sind ODER die aktuelle Zeit im Fenster des
    jeweiligen Wochentags liegt. Über-Nacht-Fenster (Start > Ende, z. B. 22:00–
    06:00) gehören abends zum Start-Tag; der Morgenteil zum Vortag.
    `now` ist optional (für Tests); sonst die aktuelle Zeit."""
    if not _farm.get("operating_hours_enabled"):
        return True
    sched = _farm.get("operating_schedule")
    if not (isinstance(sched, list) and len(sched) == 7):
        return True
    if now is None:
        now = _local_now()
    wd   = now.weekday()           # 0=Mo … 6=So
    mins = now.hour * 60 + now.minute
    # Heutiges Fenster
    d = sched[wd]
    if d.get("enabled"):
        s, e = _parse_hhmm(d.get("start", "0:0")), _parse_hhmm(d.get("end", "0:0"))
        if s == e:
            return True                       # Null-Fenster → ganzer Tag frei
        if s < e:
            if s <= mins < e:
                return True
        elif mins >= s:                       # Über Nacht: Abendteil = heute
            return True
    # Morgenteil eines Über-Nacht-Fensters vom Vortag
    dy = sched[(wd - 1) % 7]
    if dy.get("enabled"):
        sy, ey = _parse_hhmm(dy.get("start", "0:0")), _parse_hhmm(dy.get("end", "0:0"))
        if sy > ey and mins < ey:
            return True
    return False


_WD_ABBR = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"]

def _next_operating_start() -> Optional[datetime]:
    """Nächster Zeitpunkt, an dem ein Fenster beginnt (oder None)."""
    sched = _farm.get("operating_schedule")
    if not (isinstance(sched, list) and len(sched) == 7):
        return None
    now = _local_now()
    for ahead in range(0, 8):
        wd = (now.weekday() + ahead) % 7
        d  = sched[wd]
        if not d.get("enabled"):
            continue
        s    = _parse_hhmm(d.get("start", "0:0"))
        cand = datetime.combine((now + timedelta(days=ahead)).date(), datetime.min.time()) + timedelta(minutes=s)
        if cand > now:
            return cand
    return None


async def _wait_operating_window():
    """Blockiert den START eines neuen Jobs bis zum Beginn des Zeitfensters.
    Ein bereits laufender Druck wird NICHT unterbrochen — nur der Start gated."""
    if _now_in_operating_window():
        return
    nxt = _next_operating_start()
    when = f"{_WD_ABBR[nxt.weekday()]} {nxt:%H:%M}" if nxt else "nächstem Zeitfenster"
    msg = f"Außerhalb der Betriebszeit — Start ab {when}"
    _log(f"🕒 {msg}")
    _farm["error"] = msg
    try:
        while not _farm["stopping"] and not _now_in_operating_window():
            await asyncio.sleep(20)
    finally:
        if (_farm.get("error") or "").startswith("Außerhalb der Betriebszeit"):
            _farm["error"] = None
    if not _farm["stopping"]:
        _log("🕒 Betriebszeit aktiv — fahre fort")


# ── Start-Countdown nach Leerlauf ────────────────────────────
PRESTART_COUNTDOWN_SEC = 15

async def _prestart_countdown(seconds: int = PRESTART_COUNTDOWN_SEC) -> bool:
    """Kurzer Countdown vor dem Start des nächsten Jobs NACH einer Leerlaufphase
    (im Header sichtbar via _farm['start_countdown']). Pause friert den Countdown
    ein. Rückgabe True = abgelaufen → starten; False = abgebrochen (gestoppt oder
    letzter Job aus der Warteschlange entfernt)."""
    _log(f"⏳ Nächster Job startet in {seconds}s…")
    remaining = seconds
    while remaining > 0 and not _farm["stopping"]:
        while _farm["paused"] and not _farm["stopping"]:
            _farm["start_countdown"] = remaining
            await asyncio.sleep(0.5)
        if _farm["stopping"]:
            break
        if not any(j["status"] == "pending" for j in _farm["jobs"]):
            _log("⏳ Countdown abgebrochen — kein Job mehr in der Warteschlange")
            break
        _farm["start_countdown"] = remaining
        await asyncio.sleep(1.0)
        remaining -= 1
    _farm["start_countdown"] = 0
    return remaining <= 0 and not _farm["stopping"]


async def _handle_hms(hms_list: list):
    """On new fatal/serious printer HMS codes (deduped per print): pause + notify,
    UNLESS the code is on the soft-list — then only log + notify, never stop the
    farm (harmless AMS-side notices like 0C00-0100-0001-0004)."""
    severe = hms.severe_entries(hms_list)
    if not severe:
        return
    soft = _farm.get("hms_ignore") or hms.HMS_SOFT_DEFAULT
    seen = _farm.setdefault("_hms_seen", set())
    for cs, sev, text in severe:
        if cs in seen:
            continue
        seen.add(cs)
        action = _estrat("hms")
        if action == "ignore" or hms.normalize_code(cs) in soft:
            why = "Soft-Liste" if hms.normalize_code(cs) in soft else "Strategie: ignorieren"
            _log(f"ℹ HMS {sev} (ignoriert, {why}): {cs} — {text}")
            _record_hms(cs, sev, text, f"ignoriert ({why})")
            await _notify(f"ℹ *Printloom — Drucker-Hinweis (unkritisch)*\nHMS {cs} ({sev})\n{text}")
            continue
        _record_failure(f"HMS {cs}")
        _record_event("error", "", f"HMS {cs} ({sev})")
        _record_hms(cs, sev, text, action)
        if action == "stop":
            _log(f"🛑 HMS {sev}: {cs} — Farm wird gestoppt (Strategie)")
            await _notify(f"🛑 *Printloom — Drucker-Fehler, Farm gestoppt*\nHMS {cs} ({sev})\n{text}")
            _farm["stopping"] = True
            return
        if action == "skip":
            _log(f"🛑 HMS {sev}: {cs} — Job wird übersprungen (Strategie)")
            await _notify(f"🛑 *Printloom — Drucker-Fehler, Job übersprungen*\nHMS {cs} ({sev})\n{text}")
            raise RuntimeError(f"HMS {cs}: {text}")
        sev_de = hms.HMS_SEVERITY_DE.get(sev, sev)
        _log(f"🛑 HMS {sev}: {cs} — {text} ({hms.wiki_url(cs)})")
        _farm["paused"] = True
        # Code im Unterstrich-Format lassen → das Frontend macht daraus einen
        # klickbaren Bambu-Wiki-Link mit der genauen Beschreibung.
        _farm["error"] = (f"Drucker-Fehler HMS {cs} ({sev_de}) — {text} "
                          f"Code antippen für die Bambu-Wiki-Seite, beheben, dann fortsetzen.")
        await _notify(f"🛑 *Printloom — Drucker-Fehler*\nHMS {cs} ({sev_de})\n{text}\n{hms.wiki_url(cs)}")


async def _run_prep(steps: list, slot: str, device: Device):
    rack_num, slot_num = _slot_vars(slot)
    stack_rack, stack_slot = _stack_vars()
    for step in steps:
        if _farm["stopping"]:
            return
        val = (step.get("value") or "").replace("{rack}", rack_num).replace("{slot}", slot_num).replace("{stack_rack}", stack_rack).replace("{stack_slot}", stack_slot)
        try:
            t = step.get("type", "")
            if t == "macro":
                _log(f"▶ {val}")
                await _do_macro(val)
            elif t in ("klipper_gcode",):
                _log(f"▶ {step.get('label', val[:30])}")
                await _do_macro(val)   # Klipper HTTP blocks until movement complete
            elif t == "app_op":
                # Printloom-Op auch im Vorstart (z. B. move_to_printer ⏱) — wie im
                # normalen app_op-Zweig, aber ohne Magazin-/Fach-Buchhaltung (Vorstart
                # positioniert nur; Griffe gehören nicht in die Vorpositionierung).
                op = (val or "").strip().lower()
                if op in _motion.APP_OP_KEYS:
                    rk, sl = (int(stack_rack), int(stack_slot)) if op in ("grab", "grab_magazine") else \
                             (int(rack_num), int(slot_num)) if op == "store" else (1, 1)
                    geom = _farm.get("geometry") or _load_farm_geometry()
                    _log(f"▶ Printloom-Op: {op}")
                    await _do_macro(_motion.build_op(geom, op, rack=rk, slot=sl,
                                                     printer=_farm_printer(geom)))
                else:
                    _log(f"Warnung Vorstart: unbekannte Printloom-Op {op!r}")
            elif t == "gcode":
                await _do_bambu_gcode(val, device)
            elif t == "delay":
                await asyncio.sleep(float(step.get("seconds", 0)))
        except Exception as e:
            _log(f"Warnung Vorstart: {e}")
    _log("⚡ Vorstart fertig.")


async def _wait_print(job: dict, device: Device, poll_sec: int, min_min: int,
                       prep_steps: list, fail_steps: list = []) -> bool:
    _set_job(job["id"], {"status": "printing"})
    _record_event("print_start", job.get("fileName", ""), f"Fach {job.get('slot', '')}")
    _log(f"Warte auf Druckende (Poll alle {poll_sec}s)…")
    _farm["_hms_seen"] = set()  # reset HMS dedupe per print

    loop = asyncio.get_event_loop()
    prep_started = False
    prep_task: Optional[asyncio.Task] = None
    was_running = False
    max_pct = 0
    first_run = True
    fail_count = 0
    reconn_fails = 0
    retries = 0
    idle_grace = 0  # consecutive IDLE polls before giving up (grace for slow print start)
    # Watchdog (1.1 Verbindung / 1.7 Fortschritt)
    conn_alarm   = bool(_farm.get("conn_alarm", True))
    stall_min    = int(_farm.get("progress_stall_min", 0) or 0)
    conn_alarmed = False
    last_pct_seen   = -1
    last_rem_seen   = 10**9
    last_progress_t = loop.time()
    stall_notified  = False

    # Status kommt jetzt aus der EINEN persistenten Verbindung (bambu_manager) —
    # keine eigene Poll-Verbindung mehr. _wp_disconnect bleibt als No-op, damit die
    # vorhandenen Aufrufstellen (vor _do_send_file, bei Abriss …) unverändert bleiben;
    # die geteilte Verbindung darf NICHT pro Poll geschlossen werden.
    def _wp_disconnect():
        return
    try:
        while not _farm["stopping"]:
            if _farm["paused"]:
                while _farm["paused"] and not _farm["stopping"]:
                    await asyncio.sleep(0.5)
                # Nach manuellem Fortsetzen den Fortschritts-Watchdog neu scharf stellen.
                last_progress_t = loop.time()
                stall_notified = False
            if _farm["stopping"]:
                break

            await asyncio.sleep(poll_sec)
            if _farm["stopping"]:
                break

            try:
                # Über die EINE persistente Verbindung (bambu_manager) lesen — kein
                # Connect/Disconnect pro Poll mehr über die gesamte Druckdauer.
                if not await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device):
                    raise ConnectionError("MQTT nicht erreichbar")
                await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
                await asyncio.sleep(1.5)
                raw = bambu_manager.last_status(device)

                if not raw:
                    raise ConnectionError("Keine MQTT-Antwort")

                # Live-Status für die Steuerung/Dashboard cachen → die teilen sich die
                # persistente Verbindung der Farm, statt eine eigene aufzubauen.
                publish_live_status(raw, getattr(device, "id", None))

                p = raw.get("print", {})
                state = p.get("gcode_state", "IDLE")
                pct   = p.get("mc_percent", 0)
                rem   = p.get("mc_remaining_time", 0)

                _set_job(job["id"], {"progress": pct, "remaining": rem})
                _log(f"Drucker: {state}  {pct}%{f'  ~{rem} min' if rem > 0 else ''}")
                reconn_fails = 0
                conn_alarmed = False
                await _handle_hms(p.get("hms", []) or [])

                if state == "RUNNING":
                    was_running = True
                    fail_count = 0
                    idle_grace = 0
                    if pct > max_pct:
                        max_pct = pct

                    # ── Fortschritts-Watchdog (1.7) — kein mc_percent-Fortschritt während
                    # RUNNING deutet auf Verstopfung/Extrusions-/Vorschubfehler hin. Greift
                    # erst wenn der Druck wirklich läuft (pct > 0), nicht beim Aufheizen. ──
                    progressed = pct > last_pct_seen or (rem > 0 and rem < last_rem_seen)
                    if progressed:
                        last_pct_seen = max(last_pct_seen, pct)
                        last_rem_seen = rem if rem > 0 else last_rem_seen
                        last_progress_t = loop.time()
                        stall_notified = False
                    elif stall_min > 0 and pct > 0 and not stall_notified \
                            and (loop.time() - last_progress_t) >= stall_min * 60:
                        stall_notified = True
                        _record_event("error", job.get("fileName", ""), f"Stillstand {stall_min}min @ {pct}%")
                        await _notify(f"🛑 *Printloom — Stillstand erkannt*\n`{job.get('fileName','')}`\n"
                                      f"Kein Fortschritt seit {stall_min} min bei {pct}% — mögliche Verstopfung")
                        action = _estrat("progress_stall")
                        if action == "stop":
                            _log(f"🛑 Watchdog: Stillstand bei {pct}% — Farm wird gestoppt (Strategie)")
                            _farm["stopping"] = True
                        elif action == "skip":
                            _log(f"🛑 Watchdog: Stillstand bei {pct}% — Job übersprungen (Strategie)")
                            raise RuntimeError(f"Stillstand seit {stall_min} min bei {pct}% — mögliche Verstopfung")
                        else:
                            _log(f"🛑 Watchdog: kein Druckfortschritt seit {stall_min} min bei {pct}% — pausiert")
                            _farm["paused"] = True
                            _farm["error"] = (f"Kein Druckfortschritt seit {stall_min} min ({pct}%) — "
                                              "Düse/Filament prüfen (mögliche Verstopfung), dann fortsetzen")
                    if first_run and rem > 0:
                        total_layers = p.get("total_layer_num", 0)
                        layer_h      = job.get("layerHeightMm", 0.0)
                        unassigned   = job.get("slot", "1-1") == "1-0"
                        if total_layers > 0 and layer_h > 0:
                            first_run = False
                            actual_h  = round(total_layers * layer_h, 1)
                            _set_job(job["id"], {"estimatedMinutes": rem, "object_height_mm": actual_h})
                            if min_min > 0 and rem < min_min:
                                raise RuntimeError(
                                    f"Druckzeit {rem} min < Mindestdruckzeit {min_min} min — abgebrochen"
                                )
                            if unassigned:
                                # Rack was full at planning time — find a real slot now
                                await _assign_slot_for_height(job, actual_h)
                            else:
                                # Use pre-planned slot — just update height
                                _rack_update(job["slot"], "printing", job.get("fileName", ""), object_height_mm=actual_h)
                                try:
                                    with open(SLOTS_PATH) as _f:
                                        _sh = float(json.load(_f).get("slot_height_mm", 50))
                                except Exception:
                                    _sh = 50.0
                                boeden = _slots_needed(actual_h, _sh)
                                _log(f"📏 Fach {job['slot']}: {actual_h:.0f}mm ({boeden} {'Boden' if boeden == 1 else 'Böden'})")
                        elif total_layers == 0 and rem > 0:
                            # total_layer_num not yet available — wait for next poll
                            pass
                        else:
                            # No layer height data — use pre-planned height from queue analysis
                            first_run = False
                            _set_job(job["id"], {"estimatedMinutes": rem})
                            if min_min > 0 and rem < min_min:
                                raise RuntimeError(
                                    f"Druckzeit {rem} min < Mindestdruckzeit {min_min} min — abgebrochen"
                                )
                            pre_h = job.get("object_height_mm") or 1.0
                            if unassigned:
                                await _assign_slot_for_height(job, pre_h)
                            elif job.get("object_height_mm"):
                                _rack_update(job["slot"], "printing", job.get("fileName", ""), object_height_mm=pre_h)
                                _log(f"📏 Fach {job['slot']}: {pre_h:.0f}mm (aus Planung)")
                else:
                    if state != "FAILED":
                        fail_count = 0

                if not prep_started and state == "RUNNING" and rem > 0 and rem <= 1:
                    prep_started = True
                    _log("⚡ ~1 min — Vorstart-Sequenz…")
                    prep_task = asyncio.create_task(_run_prep(prep_steps, job["slot"], device))

                idle_done = state == "IDLE" and was_running and (max_pct >= 90 or pct >= 99)
                if state == "FINISH" or idle_done:
                    if state != "FINISH":
                        _log(f"Druck fertig erkannt ({state} {pct}%, max {max_pct}%)")
                    snap = await capture_snapshot(device.id)
                    if snap:
                        _set_job(job["id"], {"snapshot": snap})
                        _log("📷 Snapshot gespeichert")
                    if prep_task and not prep_task.done():
                        _log("Warte auf Vorstart-Sequenz…")
                        try:
                            await prep_task
                        except Exception as e:
                            _log(f"Warnung Vorstart: {e}")
                    return prep_started

                if state == "FAILED":
                    fail_count += 1
                    if fail_count < 2:
                        _log(f"⚠ FAILED ({fail_count}/2) — warte…")
                        continue
                    max_retries = int(_farm.get("failed_retries", 1) or 0)
                    if retries < max_retries:
                        retries += 1
                        _log(f"⚠ Retry {retries}/{max_retries}…")
                        _set_job(job["id"], {"status": "sending", "progress": 0, "remaining": 0})
                        _wp_disconnect()  # persistente Verbindung schließen, bevor _do_send_file neu verbindet (kein Doppel-Connect)
                        await _do_send_file(job, device, True)
                        _set_job(job["id"], {"status": "printing"})
                        fail_count = 0
                        continue
                    action = _estrat("print_failed")
                    if action == "stop":
                        _log("🔴 Druck fehlgeschlagen — Farm wird gestoppt (Strategie)")
                        await _notify(f"🔴 *Printloom — Druck fehlgeschlagen, Farm gestoppt*\n`{job['fileName']}`")
                        _farm["stopping"] = True
                        raise RuntimeError("Gestoppt")
                    if action == "pause":
                        _log("🔴 Druck fehlgeschlagen — pausiert (Strategie)")
                        _farm["paused"] = True
                        _farm["error"] = "Druck fehlgeschlagen — prüfen, dann fortsetzen (neuer Versuch)"
                        await _notify(f"🔴 *Printloom — Druck fehlgeschlagen, pausiert*\n`{job['fileName']}`")
                        while _farm["paused"] and not _farm["stopping"]:
                            await asyncio.sleep(0.5)
                        if _farm["stopping"]:
                            raise RuntimeError("Gestoppt")
                        # Nach Fortsetzen erneut senden und weiter beobachten.
                        _farm["error"] = None
                        retries = 0
                        fail_count = 0
                        _set_job(job["id"], {"status": "sending", "progress": 0, "remaining": 0})
                        _wp_disconnect()  # persistente Verbindung schließen, bevor _do_send_file neu verbindet (kein Doppel-Connect)
                        await _do_send_file(job, device, True)
                        _set_job(job["id"], {"status": "printing"})
                        continue
                    if action == "eject" and fail_steps:
                        # Bergen: fehlgeschlagene Platte auf Z200 heben, Tür öffnen, auswerfen
                        # und ins vorgesehene Fach einlagern — dann weiter mit dem nächsten Job.
                        # Ohne diese Bergung würde der nächste Zyklus blind auf die alte Platte
                        # laden (Kollision) — genau der gemeldete Fehler.
                        _log("🔴 Druck fehlgeschlagen — Auswurf-Sequenz (Platte bergen)…")
                        await _notify(f"🔴 *Printloom — Druck fehlgeschlagen*\n`{job['fileName']}`\n"
                                      "Platte wird ausgeworfen & eingelagert, dann weiter.")
                        try:
                            await _exec_sequence(fail_steps, job, device, False, poll_sec, min_min, [], [])
                        except Exception as fe:
                            # Auswurf misslungen → NICHT blind weiterfahren (Kollisionsgefahr) → pausieren.
                            _log(f"🛑 Auswurf-Sequenz fehlgeschlagen: {fe} — pausiert")
                            _farm["paused"] = True
                            _farm["error"] = (f"Auswurf nach Druckfehler misslungen ({fe}) — Platte "
                                              "manuell entnehmen, dann fortsetzen")
                            await _notify(f"🛑 *Printloom — Auswurf misslungen*\n`{job['fileName']}`\n{fe}")
                            while _farm["paused"] and not _farm["stopping"]:
                                await asyncio.sleep(0.5)
                            if _farm["stopping"]:
                                raise RuntimeError("Gestoppt")
                            raise RuntimeError("Druck fehlgeschlagen (FAILED)")
                        raise _EjectRecovered(
                            "Druck fehlgeschlagen (FAILED) — Platte ausgeworfen & eingelagert")
                    # skip: Job als Fehler markieren, nächster Job. ACHTUNG: die fehlgeschlagene
                    # Platte bleibt im Drucker — der nächste Zyklus lädt darauf. Nur wählen, wenn
                    # die Platte manuell entnommen wird. Sichere Alternative: 'eject'.
                    raise RuntimeError("Druck fehlgeschlagen (FAILED)")

                if state == "IDLE" and pct == 0 and not was_running:
                    idle_grace += 1
                    if idle_grace >= 3:
                        raise RuntimeError("Drucker dauerhaft IDLE — abgebrochen")
                    _log(f"⚠ Drucker noch IDLE — warte auf Druckstart ({idle_grace}/3)…")

            except RuntimeError:
                raise
            except Exception as e:
                _wp_disconnect()  # abgerissene Verbindung verwerfen → nächster Poll baut neu auf
                reconn_fails += 1
                if reconn_fails >= 5:
                    action = _estrat("connection_lost")
                    if action == "stop":
                        _log("⚠ Verbindung dauerhaft unterbrochen — Farm wird gestoppt (Strategie)")
                        _farm["stopping"] = True
                        raise RuntimeError("Gestoppt")
                    if action == "pause":
                        _log("⚠ Verbindung dauerhaft unterbrochen — pausiert (Strategie)")
                        _farm["paused"] = True
                        _farm["error"] = "Verbindung zum Drucker verloren — prüfen, dann fortsetzen"
                        while _farm["paused"] and not _farm["stopping"]:
                            await asyncio.sleep(0.5)
                        if _farm["stopping"]:
                            raise RuntimeError("Gestoppt")
                        _farm["error"] = None
                        reconn_fails = 0
                        conn_alarmed = False
                        continue
                    # skip (Default): Job als Fehler markieren, nächster Job
                    raise RuntimeError(f"Verbindung dauerhaft unterbrochen ({reconn_fails}×)")
                # Verbindungs-Watchdog (1.1): einmaliger Alarm, sobald der Reconnect
                # mehrfach scheitert — der Druck läuft am Gerät weiter, nur die Brücke fehlt.
                if conn_alarm and reconn_fails >= 3 and not conn_alarmed:
                    conn_alarmed = True
                    await _notify("⚠ *Printloom — Verbindung zum Drucker verloren*\n"
                                  f"`{job.get('fileName','')}`\nReconnect läuft — Drucker/Netzwerk prüfen")
                _log(f"⚠ Verbindung unterbrochen ({reconn_fails}/5) — retry…")

        raise RuntimeError("Gestoppt")
    finally:
        _wp_disconnect()


# ── OTTOeject-Geometrie (opt-in: Farm sendet App-G-code statt Geräte-Macro) ──
def _load_farm_geometry() -> dict:
    """Gespeicherte Drucker-Geometrie (Drucker-Tab) lesen, Defaults aufgefüllt.
    Regalzahl/Fächer/Magazin-Fach global aus der Rack-Konfiguration überlagern.
    Ohne Datei → Defaults ohne use_gcode → Farm fährt wie bisher die Geräte-Macros."""
    g = _motion.merge_defaults(storage.read_json(GEOMETRY_PATH, None))
    try:
        _motion.apply_rack_config(g, _rack_load())
    except Exception:
        pass
    # Seit v1.1.8 gibt es keine zweite X-Quelle mehr: das Farm-Layout wird aus
    # genau dieser Geometrie abgeleitet, statt sie zu überlagern. Damit fahren
    # Test-Knopf (Drucker-Tab) und Farm garantiert dieselben Positionen.
    _motion.apply_layout(g, None)
    # Migration: die Einlege-Op hieß früher „load", jetzt „place" (Alias). Alte
    # Opt-in-/Override-Einträge übernehmen, damit eine aktivierte Einlege-Position
    # nicht still auf das Geräte-Macro zurückfällt.
    for key in ("use_gcode", "gcode_override"):
        d = g.get(key)
        if isinstance(d, dict) and d.get("load") is not None and d.get("place") is None:
            d["place"] = d["load"]
    return g


def _farm_printer(geom: dict = None):
    """Welcher Drucker-Block gehört zum laufenden Gerät (seit v1.1.9 mehrere möglich)?

    Der Zyklus bedient GENAU EINEN Drucker (den aus dem Start-Aufruf). Steht in der
    Geometrie ein Block mit genau dieser Geräte-ID, fährt die Farm dessen Positionen —
    sonst den ersten. Ohne diese Zuordnung würde ein zweiter Drucker die Koordinaten
    des ersten fahren, und das ist ein Crash, kein Schönheitsfehler."""
    try:
        geom = geom or _farm.get("geometry") or _load_farm_geometry()
        return _farm_printer_of(_motion.printer_list(geom), _farm.get("bambu_id"))
    except Exception:
        return None


def _assert_printer_geometry(bambu_id) -> None:
    """Start verweigern, wenn für DIESES Gerät kein Drucker-Block existiert und die
    Farm App-G-code fahren soll.

    Ohne diese Prüfung greift der Rückfall „erster Drucker" — der ist richtig, solange
    die Geometrie nur einen (noch keinem Gerät zugeordneten) Block hat. Sobald aber
    Blöcke MIT Geräte-Zuordnung existieren und keiner passt, ist das kein Rückfall
    mehr, sondern ein Griff an die falsche Maschine."""
    try:
        geom = _load_farm_geometry()
        blocks = _motion.printer_list(geom)
        assigned = [p for p in blocks if p.get("device_id") is not None]
        if not assigned or _farm_printer_of(blocks, bambu_id):
            return
        used = [o for o in _motion.PRINTER_OPS if _motion.op_uses_gcode(geom, o)]
        if not used:
            return          # Farm fährt hier ohnehin die Geräte-Macros
    except HTTPException:
        raise
    except Exception:
        return              # Prüfung darf den Start nie an sich selbst scheitern lassen
    raise HTTPException(
        400,
        "Für diesen Drucker sind im Drucker-Tab noch keine Positionen hinterlegt. "
        "Bitte dort den Abschnitt dieses Druckers einmessen und testen — sonst würde "
        "die Farm die Positionen eines anderen Druckers fahren.")


def _farm_printer_of(blocks, bambu_id):
    if bambu_id is None:
        return None
    for p in blocks:
        if p.get("device_id") is not None and int(p["device_id"]) == int(bambu_id):
            return p["id"]
    return None


def _macro_to_op(val: str, rack_num: str, slot_num: str, stack_rack: str, stack_slot: str):
    """Bekanntes Farm-Macro → (op, rack, slot) für ottoeject_motion.build_op, sonst None.
    Nur diese Operationen können opt-in als Printloom-G-code laufen; OTTOEJECT_HOME und
    PARK_OTTOEJECT bleiben immer Geräte-Macros."""
    v = (val or "").strip().upper()
    if "GRAB_FROM_RACK" in v or v.startswith("GRAB_FROM_SLOT_"):
        return ("grab", int(stack_rack), int(stack_slot))
    if "STORE_TO_RACK" in v or v.startswith("STORE_TO_SLOT_"):
        return ("store", int(rack_num), int(slot_num))
    if v.startswith("OPEN_DOOR"):
        return ("open_door", 1, 1)
    if v.startswith("CLOSE_DOOR"):
        return ("close_door", 1, 1)
    if v.startswith("MOVE_TO_PRINTER"):
        return ("move_to_printer", 1, 1)
    if v.startswith("EJECT_FROM"):
        return ("eject", 1, 1)
    if v.startswith("PLACE_ONTO") or v.startswith("LOAD_ONTO"):
        return ("place", 1, 1)   # place ist die kanonische Op; „load" ist nur ein Alias
    return None


async def _start_homing_print(device: Device) -> None:
    """Homing-.3mf hochladen und starten (G28 + Bett auf Z200). Wartet NICHT auf
    das Ende — dafür ist `_wait_bambu_finish` da.

    Die Datei wird bei jedem Senden frisch erzeugt (deterministischer Inhalt), damit
    G-code-Änderungen (z. B. schnelleres Z200) sofort wirken, ohne dass jemand in den
    Einstellungen „Erstellen" drückt. Eine alte Datei ist der Rückfall.

    Eigene Funktion, weil ausser dem Sequenzschritt auch der Stresstest das Bett auf
    Z200 braucht — zwei Kopien wuerden beim naechsten Umbau auseinanderlaufen."""
    try:
        with open(HOMING_3MF_PATH, "wb") as f:
            f.write(_build_homing_3mf())
    except Exception as e:
        if not os.path.exists(HOMING_3MF_PATH):
            raise RuntimeError(f"Homing-Datei konnte nicht erstellt werden: {e}")
        logger.warning(f"Homing-Datei nicht erneuerbar ({e}) — nutze vorhandene")
    homing_name = "printloom_homing.3mf"
    loop = asyncio.get_event_loop()
    _log("[↑] Homing senden (G28+Z200)…")
    ftp = BambuFTP(device.ip_address, device.access_code)
    up = await loop.run_in_executor(bambu_manager.executor, ftp.upload_file, HOMING_3MF_PATH, homing_name)
    if not up:
        raise RuntimeError("Homing FTP-Upload fehlgeschlagen")
    # Über die persistente Verbindung (bambu_manager) starten — kein eigener Connect.
    connected = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)
    if not connected:
        raise RuntimeError("MQTT-Verbindung fehlgeschlagen")
    await asyncio.sleep(5)
    ok = await loop.run_in_executor(
        bambu_manager.executor,
        lambda: bambu_manager.start_print(device, homing_name, use_ams=False, ams_mapping=[], plate_param="")
    )
    await asyncio.sleep(2)
    if not ok:
        raise RuntimeError("Homing-Druck Start fehlgeschlagen")


async def _exec_step(step: dict, job: dict, device: Device, use_ams: bool,
                      poll_sec: int, min_min: int, prep_steps: list, fail_steps: list = []):
    if _farm["stopping"]:
        raise RuntimeError("Gestoppt")

    # Conditional step (5.3): skip when its printer-status condition is not met.
    cond = step.get("condition")
    if cond and cond.get("check"):
        passed, text = await _eval_condition(cond, device)
        if not passed:
            _log(f"⏭ Bedingung nicht erfüllt ({text}) — '{step.get('label', step.get('type', '?'))}' übersprungen")
            return
        _log(f"✓ Bedingung erfüllt ({text})")

    rack_num, slot_num = _slot_vars(job["slot"])
    stack_rack, stack_slot = _stack_vars()
    val = (step.get("value") or "").replace("{rack}", rack_num).replace("{slot}", slot_num).replace("{stack_rack}", stack_rack).replace("{stack_slot}", stack_slot)
    t = step.get("type", "")

    if t == "gcode":
        _log(f"[GCode] {step.get('label', val[:40])}")
        await _do_bambu_gcode(val, device)
        # Record when this gcode was sent so wait_bambu_idle can compute elapsed time
        _farm["_last_gcode_time"] = asyncio.get_event_loop().time()

    elif t == "klipper_gcode":
        label = step.get("label") or val.replace("\n", " · ")[:40]
        _log(f"[Klipper] {label}")
        await _do_macro(val)   # Klipper HTTP blocks until movement is complete
        _log(f"✓ {label} — Position erreicht")

    elif t == "wait_bambu_idle":
        # gcode_state ändert sich bei manuellen Befehlen (G28) nicht zuverlässig.
        # Stattdessen: Mindestdauer seit dem letzten Bambu-gcode-Schritt abwarten.
        # Die Zeit der vorherigen Schritte (OTTOeject home/open/grab) wird abgezogen
        # → so wird nur die wirklich noch fehlende Zeit gewartet.
        label = step.get("label") or "Warte Z200"
        min_duration = max(5, int(step.get("seconds") or 50))
        loop = asyncio.get_event_loop()

        gcode_time = _farm.get("_last_gcode_time")
        if gcode_time is not None:
            elapsed = loop.time() - gcode_time
            remaining = max(0.0, min_duration - elapsed)
            _log(f"[⏳] {label} — G28 vor {elapsed:.0f}s gesendet, noch {remaining:.0f}s…")
        else:
            remaining = float(min_duration)
            _log(f"[⏳] {label} — {remaining:.0f}s warten…")

        interval = 0.5
        waited = 0.0
        while waited < remaining and not _farm["stopping"]:
            await asyncio.sleep(interval)
            waited += interval

        _log(f"✓ {label} — Z200 erreicht")

    elif t == "macro":
        if "GRAB_FROM_RACK" in val or val.startswith("GRAB_FROM_SLOT_"):
            # First Start hat die Platte schon geholt (wartet vor dem Drucker) →
            # der Zyklus-Griff des ersten Jobs entfällt, sonst würde doppelt gegriffen.
            # Buchhaltung (Magazin-Zähler, Fach „printing") lief bereits beim Griff.
            if not _farm.get("_in_first_start") and _farm.pop("_plate_ready", False):
                _log("⏭ Platte schon im Greifer (im First Start geholt) — Griff übersprungen")
                return
            # Magazin-Gate: leer → parken/pausieren, nach Auffüllen homen. Liefert das
            # DANN aktive Magazin → Macro-String mit den FRISCHEN Werten neu aufbauen
            # (der vorab substituierte fuhr sonst zum vor der Pause gemerkten Regal).
            stack_rack, stack_slot = await _magazine_gate()
            val = (step.get("value") or "").replace("{rack}", rack_num).replace("{slot}", slot_num) \
                .replace("{stack_rack}", stack_rack).replace("{stack_slot}", stack_slot)
        # Opt-in: bekannte Drucker-/Regal-Macros können als Printloom-G-code laufen
        # (geometry.use_gcode[op] = true). Standard aus → Geräte-Macro wie bisher.
        # Die Magazin-/Fach-Buchhaltung unten prüft weiter val (Macro-Name, unverändert).
        send_val, op_used, op_map = val, None, None
        try:
            op_map = _macro_to_op(val, rack_num, slot_num, stack_rack, stack_slot)
            if op_map:
                geom = _farm.get("geometry") or _load_farm_geometry()
                if _motion.op_uses_gcode(geom, op_map[0], _farm_printer(geom)):
                    op_used = op_map[0]
                    send_val = _motion.build_op(geom, op_used, rack=op_map[1], slot=op_map[2],
                                                printer=_farm_printer(geom))
        except Exception as e:
            send_val, op_used = val, None
            logger.warning(f"use_gcode-Auswertung fehlgeschlagen ({e}) — nutze Macro {val!r}")
        # Auch hier abkühlen lassen — ob der Auswurf als Geräte-Macro oder als
        # Printloom-G-code fährt, ändert nichts daran, dass der Magnet eine warme
        # Platte nicht hält. `op_map` kennt die Operation in beiden Fällen.
        if op_map and op_map[0] == "eject":
            await _await_bed_cool(device)
        _log(f"▶ {val}" + (f"  →  Printloom-G-code ({op_used})" if op_used else ""))
        await _do_macro(send_val)
        if "GRAB_FROM_RACK" in val or val.startswith("GRAB_FROM_SLOT_"):
            _decrement_magazine()
            _set_arm("empty", f"{stack_rack}-{stack_slot}", job.get("id"))
            if job.get("slot") and job["slot"] != "1-0":
                _rack_update(job["slot"], "printing", job["fileName"])
            if _farm.get("_in_first_start"):
                _farm["_plate_ready"] = True   # Zyklus-Griff des ersten Jobs überspringen
        elif "STORE_TO_RACK" in val or val.startswith("STORE_TO_SLOT_"):
            _rack_update(job["slot"], "done",
                         object_height_mm=job.get("object_height_mm"))
            _set_arm("none")

    elif t == "app_op":
        # Printloom-eigene Operation (Drucker-Tab-Geometrie → G-code), frei in Sequenzen
        # nutzbar wie ein Macro — aber IMMER als Printloom-G-code (unabhängig vom
        # farmweiten use_gcode-Opt-in). value = Op-Key (open_door/close_door/
        # move_to_printer/eject/place/grab/store).
        op = (val or "").strip().lower()
        if op not in _motion.APP_OP_KEYS:
            raise RuntimeError(f"Unbekannte Printloom-Op: {op!r}")
        # grab UND grab_magazine zählen als Greifen (Magazin-Check + Zähler dekrementieren).
        is_grab, is_store = op in ("grab", "grab_magazine"), op == "store"
        if is_grab and not _farm.get("_in_first_start") and _farm.pop("_plate_ready", False):
            # First Start hat die Platte schon geholt — Zyklus-Griff des ersten Jobs entfällt.
            _log("⏭ Platte schon im Greifer (im First Start geholt) — Griff übersprungen")
            return
        if is_grab:
            # Magazin-Gate: leer → parken/pausieren, nach Auffüllen homen. Liefert das
            # DANN aktive Magazin (kann nach dem Auffüllen ein anderes Regal sein).
            stack_rack, stack_slot = await _magazine_gate()
            # Ohne Magazin (Setup: „alle Fächer = Lagerfächer") liegen die leeren
            # Platten in normalen Fächern → NORMALER Fach-Griff statt Magazin-Griff
            # (grab_magazine greift flach/NOLIFT für einen Stapel, das passt hier nicht).
            if op == "grab_magazine" and _magazine_slot_cfg() <= 0:
                op = "grab"
                _log("📥 Kein Magazin konfiguriert — greife die leere Platte aus dem Lagerfach")
        rk, sl = (int(stack_rack), int(stack_slot)) if is_grab else \
                 (int(rack_num), int(slot_num)) if is_store else (1, 1)
        geom = _farm.get("geometry") or _load_farm_geometry()
        script = _motion.build_op(geom, op, rack=rk, slot=sl, printer=_farm_printer(geom))
        if op == "eject":
            await _await_bed_cool(device)
        _log(f"▶ Printloom-Op: {op}" + (f" (Regal {rk} Fach {sl})" if (is_grab or is_store) else ""))
        await _do_macro(script)   # Klipper HTTP blocks until movement is complete
        if is_grab:
            # Gegriffenes Fach ausdrücklich mitgeben — ohne Magazin wird genau dessen
            # Markierung gelöscht (nicht „das nächstbeste" Fach).
            _decrement_magazine(rk, sl)
            _set_arm("empty", f"{rk}-{sl}", job.get("id"))
            if job.get("slot") and job["slot"] != "1-0":
                _rack_update(job["slot"], "printing", job["fileName"])
            if _farm.get("_in_first_start"):
                _farm["_plate_ready"] = True   # Zyklus-Griff des ersten Jobs überspringen
        elif is_store:
            _rack_update(job["slot"], "done", object_height_mm=job.get("object_height_mm"))
            _set_arm("none")
        elif op == "eject":
            # Fertige Platte kommt aus dem Drucker → sie hängt jetzt am Arm.
            _set_arm("printed", "", job.get("id"))
        elif op in ("place", "load"):
            # Leere Platte ist im Drucker abgesetzt → Arm ist wieder frei.
            _set_arm("none")

    elif t == "delay":
        secs = int(step.get("seconds", 0))
        _log(f"⏱ {step.get('label', '')} — {secs}s…")
        for _ in range(secs):
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            await asyncio.sleep(1)

    elif t == "send_homing_file":
        await _start_homing_print(device)
        timeout = float(step.get("seconds") or 180)
        if step.get("nowait"):
            # Nicht blockieren: der Drucker homet im Hintergrund, das OTTOeject kann
            # währenddessen schon Tür öffnen / Platte holen / vor den Drucker fahren.
            # Der Monitor-Task läuft ab JETZT mit (sieht RUNNING→FAILED/FINISH sicher,
            # auch wenn das Homing vor dem Warteschritt fertig wird); der Schritt
            # „Auf Z200 warten" (wait_homing) holt das Ergebnis später ab.
            _farm["_homing_task"] = asyncio.create_task(
                _wait_bambu_finish(device, label="Homing (G28+Z200)", timeout=timeout))
            _log("✓ Homing gesendet — läuft im Hintergrund (OTTOeject arbeitet parallel weiter)")
        else:
            _log("✓ Homing gesendet — warte auf FINISH…")
            # Position-confirmed: wait until the printer reports the homing print done.
            await _wait_bambu_finish(device, label="Homing (G28+Z200)", timeout=timeout)

    elif t == "wait_homing":
        # Wartet auf das Ende des mit „nowait" gestarteten Homing-Drucks (Z200 erreicht).
        # Der Monitor-Task lief seit dem Senden mit — hier nur noch das Ergebnis abholen.
        label = step.get("label") or "Auf Z200 warten"
        task = _farm.pop("_homing_task", None)
        if task is not None:
            _log(f"[⏳] {label} — Homing läuft noch…" if not task.done() else f"[⏳] {label}…")
            await task
        else:
            # Ohne vorheriges nowait-Homing (Schritt einzeln verwendet): direkt warten.
            await _wait_bambu_finish(device, label=label, timeout=float(step.get("seconds") or 180))

    elif t == "bambu_move":
        # Raw-G-code Z move: send G1 Z{z} directly to the (idle) printer instead of
        # a one-shot .3mf "print". A .3mf triggers the Bambu's full print-prep
        # (home/level, ~2 min) BEFORE the move runs — far too slow, and it tripped
        # the FINISH timeout so the eject ran before the bed was in position. Raw
        # gcode_line executes immediately; since it gives no gcode_state feedback we
        # can't poll FINISH, so we wait a short computed settle instead.
        z    = int(step.get("z", 200) or 200)
        feed = int(step.get("feed", 3000) or 3000)
        loop = asyncio.get_event_loop()
        _log(f"[↑] Bambu Position Z{z} (F{feed}) per G-Code…")
        # Über die persistente Verbindung (bambu_manager) senden — kein eigener Connect.
        ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.send_gcode, device, f"G90\nG1 Z{z} F{feed}")
        if not ok:
            raise RuntimeError("Z-Bewegung (G-Code) fehlgeschlagen")
        # Settle = worst-case Z travel / feed + buffer (capped). z.B. F3000 → ~8s.
        wait_s = min(30.0, max(5.0, 256.0 / max(1.0, feed / 60.0) + 3.0))
        _log(f"… Z{z}: G-Code gesendet, warte {wait_s:.0f}s bis Position erreicht…")
        waited = 0.0
        while waited < wait_s and not _farm["stopping"]:
            await asyncio.sleep(0.5)
            waited += 0.5
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")
        _log(f"✓ Z{z} — Position erreicht (G-Code + {wait_s:.0f}s)")

    elif t == "send_file":
        _set_job(job["id"], {"status": "sending"})
        # Block printing until filaments confidently match the live AMS (or manual map set).
        await _ensure_ams_ready(job, device, use_ams)
        _log(f"[↑] Datei senden: {job['fileName']}")
        await _do_send_file(job, device, use_ams)

    elif t == "send_file_fixed":
        # Sends a specific file from the library (e.g. homing .3mf) instead of the job file.
        # Use value field = file ID (integer).
        fixed_id = int((step.get("value") or "0").strip() or "0")
        if not fixed_id:
            raise RuntimeError("send_file_fixed: keine Datei-ID angegeben (value = Datei-ID)")
        db = SessionLocal()
        try:
            fixed_file = db.query(UploadedFile).filter(UploadedFile.id == fixed_id).first()
            if not fixed_file:
                raise RuntimeError(f"Datei ID {fixed_id} nicht gefunden")
            fixed_job = {
                "id":       job["id"],
                "fileId":   fixed_id,
                "fileName": fixed_file.original_filename,
                "slot":     job["slot"],
                "amsMap":   "",
            }
            _log(f"[↑] Feste Datei senden: {fixed_file.original_filename} (ID {fixed_id})")
            await _do_send_file(fixed_job, device, False)  # AMS off for utility files
        finally:
            db.close()

    elif t == "wait_print":
        _log("[⏳] Warte auf Druckende…")
        prep_started = await _wait_print(job, device, poll_sec, min_min, prep_steps, fail_steps)
        if not prep_started and prep_steps:
            _log("Vorstart-Fallback…")
            await _run_prep(prep_steps, job["slot"], device)
        _log(f"✓ Druck fertig: {job['fileName']}")

    elif t == "wait_print_failed":
        label = step.get("label") or "Warte auf Druckfehler"
        _log(f"[✗] {label} — warte auf FAILED…")
        loop = asyncio.get_event_loop()
        while not _farm["stopping"]:
            while _farm["paused"] and not _farm["stopping"]:
                await asyncio.sleep(0.5)
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            await asyncio.sleep(poll_sec)
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            try:
                # Persistente Verbindung (bambu_manager) — kein Connect pro Poll.
                if not await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device):
                    raise ConnectionError("MQTT nicht erreichbar")
                await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
                await asyncio.sleep(1.5)
                raw = bambu_manager.last_status(device)
                if not raw:
                    raise ConnectionError("Keine MQTT-Antwort")
                p = raw.get("print", {})
                state = p.get("gcode_state", "IDLE")
                pct   = p.get("mc_percent", 0)
                _log(f"Drucker: {state}  {pct}%")
                if state == "FAILED":
                    _log(f"✓ {label} — Drucker FAILED {pct}% erkannt — weiter")
                    break
            except RuntimeError:
                raise
            except Exception as e:
                _log(f"⚠ Verbindungsfehler: {e}")

    elif t == "wait_pause":
        label = step.get("label") or "Warte auf PAUSE"
        timeout_sec = max(30, int(step.get("seconds") or 120))
        _log(f"[⏸] {label} — warte auf PAUSE (Timeout {timeout_sec}s)…")
        loop = asyncio.get_event_loop()
        elapsed = 0.0
        conn_fails = 0
        while not _farm["stopping"]:
            while _farm["paused"] and not _farm["stopping"]:
                await asyncio.sleep(0.5)
            if _farm["stopping"]:
                raise RuntimeError("Gestoppt")
            await asyncio.sleep(poll_sec)
            elapsed += poll_sec
            if elapsed > timeout_sec:
                raise RuntimeError(
                    f"{label} — Timeout nach {timeout_sec}s — Drucker nie auf PAUSE — "
                    f"Crash-Schutz: Platte NICHT eingelegt"
                )
            try:
                # Persistente Verbindung (bambu_manager) — kein Connect pro Poll.
                if not await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device):
                    conn_fails += 1
                    if conn_fails >= 5:
                        raise RuntimeError(f"{label} — MQTT dauerhaft nicht erreichbar")
                    _log(f"⚠ MQTT nicht erreichbar ({conn_fails}/5)…")
                    continue
                await loop.run_in_executor(bambu_manager.executor, bambu_manager.request_pushall, device)
                await asyncio.sleep(1.5)
                raw = bambu_manager.last_status(device)
                conn_fails = 0
                if not raw:
                    continue
                p     = raw.get("print", {})
                state = p.get("gcode_state", "IDLE")
                pct   = p.get("mc_percent", 0)
                _log(f"Drucker: {state}  {pct}%")
                if state == "PAUSE":
                    _log(f"✓ {label} — Drucker auf PAUSE (Z200) — Platte einlegen")
                    break
                if state == "FAILED":
                    raise RuntimeError(
                        f"{label} — FAILED — Crash-Schutz: Platte NICHT einlegen — abgebrochen"
                    )
                if state == "FINISH":
                    raise RuntimeError(
                        f"{label} — Unerwartet FINISH (M400 U1 ignoriert?) — Crash-Schutz aktiv"
                    )
                if state == "IDLE" and elapsed >= max(poll_sec * 3, 15):
                    raise RuntimeError(
                        f"{label} — Drucker dauerhaft IDLE (Homing nicht gestartet?) — abgebrochen"
                    )
            except RuntimeError:
                raise
            except Exception as e:
                conn_fails += 1
                _log(f"⚠ Verbindungsfehler: {e}")

    elif t == "clear_error":
        label = step.get("label") or "Fehler quittieren"
        _log(f"[⚠] {label}…")
        loop = asyncio.get_event_loop()
        # Persistente Verbindung (bambu_manager); clear_error = stop-Befehl (FAILED → IDLE).
        if not await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device):
            raise RuntimeError("MQTT nicht erreichbar für clear_error")
        ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.print_command, device, "stop")
        await asyncio.sleep(2)
        _log(f"{'✓' if ok else '⚠'} {label}{'​' if ok else ' — Befehl nicht bestätigt'}")

    else:
        _log(f"⚠ Unbekannter Schritt '{t}' — übersprungen")


def _filter_disabled(steps: list) -> list:
    """
    Remove disabled steps and fix parallel flags.
    If a group-anchor (parallel=False step) was disabled, the steps that were
    parallel to it must NOT become parallel with the previous group — they start
    a new sequential group instead.
    """
    result = []
    current_group_has_enabled = False  # does the CURRENT parallel group have any active step?

    for step in steps:
        disabled    = step.get("disabled", False)
        is_parallel = step.get("parallel",  False)

        if not is_parallel:
            # This step starts a NEW parallel group
            current_group_has_enabled = not disabled
            if not disabled:
                result.append(step)
        else:
            # This step continues the current parallel group
            if not disabled:
                if current_group_has_enabled:
                    # Group has an enabled anchor → keep parallel
                    result.append(step)
                else:
                    # Group's anchor was all disabled → demote to sequential
                    result.append({**step, "parallel": False})
                    current_group_has_enabled = True

    return result


# These step types must ALWAYS stay in the normal flow — pre-positioning them is
# nonsensical and breaks the cycle. Pulling `wait_print` into prep removes the wait
# entirely → the cycle ejects mid-print; `send_file` likewise must run in order;
# `wait_homing` würde während eines echten Drucks endlos auf FINISH warten.
_PREP_FORBIDDEN = ("wait_print", "send_file", "wait_homing")


def _split_prep(steps: list) -> tuple:
    """Split a cycle into (normal, prep). `prep` = steps flagged `prep:true` (and not
    disabled) → executed ~1 min before print end via _wait_print's pre-positioning;
    they are removed from the normal flow so they don't run twice. `wait_print`/
    `send_file` are force-kept in the normal flow regardless of the flag."""
    normal, prep = [], []
    for s in steps:
        if s.get("prep") and not s.get("disabled") and s.get("type") not in _PREP_FORBIDDEN:
            prep.append(s)
        else:
            normal.append(s)
    return normal, prep


def _handover_trim(steps: list) -> list:
    """Übergabe First Start → Zyklus (nur Job 1, wenn `_plate_ready` gesetzt ist):
    der First Start hat die Platte schon geholt und steht damit vor dem Drucker —
    der Zyklus startet direkt HINTER seinem ersten Griff-Schritt. Auch die Schritte
    DAVOR (z. B. „Tür öffnen") entfallen: die Tür ist bereits offen, und der Arm
    dürfte die Tür-Fahrt nicht mit der Platte im Greifer ausführen.

    Sicherheits-Fallbacks (dann greift der Einzel-Skip im Griff-Schritt selbst):
    kein Griff vorhanden · Griff steckt in einer ∥-Gruppe · vor dem Griff liegt
    ein Datei-/Warteschritt (send_file/wait_print …), der nicht entfallen darf."""
    def _is_grab(s):
        if s.get("disabled"):
            return False
        t, v = s.get("type"), str(s.get("value") or "")
        if t == "macro":
            vu = v.upper()
            return "GRAB_FROM_RACK" in vu or vu.strip().startswith("GRAB_FROM_SLOT_")
        return t == "app_op" and v.strip().lower() in ("grab", "grab_magazine")

    blockers = {"wait_print", "send_file", "send_homing_file", "send_file_fixed"}
    for i, s in enumerate(steps):
        if not _is_grab(s):
            continue
        in_group = s.get("parallel") or (i + 1 < len(steps) and steps[i + 1].get("parallel"))
        if in_group or any(x.get("type") in blockers for x in steps[:i]):
            return steps
        _farm.pop("_plate_ready", None)
        skipped = [x.get("label", x.get("type", "?")) for x in steps[:i + 1] if not x.get("disabled")]
        _log("⏭ Übergabe vom First Start (Platte schon im Greifer) — übersprungen: " + " · ".join(skipped))
        return steps[i + 1:]
    return steps


async def _exec_sequence(steps: list, job: dict, device: Device, use_ams: bool,
                          poll_sec: int, min_min: int, prep_steps: list, fail_steps: list = []):
    steps = _filter_disabled(steps)
    # Drucker-Geometrie einmal je Job laden → zwischenzeitliche Positions-Änderungen
    # (Drucker-Tab) wirken ab dem nächsten Job. Nur wirksam, wo use_gcode[op] aktiv ist.
    try:
        _farm["geometry"] = _load_farm_geometry()
    except Exception:
        _farm["geometry"] = None
    groups: list = []
    for step in steps:
        if step.get("parallel") and groups:
            groups[-1].append(step)
        else:
            groups.append([step])

    total = len(groups)
    for gi, group in enumerate(groups):
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")
        while _farm["paused"] and not _farm["stopping"]:
            await asyncio.sleep(0.5)

        label = " + ".join(s.get("label", s.get("type", "?")) for s in group)
        _farm["seq_step_idx"] = gi
        _farm["seq_step_total"] = total
        _farm["seq_step_label"] = label
        # Bei JEDEM Schritt mitschreiben: bricht die App hier ab, weiß man danach
        # genau, wo es aufgehört hat (Phase 3.1).
        _persist_state()
        _log(f"▸ {label}")

        if len(group) == 1:
            st = group[0]
            try:
                await _exec_step(st, job, device, use_ams, poll_sec, min_min, prep_steps, fail_steps)
            except RuntimeError as e:
                if str(e) == "Gestoppt":
                    raise
                if st.get("optional"):
                    _log(f"⚠ '{st.get('label', st.get('type', '?'))}' fehlgeschlagen (optional) — als fertig gewertet")
                else:
                    raise
        else:
            results = await asyncio.gather(*[
                _exec_step(s, job, device, use_ams, poll_sec, min_min, prep_steps, fail_steps)
                for s in group
            ], return_exceptions=True)
            for s, result in zip(group, results):
                if isinstance(result, Exception):
                    if isinstance(result, RuntimeError) and str(result) == "Gestoppt":
                        raise result
                    if s.get("optional"):
                        _log(f"⚠ '{s.get('label', '')}' fehlgeschlagen (optional) — als fertig gewertet")
                    else:
                        raise result

    _farm["seq_step_idx"] = 0
    _farm["seq_step_total"] = 0
    _farm["seq_step_label"] = ""


# ── Slot availability check ──────────────────────────────────
async def _wait_for_slot(slot: str, poll_sec: int):
    """Block until rack slot is free or ready. Raises RuntimeError on stop."""
    while not _farm["stopping"]:
        try:
            if os.path.exists(SLOTS_PATH):
                with open(SLOTS_PATH) as f:
                    data = json.load(f)
                status = data.get("slots", {}).get(str(slot), {}).get("status", "free")
                if status in ("free", "ready"):
                    return
                _log(f"⏳ Fach {slot} ist '{status}' — warte auf Freigabe…")
        except Exception as e:
            _log(f"⚠ Fach-Status-Prüfung: {e}")
        while _farm["paused"] and not _farm["stopping"]:
            await asyncio.sleep(0.5)
        if _farm["stopping"]:
            raise RuntimeError("Gestoppt")
        await asyncio.sleep(poll_sec)
    raise RuntimeError("Gestoppt")


# ── Main farm coroutine (continuous loop) ────────────────────
async def _run_farm(bambu_id: int, use_ams: bool, poll_sec: int, min_min: int,
                     seq_new: list, seq_next: list):
    db = SessionLocal()
    try:
        device = db.query(Device).filter(
            Device.id == bambu_id,
            Device.device_type == PrinterType.BAMBU_LAB,
        ).first()
        if not device:
            raise RuntimeError("Bambu Lab Gerät nicht gefunden")
    finally:
        db.close()

    completed = 0
    cur_slot: Optional[str] = None
    first_start_done = False
    # Reste aus einem früheren Lauf entsorgen (Greifer-Merker, Homing-Monitor).
    _farm.pop("_plate_ready", None)
    _farm["_in_first_start"] = False
    _old_task = _farm.pop("_homing_task", None)
    if _old_task is not None:
        _old_task.cancel()

    try:
        _log("═══ Auto Farm aktiv — wartet auf Jobs ═══")

        while not _farm["stopping"]:
            # Geänderte Einstellungen übernehmen (nur bei geänderter Datei).
            _refresh_live_settings()

            # Respect pause
            while _farm["paused"] and not _farm["stopping"]:
                await asyncio.sleep(0.5)
            if _farm["stopping"]:
                break

            # Find next pending job
            pending = [j for j in _farm["jobs"] if j["status"] == "pending"]
            if not pending:
                # KEIN Auto-Stop mehr: leere Warteschlange → Leerlauf, bis ein neuer
                # Job kommt (oder manuell gestoppt / per Update neugestartet wird).
                if not _farm["idle"]:
                    _farm["idle"] = True
                    # Nur parken, wenn schon einmal gehomt wurde (First Start lief) — sonst
                    # ist die Maschine ungehomt und PARK wäre unsicher.
                    if first_start_done:
                        _log("⏸ Warteschlange leer — OTTOeject parkt, warte auf neue Jobs…")
                        # Arm PARKEN, statt vor dem Regal stehen zu bleiben. Beim nächsten
                        # Job wird neu gehomt: Klipper schaltet in der Wartezeit die Motoren
                        # per idle_timeout ab → Referenz geht verloren.
                        try:
                            await _do_macro("PARK_OTTOEJECT")
                        except Exception as e:
                            _log(f"⚠ Parken beim Leerlauf fehlgeschlagen: {e}")
                        _farm["_parked_idle"] = True   # → nächster Job homt zuerst
                    else:
                        _log("⏸ Warteschlange leer — warte auf neue Jobs…")
                _farm["current_job_id"] = None
                _farm["current_job_idx"] = -1
                await asyncio.sleep(2)
                continue

            job = pending[0]
            # 2.5 Betriebszeiten: einen NEUEN Job nur im Zeitfenster starten.
            # Außerhalb wird gewartet; danach zurück an den Schleifenanfang, damit
            # Pause/Stop/Queue erneut geprüft werden.
            if not _now_in_operating_window():
                await _wait_operating_window()
                continue
            # Aus dem Leerlauf heraus: 15-Sekunden-Countdown vor dem nächsten Job
            # (im Header sichtbar). Direkt aufeinanderfolgende Jobs (idle == False)
            # starten ohne Extra-Countdown — der Auswurf-Zyklus liegt dazwischen.
            if _farm["idle"]:
                if not await _prestart_countdown():
                    continue   # gestoppt oder Job entfernt → Schleife neu bewerten
                _farm["idle"] = False
                # Nach dem Leerlauf zuerst REFERENZFAHRT: Klipper kann in der Wartezeit
                # per idle_timeout die Motoren abgeschaltet haben (verlorene Referenz).
                # Danach läuft der Zyklus normal weiter.
                if _farm.pop("_parked_idle", False) and first_start_done:
                    _log("↑ Referenzfahrt nach Leerlauf (OTTOeject homen)…")
                    try:
                        await _do_macro("OTTOEJECT_HOME")
                    except Exception as e:
                        _log(f"⚠ Homing nach Leerlauf fehlgeschlagen: {e}")
                # WICHTIG: Während des Countdowns kann der Nutzer die Reihenfolge
                # ändern (Drag/↑↓ → /jobs/reorder). Deshalb den jetzt obersten
                # wartenden Job NEU bestimmen — sonst startet trotz Umsortieren der
                # vor dem Countdown gemerkte Job.
                pending = [j for j in _farm["jobs"] if j["status"] == "pending"]
                if not pending:
                    continue
                job = pending[0]
            # Find the index in the full jobs list for UI compat
            for idx, j in enumerate(_farm["jobs"]):
                if j["id"] == job["id"]:
                    _farm["current_job_idx"] = idx
                    break

            _farm["current_job_id"] = job["id"]
            cur_slot = job["slot"]
            _log(f"── Job: {job['fileName']} ──")

            _set_job(job["id"], {"status": "running"})
            job_started_at = datetime.now()   # wall-clock for the per-file history (B.2)
            job_start_kwh  = await _read_energy_kwh(bambu_id)   # plug energy counter (3.1)

            try:
                # First Start runs exactly ONCE before the first job's cycle
                # (one-time homing + Z200). `seq_new` = First Start, `seq_next` = cycle.
                if not first_start_done:
                    if _filter_disabled(seq_new):
                        _log("▶ First Start (einmaliges Homing)…")
                        _farm["_in_first_start"] = True
                        try:
                            await _exec_sequence(seq_new, job, device, use_ams, poll_sec, min_min, [], [])
                        finally:
                            _farm["_in_first_start"] = False
                    first_start_done = True

                # The recurring cycle runs for EVERY job. Steps flagged `prep` are
                # pulled out and handed to _wait_print so they fire ~1 min before
                # the print ends (pre-positioning) instead of in their normal slot.
                cycle_normal, cycle_prep = _split_prep(seq_next)
                # Übergabe: hat der First Start die Platte schon geholt, startet Job 1
                # direkt hinter dem Zyklus-Griff (inkl. „Tür öffnen" davor — Tür ist
                # offen, Arm steht mit Platte vor dem Drucker).
                if _farm.get("_plate_ready"):
                    cycle_normal = _handover_trim(cycle_normal)
                # Bergungs-Sequenz für die 'eject'-Strategie bei Druckfehler (Z200 → Tür →
                # Auswurf → Einlagern der fehlgeschlagenen Platte). Bei Erfolg ungenutzt.
                eject_recovery = _eject_recovery_steps(seq_next)
                await _exec_sequence(cycle_normal, job, device, use_ams, poll_sec, min_min,
                                     cycle_prep, eject_recovery)
                completed += 1
                actual_min = (datetime.now() - job_started_at).total_seconds() / 60.0
                end_kwh  = await _read_energy_kwh(bambu_id)
                used_kwh = 0.0
                if job_start_kwh is not None and end_kwh is not None and end_kwh >= job_start_kwh:
                    used_kwh = round(end_kwh - job_start_kwh, 4)
                _set_job(job["id"], {"status": "done"})
                _rack_update(job["slot"], "done")
                # Projekt-Fortschritt abhaken (Job trägt tag "proj:<itemId>").
                tag = job.get("tag") or ""
                if tag.startswith("proj:"):
                    try:
                        from app.routers.project import mark_item_printed
                        mark_item_printed(tag[5:])
                    except Exception as e:
                        logger.warning(f"project mark done failed: {e}")
                used_g = await _job_filament_g(job)
                _record_success(round(actual_min) or job.get("estimatedMinutes") or 0,
                                used_kwh, used_g)
                _record_duration(job.get("fileId"), actual_min, used_kwh)
                _record_event("print_done", job.get("fileName", ""), f"Fach {job['slot']}")
                _record_completed(job, "done", job_started_at, datetime.now(), actual_min)
                cur_slot = None
                _farm["current_job_id"] = None
                _log(f"✓ Fertig: {job['fileName']}")
                await _notify(
                    f"✅ *Printloom — Druck fertig*\n`{job['fileName']}`\nFach {job['slot']}"
                )

            except _EjectRecovered as e:
                # Druckfehler, dessen Platte geborgen (ausgeworfen + eingelagert) wurde →
                # Fach bleibt BELEGT (Platte liegt drin), nächster Job lädt eine frische
                # Platte und startet. Kein blockierender Fehlerzustand.
                msg = str(e)
                _log(f"🔴 {msg}")
                _record_failure(msg)
                _record_event("error", job.get("fileName", ""), msg[:70])
                _record_completed(job, "ejected", job_started_at, datetime.now(),
                                  (datetime.now() - job_started_at).total_seconds() / 60.0, msg[:120])
                _set_job(job["id"], {"status": "error"})
                _rack_update(job["slot"], "done", job.get("fileName", ""))
                cur_slot = None
                _farm["current_job_id"] = None
                _farm["error"] = None
                await _notify(f"➡️ *Printloom — weiter nach Druckfehler*\n`{job['fileName']}`\n"
                              "Platte eingelagert, nächster Job startet.")

            except _MoveTimeout as e:
                # Hängende Bewegung (Phase 3.3): Der Arm steht an unbekannter Stelle,
                # evtl. mit Platte. Weiterfahren wäre die schlechteste Option — also
                # Position als unbekannt markieren (erzwingt Referenzfahrt) und nach
                # der eingestellten Strategie reagieren.
                msg = str(e)
                _farm["needs_home"] = True
                _persist_state()
                action = _estrat("move_timeout")
                _log(f"⏱ {msg} — Strategie: {action}")
                _record_failure(msg)
                _record_event("error", job.get("fileName", ""), msg[:70])
                await _notify(f"⏱ *Printloom — Bewegung hängt*\n`{job['fileName']}`\n{msg}")
                if action == "stop":
                    _farm["stopping"] = True
                    _farm["error"] = msg
                    break
                if action == "pause":
                    _farm["paused"] = True
                    _farm["error"] = (f"{msg} — OTTOeject prüfen, dann fortsetzen "
                                      f"(es wird zuerst referenziert)")
                    while _farm["paused"] and not _farm["stopping"]:
                        await asyncio.sleep(0.5)
                    if _farm["stopping"]:
                        break
                    _farm["error"] = None
                    continue          # denselben Job erneut versuchen
                # skip/ignore → Job als Fehler werten und weitermachen
                _record_completed(job, "error", job_started_at, datetime.now(),
                                  (datetime.now() - job_started_at).total_seconds() / 60.0, msg[:120])
                _set_job(job["id"], {"status": "error"})
                if cur_slot:
                    _rack_update(job["slot"], "free")
                cur_slot = None
                _farm["current_job_id"] = None

            except RuntimeError as e:
                msg = str(e)
                if msg == "Gestoppt":
                    _farm["stopping"] = True
                    break
                _log(f"FEHLER: {msg}")
                _record_failure(msg)
                _record_event("error", job.get("fileName", ""), msg[:70])
                _record_completed(job, "error", job_started_at, datetime.now(),
                                  (datetime.now() - job_started_at).total_seconds() / 60.0, msg[:120])
                _set_job(job["id"], {"status": "error"})
                if cur_slot:
                    _rack_update(job["slot"], "free")
                cur_slot = None
                _farm["current_job_id"] = None
                _farm["error"] = msg
                await _notify(f"❌ *Printloom — Job fehlgeschlagen*\n`{job['fileName']}`\n{msg}")
                # Continue loop — pick up next pending job

    except Exception as e:
        _farm["error"] = str(e)
        _log(f"FEHLER (unhandled): {e}")
        for j in _farm["jobs"]:
            if j["status"] in ("running", "sending", "printing"):
                j["status"] = "error"
        if cur_slot:
            _rack_update(cur_slot, "free")

    finally:
        # Nie abgeholten Homing-Monitor (nowait ohne wait_homing / Abbruch) beenden.
        _left_task = _farm.pop("_homing_task", None)
        if _left_task is not None:
            _left_task.cancel()
        if completed > 0:
            _log("Abschluss: OTTOeject parken…")
            try:
                await _do_macro("PARK_OTTOEJECT")
            except Exception as e:
                _log(f"Warnung PARK_OTTOEJECT: {e}")

        # Reset any slots still reserved as 'printing' — plate was grabbed, farm
        # stopped before store. Diese Fächer haben normalerweise noch KEINE
        # physische Platte (die liegt im Drucker). Wir loggen sie aber, damit der
        # Nutzer prüfen kann, falls der Stopp ausnahmsweise mitten im Einlagern kam.
        try:
            if os.path.exists(SLOTS_PATH):
                with open(SLOTS_PATH) as f:
                    data = json.load(f)
                freed = []
                for key, slot_data in data.get("slots", {}).items():
                    if slot_data.get("status") == "printing":
                        slot_data["status"] = "free"
                        slot_data["object_height_mm"] = None
                        freed.append(key)
                if freed:
                    storage.write_json(SLOTS_PATH, data)
                    _log(f"⚠ Reservierte Fächer beim Stopp freigegeben: {', '.join(freed)} "
                         f"— falls dort doch eine Platte liegt, im Rack Manager prüfen")
        except Exception as e:
            logger.warning(f"slot cleanup on stop failed: {e}")

        remaining = [j for j in _farm["jobs"] if j["status"] in ("pending", "error")]
        try:
            _write_config(QUEUE_PATH, {"jobs": remaining})
        except Exception as e:
            logger.warning(f"queue persist on stop failed: {e}")
        _farm["jobs"] = []   # clear so status endpoint doesn't leak stale job data

        _farm["running"] = False
        _farm["stopping"] = False
        _farm["paused"] = False
        _farm["idle"] = False
        _farm["start_countdown"] = 0
        _farm["current_job_id"] = None
        _farm["current_job_idx"] = -1
        _farm["seq_step_idx"] = 0
        _farm["seq_step_total"] = 0
        _farm["seq_step_label"] = ""
        _farm["_last_gcode_time"] = None
        # stop_reason intentionally kept — frontend reads it once after running→False
        _farm["arm"] = dict(_ARM_EMPTY)
        _clear_state()               # sauberes Ende → nichts zu bergen
        _record_event("farm_stop", "", _farm.get("stop_reason") or "")
        _log("═══ Auto Farm beendet ═══")

        # Auto-Abschaltung (3.2): nach Leerlauf die Steckdose abschalten, sofern
        # konfiguriert und die Farm regulär (nicht manuell) durchgelaufen ist.
        try:
            idle_min = int(_read_config(SETTINGS_PATH, _DEFAULT_SETTINGS).get("idle_off_min", 0) or 0)
            if idle_min > 0 and completed > 0 and _device_settings(bambu_id).get("plug_type", "none") != "none":
                _log(f"⏻ Auto-Abschaltung in {idle_min} min geplant (sofern kein neuer Job startet)")
                asyncio.create_task(_idle_shutdown_after(bambu_id, idle_min))
        except Exception as e:
            logger.warning(f"idle shutdown scheduling failed: {e}")


# ── Pydantic schemas ─────────────────────────────────────────
class JobIn(BaseModel):
    id: int
    fileId: int
    fileName: str
    slot: str
    status: str = "pending"
    progress: int = 0
    remaining: int = 0
    estimatedMinutes: Optional[int] = None
    amsMap: Optional[str] = None
    layerHeightMm: float = 0.0
    object_height_mm: Optional[float] = None
    plate: Optional[int] = None
    plateTotal: Optional[int] = None   # Gesamt-Plattenzahl der Multi-Plate-.3mf (für „Platte 3/13")
    plateName: Optional[str] = None    # Slicer-Plattenname (plater_name) — Anzeige statt „Platte N"
    tag: Optional[str] = None   # z. B. "proj:<itemId>" → Projekt-Fortschritt (Abhaken)


class EnqueueRequest(BaseModel):
    id: int
    fileId: int
    fileName: str
    slot: str
    amsMap: Optional[str] = None
    layerHeightMm: float = 0.0
    object_height_mm: Optional[float] = None
    plate: Optional[int] = None
    plateTotal: Optional[int] = None   # Gesamt-Plattenzahl der Multi-Plate-.3mf (für „Platte 3/13")
    plateName: Optional[str] = None    # Slicer-Plattenname (plater_name)
    tag: Optional[str] = None   # z. B. "proj:<itemId>"


class StartRequest(BaseModel):
    bambu_id: int
    use_ams: bool = True
    poll_interval: int = 20
    min_print_minutes: int = 0
    jobs: List[JobIn]


class ReorderPayload(BaseModel):
    job_ids: List[int] = []


class SequencesPayload(BaseModel):
    seq_new:  List[dict] = []
    seq_next: List[dict] = []

class SettingsPayload(BaseModel):
    poll_interval:     int  = 20
    min_print_minutes: int  = 0
    use_ams:           bool = True
    hms_ignore:        List[str] = ["0C00-0100-0001-0004"]
    power_price_eur_kwh:   float = 0.30
    machine_rate_eur_h:    float = 0.0
    filament_price_eur_kg: float = 20.0
    idle_off_min:          int   = 0
    move_timeout_s:        int   = 180
    conn_alarm:            bool  = True
    progress_stall_min:    int   = 0
    error_strategy:        dict  = {}
    failed_retries:        int   = 1
    timezone:                str  = ""         # IANA-TZ des Nutzers (z. B. "Europe/Berlin")
    operating_hours_enabled: bool = False
    operating_schedule:      List[dict] = []   # 7 Einträge [{enabled,start,end}], Index 0=Mo
    exact_color_only:        bool = False      # nur exakte Farbe drucken, sonst pausieren
    cool_before_eject:       bool  = True      # Magnet: vor dem Auswerfen abkühlen lassen
    cool_temp_c:             float = 30.0      # Druckplatte gilt ab hier als kalt genug
    cool_timeout_min:        int   = 30        # 0 = ohne Zeitlimit warten
    # Legacy (vor v1.0.59) — weiterhin akzeptiert für alte Clients/Backups:
    operating_start:         str  = "22:00"
    operating_end:           str  = "06:00"
    operating_days:          List[int] = [0, 1, 2, 3, 4, 5, 6]

class QueuePayload(BaseModel):
    jobs: List[dict] = []


# ── Endpoints ────────────────────────────────────────────────
@router.post("/start")
async def start_farm(req: StartRequest):
    global _task
    if _farm["running"]:
        raise HTTPException(409, "Auto Farm läuft bereits")

    # Validate sequences BEFORE touching farm state
    seq_data = _read_config(SEQ_PATH, {"seq_new": [], "seq_next": []})
    saved_ver = seq_data.get("schema_version", "—")
    if saved_ver != SEQ_SCHEMA_VERSION:
        raise HTTPException(
            400,
            f"Sequenzen veraltet (Schema {saved_ver} ≠ {SEQ_SCHEMA_VERSION}) — "
            f"bitte Sequenz-Editor öffnen und ↺ Standard klicken, dann erneut starten."
        )

    _settings = _read_config(SETTINGS_PATH, _DEFAULT_SETTINGS)

    # Fährt die Farm App-G-code, muss sie den Block DIESES Druckers haben. Seit
    # v1.1.9 gibt es mehrere; ein Gerät ohne eigenen Block würde sonst still die
    # Koordinaten des ersten Druckers fahren — also gegen den falschen Drucker.
    _assert_printer_geometry(req.bambu_id)

    _farm.update({
        "running":         True,
        "stopping":        False,
        "paused":          False,
        "idle":            False,
        "start_countdown": 0,
        "bambu_id":        req.bambu_id,   # für Pause/Resume/Stop-Befehle an den X1C
        "error":           None,
        "stop_reason":     None,
        "current_job_id":  None,
        "current_job_idx": -1,
        "seq_step_idx":    0,
        "seq_step_total":  0,
        "seq_step_label":  "",
        "started_at":      datetime.now().isoformat(),
        "jobs":            [j.model_dump() for j in req.jobs],
        "log":             [],
        # Startwerte über dieselbe Funktion, die sie später nachzieht — sonst laufen
        # Schnappschuss und Nachziehen mit der Zeit auseinander (siehe _live_settings).
        **_live_settings(_settings),
        # Ein neuer Lauf beginnt mit leerem Greifer; ein unterbrochener Lauf ist
        # damit erledigt (der Nutzer startet ja bewusst neu). Position gilt aber
        # weiter als unbekannt → die erste Bewegung referenziert (needs_home).
        "arm":                dict(_ARM_EMPTY),
        "recovery":           None,
    })

    _farm.pop("_no_slot_logged", None)   # „Regal voll"-Log-Dedup nicht über Läufe schleppen
    _farm.pop("_settings_mtime", None)   # nächster Durchlauf liest die Einstellungen frisch
    _record_event("farm_start", "", f"{len([j for j in req.jobs if j.status == 'pending'])} Jobs")

    _task = asyncio.create_task(_run_farm(
        bambu_id=req.bambu_id,
        use_ams=req.use_ams,
        poll_sec=req.poll_interval,
        min_min=req.min_print_minutes,
        seq_new=seq_data.get("seq_new", []),
        seq_next=seq_data.get("seq_next", []),
    ))

    job_count = len([j for j in req.jobs if j.status == "pending"])
    return {"success": True, "message": "Auto Farm gestartet", "job_count": job_count}


@router.post("/enqueue")
async def enqueue_job(job: EnqueueRequest):
    """Add a job to the running farm's queue."""
    if not _farm["running"]:
        raise HTTPException(400, "Farm nicht aktiv — erst starten")
    if any(j["id"] == job.id for j in _farm["jobs"]):
        raise HTTPException(409, "Job bereits in der Warteschlange")

    # Analyze height server-side so runtime slot assignment has clearance data.
    # The slot is forced to "1-0" so the print picks a real free slot at start time
    # based on the LIVE rack state (handles slots freed while the farm is running).
    layer_h = job.layerHeightMm or 0.0
    obj_h   = job.object_height_mm
    try:
        db = SessionLocal()
        try:
            f = db.query(UploadedFile).filter(UploadedFile.id == job.fileId).first()
        finally:
            db.close()
        if f and os.path.exists(f.file_path) and f.file_type in (".3mf", ".gcode"):
            # Plattengenau: Multi-Plate-Jobs bekommen die Höhe IHRER Platte,
            # nicht die der ersten (falsche Fach-Reservierung sonst).
            result = analyze_3mf_height(f.file_path, job.plate) if f.file_type == ".3mf" else analyze_gcode_height(f.file_path)
            lc = result.get("layer_count", 0)
            lh = result.get("layer_height_mm", 0.0)
            mz = result.get("max_z_mm", 0.0)
            margin = 1.0 + float(_rack_load().get("height_margin_pct", 15.0)) / 100.0
            if lc > 0 and lh > 0:
                obj_h, layer_h = round(lc * lh * margin, 1), lh
            elif mz > 0:
                obj_h = round(mz * margin, 1)
    except Exception as e:
        logger.warning(f"enqueue height analysis failed for file {job.fileId}: {e}")

    _farm["jobs"].append({
        "id":               job.id,
        "fileId":           job.fileId,
        "fileName":         job.fileName,
        "slot":             "1-0",  # sentinel → real slot chosen at print start
        "status":           "pending",
        "progress":         0,
        "remaining":        0,
        "estimatedMinutes": None,
        "amsMap":           job.amsMap or "",
        "layerHeightMm":    layer_h,
        "object_height_mm": obj_h,
        "plate":            job.plate,
        "plateTotal":       job.plateTotal,
        "plateName":        job.plateName or "",
        "tag":              job.tag or "",
    })
    _log(f"[+] {job.fileName}{f' (Platte {job.plate})' if job.plate else ''} → Fach wird bei Ausführung zugewiesen")
    return {"success": True}


@router.put("/jobs/reorder")
async def reorder_jobs(payload: ReorderPayload):
    """Reorder pending jobs while the farm is running."""
    if not _farm["running"]:
        raise HTTPException(400, "Farm nicht aktiv")
    id_to_job = {j["id"]: j for j in _farm["jobs"]}
    non_pending  = [j for j in _farm["jobs"] if j["status"] != "pending"]
    new_pending  = [id_to_job[i] for i in payload.job_ids if i in id_to_job and id_to_job[i]["status"] == "pending"]
    _farm["jobs"] = non_pending + new_pending
    # Sichtbar bestätigen — so lässt sich im Farm-Log prüfen, dass eine Umsortierung
    # bei der LAUFENDEN Farm angekommen ist (und nicht nur in der UI).
    order = " → ".join(
        (j.get("fileName", "?") + (f" P{j['plate']}" if j.get("plate") else "")) for j in new_pending[:5])
    _log(f"↕ Warteschlange umsortiert: {order}" + (" …" if len(new_pending) > 5 else ""))
    return {"success": True}


class JobAmsPayload(BaseModel):
    amsMap: str = ""


@router.put("/job/{job_id}/ams")
async def set_job_ams(job_id: int, payload: JobAmsPayload):
    """Set a manual AMS mapping on a job in the running farm. Clears the
    'needs manual AMS' block so a paused job can resume after the user maps it."""
    if not _farm["running"]:
        raise HTTPException(400, "Farm nicht aktiv")
    found = False
    for j in _farm["jobs"]:
        if j["id"] == job_id:
            j["amsMap"] = (payload.amsMap or "").strip()
            j["needs_ams"] = False
            found = True
            break
    if not found:
        raise HTTPException(404, "Job nicht in der Warteschlange")
    return {"success": True}


@router.delete("/jobs/{job_id}")
async def remove_job_from_farm(job_id: int):
    """Remove a pending or errored job from the farm queue."""
    job = next((j for j in _farm["jobs"] if j["id"] == job_id), None)
    if not job:
        raise HTTPException(404, "Job nicht gefunden")
    # done ist entfernbar: fertige Jobs verschwinden aus der Queue, sobald ihre
    # Platte aus dem Regal entnommen wird (Frontend ruft das beim Fach-Leeren).
    if job["status"] not in ("pending", "error", "done"):
        raise HTTPException(400, "Laufende Jobs können nicht entfernt werden")
    _farm["jobs"] = [j for j in _farm["jobs"] if j["id"] != job_id]
    _log(f"[-] {job['fileName']} entfernt")
    return {"success": True}


@router.get("/status")
async def get_status(light: bool = False):
    # `light=1` lässt das Aktivitäts-Log (bis 200 Einträge) weg — Dashboard,
    # Mobile-View, Datei-Bibliothek & ETA-Hook brauchen es nicht und pollen oft.
    # Wie beim WS: interne _-Felder (Sets) und den Geometrie-Cache nicht ausliefern.
    data = {k: v for k, v in _farm.items()
            if not k.startswith("_") and k not in _WS_SKIP_KEYS}
    if light:
        data.pop("log", None)
    return data


# ── P6: WebSocket-Live-Kanal ─────────────────────────────────
# Statt dass jeder Client den Status pollt, pusht der Server Änderungen.
# Ein einziger Broadcaster-Task vergleicht den serialisierten Farm-Status im
# 1-s-Takt mit dem zuletzt gesendeten und schickt nur bei Änderung. Läuft nur,
# solange Clients verbunden sind. Frontend fällt bei Abriss auf HTTP-Poll zurück.
_ws_clients: set = set()
_ws_task: Optional[asyncio.Task] = None
_ws_last_payload: Optional[str] = None


_WS_LOG_LIMIT = 80   # nur die jüngsten N Log-Zeilen über den WS pushen (Panel zeigt Aktuelles; das volle Log gibt es als Download)


# Nicht über den WS pushen: "geometry" ist der komplette Drucker-Geometrie-Speicher
# (inkl. gcode_override-Texte) — nur intern für den Sequenz-Runner gecacht, für die
# UI irrelevant und unnötig groß im 1-s-Vergleich + jedem Push.
_WS_SKIP_KEYS = {"geometry"}


def _ws_snapshot() -> str:
    """Farm-Status als JSON — interne Underscore-Felder (z. B. Sets) ausgeblendet,
    Log auf die jüngsten Zeilen gekappt (kleinere Push-Pakete)."""
    data = {k: v for k, v in _farm.items()
            if not k.startswith("_") and k not in _WS_SKIP_KEYS}
    log = data.get("log")
    if isinstance(log, list) and len(log) > _WS_LOG_LIMIT:
        data["log"] = log[:_WS_LOG_LIMIT]   # Log ist neueste-zuerst → erste N = aktuellste
    return json.dumps(data, default=str, ensure_ascii=False)


def _ws_drop(ws):
    """Client aus dem Verteiler nehmen und best-effort schließen (eigener Task,
    damit auch ein hängendes close() den Broadcaster nicht aufhält)."""
    _ws_clients.discard(ws)
    async def _close():
        try:
            await asyncio.wait_for(ws.close(), timeout=2.0)
        except Exception:
            pass
    try:
        asyncio.get_event_loop().create_task(_close())
    except Exception:
        pass


async def _ws_broadcaster():
    global _ws_task, _ws_last_payload
    try:
        while _ws_clients:
            payload = _ws_snapshot()
            if payload != _ws_last_payload:
                _ws_last_payload = payload
                for ws in list(_ws_clients):
                    # Send-Timeout: ein halbtoter Client (eingeschlafenes Handy/Tab,
                    # gestalltes TCP) blockierte sonst den EINEN Broadcaster — alle
                    # anderen Clients bekamen nichts mehr und die UI wirkte
                    # eingefroren, obwohl das Backend normal lief.
                    try:
                        await asyncio.wait_for(ws.send_text(payload), timeout=3.0)
                    except Exception:
                        _ws_drop(ws)
            await asyncio.sleep(1.0)
    finally:
        _ws_task = None
        # Rennen schließen: Verbindet sich ein Client GENAU zwischen der leeren
        # `while`-Prüfung und diesem finally, sah farm_ws den Task noch als laufend
        # und startete keinen neuen — der Client hätte nur den Erst-Snapshot bekommen
        # und die Farm-Ansicht wäre eingefroren geblieben (bis zum Neuverbinden).
        if _ws_clients:
            _ws_task = asyncio.create_task(_ws_broadcaster())


@router.websocket("/ws")
async def farm_ws(ws: WebSocket):
    global _ws_task
    await ws.accept()
    _ws_clients.add(ws)
    try:
        await ws.send_text(_ws_snapshot())            # Initial-Snapshot sofort
        if _ws_task is None or _ws_task.done():        # Broadcaster bei Bedarf starten
            _ws_task = asyncio.create_task(_ws_broadcaster())
        while True:                                    # offen halten, nur Disconnect erkennen
            await ws.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        _ws_clients.discard(ws)


@router.post("/stop")
async def stop_farm():
    if not _farm["running"]:
        raise HTTPException(400, "Auto Farm läuft nicht")
    _farm["stopping"] = True
    _farm["paused"] = False
    _farm["stop_reason"] = "manual"
    await _send_print_cmd("stop")   # X1C-Druck ebenfalls abbrechen
    return {"success": True}


@router.post("/force-reset")
async def force_reset():
    """Force-reset all farm state. Use when farm is stuck and Stop has no effect."""
    global _task
    if _task and not _task.done():
        _task.cancel()
    _farm.update({
        "running":          False,
        "stopping":         False,
        "paused":           False,
        "idle":             False,
        "start_countdown":  0,
        "error":            None,
        "stop_reason":      None,
        "current_job_id":   None,
        "current_job_idx":  -1,
        "seq_step_idx":     0,
        "seq_step_total":   0,
        "seq_step_label":   "",
        "started_at":       None,
        "_last_gcode_time": None,
        "_plate_ready": False,
        "arm":              dict(_ARM_EMPTY),
        "recovery":         None,
        "needs_home":       True,   # Position nach dem Force-Reset unbekannt
        "_in_first_start": False,
    })
    _task = None
    _log("⚠ Farm-State force-reset")
    return {"success": True}


_test_task: Optional[asyncio.Task] = None
_test_running = False
_test_state   = {"step_label": "", "step_idx": 0, "step_total": 0}

async def _run_test_cycle():
    global _test_running, _test_state
    _test_running = True
    _log("🧪 Test-Phase gestartet…")
    try:
        seq_data = _read_config(SEQ_PATH, {"seq_new": []})
        all_steps = seq_data.get("seq_new", [])
        # Only run executable steps (skip wait_print, send_file, etc.)
        steps = [s for s in all_steps if s.get("type") in ("macro", "klipper_gcode", "delay")]
        stack_rack, stack_slot = _stack_vars()
        _test_state["step_total"] = len(steps)
        for idx, step in enumerate(steps):
            if not _test_running:
                break
            label = step.get("label") or step.get("value", "")
            _test_state["step_idx"]   = idx
            _test_state["step_label"] = label
            t   = step.get("type", "")
            val = (step.get("value") or "").replace(
                "{rack}", "1").replace("{slot}", "1").replace(
                "{stack_rack}", stack_rack).replace("{stack_slot}", stack_slot)
            if t in ("macro", "klipper_gcode"):
                _log(f"🧪 ▶ {label}")
                try:
                    await _do_macro(val)
                except Exception as e:
                    _log(f"🧪 ⚠ {val}: {e}")
            elif t == "delay":
                secs = int(step.get("seconds", 0))
                _log(f"🧪 ⏱ {secs}s…")
                for _ in range(secs):
                    if not _test_running:
                        break
                    await asyncio.sleep(1)
        _log("🧪 Test-Phase abgeschlossen")
    except Exception as e:
        _log(f"🧪 Fehler: {e}")
    finally:
        _test_running = False
        _test_state["step_label"] = ""


@router.post("/test-cycle")
async def start_test_cycle():
    global _test_task, _test_running
    if _farm["running"]:
        raise HTTPException(400, "Auto Farm läuft — Test-Phase nicht möglich")
    if _test_running:
        raise HTTPException(409, "Test-Phase läuft bereits")
    _test_task = asyncio.create_task(_run_test_cycle())
    return {"success": True}


@router.post("/test-cycle/stop")
async def stop_test_cycle():
    global _test_running, _test_task
    _test_running = False
    if _test_task and not _test_task.done():
        _test_task.cancel()
    return {"success": True}


@router.get("/test-cycle/status")
async def get_test_cycle_status():
    return {**_test_state, "running": _test_running}


# ── Stresstest: die Magazine leerräumen ──────────────────────────────────────
# Platte aus Magazin 1 holen, in ein GEWÜRFELTES freies Fach legen, wiederholen,
# bis alle Magazine leer sind. Die zufälligen Ziele ergeben lauter unterschiedlich
# lange Wege statt derselben Strecke im Kreis — das ist der Punkt. Der PLAN steht
# in app/services/stress_test.py (reine Rechnung, ohne Bewegung); hier wird er
# nur abgefahren.

_stress_task: Optional[asyncio.Task] = None
_stress = {"running": False, "done": 0, "total": 0, "step": "",
           "error": None, "started_at": None, "include_printer": False}


def _stress_geometry() -> dict:
    return _farm.get("geometry") or _load_farm_geometry()


def _magazine_take(rack: int) -> None:
    """Zähler GENAU dieses Magazins um eins senken. Bewusst nicht
    _decrement_magazine(): das nimmt „das erste Regal mit Bestand" und würde beim
    Stresstest von der geplanten Reihenfolge abweichen können."""
    try:
        if not os.path.exists(SLOTS_PATH):
            return
        with open(SLOTS_PATH) as f:
            d = json.load(f)
        counts = d.get("magazine_counts") or []
        i = int(rack) - 1
        if 0 <= i < len(counts):
            d["magazine_counts"][i] = max(0, int(counts[i]) - 1)
            storage.write_json(SLOTS_PATH, d)
            _log(f"📦 Magazin R{rack}: {d['magazine_counts'][i]} Platten verbleibend")
    except Exception as e:
        logger.warning(f"stress magazine take failed: {e}")


def _stress_bambu(device_id=None) -> Device:
    """Bambu-Gerät für den Drucker-Umweg.

    EINE Quelle: gefahren werden die Positionen des Drucker-Blocks aus der
    Geometrie (`_farm_printer`) — also muss auch das Gerät DIESER Block bestimmen.
    Ein zweiter Weg („das erste Gerät in der Datenbank") könnte auf eine andere
    Maschine zeigen als die Koordinaten, und das ist ein Crash, kein
    Schönheitsfehler. Nur wenn der Block keinem Gerät zugeordnet ist, greift der
    Rückfall auf das einzige vorhandene."""
    db = SessionLocal()
    try:
        q = db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB)
        if device_id is None:
            block = _farm_printer(_stress_geometry()) or {}
            device_id = block.get("device_id")
        if device_id is not None:
            d = q.filter(Device.id == int(device_id)).first()
            if not d:
                raise HTTPException(
                    400, "Der Drucker aus der Geometrie ist nicht mehr eingerichtet — "
                         "bitte im Drucker-Tab zuordnen.")
            return d
        alle = q.all()
        if not alle:
            raise HTTPException(400, "Kein Bambu-Drucker eingerichtet — "
                                     "ohne Drucker geht der Umweg nicht.")
        if len(alle) > 1:
            raise HTTPException(
                400, "Mehrere Drucker eingerichtet, aber die Positionen im Drucker-Tab "
                     "sind keinem zugeordnet. Ohne Zuordnung wüsste der Test nicht, "
                     "welche Maschine zu den Koordinaten gehört.")
        return alle[0]
    finally:
        db.close()


async def _run_stress_test(moves: list, include_printer: bool = False,
                           device: Optional[Device] = None):
    """Jede Platte einzeln: aus dem Magazin greifen, hinfahren, ablegen, buchen.

    Nach JEDEM Schritt wird gebucht statt erst am Ende — bricht der Test ab
    (Stopp, Fehler, Stromausfall), stimmen Magazin-Bestand und Fach-Belegung
    trotzdem mit der Wirklichkeit überein. Sonst wüsste danach niemand, wo die
    Platten liegen.

    Mit `include_printer` macht jede Platte unterwegs den Umweg über den Drucker:
    auflegen, wieder herunternehmen, dann erst ins Fach. Das Bett fährt EINMAL zu
    Beginn auf Z200 und bleibt dort, eine Tür geht einmal auf und am Ende zu —
    pro Platte homen und Tür klappern wäre nur Verschleiß ohne Erkenntnis."""
    geom = _stress_geometry()
    printer = _farm_printer(geom)
    tuer = include_printer and _stress_service.has_door(geom, printer)
    tuer_offen = False        # nur schliessen, was wir auch geoeffnet haben
    umweg = _stress_service.printer_ops(geom, printer) if include_printer else ()
    _stress.update({"running": True, "done": 0, "total": len(moves), "error": None,
                    "step": "", "started_at": datetime.now().isoformat(),
                    "include_printer": bool(include_printer)})
    _log(f"🏋 Stresstest: {len(moves)} Platte(n) aus den Magazinen verteilen"
         + (" — mit Umweg über den Drucker" if include_printer else ""))
    try:
        if include_printer:
            # Erst das Bett auf Z200, DANN die Tür: solange das Bett fährt, hat der
            # Arm im Gehäuse nichts zu suchen.
            _stress["step"] = "Drucker auf Z200"
            _log("🏋 Drucker homen (G28 + Bett auf Z200)…")
            await _start_homing_print(device)
            await _wait_bambu_finish(device, label="Homing (G28+Z200)", timeout=300)
            if tuer:
                _stress["step"] = "Tür öffnen"
                await _do_macro(_motion.build_op(geom, "open_door", printer=printer))
                tuer_offen = True
        for i, m in enumerate(moves):
            if not _stress["running"]:
                _log("🏋 Stresstest abgebrochen")
                break
            _stress["step"] = f"{m['from']} → {m['to']}"
            _stress["done"] = i
            _log(f"🏋 {i + 1}/{len(moves)}: {m['from']} → {m['to']}")

            # Aus dem Stapel wird FLACH gegriffen (grab_magazine, ohne Anheben);
            # eine einzeln liegende Leerplatte dagegen normal.
            griff = "grab_magazine" if m.get("from_magazine") else "grab"
            await _do_macro(_motion.build_op(geom, griff, rack=m["from_rack"],
                                             slot=m["from_slot"], printer=printer))
            if m.get("from_magazine"):
                _magazine_take(m["from_rack"])
            else:
                _rack_update(m["from"], "free", empty_plate=False)
            _set_arm("full", m["from"])

            for op in umweg:
                _stress["step"] = f"{m['from']} → Drucker ({op})"
                _log(f"🏋 … {op} am Drucker")
                await _do_macro(_motion.build_op(geom, op, printer=printer))
                # Zwischen Auflegen und Herunternehmen liegt die Platte WIRKLICH auf
                # dem Bett — den Arm so lange als leer führen, sonst sucht eine
                # Bergung nach einer Platte, die nicht am Greifer hängt.
                _set_arm("none" if op in ("place", "load") else "full",
                         "" if op in ("place", "load") else m["from"])
            _stress["step"] = f"{m['from']} → {m['to']}"

            await _do_macro(_motion.build_op(geom, "store", rack=m["to_rack"],
                                             slot=m["to_slot"], printer=printer))
            # Im Fach liegt jetzt eine Platte — als belegt buchen, sonst plant die
            # Farm dort einen Druck hinein. „Stresstest" in der Notiz sagt, warum.
            _rack_update(m["to"], "done", file_name="Stresstest",
                         empty_plate=not _magazine_slot_cfg())
            _set_arm("none")
            _stress["done"] = i + 1
        else:
            _log("🏋 Stresstest abgeschlossen — Magazine leer, Platten verteilt")
    except Exception as e:
        _stress["error"] = str(e)
        _log(f"🏋 ⚠ Stresstest abgebrochen: {e}")
    finally:
        if tuer_offen:
            # Auch nach Abbruch oder Fehler: eine offene Tür ist ein offener Drucker.
            # Aber nur, wenn sie wirklich offen ist — „Tür zu" auf eine geschlossene
            # Tür zu fahren heisst, mit dem Arm dagegen zu druecken.
            try:
                _stress["step"] = "Tür schließen"
                await _do_macro(_motion.build_op(geom, "close_door", printer=printer))
            except Exception as e:
                _log(f"🏋 ⚠ Tür schließen fehlgeschlagen: {e}")
        _stress["running"] = False
        _stress["step"] = ""


def _stress_plan(seed=None, include_printer: bool = False) -> dict:
    geom = _stress_geometry()
    return _stress_service.plan(_rack_data(), geom, seed=seed,
                                printer=_farm_printer(geom),
                                include_printer=include_printer)


class StressStartBody(BaseModel):
    include_printer: bool = False
    device_id: Optional[int] = None


@router.get("/stress-test/plan")
async def stress_test_plan(include_printer: bool = False):
    """Vorschau: wie viele Platten, wohin, wie lange? Bewegt nichts.

    Die Ziele sind gewürfelt, die Vorschau zeigt also EINE mögliche Verteilung —
    gefahren wird die, die beim Start ausgewürfelt und zurückgegeben wird."""
    try:
        return {**_stress_plan(include_printer=include_printer),
                "running": _stress["running"]}
    except Exception as e:
        raise HTTPException(400, f"Stresstest-Plan nicht möglich: {e}")


@router.post("/stress-test")
async def start_stress_test(body: Optional[StressStartBody] = None):
    global _stress_task
    body = body or StressStartBody()
    if _farm["running"]:
        raise HTTPException(400, "Auto Farm läuft — Stresstest nicht möglich")
    if _test_running:
        raise HTTPException(409, "Test-Phase läuft bereits")
    if _stress["running"]:
        raise HTTPException(409, "Stresstest läuft bereits")
    # Gerät VOR dem Plan holen: fehlt der Drucker, soll der Test gar nicht erst
    # starten statt mitten im Lauf auf halber Strecke stehenzubleiben.
    device = _stress_bambu(body.device_id) if body.include_printer else None
    plan = _stress_plan(include_printer=body.include_printer)
    if not plan["plate_count"]:
        raise HTTPException(400, "Die Magazine sind leer — nichts zu verteilen.")
    if not plan["moves"]:
        raise HTTPException(400, "Kein freies Fach für die Platten — erst Fächer räumen.")
    _stress_task = asyncio.create_task(
        _run_stress_test(plan["moves"], body.include_printer, device))
    return {"success": True, **plan}


@router.post("/stress-test/stop")
async def stop_stress_test():
    """Anhalten. Die laufende Bewegung wird NICHT unterbrochen — sie zu Ende fahren
    zu lassen ist sicherer, als den Arm mit einer Platte im Griff stehen zu lassen."""
    _stress["running"] = False
    return {"success": True}


@router.get("/stress-test/status")
async def stress_test_status():
    return dict(_stress)


@router.post("/pause")
async def pause_farm():
    if not _farm["running"]:
        raise HTTPException(400, "Auto Farm läuft nicht")
    _farm["paused"] = not _farm["paused"]
    if _farm["paused"]:
        await _send_print_cmd("pause")     # X1C-Druck pausieren
    else:
        # Beim Fortsetzen den Fehler-Banner löschen — sonst bleibt z. B. eine
        # HMS-Meldung hängen, obwohl der Nutzer sie behoben hat und weiterläuft.
        _farm["error"] = None
        await _send_print_cmd("resume")    # X1C-Druck fortsetzen
    return {"success": True, "paused": _farm["paused"]}


def _printer_pool() -> list:
    """Drucker aus dem Layout mit allem, was die Verteilung braucht: Auslastung,
    freie Fächer in den zugeordneten Regalen, Bauraumhöhe aus dem Modell."""
    try:
        from app.routers.layout import load_layout
        from app.services import farm_layout, printer_models
    except Exception:
        return []
    lay = load_layout()
    if not lay.get("modules"):
        return []

    data = _rack_data()
    slots = data.get("slots") or {}
    reserved = _rack_logic.reserved_source_slots(data)
    taken = {j.get("slot") for j in _farm.get("jobs", [])
             if j.get("status") not in ("done", "error") and j.get("slot")}

    out = []
    for m in farm_layout.printers(lay):
        racks = farm_layout.racks_for_printer(lay, m["id"])
        legacy = {r.get("legacy_rack") for r in racks if r.get("legacy_rack")}
        free = 0
        for key, s in slots.items():
            try:
                r = int(str(key).split("-")[0])
            except (ValueError, IndexError):
                continue
            if legacy and r not in legacy:
                continue
            if s.get("status", "free") in ("free", "ready") and key not in reserved and key not in taken:
                free += 1
        cur = _farm.get("current_printer_module")
        out.append({
            "id": m["id"], "name": m["name"], "device_id": m.get("device_id"),
            "enabled": m.get("enabled", True), "online": True,
            "busy": bool(_farm.get("running")) and (cur is None or cur == m["id"]),
            "queue_len": len([j for j in _farm.get("jobs", [])
                              if j.get("status") == "pending"
                              and (j.get("printer") or m["id"]) == m["id"]]),
            "free_slots": free,
            "max_height_mm": None,   # Bauraumhöhe je Modell: noch nicht hinterlegt
            "model": m.get("model") or "",
            "racks": sorted(legacy),
        })
    return out


@router.get("/printers")
async def farm_printers():
    """Übersicht über die Drucker der Farm (Phase 4.7) — inkl. Arm-Status.
    Ohne Layout eine leere Liste: dann läuft alles wie bisher mit einem Drucker."""
    return {"printers": _printer_pool(), "arm": arm_status(),
            "current": _farm.get("current_printer_module")}


@router.post("/dispatch")
async def dispatch_queue(body: dict = None):
    """Warteschlange auf die Drucker verteilen (Vorschau oder übernehmen).

    Body: {apply?: bool} — ohne `apply` wird nur gezeigt, wer wohin ginge.
    Feste Zuweisungen des Nutzers bleiben unangetastet."""
    from app.services import job_dispatch
    body = body or {}
    pool = _printer_pool()
    if not pool:
        raise HTTPException(400, "Kein Farm-Layout eingerichtet — es gibt nur einen Drucker")

    jobs = [j for j in _farm.get("jobs", []) if j.get("status") == "pending"] \
        or _read_config(QUEUE_PATH, {"jobs": []}).get("jobs", [])
    plan = job_dispatch.distribute(pool, jobs)

    if body.get("apply"):
        by_id = {j.get("id"): j for j in jobs}
        for jid, pid in plan.items():
            if pid and jid in by_id:
                by_id[jid]["printer"] = pid
        if _farm.get("running"):
            for j in _farm.get("jobs", []):
                if j.get("id") in plan and plan[j["id"]]:
                    j["printer"] = plan[j["id"]]
        else:
            _write_config(QUEUE_PATH, {"jobs": jobs})
        _log(f"⇉ Warteschlange verteilt: {len([p for p in plan.values() if p])} Job(s) zugewiesen")

    return {
        "success": True,
        "plan": [{"job_id": jid, "printer": pid} for jid, pid in plan.items()],
        "printers": pool,
        "unassigned": [jid for jid, pid in plan.items() if not pid],
        "applied": bool(body.get("apply")),
    }


@router.get("/recovery")
async def get_recovery():
    """Wurde ein Lauf durch einen Neustart unterbrochen? (Phase 3.1)

    Bewusst NUR eine Meldung, kein automatisches Weiterfahren: der Arm steht an
    unbekannter Stelle und hält womöglich eine Platte. Das muss ein Mensch ansehen."""
    rec = _farm.get("recovery")
    if not rec:
        return {"pending": False}
    arm = rec.get("arm") or {}
    holding = arm.get("holding", "none")
    hint = {
        "empty":   "Im Greifer hängt eine LEERE Platte" + (f" (aus Fach {arm.get('from')})" if arm.get("from") else ""),
        "printed": "Im Greifer hängt eine Platte mit einem FERTIGEN Druck",
    }.get(holding, "Der Greifer war leer")
    return {
        "pending": True,
        "job": rec.get("job_name") or "",
        "slot": rec.get("slot") or "",
        "step": rec.get("step_label") or "",
        "step_idx": rec.get("step_idx"),
        "step_total": rec.get("step_total"),
        "arm": arm,
        "arm_hint": hint,
        "saved_at": rec.get("saved_at"),
        "advice": ("Erst nachsehen: Steht eine Platte im Greifer oder im Drucker? "
                   "Danach hier bestätigen — die Farm referenziert vor der nächsten "
                   "Bewegung selbst."),
    }


@router.post("/recovery/dismiss")
async def dismiss_recovery(body: dict = None):
    """Unterbrochenen Lauf quittieren. `arm_cleared` = der Greifer ist wieder leer
    (der Nutzer hat die Platte abgenommen)."""
    body = body or {}
    _farm["recovery"] = None
    if body.get("arm_cleared", True):
        _farm["arm"] = dict(_ARM_EMPTY)
    # Position gilt nach einem Abbruch immer als unbekannt → vor der nächsten
    # Bewegung wird referenziert.
    _farm["needs_home"] = True
    _clear_state()
    _log("↩ Unterbrochener Lauf quittiert — vor der nächsten Bewegung wird referenziert.")
    return {"success": True}


@router.get("/hms-history")
async def get_hms_history(limit: int = 100):
    """Aufgetretene Drucker-Fehler mit Zeitstempel (neueste zuerst)."""
    items = storage.read_json(HMS_PATH, [])
    if not isinstance(items, list):
        items = []
    return {"items": items[:max(1, min(HMS_MAX, limit))], "total": len(items)}


@router.delete("/hms-history")
async def clear_hms_history():
    storage.write_json(HMS_PATH, [])
    return {"success": True}


@router.post("/dry-run")
async def dry_run(payload: dict = None):
    """Trockenlauf: die Sequenz durchspielen, OHNE etwas zu senden.

    Zeigt Schritt für Schritt, was passieren WÜRDE — welches Macro, welcher
    Printloom-G-code, welches Regal/Fach, und ob eine Bewegung aus der Achse fahren
    würde. Gedacht als letzter Blick vor dem ersten echten Lauf: bisher musste man
    den Arm dafür wirklich losschicken.

    Body: {which?: "seq_new"|"seq_next"|"both", height_mm?: Objekthöhe für die
           Fachwahl (Standard 40)}
    """
    payload = payload or {}
    which = str(payload.get("which") or "both")
    try:
        height = max(0.0, float(payload.get("height_mm", 40)))
    except (TypeError, ValueError):
        height = 40.0

    seq_data = _read_config(SEQ_PATH, {"seq_new": [], "seq_next": []})
    geom = _load_farm_geometry()
    rack_data = _rack_data()
    check = _geometry_check.check_geometry(geom)

    # Simulierte Ausgangslage: Fach für die Objekthöhe + Quelle der leeren Platte.
    target_slot = _find_slot_for_height(height) or ""
    rack_num, slot_num = _slot_vars(target_slot or "1-1")
    src_rack, src_slot, from_mag = _rack_logic.plate_source(rack_data)
    stack_rack, stack_slot = str(src_rack), str(src_slot)
    plates = _rack_logic.empty_plate_count(rack_data)

    def _walk(steps: list, name: str) -> list:
        out = []
        for i, step in enumerate(_filter_disabled(steps or [])):
            t = step.get("type", "")
            raw = (step.get("value") or "")
            val = (raw.replace("{rack}", rack_num).replace("{slot}", slot_num)
                      .replace("{stack_rack}", stack_rack).replace("{stack_slot}", stack_slot))
            # target_rack/target_slot getrennt mitliefern: die Oberfläche baut daraus
            # den Text in der eingestellten Sprache. `target`/`note` bleiben als
            # fertiger deutscher Text für Logs und ältere Clients.
            entry = {"seq": name, "index": i, "type": t,
                     "label": step.get("label") or val[:60], "value": val,
                     "target": "", "target_rack": None, "target_slot": None,
                     "script": "", "problems": [], "note": ""}

            op, rack, slot = None, 1, 1
            if t == "app_op":
                op = (val or "").strip().lower()
                if op in ("grab", "grab_magazine"):
                    rack, slot = src_rack, src_slot
                    # Ohne Magazin wird der Magazin-Griff zum normalen Fach-Griff.
                    if op == "grab_magazine" and _magazine_slot_cfg() <= 0:
                        op = "grab"
                        entry["note"] = "kein Magazin — greift aus dem Lagerfach"   # tr-Schlüssel
                elif op == "store":
                    rack, slot = int(rack_num), int(slot_num)
            elif t == "macro":
                mapped = _macro_to_op(val, rack_num, slot_num, stack_rack, stack_slot)
                if mapped and _motion.op_uses_gcode(geom, mapped[0], _farm_printer(geom)):
                    op, rack, slot = mapped
                    entry["note"] = "läuft als Printloom-G-code (use_gcode)"
                elif mapped:
                    entry["note"] = "Geräte-Macro (Printloom-G-code nicht aktiviert)"

            if op:
                if op in ("grab", "grab_magazine", "store", "approach"):
                    entry["target"] = f"R{rack} Fach {slot}"
                    entry["target_rack"], entry["target_slot"] = rack, slot
                try:
                    pid = _farm_printer(geom)
                    entry["script"] = _motion.build_op(geom, op, rack=rack, slot=slot,
                                                       check=False, printer=pid)
                    entry["problems"] = _geometry_check.check_script(
                        entry["script"], geom, op, rack, slot, pid)
                except ValueError as e:
                    entry["problems"] = [{"severity": "error", "message": str(e)}]
            elif t == "delay":
                entry["target"] = f"{step.get('seconds', 0)} s"
            out.append(entry)
        return out

    steps = []
    if which in ("seq_new", "both"):
        steps += _walk(seq_data.get("seq_new"), "seq_new")
    if which in ("seq_next", "both"):
        steps += _walk(seq_data.get("seq_next"), "seq_next")

    problems = [p for s in steps for p in s["problems"]]
    # Warnungen als Vorlage + Werte (siehe geometry_check.problem) — sonst blieben
    # sie in jeder Sprache deutsch.
    warnings = []
    if not target_slot:
        warnings.append(_geometry_check.problem(
            "no_free_slot", "warning",
            "Kein freies Fach für ein {0} mm hohes Objekt — die Farm würde hier nach der "
            "eingestellten Fehlerstrategie reagieren.", [f"{height:.0f}"]))
    if plates <= 0:
        warnings.append(_geometry_check.problem(
            "no_plates", "warning",
            "Keine leeren Platten gemeldet — der Griff würde ins Magazin-Gate laufen "
            "(parken + pausieren)."))
    if not steps:
        warnings.append(_geometry_check.problem(
            "no_steps", "warning", "Keine aktiven Schritte in der Sequenz."))

    return {
        "success": True,
        "steps": steps,
        "start": {"target_slot": target_slot, "source": f"R{src_rack} Fach {src_slot}",
                  "source_rack": src_rack, "source_slot": src_slot,
                  "from_magazine": from_mag, "plates_available": plates,
                  "height_mm": height},
        "geometry_check": check,
        "warnings": warnings,
        "errors": [p for p in problems if p.get("severity") == "error"],
    }


@router.get("/sequences")
async def get_sequences():
    data = _read_config(SEQ_PATH, {})
    # Schema version mismatch → return empty so frontend resets to new defaults
    if data.get("schema_version") != SEQ_SCHEMA_VERSION:
        return {"seq_new": [], "seq_next": []}
    return data

@router.put("/sequences")
async def save_sequences(payload: SequencesPayload):
    data = payload.model_dump()
    data["schema_version"] = SEQ_SCHEMA_VERSION
    _write_config(SEQ_PATH, data)
    return {"success": True}

@router.get("/settings")
async def get_settings():
    s = _read_config(SETTINGS_PATH, _DEFAULT_SETTINGS)
    # Immer einen normalisierten 7-Tage-Plan mitliefern (migriert alte Configs),
    # damit das Frontend nicht selbst migrieren muss.
    s["operating_schedule"] = _operating_schedule(s)
    return s

@router.put("/settings")
async def save_settings(payload: SettingsPayload):
    # Merge statt Überschreiben: nur die tatsächlich gesendeten Felder ändern,
    # der Rest bleibt erhalten. Sonst setzt das Speichern eines Teilbereichs
    # (z. B. Farm-Einstellungen) die anderen (Preise, Fehlerstrategie,
    # Betriebszeiten) auf Default zurück.
    current = _read_config(SETTINGS_PATH, dict(_DEFAULT_SETTINGS))
    current.update(payload.model_dump(exclude_unset=True))
    _write_config(SETTINGS_PATH, current)
    return {"success": True}

@router.get("/queue")
async def get_queue():
    # Return live in-memory state when running so _id in frontend stays ahead of all known IDs
    if _farm["running"] and _farm.get("jobs"):
        return _farm["jobs"]
    data = _read_config(QUEUE_PATH, {"jobs": []})
    return data.get("jobs", [])

@router.put("/queue")
async def save_queue(payload: QueuePayload):
    _write_config(QUEUE_PATH, payload.model_dump())
    return {"success": True}


@router.post("/homing_file/setup")
async def setup_homing_file():
    """Generate the homing .3mf and store it in /app/db/ (not visible in file library)."""
    data = _build_homing_3mf()
    with open(HOMING_3MF_PATH, "wb") as f:
        f.write(data)
    logger.info(f"[AutoFarm] Homing-Datei erstellt: {HOMING_3MF_PATH}")
    return {"success": True, "filename": "Printloom Homing.3mf"}


@router.get("/homing_file/info")
async def get_homing_file_info():
    configured = os.path.exists(HOMING_3MF_PATH)
    return {"configured": configured, "filename": "Printloom Homing.3mf" if configured else None}


@router.post("/clear_log")
async def clear_log():
    _farm["log"] = []
    return {"success": True}


@router.get("/log/download")
async def download_log():
    """Download persisted log file as text."""
    from fastapi.responses import FileResponse, PlainTextResponse
    if not os.path.exists(LOG_PATH):
        return PlainTextResponse("Kein Log vorhanden.\n", media_type="text/plain")
    return FileResponse(LOG_PATH, filename="printloom_log.txt", media_type="text/plain")


@router.delete("/log/file")
async def clear_log_file():
    """Delete the persisted log file."""
    try:
        if os.path.exists(LOG_PATH):
            os.remove(LOG_PATH)
    except Exception:
        pass
    return {"success": True}


@router.get("/file_filaments/{file_id}")
async def get_file_filaments(file_id: int, plate: Optional[int] = None):
    """Return the filament types and colors a print USES — immer aus der Datei
    gelesen (Material+Farbe), plattengenau bei Multi-Plate-.3mf."""
    db = SessionLocal()
    try:
        f = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
        if not f:
            raise HTTPException(404, "Datei nicht gefunden")
        if not os.path.exists(f.file_path):
            raise HTTPException(404, "Datei nicht auf Disk")
        types, colors = _read_filament_info(f.file_path, f.file_type, plate)
        return {"filaments": [{"type": t, "color": c} for t, c in zip(types, colors)],
                "ams_map": _file_ams_map(file_id)}
    finally:
        db.close()


class FileAmsPayload(BaseModel):
    ams_map: str = ""   # "gid,gid" je Datei-Filament; leer = wieder Auto


@router.put("/file_ams/{file_id}")
async def set_file_ams(file_id: int, payload: FileAmsPayload):
    """Pro Datei manuell gewählte AMS-Slots speichern (im Datei-Browser). Wird beim
    Druck verwendet; leer = wieder automatisches Matching (material-/farbgenau)."""
    _save_file_ams_map(file_id, payload.ams_map)
    return {"success": True, "ams_map": _file_ams_map(file_id)}


@router.get("/stats")
async def get_stats():
    return _read_stats()


@router.delete("/stats")
async def reset_stats():
    try:
        if os.path.exists(STATS_PATH):
            os.remove(STATS_PATH)
    except Exception:
        pass
    return {"success": True}


@router.get("/history")
async def get_history():
    """Per-file measured durations (avg of recent real runs) for the history-based
    ETA. Keyed by file id: { "<id>": {"avg_min": x, "n": k, "samples": [...]} }."""
    return _read_history()


@router.get("/timeline")
async def get_timeline(hours: int = 24):
    """Recent printer-utilization events for the usage timeline (default last 24h)."""
    events = storage.read_json(TIMELINE_PATH, [])
    cutoff = datetime.now() - timedelta(hours=max(1, hours))
    recent = []
    for e in events:
        try:
            if datetime.fromisoformat(e["ts"]) >= cutoff:
                recent.append(e)
        except (KeyError, ValueError):
            continue
    return {"events": recent, "now": datetime.now().isoformat(), "hours": hours}


@router.delete("/timeline")
async def reset_timeline():
    try:
        if os.path.exists(TIMELINE_PATH):
            os.remove(TIMELINE_PATH)
    except Exception:
        pass
    return {"success": True}


@router.get("/completed")
async def get_completed(limit: int = 500):
    """Historie abgeschlossener Druck-Jobs (neueste zuerst): Modell, Platte, Fach,
    Datum, Anfangs-/End-Uhrzeit, Dauer, Status (done/error/ejected)."""
    items = storage.read_json(COMPLETED_PATH, [])
    if not isinstance(items, list):
        items = []
    return {"items": items[:max(1, min(limit, COMPLETED_MAX))], "total": len(items)}


@router.delete("/completed")
async def clear_completed():
    try:
        if os.path.exists(COMPLETED_PATH):
            os.remove(COMPLETED_PATH)
    except Exception:
        pass
    return {"success": True}
