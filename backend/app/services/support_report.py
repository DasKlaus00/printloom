"""Support-Bericht: EINE englische Textdatei zum Verschicken (seit v1.1.90).

Aufbau (für Menschen und für Claude, der ihn auswertet):
  1. Findings  — automatische Prüfungen mit Stufe (ERROR/WARNING/INFO)
  2. Problems  — Fehler und Warnungen aus dem Log, gruppiert, mit erstem/letztem
                 Auftreten, Anzahl und Ausnahme; dazu die letzten Tracebacks
  3. Environment, 4. Devices (mit Steckbrief je Gerät, live abgefragt), 5. Farm
  6. Log       — die jüngsten Zeilen des Support-Logs

Der Steckbrief ist für neue Drucker gedacht: Was meldet das Gerät (Moonraker-Objekte,
Versionen, Kameras; beim Bambu die Felder des Telegramms)? Damit lässt sich ein Modell
einbauen, ohne dass jemand vor Ort danebensteht.

Nichts geht von selbst irgendwohin: Der Nutzer lädt die Datei herunter. Geheimnisse,
Adressen und Seriennummern behandelt support_log.clean() wie im Log selbst.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import shutil
import sys
import time
from datetime import datetime, timezone

import httpx

from app import paths
from app.services import support_log

logger = logging.getLogger(__name__)

LOG_TAIL_BYTES = 3_000_000       # so viel Log hängt an (die jüngsten Zeilen)
PROBE_TIMEOUT_S = 4.0
RESTARTS_WARN = 3                # mehr Starts in 24 h → Hinweis auf Absturzschleife
DISK_WARN_BYTES = 1_000_000_000
TRACEBACKS_SHOWN = 5
FARM_LOG_SHOWN = 40

# Werte aus dem Bambu-Telegramm, die im Steckbrief mit Inhalt stehen (sonst nur der Name).
BAMBU_VALUE_KEYS = ("gcode_state", "mc_print_stage", "stg_cur", "print_error", "mc_percent",
                    "mc_remaining_time", "layer_num", "total_layer_num", "subtask_name",
                    "nozzle_diameter", "nozzle_type", "nozzle_temper", "nozzle_target_temper",
                    "bed_temper", "bed_target_temper", "chamber_temper", "home_flag", "sdcard",
                    "wifi_signal", "spd_lvl", "print_type", "lifecycle", "fail_reason")


# ── Hilfen ───────────────────────────────────────────────────────────────────
def _now_stamp() -> str:
    return support_log.stamp(time.time())


def _dur(seconds: float) -> str:
    s = int(max(0, seconds))
    d, s = divmod(s, 86400)
    h, s = divmod(s, 3600)
    m, s = divmod(s, 60)
    return (f"{d}d " if d else "") + f"{h}h {m:02d}m {s:02d}s"


def _type(d) -> str:
    return str(getattr(d.device_type, "value", d.device_type))


def _short(value, n: int = 300) -> str:
    s = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str)
    return s if len(s) <= n else s[:n] + f"… (+{len(s) - n} chars)"


class Finding:
    ORDER = {"ERROR": 0, "WARNING": 1, "INFO": 2}

    def __init__(self, level: str, text: str):
        self.level, self.text = level, text

    def line(self) -> str:
        return f"  [{self.level:<7}] {self.text}"


# ── Geräte live abfragen (Steckbrief) ────────────────────────────────────────
async def _moon_get(client: httpx.AsyncClient, base: str, path: str, hdr: dict) -> dict:
    """GET auf Moonraker → {"ok", "ms", "result"| "error"}; wirft nie."""
    t0 = time.monotonic()
    try:
        r = await client.get(base + path, headers=hdr)
        ms = round((time.monotonic() - t0) * 1000)
        if r.status_code != 200:
            return {"ok": False, "ms": ms, "error": f"HTTP {r.status_code}: {r.text[:200]}"}
        return {"ok": True, "ms": ms, "result": (r.json() or {}).get("result")}
    except (httpx.HTTPError, ValueError) as e:
        return {"ok": False, "ms": round((time.monotonic() - t0) * 1000),
                "error": support_log.exc_text(e)}


async def _probe_moonraker(base: str, hdr: dict) -> dict:
    """Was ein Klipper/Moonraker-Gerät über sich sagt (Drucker oder OTTOeject)."""
    async with httpx.AsyncClient(timeout=PROBE_TIMEOUT_S) as c:
        info, server, objs, cams, toolhead = await asyncio.gather(
            _moon_get(c, base, "/printer/info", hdr), _moon_get(c, base, "/server/info", hdr),
            _moon_get(c, base, "/printer/objects/list", hdr),
            _moon_get(c, base, "/server/webcams/list", hdr),
            _moon_get(c, base, "/printer/objects/query?toolhead=homed_axes,position,axis_minimum,"
                               "axis_maximum&webhooks&print_stats&idle_timeout", hdr))
    return {"printer_info": info, "server_info": server, "objects": objs, "webcams": cams,
            "query": toolhead}


def _fmt_moon_probe(p: dict) -> list:
    out = []
    info = p["printer_info"]
    if not info["ok"]:
        return [f"    reachable: NO — {info['error']} ({info['ms']} ms)"]
    r = info.get("result") or {}
    out.append(f"    reachable: yes ({info['ms']} ms) · klippy state {r.get('state')!r}"
               + (f" — {r.get('state_message')!r}" if r.get("state") != "ready" else ""))
    out.append(f"    klipper version: {r.get('software_version')} · cpu: {r.get('cpu_info')}")
    s = p["server_info"]
    if s["ok"]:
        sr = s.get("result") or {}
        out.append(f"    moonraker version: {sr.get('moonraker_version')} · api {sr.get('api_version_string')}"
                   f" · klippy_connected {sr.get('klippy_connected')}")
        if sr.get("failed_components"):
            out.append(f"    moonraker failed components: {sr.get('failed_components')}")
        if sr.get("warnings"):
            out.append(f"    moonraker warnings: {_short(sr.get('warnings'), 600)}")
        out.append(f"    moonraker components: {', '.join(sr.get('components') or [])}")
    else:
        out.append(f"    /server/info: {s['error']}")
    o = p["objects"]
    if o["ok"]:
        names = (o.get("result") or {}).get("objects") or []
        out.append(f"    klipper objects ({len(names)}): {', '.join(names)}")
    else:
        out.append(f"    /printer/objects/list: {o['error']}")
    w = p["webcams"]
    if w["ok"]:
        cams = (w.get("result") or {}).get("webcams") or []
        for cam in cams:
            out.append(f"    webcam {cam.get('name')!r}: service {cam.get('service')}, enabled "
                       f"{cam.get('enabled')}, location {cam.get('location')}, stream {cam.get('stream_url')}, "
                       f"snapshot {cam.get('snapshot_url')}")
        if not cams:
            out.append("    webcams: none reported")
    q = p["query"]
    if q["ok"]:
        st = (q.get("result") or {}).get("status") or {}
        out.append(f"    live: {_short(st, 900)}")
    return out


def _probe_bambu(device) -> list:
    """Bambu: Verbindung über bambu_manager (persistent), dann das letzte Telegramm."""
    from app.services import bambu_manager
    out = []
    try:
        ok = bambu_manager.ensure(device, wait_timeout=3.0)
    except Exception as e:                      # Bericht darf an einem Gerät nicht scheitern
        return [f"    MQTT: error while connecting — {type(e).__name__}: {e}"]
    age = bambu_manager.status_age(device)
    out.append(f"    MQTT connected: {ok} · last message {'never' if age is None else f'{age:.1f} s ago'}")
    raw = bambu_manager.last_status(device) or {}
    p = raw.get("print") if isinstance(raw, dict) else None
    if not isinstance(p, dict):
        out.append("    no status telegram received yet")
        return out
    out.append("    values: " + ", ".join(f"{k}={p.get(k)!r}" for k in BAMBU_VALUE_KEYS if k in p))
    hms = p.get("hms") or []
    out.append(f"    hms: {_short(hms, 600) if hms else 'none'}")
    ams = (p.get("ams") or {}).get("ams") if isinstance(p.get("ams"), dict) else None
    if ams:
        trays = sum(len(u.get("tray") or []) for u in ams if isinstance(u, dict))
        out.append(f"    ams: {len(ams)} unit(s), {trays} tray(s), tray_now {(p.get('ams') or {}).get('tray_now')}")
    else:
        out.append("    ams: none reported")
    for k in ("upgrade_state", "ipcam", "lights_report", "xcam", "net"):
        if k in p:
            out.append(f"    {k}: {_short(p.get(k), 400)}")
    out.append(f"    telegram keys ({len(p)}): {', '.join(sorted(p))}")
    others = sorted(k for k in raw if k != "print") if isinstance(raw, dict) else []
    if others:
        out.append(f"    other top-level keys: {', '.join(others)}")
    return out


async def _device_section(devices: list, farm_id) -> tuple:
    """→ (Zeilen, Befunde) für alle Geräte; Abfragen laufen parallel."""
    from app.models.models import PrinterType
    from app.services import moonraker_printer, printer_models
    lines, findings = [], []
    loop = asyncio.get_running_loop()

    async def one(d):
        t = _type(d)
        head = [f"  [{d.id}] {d.name!r} — type {t}, model {d.model or 'not set'}"
                f" ({(printer_models.by_id(d.model) or {}).get('label') or '—'}),"
                f" address {d.ip_address}:{d.port}, active {d.is_active}"
                + (" · FARM PRINTER" if d.id == farm_id else ""),
                f"    access code set: {bool(d.access_code)} · serial set: {bool(d.serial_number)}"
                f" · tls {d.use_tls} · mqtt port {d.mqtt_port}"]
        try:
            if d.device_type == PrinterType.MOONRAKER:
                p = await _probe_moonraker(moonraker_printer.base_url(d), moonraker_printer.headers(d))
                return d, head + _fmt_moon_probe(p), p
            if d.device_type == PrinterType.KLIPPER:
                p = await _probe_moonraker(f"http://{d.ip_address}:{d.port}", {})
                return d, head + _fmt_moon_probe(p), p
            if d.device_type == PrinterType.BAMBU_LAB:
                return d, head + await loop.run_in_executor(None, _probe_bambu, d), None
        except Exception as e:                  # ein Gerät darf den Bericht nicht kippen
            logger.warning(f"Support report: probe of device {d.id} failed: {type(e).__name__}: {e}")
            return d, head + [f"    probe failed: {type(e).__name__}: {e}"], None
        return d, head + ["    (no live probe for this device type)"], None

    results = await asyncio.gather(*(one(d) for d in devices))
    for d, rows, probe in results:
        lines += rows + [""]
        if probe is not None:
            info = probe["printer_info"]
            what = "OTTOeject" if _type(d) == "klipper" else f"Printer {d.name!r}"
            if not info["ok"]:
                findings.append(Finding("ERROR", f"{what} not reachable: {info['error']}"))
            else:
                st = (info.get("result") or {}).get("state")
                if st != "ready":
                    findings.append(Finding("ERROR", f"{what}: Klipper is {st!r} — "
                                                     f"{(info.get('result') or {}).get('state_message')!r}"))
        elif _type(d) == "bambu_lab":
            if any("MQTT connected: False" in r for r in rows):
                findings.append(Finding("ERROR", f"Printer {d.name!r}: no MQTT connection (LAN mode, "
                                                 f"access code, network?)"))
            err = next((r for r in rows if "print_error=" in r), "")
            if "print_error=0" not in err and "print_error=" in err:
                findings.append(Finding("WARNING", f"Printer {d.name!r} reports a print error — see devices"))
    return lines, findings


# ── Farm ─────────────────────────────────────────────────────────────────────
def _farm_section(db, devices: list) -> tuple:
    from app.routers import autofarm as af, control
    from app.services import ottoeject_motion as motion
    lines, findings = [], []
    f = af._farm
    jobs = f.get("jobs") or []
    by_status: dict = {}
    for j in jobs:
        by_status[j.get("status")] = by_status.get(j.get("status"), 0) + 1
    lines.append(f"  running {f.get('running')} · paused {f.get('paused')} · stopping {f.get('stopping')}"
                 f" · stress test {af._stress.get('running')}")
    lines.append(f"  current step: {f.get('seq_step_label')!r} ({f.get('seq_step_idx')}/{f.get('seq_step_total')})"
                 f" · current job id {f.get('current_job_id')}")
    lines.append(f"  error: {f.get('error')!r}")
    lines.append(f"  queue: {len(jobs)} job(s) {by_status}")
    for k in ("arm", "bed", "needs_home", "recovery", "idle", "bambu_id", "stop_reason"):
        if k in f:
            lines.append(f"  {k}: {f.get(k)!r}")
    # Gespeicherte Werte, nicht _estrat(): das würde für alte Werte selbst ins Farm-Log schreiben.
    stored = f.get("error_strategy") or {}
    lines.append("  error strategies: " + ", ".join(
        f"{k}={stored.get(k) or v}" for k, v in af._ERROR_DEFAULTS.items()))
    if f.get("error"):
        findings.append(Finding("WARNING", f"Farm reports an error: {f.get('error')!r}"))
    if f.get("paused"):
        findings.append(Finding("WARNING", "Farm is paused"))
    try:
        if control.notaus_aktiv(db):
            findings.append(Finding("WARNING", "Emergency stop is active — no movement until "
                                               "\"Resume operation\" (Control page)"))
            lines.append("  emergency stop: ACTIVE")
        else:
            lines.append("  emergency stop: not active")
    except Exception as e:
        lines.append(f"  emergency stop: not readable ({type(e).__name__}: {e})")
    farm_id = None
    try:
        farm_id = af.farm_printer_id()
        dev = next((d for d in devices if d.id == farm_id), None) or af.farm_device(db)
        if dev is None:
            findings.append(Finding("ERROR", "No farm printer: no Bambu Lab or Snapmaker U1 printer is set up"))
        else:
            farm_id = dev.id
            lines.append(f"  farm printer: [{dev.id}] {dev.name!r} ({_type(dev)}, model {dev.model})")
            geom = af._load_farm_geometry()
            blocks = motion.printer_list(geom) or []
            blk = next((b for b in blocks if b.get("device_id") == dev.id), None)
            lines.append(f"  printer blocks in geometry: {len(blocks)} · block for the farm printer: "
                         f"{'yes' if blk else 'no (first block is used)'}")
            if _type(dev) == "moonraker":
                ok = bool(blk) and blk.get("confirmed_for") == dev.id
                lines.append(f"  U1 positions confirmed (\"Measured and tested\"): {ok}")
                if not ok:
                    findings.append(Finding("WARNING", f"Farm printer {dev.name!r} (Snapmaker U1): positions "
                                                       "not confirmed — the farm will not start. Printer tab → "
                                                       "measure, test, \"Measured and tested\"."))
    except Exception as e:
        lines.append(f"  farm printer: not determinable ({type(e).__name__}: {e})")
    tail = (f.get("log_en") or [])[:FARM_LOG_SHOWN]
    if tail:
        lines.append(f"  last {len(tail)} farm log lines (newest first):")
        lines += [f"    {ln}" for ln in tail]
    return lines, findings, farm_id


# ── Umgebung ─────────────────────────────────────────────────────────────────
def _environment(version: str) -> tuple:
    from app.services import appsettings, online
    lines, findings = [], []
    lines.append(f"  version {version} · update channel {appsettings.read_update_channel()} · runtime {paths.RUNTIME}")
    lines.append(f"  python {platform.python_version()} ({sys.platform}) · {platform.system()} "
                 f"{platform.release()} · {platform.machine()} · pid {os.getpid()}")
    dt = datetime.now().astimezone()
    # Ohne tzname(): Windows nennt ihn in der Sprache des Systems („Mitteleuropäische Zeit").
    lines.append(f"  clock: {dt:%Y-%m-%d %H:%M:%S} (UTC{dt:%z}) · "
                 f"UTC {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}Z")
    if dt.year < 2025:
        findings.append(Finding("WARNING", f"System clock looks wrong ({dt:%Y-%m-%d}) — timestamps, TLS and "
                                           "schedules depend on it"))
    try:
        from app.routers import autofarm as af
        lines.append(f"  farm time zone setting: {af._user_tz() or 'server time'}")
    except Exception as e:
        lines.append(f"  farm time zone setting: not readable ({type(e).__name__})")
    try:
        du = shutil.disk_usage(paths.DATA_ROOT)
        lines.append(f"  data folder: {paths.DATA_ROOT} · free {du.free / 1e9:.1f} GB of {du.total / 1e9:.1f} GB")
        if du.free < DISK_WARN_BYTES:
            findings.append(Finding("WARNING", f"Only {du.free / 1e9:.2f} GB free in the data folder"))
    except OSError as e:
        lines.append(f"  data folder: {paths.DATA_ROOT} (disk usage not readable: {e})")
    lines.append(f"  camera globally disabled: {appsettings.camera_disabled()}")
    lines.append(f"  online services: {online.read_settings()}")
    lines.append(f"  PRINTLOOM_ALLOWED_HOSTS set: {bool(os.environ.get('PRINTLOOM_ALLOWED_HOSTS'))}")
    if not support_log.log_path().exists():
        findings.append(Finding("WARNING", "Support log file does not exist — logging into the data folder failed"))
    try:
        from app.routers import system
        broken = [f for f in system._data_files_states() if f["broken"]]
        for b in broken:
            findings.append(Finding("ERROR", f"Data file {b['file']} is unreadable ({b['reason']}) — "
                                             "System → Data storage"))
        lines.append(f"  unreadable data files: {len(broken)}")
    except Exception as e:
        lines.append(f"  data files: not checked ({type(e).__name__}: {e})")
    return lines, findings


# ── Log-Auswertung ───────────────────────────────────────────────────────────
def _problems(analysis: dict, entries: list) -> tuple:
    lines, findings = [], []
    lv = analysis["levels"]
    lines.append("  levels: " + " · ".join(f"{k} {v}" for k, v in sorted(lv.items())))
    lines.append(f"  log covers: {analysis['first']} → {analysis['last']}")
    if analysis["components"]:
        lines.append("  warnings/errors by component: " + ", ".join(
            f"{k} {v}" for k, v in sorted(analysis["components"].items(), key=lambda kv: -kv[1])))
    lines.append(f"  app starts in the log: {len(analysis['starts'])}"
                 + (f" (last {analysis['starts'][-1]})" if analysis["starts"] else ""))
    recent = [s for s in analysis["starts"] if _age_s(s) is not None and _age_s(s) < 86400]
    if len(recent) > RESTARTS_WARN:
        findings.append(Finding("WARNING", f"App started {len(recent)} times in the last 24 h — "
                                           "possible crash loop or update loop"))
    if analysis["crashes"]:
        findings.append(Finding("ERROR", f"{len(analysis['crashes'])} crash(es) / critical error(s) in the log "
                                         "— see PROBLEMS"))
    lines.append("")
    if not analysis["groups"]:
        lines.append("  no warnings or errors in the log")
    for g in analysis["groups"][:60]:
        lines.append(f"  [{g['level']}] ×{g['count']} {g['comp']}: {g['pattern']}")
        lines.append(f"      first {g['first']} · last {g['last']}")
        if g["count"] > 1 or g["pattern"] != g["example"]:
            lines.append(f"      latest: {_short(g['example'], 400)}")
        if g["exception"]:
            lines.append(f"      exception: {g['exception'].strip()}")
    if len(analysis["groups"]) > 60:
        lines.append(f"  … {len(analysis['groups']) - 60} more groups")
    tbs = [e for e in entries if e["tb"]][-TRACEBACKS_SHOWN:]
    if tbs:
        lines += ["", f"  last {len(tbs)} tracebacks:"]
        for e in tbs:
            lines.append(f"  --- {e['ts']} {e['level']} {e['comp']} [{e['thread']}]: {e['msg']}")
            lines += [f"      {t}" for t in e["tb"]]
    return lines, findings


def _age_s(ts: str):
    try:
        dt = datetime.strptime(ts, "%Y-%m-%d %H:%M:%S.%f %z")
    except ValueError:
        return None
    return (datetime.now(timezone.utc) - dt).total_seconds()


# ── Zusammenbauen ────────────────────────────────────────────────────────────
async def build(db, version: str) -> str:
    """Der ganze Bericht als Text. Wirft nicht: Was scheitert, steht als Zeile drin."""
    from app.models.models import Device
    t0 = time.monotonic()
    findings: list = []
    sections: list = []

    devices = db.query(Device).order_by(Device.id).all()
    for d in devices:
        support_log.hide_device(d)

    def guarded(title, fn):
        try:
            lines, found = fn()
            findings.extend(found)
            sections.append((title, lines))
        except Exception as e:
            logger.warning(f"Support report: section {title!r} failed: {type(e).__name__}: {e}", exc_info=True)
            sections.append((title, [f"  section failed: {type(e).__name__}: {e}"]))

    guarded("ENVIRONMENT", lambda: _environment(version))
    farm_id = None
    try:
        farm_lines, farm_found, farm_id = _farm_section(db, devices)
        findings.extend(farm_found)
    except Exception as e:
        logger.warning(f"Support report: farm section failed: {type(e).__name__}: {e}", exc_info=True)
        farm_lines = [f"  section failed: {type(e).__name__}: {e}"]
    if not any(_type(d) == "klipper" for d in devices):
        findings.append(Finding("WARNING", "No OTTOeject (Klipper) configured — the farm cannot move plates"))
    try:
        dev_lines, dev_found = await _device_section(devices, farm_id)
        findings.extend(dev_found)
    except Exception as e:
        logger.warning(f"Support report: device section failed: {type(e).__name__}: {e}", exc_info=True)
        dev_lines = [f"  section failed: {type(e).__name__}: {e}"]
    sections.append((f"DEVICES ({len(devices)})", dev_lines or ["  no devices configured"]))
    sections.append(("FARM", farm_lines))

    log_text = support_log.read_tail(LOG_TAIL_BYTES)
    entries = support_log.parse(log_text)
    analysis = support_log.analyze(entries)
    prob_lines, prob_found = _problems(analysis, entries)
    findings.extend(prob_found)

    findings.sort(key=lambda f: Finding.ORDER.get(f.level, 3))
    head = [
        "PRINTLOOM SUPPORT REPORT",
        "========================",
        f"created:  {_now_stamp()} (UTC {datetime.now(timezone.utc):%Y-%m-%d %H:%M:%S}Z)",
        f"version:  {version} · runtime {paths.RUNTIME}",
        f"uptime:   {_dur(time.time() - support_log._START_WALL)}",
        f"log:      {', '.join(p.name for p in support_log.files_oldest_first()) or 'none'} "
        f"({sum(p.stat().st_size for p in support_log.files_oldest_first()) / 1e6:.1f} MB)",
        "",
        "Privacy: no access codes, passwords or tokens. IP addresses end in .x, serial numbers",
        "are shortened, the user folder is \"~\". Device and file names are included. Nothing",
        "was sent anywhere — you decide who gets this file.",
        "Timestamps: local time of the Printloom computer with UTC offset; \"+123.456s\" in the",
        "log is the time since Printloom started. Values in \"…\" are quoted as reported",
        "(file names, printer messages, error texts).",
        "",
        "1. FINDINGS (automatic checks)",
        "------------------------------",
    ]
    head += [f.line() for f in findings] or ["  nothing noticeable"]
    body = ["", "2. PROBLEMS IN THE LOG", "---------------------"] + prob_lines
    for n, (title, lines) in enumerate(sections, start=3):
        body += ["", f"{n}. {title}", "-" * (len(title) + 3)] + lines
    body += ["", f"{len(sections) + 3}. LOG (newest last, up to {LOG_TAIL_BYTES // 1_000_000} MB)",
             "-" * 30, log_text.rstrip("\n"), "",
             f"(report built in {time.monotonic() - t0:.1f} s)"]
    return support_log.clean("\n".join(head + body)) + "\n"
