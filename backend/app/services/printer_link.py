"""EIN Weg zum Drucker für die Farm — Bambu (MQTT + FTP) und Moonraker (HTTP, Snapmaker U1).

Warum: Der Farm-Zyklus (routers/autofarm.py) sprach bis v1.1.86 an rund 60 Stellen
direkt bambu_manager an. Statt jede Stelle zu verzweigen, bietet dieses Modul genau
die Aufrufe, die der Zyklus braucht, mit denselben Namen und derselben Bedeutung:

  ensure · is_connected · request_pushall · last_status · status_age
  send_gcode · print_command · run_gcode (blockierend, nur Moonraker)

`last_status` liefert bei beiden Druckern ein Telegramm der Form {"print": {...}} mit
gcode_state, mc_percent, mc_remaining_time, Temperaturen (Bambu-Schreibweise). Beim U1
baut moonraker_printer.farm_print_status es aus dem normalisierten Zustand.

Alle Funktionen sind synchron und laufen im `executor` (dem kleinen Pool der
Bambu-Seite): So bleibt die Aufrufform im Zyklus gleich, und ein hängender Drucker
blockiert nie die Request-Verarbeitung.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Optional

import httpx

from app.models.models import PrinterType
from app.services import bambu_manager, moonraker_printer, support_log

logger = logging.getLogger(__name__)

executor = bambu_manager.executor

# Gerätetypen, die die Farm fahren kann. Eine Quelle für Start, Geräteauswahl,
# Stresstest und Oberfläche (über /api/autofarm/farm-printer).
FARM_PRINTER_TYPES = (PrinterType.BAMBU_LAB, PrinterType.MOONRAKER)

# Ein U1-Zustand gilt so lange als „verbunden"; danach ist er unbekannt.
MOON_FRESH_S = 30.0

_moon: dict = {}               # device_id -> {"t": monotonic, "raw": {...}}
_moon_lock = threading.Lock()


def is_moonraker(device) -> bool:
    return getattr(device, "device_type", None) in (PrinterType.MOONRAKER, PrinterType.MOONRAKER.value)


def is_farm_printer(device) -> bool:
    t = getattr(device, "device_type", None)
    return t in FARM_PRINTER_TYPES or t in tuple(x.value for x in FARM_PRINTER_TYPES)


def _key(device):
    return getattr(device, "id", None) or getattr(device, "ip_address", None)


def _moon_refresh(device) -> Optional[dict]:
    """Zustand des U1 frisch lesen und als Telegramm ablegen. None = nicht lesbar.

    Support-Log: nur WECHSEL (erreichbar ↔ nicht erreichbar, Klipper-/Druckzustand) —
    bis v1.1.89 stand bei einem ausgeschalteten U1 jede Abfrage im Log."""
    name = getattr(device, "name", "?")
    try:
        _, st = moonraker_printer.query_sync(device)
    except (PermissionError, httpx.HTTPError, ValueError, OSError) as e:
        support_log.state_change("printer.moonraker", ("moon-link", _key(device)), f"{name} (Moonraker)",
                                 {"reachable": False, "error": support_log.exc_text(e)[:200]},
                                 level=logging.WARNING)
        return None
    support_log.state_change("printer.moonraker", ("moon-link", _key(device)), f"{name} (Moonraker)",
                             {"reachable": True, "error": None})
    norm = moonraker_printer.normalize(st)
    support_log.state_change("printer.moonraker", ("moon-state", _key(device)), name, {
        "klippy": norm.get("klippy_state"), "print_state": norm.get("print_state"),
        "executing_gcode": norm.get("executing_gcode"), "file": norm.get("subtask_name") or None,
        "klippy_message": (norm.get("klippy_message") or "")[:200] or None,
        "display": (norm.get("message") or "")[:120] or None})
    raw = {"print": moonraker_printer.farm_print_status(norm), "moonraker": norm}
    with _moon_lock:
        _moon[_key(device)] = {"t": time.monotonic(), "raw": raw}
    return raw


def _moon_entry(device) -> Optional[dict]:
    with _moon_lock:
        return _moon.get(_key(device))


# ── Dieselben Aufrufe wie bambu_manager ──────────────────────────────────────
def ensure(device, wait_timeout: float = 6.0) -> bool:
    if is_moonraker(device):
        return _moon_refresh(device) is not None
    return bambu_manager.ensure(device, wait_timeout=wait_timeout)


def is_connected(device) -> bool:
    if is_moonraker(device):
        age = status_age(device)
        return age is not None and age <= MOON_FRESH_S
    return bambu_manager.is_connected(device)


def request_pushall(device) -> bool:
    if is_moonraker(device):
        return _moon_refresh(device) is not None
    return bambu_manager.request_pushall(device)


def last_status(device) -> Optional[dict]:
    if is_moonraker(device):
        e = _moon_entry(device)
        return e["raw"] if e else None
    return bambu_manager.last_status(device)


def status_age(device) -> Optional[float]:
    if is_moonraker(device):
        e = _moon_entry(device)
        return None if e is None else time.monotonic() - e["t"]
    return bambu_manager.status_age(device)


def send_gcode(device, gcode: str) -> bool:
    """G-code an den Drucker. Beim U1 kehrt das erst zurück, wenn er ausgeführt ist;
    False, wenn Klipper ihn ablehnt oder der Drucker nicht erreichbar ist."""
    if is_moonraker(device):
        try:
            moonraker_printer.run_gcode_sync(device, gcode, timeout=GCODE_TIMEOUT_S)
            return True
        except (RuntimeError, PermissionError, httpx.HTTPError, OSError) as e:
            logger.warning(f"G-code to {getattr(device, 'name', '?')} failed: {e}")
            return False
    return bambu_manager.send_gcode(device, gcode)


def run_gcode(device, gcode: str, timeout: float) -> None:
    """Blockierend und mit Fehlertext (nur Moonraker): fürs Homing, dessen Ende die
    Farm abwarten muss. RuntimeError mit der Meldung von Klipper."""
    if not is_moonraker(device):
        raise RuntimeError("run_gcode gibt es nur für Moonraker-Drucker")
    try:
        moonraker_printer.run_gcode_sync(device, gcode, timeout=timeout)
    except (PermissionError, httpx.HTTPError, OSError) as e:
        raise RuntimeError(f"Drucker nicht erreichbar ({type(e).__name__})") from e


# Bambu-Wörter → Moonraker. „stop" heißt dort cancel.
_MOON_ACTIONS = {"pause": "pause", "resume": "resume", "stop": "cancel"}


def print_command(device, cmd: str) -> bool:
    if is_moonraker(device):
        action = _MOON_ACTIONS.get(cmd)
        if not action:
            return False
        try:
            moonraker_printer.print_action_sync(device, action)
            return True
        except (PermissionError, httpx.HTTPError, ValueError, OSError) as e:
            logger.warning(f"Print {cmd} to {getattr(device, 'name', '?')} failed: {e}")
            return False
    return bambu_manager.print_command(device, cmd)


def moon_live_state(device) -> Optional[str]:
    """Frischer Zustand des U1 für Sicherheitsentscheidungen (printer_guard)."""
    raw = _moon_refresh(device)
    if raw is None:
        return None
    return moonraker_printer.live_state_of(raw.get("moonraker") or {})


def moon_tools(device) -> list:
    """Köpfe des U1 mit Filament (frisch gelesen); [] wenn nicht lesbar."""
    raw = _moon_refresh(device)
    return list(((raw or {}).get("moonraker") or {}).get("tools") or [])


# Zeitlimit eines G-code-Befehls an den U1. Moonraker antwortet erst nach der
# Ausführung; Bett-Fahrten der Sequenzen dauern Sekunden, G28 mit Z-Fahrt knapp eine
# Minute. Das Homing selbst hat sein eigenes, längeres Limit (autofarm).
GCODE_TIMEOUT_S = 120.0
