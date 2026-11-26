"""Support-Log: EIN englisches Logfile zum Verschicken (seit v1.1.90).

Warum: Nutzer in aller Welt melden Fehler („Drucker-Pille grau") ohne Log — bis v1.1.89
gab es nur das deutsche Farm-Log und unter Windows die desktop.log (rohe Konsole).
Jetzt landet jede Meldung (eigene, Bibliotheken, Abstürze samt Traceback) als Zeile in
<Datenordner>/logs/printloom.log:

  2026-11-26 12:34:56.789 +01:00 | +754.123s | WARNING  | farm [MainThread] | message | k=v

  Datum und Uhrzeit mit Millisekunden und Zeitzone, Laufzeit seit dem Start (für
  Abstände ohne Uhrumstellung), Stufe, Bereich, Thread, Meldung, Felder; Tracebacks
  folgen eingerückt mit „    | ".

Englisch: Alle Log-Texte im Code sind englisch (test_support_log prüft das), die
Farm-Meldungen bringen ihre englische Fassung mit (_log(msg, en=…)). Werte, die von
woanders kommen (Dateinamen, Gerätenamen, Fehlertexte), stehen in "…".

Datenschutz: kein Zugangsdatum (credentials.scrub), Adressen maskiert
(credentials.mask_hosts), bekannte Seriennummern und Access-Codes ersetzt (hide), der
Benutzerordner als „~". Nichts verlässt den Rechner von selbst — der Nutzer lädt den
Bericht herunter und entscheidet, wem er ihn gibt (services/support_report.py).
"""
from __future__ import annotations

import logging
import logging.handlers
import os
import platform
import re
import sys
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Optional

from app import paths
from app.services import credentials

LOG_NAME = "printloom.log"
MAX_BYTES = 5_000_000          # je Datei
BACKUPS = 4                    # + 4 ältere → höchstens ~25 MB
SEP = " | "
TB_PREFIX = "    | "

_START_WALL = time.time()
_installed = False
_handler: Optional[logging.Handler] = None
_hidden: dict = {}             # Wert → Ersatz (Seriennummern, Access-Codes)
_hidden_lock = threading.Lock()
_HOME = str(Path.home())


def log_dir() -> Path:
    return paths.DATA_ROOT / "logs"


def log_path() -> Path:
    return log_dir() / LOG_NAME


# ── Datenschutz ──────────────────────────────────────────────────────────────
def hide(value, label: str) -> None:
    """Einen Wert, der nie im Log stehen darf (Access-Code) oder nur gekürzt
    (Seriennummer), ab jetzt in jeder Zeile ersetzen. Kurze Werte (< 6 Zeichen) nicht:
    Sie träfen zufällig Zahlen in anderen Meldungen."""
    v = str(value or "").strip()
    if len(v) < 6:
        return
    repl = f"<{label} …{v[-4:]}>" if label == "serial" else f"<{label}>"
    with _hidden_lock:
        _hidden[v] = repl


def hide_device(device) -> None:
    """Seriennummer und Access-Code eines Geräts verbergen (aus DB-Zeile oder Kopie)."""
    hide(getattr(device, "serial_number", None), "serial")
    hide(getattr(device, "access_code", None), "secret")


def clean(text) -> str:
    """Eine Zeile so, wie sie ins Log darf: ohne Geheimnisse, Adressen maskiert,
    bekannte Seriennummern/Codes ersetzt, Benutzerordner als „~"."""
    s = credentials.mask_hosts(credentials.scrub(text))
    with _hidden_lock:
        items = sorted(_hidden.items(), key=lambda kv: -len(kv[0]))
    for v, repl in items:
        if v in s:
            s = s.replace(v, repl)
    if _HOME and len(_HOME) > 3:
        s = s.replace(_HOME, "~")
    return s


# ── Format ───────────────────────────────────────────────────────────────────
def _component(name: str) -> str:
    for prefix in ("printloom.", "app.services.", "app.routers.", "app."):
        if name.startswith(prefix):
            return name[len(prefix):]
    return name


def stamp(created: float) -> str:
    """„2026-11-26 12:34:56.789 +01:00" — Ortszeit des Rechners mit Abstand zu UTC."""
    dt = datetime.fromtimestamp(created).astimezone()
    off = dt.strftime("%z")
    return f"{dt:%Y-%m-%d %H:%M:%S}.{int(dt.microsecond / 1000):03d} {off[:3]}:{off[3:]}"


class SupportFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        try:
            msg = record.getMessage()
        except Exception as e:          # falsche %-Argumente: Zeile trotzdem schreiben
            msg = f"{record.msg!r} (log format error: {type(e).__name__})"
        fields = getattr(record, "fields", None)
        if isinstance(fields, dict) and fields:
            msg += SEP + " ".join(f"{k}={v!r}" if isinstance(v, str) and " " in v else f"{k}={v}"
                                  for k, v in fields.items())
        head = SEP.join((stamp(record.created), f"+{record.created - _START_WALL:.3f}s",
                         f"{record.levelname:<8}",
                         f"{_component(record.name)} [{record.threadName}]", msg))
        tb = ""
        if record.exc_info:
            tb = self.formatException(record.exc_info)
        elif record.exc_text:
            tb = record.exc_text
        if record.stack_info:
            tb = (tb + "\n" if tb else "") + record.stack_info
        if tb:
            head += "\n" + "\n".join(TB_PREFIX + ln for ln in tb.splitlines())
        return clean(head)


# ── Einrichten ───────────────────────────────────────────────────────────────
def _app_version() -> str:
    try:
        return Path(paths.version_file()).read_text(encoding="utf-8").strip() or "unknown"
    except OSError as e:
        return f"unknown ({type(e).__name__})"


def session_header() -> str:
    dt = datetime.now().astimezone()
    return (f"=== Printloom {_app_version()} started — runtime {paths.RUNTIME}, "
            f"Python {platform.python_version()}, {platform.system()} {platform.release()} "
            f"({platform.machine()}), PID {os.getpid()}, local time UTC{dt.strftime('%z')} ===")


def install() -> bool:
    """Logfile an den Root-Logger und an uvicorn hängen, Abstürze mitschreiben.
    Mehrfach aufrufbar. False, wenn der Ordner nicht beschreibbar ist (dann läuft die
    App ohne Logfile weiter — das ist ein Hinweis im Bericht, kein Startabbruch)."""
    global _installed, _handler
    if _installed:
        return True
    try:
        log_dir().mkdir(parents=True, exist_ok=True)
        h = logging.handlers.RotatingFileHandler(
            log_path(), maxBytes=MAX_BYTES, backupCount=BACKUPS, encoding="utf-8", delay=True)
    except OSError as e:
        logging.getLogger(__name__).warning(f"Support log not writable: {e}")
        return False
    h.setLevel(logging.INFO)
    h.setFormatter(SupportFormatter())
    root = logging.getLogger()
    root.addHandler(h)
    # Ohne basicConfig (Tests, Hilfsprogramme) stünde der Root-Logger auf WARNING —
    # dann fehlten Zustandswechsel und Farm-Zeilen im Logfile.
    if root.level > logging.INFO or root.level == logging.NOTSET:
        root.setLevel(logging.INFO)
    # uvicorn gibt seine Meldungen (auch „Exception in ASGI application") nicht an den
    # Root-Logger weiter — darum dort zusätzlich. Das Zugriffslog bleibt draußen.
    logging.getLogger("uvicorn").addHandler(h)
    _handler, _installed = h, True
    _hook_crashes()
    logging.getLogger("printloom.app").info(session_header())
    return True


def _hook_crashes() -> None:
    """Unerwartete Ausnahmen in Threads und im Hauptprogramm mit Traceback loggen,
    dann wie vorher weiterreichen."""
    crash = logging.getLogger("printloom.crash")
    prev_sys, prev_thread = sys.excepthook, threading.excepthook

    def sys_hook(t, v, tb):
        if not issubclass(t, KeyboardInterrupt):
            crash.critical("Uncaught exception", exc_info=(t, v, tb))
        prev_sys(t, v, tb)

    def thread_hook(args):
        if args.exc_type is not SystemExit:
            crash.error(f"Uncaught exception in thread {getattr(args.thread, 'name', '?')}",
                        exc_info=(args.exc_type, args.exc_value, args.exc_traceback))
        prev_thread(args)

    sys.excepthook, threading.excepthook = sys_hook, thread_hook


def asyncio_handler(loop, context) -> None:
    """Für loop.set_exception_handler: verlorene Ausnahmen in Tasks ins Log."""
    exc = context.get("exception")
    logging.getLogger("printloom.crash").error(
        f"Asyncio: {context.get('message') or 'unhandled error'}",
        exc_info=(type(exc), exc, exc.__traceback__) if exc else None)


# ── Zustandswechsel (Drucker, Verbindungen) ─────────────────────────────────
_last_state: dict = {}
_state_lock = threading.Lock()


def state_change(component: str, key, label: str, values: dict,
                 level: int = logging.INFO) -> bool:
    """Nur Wechsel loggen: „<label>: gcode_state 'IDLE' → 'RUNNING'". Der erste Stand
    erscheint als „initial state". Werte mit None fehlen in der Zeile (unbekannt).
    → ob etwas geloggt wurde."""
    with _state_lock:
        prev = _last_state.get(key)
        if prev == values:
            return False
        _last_state[key] = dict(values)
    lg = logging.getLogger(f"printloom.{component}")
    if prev is None:
        shown = ", ".join(f"{k}={v!r}" for k, v in values.items() if v is not None)
        lg.log(level, f"{label}: initial state {shown}")
    else:
        diff = ", ".join(f"{k} {prev.get(k)!r} → {v!r}" for k, v in values.items() if prev.get(k) != v)
        lg.log(level, f"{label}: {diff}")
    return True


def exc_text(e: BaseException) -> str:
    """„ConnectTimeout: timed out" — ohne leeren Doppelpunkt, wenn die Ausnahme keinen
    Text hat (httpx.ConnectTimeout oft)."""
    text = str(e).strip()
    return f"{type(e).__name__}: {text}" if text else type(e).__name__


def forget_state(key) -> None:
    with _state_lock:
        _last_state.pop(key, None)


# ── Lesen (für den Bericht) ──────────────────────────────────────────────────
def files_oldest_first() -> list:
    base = log_path()
    out = [base.with_name(f"{LOG_NAME}.{i}") for i in range(BACKUPS, 0, -1)]
    return [p for p in out + [base] if p.exists()]


def read_tail(max_bytes: int) -> str:
    """Die jüngsten `max_bytes` aller Logdateien (älteste zuerst), an Zeilengrenze."""
    if _handler is not None:
        try:
            _handler.flush()
        except (OSError, ValueError) as e:
            logging.getLogger(__name__).debug(f"Support log flush failed: {e}")
    chunks, size = [], 0
    for p in reversed(files_oldest_first()):
        try:
            data = p.read_bytes()
        except OSError as e:
            chunks.append(f"[{p.name} not readable: {e}]\n".encode())
            continue
        if size + len(data) > max_bytes:
            data = data[len(data) - (max_bytes - size):]
            cut = data.find(b"\n")
            data = data[cut + 1:] if cut >= 0 else data
            chunks.append(data)
            break
        chunks.append(data)
        size += len(data)
    # Unter Windows schreibt der Handler im Textmodus CRLF — hier einheitlich LF.
    return b"".join(reversed(chunks)).decode("utf-8", errors="replace").replace("\r\n", "\n")


# ── Auswertung ───────────────────────────────────────────────────────────────
LINE = re.compile(r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d) \| \+([\d.]+)s \| "
                  r"(\w+)\s* \| (\S+) \[([^\]]*)\] \| (.*)$")
_NORM = [(re.compile(r'"[^"]*"'), '"…"'), (re.compile(r"'[^']*'"), "'…'"),
         (re.compile(r"\b0x[0-9a-fA-F]+\b"), "0x#"), (re.compile(r"\d+(\.\d+)?"), "#")]


def normalize(msg: str) -> str:
    """Meldung ohne wechselnde Werte — gleiche Fehler zählen zusammen."""
    for rx, repl in _NORM:
        msg = rx.sub(repl, msg)
    return msg[:200]


def parse(text: str) -> list:
    """Logtext → Einträge {ts, up, level, comp, thread, msg, tb}. Zeilen, die zu keinem
    Eintrag passen (Fremdformat), hängen am vorigen."""
    out = []
    for ln in text.splitlines():
        m = LINE.match(ln)
        if m:
            out.append({"ts": m.group(1), "up": float(m.group(2)), "level": m.group(3),
                        "comp": m.group(4), "thread": m.group(5), "msg": m.group(6), "tb": []})
        elif out:
            out[-1]["tb"].append(ln[len(TB_PREFIX):] if ln.startswith(TB_PREFIX) else ln)
    return out


def analyze(entries: list) -> dict:
    """Zählungen, Fehlergruppen (erstes/letztes Auftreten), Neustarts, Abstürze."""
    levels, comps, groups = {}, {}, {}
    starts, crashes = [], []
    for e in entries:
        levels[e["level"]] = levels.get(e["level"], 0) + 1
        if e["msg"].startswith("=== Printloom ") and "started" in e["msg"]:
            starts.append(e["ts"])
        if e["level"] not in ("WARNING", "ERROR", "CRITICAL"):
            continue
        comps[e["comp"]] = comps.get(e["comp"], 0) + 1
        key = (e["level"], e["comp"], normalize(e["msg"]))
        g = groups.get(key)
        if g is None:
            g = groups[key] = {"level": e["level"], "comp": e["comp"], "pattern": key[2],
                               "count": 0, "first": e["ts"], "last": e["ts"], "example": e["msg"],
                               "exception": None}
        g["count"] += 1
        g["last"], g["example"] = e["ts"], e["msg"]
        if e["tb"]:
            g["exception"] = next((t for t in reversed(e["tb"]) if t.strip()), None)
            if e["comp"] == "crash" or e["level"] == "CRITICAL":
                crashes.append(e)
    order = {"CRITICAL": 0, "ERROR": 1, "WARNING": 2}
    ranked = sorted(groups.values(), key=lambda g: (order.get(g["level"], 3), -g["count"]))
    return {"levels": levels, "components": comps, "groups": ranked, "starts": starts,
            "crashes": crashes, "first": entries[0]["ts"] if entries else None,
            "last": entries[-1]["ts"] if entries else None}
