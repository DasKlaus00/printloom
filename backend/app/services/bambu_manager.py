"""Persistente MQTT-Verbindungen zu den Bambu-Druckern — EINE pro Gerät.

Warum: Bisher öffnete fast jede Aktion (jeder /status-Poll, jeder Kamera-Licht-Aufruf,
jeder Farm-Schritt) eine EIGENE kurzlebige `BambuLabMQTT().connect()/disconnect()`.
Der X1C erlaubt nur wenige gleichzeitige MQTT-Verbindungen → die Clients warfen sich
gegenseitig raus („verliert dauernd die Verbindung"), und die blockierenden connect()
(bis ~8 s) liefen alle über den gemeinsamen Default-ThreadPool → der lief voll
(„App hängt").

Dieser Manager hält je Drucker GENAU EINE langlebige Verbindung (paho Auto-Reconnect)
und einen laufend aktualisierten Status-Cache. Alle Status-Abfragen lesen den Cache
(kein Connect pro Request); alle Befehle publishen über dieselbe Verbindung. Blockierende
Arbeit läuft in einem eigenen, kleinen Pool, damit ein Verbindungs-Sturm die
Request-Verarbeitung nicht mehr aushungern kann.
"""
from __future__ import annotations
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

logger = logging.getLogger(__name__)

# Eigener, kleiner Pool NUR für blockierende MQTT-/FTP-Arbeit — getrennt vom Default-
# Executor der Requests. So kann ein Connect-Sturm die App nicht mehr blockieren.
executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="bambu")

_clients: dict = {}                 # key -> BambuLabMQTT (persistent)
_registry_lock = threading.Lock()

# Optionaler Client-Factory-Override (für lokale Tests ohne paho-Abhängigkeit).
_FACTORY = None


def _make(device):
    if _FACTORY is not None:
        return _FACTORY(device)
    from app.services.bambu_mqtt import BambuLabMQTT
    return BambuLabMQTT(device)


def _key(device):
    return (getattr(device, "id", None)
            or getattr(device, "serial_number", None)
            or getattr(device, "ip_address", None))


def get_client(device):
    """Den persistenten Client für dieses Gerät holen (bei Bedarf anlegen, noch NICHT
    verbinden). Ändert sich IP/Access-Code, wird die alte Verbindung verworfen."""
    k = _key(device)
    with _registry_lock:
        c = _clients.get(k)
        if c is not None:
            old, new = c.device, device
            if (getattr(old, "ip_address", None) != getattr(new, "ip_address", None) or
                    getattr(old, "access_code", None) != getattr(new, "access_code", None)):
                try:
                    c.disconnect()
                except Exception:
                    pass
                c = None
        if c is None:
            c = _make(device)
            _clients[k] = c
        else:
            c.device = device
        return c


# Nach einem GESCHEITERTEN Connect so lange keinen neuen Versuch starten, sondern sofort
# False (→ Cache/offline) liefern. Ohne Backoff versuchte JEDER Status-Poll bei Drucker
# aus/unerreichbar einen vollen ~6-s-Connect — seriell hinter dem Lock, auf nur 4 Workern:
# die Warteschlange wuchs schneller als sie abgearbeitet wurde, Status-Requests hingen
# minutenlang, hielten dabei DB-Sessions → der SQLite-Pool lief voll → die GANZE App hing
# („Seite lädt ewig", nur Neustart half).
_FAIL_BACKOFF_S = 20.0


def _in_backoff(c) -> bool:
    return time.monotonic() - getattr(c, "_last_fail", 0.0) < _FAIL_BACKOFF_S


def ensure(device, wait_timeout: float = 6.0) -> bool:
    """Sicherstellen, dass die dauerhafte Verbindung steht. Reused eine bestehende
    Verbindung; verbindet nur beim ersten Mal (danach hält paho sie per Auto-Reconnect).
    Nach einem Fehlschlag greift ein Backoff: Aufrufer bekommen sofort False statt
    sich hinter einem aussichtslosen Connect zu stauen."""
    c = get_client(device)
    if c.connected:
        return True
    if _in_backoff(c):
        return False
    # Bounded warten statt unbegrenzt: hängt ein Connect fest, stauen sich Aufrufer
    # hier nicht mehr endlos, sondern geben nach wait_timeout auf.
    if not c._connect_lock.acquire(timeout=max(wait_timeout, 0.1)):
        return c.connected
    try:
        if c.connected:
            return True
        if _in_backoff(c):
            return False
        if getattr(c, "_started", False):
            # paho reconnectet im Hintergrund — KEINEN zweiten Client bauen, nur kurz warten.
            deadline = time.monotonic() + min(wait_timeout, 3.0)
            while time.monotonic() < deadline and not c.connected:
                time.sleep(0.2)
            if not c.connected:
                c._last_fail = time.monotonic()
            return c.connected
        ok = c.connect(wait_timeout=wait_timeout)
        if not ok:
            c._last_fail = time.monotonic()
        return ok
    finally:
        c._connect_lock.release()


def is_connected(device) -> bool:
    c = _clients.get(_key(device))
    return bool(c and c.connected)


def last_status(device) -> Optional[dict]:
    """Letztes (gemergtes) Roh-Telegramm aus dem Cache — OHNE zu verbinden."""
    c = _clients.get(_key(device))
    return c.get_last_message() if c else None


def _has_ams(raw: dict) -> bool:
    return bool((((raw or {}).get("print", {}) or {}).get("ams", {}) or {}).get("ams"))


def request_pushall(device) -> bool:
    """Vollreport anfordern (füllt AMS/Status). Nutzt die persistente Verbindung."""
    if not ensure(device):
        return False
    return get_client(device).request_status()


def fetch_status(device, want_ams: bool = True, max_wait: float = 4.0) -> Optional[dict]:
    """Frischen Status liefern, ohne je eine zweite Verbindung zu öffnen.
    Normalfall: die persistente Verbindung hat laufend Deltas → Cache ist frisch, kein
    Warten. Nur wenn noch nichts (oder kein AMS) da ist, einmal pushall + kurz warten."""
    if not ensure(device):
        return last_status(device)   # evtl. veralteter Cache statt gar nichts
    c = get_client(device)
    raw = c.get_last_message()
    if raw is None or (want_ams and not _has_ams(raw)):
        # Warte-Dedupe: liefert der Drucker dauerhaft kein AMS (z. B. keins verbaut),
        # würde sonst JEDER Poll hier max_wait Sekunden einen Worker blockieren.
        now = time.monotonic()
        if now - getattr(c, "_pushall_wait_ts", 0.0) >= 15.0:
            c._pushall_wait_ts = now
            c.request_status()
            deadline = time.monotonic() + max_wait
            while time.monotonic() < deadline:
                time.sleep(0.3)
                raw = c.get_last_message()
                if raw and (not want_ams or _has_ams(raw)):
                    break
    return c.get_last_message()


def set_chamber_light(device, on: bool = True) -> bool:
    if not ensure(device):
        return False
    return get_client(device).set_chamber_light(on)


def send_gcode(device, gcode: str) -> bool:
    if not ensure(device):
        return False
    return get_client(device).send_gcode(gcode)


def print_command(device, cmd: str) -> bool:
    """pause / resume / stop über die persistente Verbindung."""
    if not ensure(device):
        return False
    return get_client(device)._print_cmd(cmd)


def start_print(device, remote_filename: str, use_ams: bool = True,
                ams_mapping: list = None, plate_param: str = None) -> bool:
    if not ensure(device):
        return False
    return get_client(device).start_print(remote_filename, use_ams=use_ams,
                                          ams_mapping=ams_mapping, plate_param=plate_param)


def drop(device) -> None:
    """Verbindung eines Geräts schließen und aus der Registry entfernen."""
    k = _key(device)
    with _registry_lock:
        c = _clients.pop(k, None)
    if c:
        try:
            c.disconnect()
        except Exception:
            pass
