# /// script
# requires-python = ">=3.12"
# dependencies = []
#
# [tool.orcaslicer.plugin]
# name = "Printloom"
# description = "Verbindet OrcaSlicer mit deiner Printloom-Druckfarm: Farm-Check nach dem Slicen (Arm-Kollision, Regalhöhe, Spulen), Senden in die Warteschlange, Drucker und Farm im eigenen Tab. Spricht nur mit der Printloom-Adresse, die du einträgst."
# author = "Printloom"
# version = "1.0.0"
# ///
"""Printloom für OrcaSlicer (ab 2.5).

Fünf Teile in einem Plugin:
  1. Farm-Check nach dem Slicen: Kollisionszone des Arms und Regalhöhe → Hinweis im 3D-Bild
  2. Senden und Drucken an Printloom: Bibliothek + Warteschlange (Drucker-Agent „Printloom")
  3. Druckerzustand und AMS im Geräte-Tab — über Printloom, ohne zweite Verbindung zum Drucker
  4. Spulen-Check: reicht das Filament im Fach, das die Farm nehmen würde?
  5. Tab „Printloom": Farm, Warteschlange, Regal, Drucker, AMS

Geurteilt wird in Printloom (/api/slicer/…), mit derselben Logik wie in der Farm. Das
Plugin sammelt nur ein und zeigt an — so urteilen Slicer und Farm nie verschieden.

Threads: Orca ruft Ereignisse und Agent-Methoden auf dem Oberflächen- oder dem
Slicing-Thread auf, und beide dürfen nie warten. Alles Netzwerk läuft deshalb in
eigenen Threads; die muss man beim ersten Laden einmal erlauben.

Was Orca vom Geräte-Bericht erwartet, steht nicht in der Plugin-Doku. Vorbild ist
Orcas eigener Moonraker-Agent (src/slic3r/Utils/MoonrakerPrinterAgent.cpp).
"""
from __future__ import annotations

import base64
import gzip
import json
import os
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

import orca

VERSION = "1.0.0"
API_VERSION = 1
AGENT_ID = "printloom"          # steht in den Drucker-Profilen der Nutzer — nie ändern
STATUS_INTERVAL_S = 3.0          # Geräte-Tab: so oft fragt Orca auch seine eigenen Drucker
OVERVIEW_INTERVAL_S = 10.0       # Printloom-Tab

# Bambu-Codes, die Orcas Druck-Jobs verstehen (src/slic3r/Utils/bambu_networking.hpp).
STAGE_CREATE, STAGE_UPLOAD, STAGE_SENDING, STAGE_FINISHED, STAGE_ERROR = 0, 1, 3, 6, 7
ERR_CONNECT, ERR_FILE, ERR_CANCELED, ERR_UPLOAD, NOT_SUPPORTED = -2, -14, -18, -5010, -7010
SDCARD_NORMAL = 1                # DevStorage::HAS_SDCARD_NORMAL

# Felder aus Printlooms Druckerzustand, die wörtlich in den Geräte-Bericht gehen.
PASS_KEYS = ("mc_percent", "mc_remaining_time", "subtask_name", "layer_num",
             "total_layer_num", "nozzle_temper", "nozzle_target_temper", "bed_temper",
             "bed_target_temper", "chamber_temper", "nozzle_diameter", "nozzle_type",
             "ams", "vt_tray")
_STAGE_OF_STATE = {"PREPARE": 1, "RUNNING": 1, "PAUSE": 2, "FINISH": 3, "FAILED": 4}


def _log(msg: str) -> None:
    # stdout/stderr landen in Orcas Python-Log (data_dir/log/python_*.log).
    print(f"[Printloom] {msg}", flush=True)


# ── Texte ─────────────────────────────────────────────────────────────────────
# Das Plugin spricht die Sprache der Orca-Oberfläche: Deutsch, sonst Englisch.

TEXT = {
    "de": {
        "agent_desc": "Printloom-Farm: Senden und Drucken landen in der Warteschlange",
        "preparing": "Vorbereiten…",
        "uploading": "An Printloom senden… {pct} %",
        "sent": "In Printloom",
        "not_configured": "Printloom: Adresse fehlt — im Tab „Printloom“ eintragen.",
        "sent_queue": "Printloom: „{name}“ in der Warteschlange ({jobs}).",
        "sent_library": "Printloom: „{name}“ liegt in der Bibliothek.",
        "send_failed": "Printloom: Senden fehlgeschlagen — {err}",
        "check_failed": "Printloom: Farm-Check nicht möglich — {err}",
        "check_ok": "Printloom: Farm-Check ok — Arm frei, {slots}, {spool}.",
        "slots_one": "1 Fach",
        "slots_many": "{n} Fächer",
        "spool_ok": "Spulen reichen",
        "spool_unknown": "Spulen unbekannt",
        "crash": "Arm-Kollision: über {zlim:g} mm fährt der Druck bei X {x:g} mm (Randstreifen {margin:g} mm). Teil zur Mitte schieben.",
        "too_tall": "Zu hoch fürs Regal: {h:g} mm (max. {max:g} mm) — die Farm würde pausieren.",
        "slots_hint": "Belegt {n} Fächer ({h:g} mm hoch).",
        "spool_short": "Fach {label} ({type}): noch ca. {left:g} g, der Druck braucht {need:g} g.",
        "spool_missing": "Kein {type} im AMS — die Farm würde pausieren.",
        "plate": "Platte {n}: ",
        "jobs_one": "1 Job",
        "jobs_many": "{n} Jobs",
    },
    "en": {
        "agent_desc": "Printloom farm: Send and Print add to the queue",
        "preparing": "Preparing…",
        "uploading": "Sending to Printloom… {pct} %",
        "sent": "In Printloom",
        "not_configured": "Printloom: no address — enter it in the “Printloom” tab.",
        "sent_queue": "Printloom: “{name}” is in the queue ({jobs}).",
        "sent_library": "Printloom: “{name}” is in the library.",
        "send_failed": "Printloom: sending failed — {err}",
        "check_failed": "Printloom: farm check not possible — {err}",
        "check_ok": "Printloom: farm check ok — arm clear, {slots}, {spool}.",
        "slots_one": "1 slot",
        "slots_many": "{n} slots",
        "spool_ok": "spools suffice",
        "spool_unknown": "spools unknown",
        "crash": "Arm collision: above {zlim:g} mm the print moves to X {x:g} mm (edge strip {margin:g} mm). Move the part towards the centre.",
        "too_tall": "Too tall for the rack: {h:g} mm (max. {max:g} mm) — the farm would pause.",
        "slots_hint": "Takes {n} slots ({h:g} mm tall).",
        "spool_short": "Slot {label} ({type}): about {left:g} g left, the print needs {need:g} g.",
        "spool_missing": "No {type} in the AMS — the farm would pause.",
        "plate": "Plate {n}: ",
        "jobs_one": "1 job",
        "jobs_many": "{n} jobs",
    },
}

# Texte des Tabs — die Seite bekommt sie mit jeder Nachricht, eine Quelle für beide.
PAGE_TEXT = {
    "de": {
        "title": "Printloom", "refresh": "Aktualisieren", "settings": "Verbindung",
        "url": "Printloom-Adresse", "url_hint": "z. B. http://192.168.1.20:8000 oder https://printloom.example.de",
        "user": "Benutzer (nur hinter authentik o. Ä.)", "password": "Passwort / App-Passwort",
        "password_saved": "gespeichert — leer lassen zum Behalten", "password_clear": "Passwort löschen",
        "check_after_slice": "Nach dem Slicen gegen die Farm prüfen",
        "send_queues": "„Senden“ legt auch in die Warteschlange (sonst nur Bibliothek)",
        "save": "Speichern", "test": "Verbindung testen", "saved": "Gespeichert.",
        "connected": "Verbunden mit Printloom {v}", "not_connected": "Nicht verbunden",
        "farm": "Farm", "queue": "Warteschlange", "rack": "Regal", "printer": "Drucker", "ams": "AMS",
        "running": "läuft", "paused": "pausiert", "idle": "wartet auf Jobs", "stopped": "gestoppt",
        "stopping": "stoppt…", "countdown": "Start in {s} s", "current": "Aktuell",
        "empty_queue": "Keine offenen Jobs.", "pending": "offen", "done": "fertig", "error": "Fehler",
        "free_slots": "{free} von {total} Fächern frei", "empty_plates": "{n} leere Platten bereit",
        "progress": "{p} %", "remaining": "noch {m} min", "layer": "Schicht {a}/{b}",
        "nozzle": "Düse", "bed": "Bett", "chamber": "Bauraum", "offline": "keine Verbindung",
        "unknown": "unbekannt", "last_check": "Letzter Farm-Check", "last_send": "Zuletzt gesendet",
        "nothing_yet": "Noch nichts.", "plate": "Platte {n}",
    },
    "en": {
        "title": "Printloom", "refresh": "Refresh", "settings": "Connection",
        "url": "Printloom address", "url_hint": "e.g. http://192.168.1.20:8000 or https://printloom.example.com",
        "user": "User (only behind authentik or similar)", "password": "Password / app password",
        "password_saved": "saved — leave empty to keep", "password_clear": "Delete password",
        "check_after_slice": "Check against the farm after slicing",
        "send_queues": "“Send” also adds to the queue (otherwise library only)",
        "save": "Save", "test": "Test connection", "saved": "Saved.",
        "connected": "Connected to Printloom {v}", "not_connected": "Not connected",
        "farm": "Farm", "queue": "Queue", "rack": "Rack", "printer": "Printer", "ams": "AMS",
        "running": "running", "paused": "paused", "idle": "waiting for jobs", "stopped": "stopped",
        "stopping": "stopping…", "countdown": "starts in {s} s", "current": "Current",
        "empty_queue": "No open jobs.", "pending": "open", "done": "done", "error": "error",
        "free_slots": "{free} of {total} slots free", "empty_plates": "{n} empty plates ready",
        "progress": "{p} %", "remaining": "{m} min left", "layer": "layer {a}/{b}",
        "nozzle": "Nozzle", "bed": "Bed", "chamber": "Chamber", "offline": "no connection",
        "unknown": "unknown", "last_check": "Last farm check", "last_send": "Last sent",
        "nothing_yet": "Nothing yet.", "plate": "Plate {n}",
    },
}


def tr(lang: str, key: str, **kw) -> str:
    text = TEXT.get(lang, TEXT["en"]).get(key) or TEXT["en"].get(key) or key
    return text.format(**kw) if kw else text


# ── Reine Hilfen (ohne Orca testbar) ──────────────────────────────────────────

def normalize_url(url: str) -> str:
    url = (url or "").strip().rstrip("/")
    if url and "://" not in url:
        url = "http://" + url
    return url


def device_id_for(url: str) -> str:
    """Geräte-ID wie Orca sie aus einer Druckadresse bildet (Host[:Port], ohne Schema
    und Pfad) — so trifft eine im Profil eingetragene Adresse dasselbe Gerät."""
    rest = normalize_url(url).split("://", 1)[-1]
    return rest.split("/", 1)[0]


def upload_name(project_name: str, filename: str) -> str:
    """Dateiname für die Bibliothek: der Projektname aus Orca, mit der Endung der
    wirklich gesendeten Datei."""
    ext = ".gcode.3mf" if filename.lower().endswith(".3mf") else ".gcode"
    base = (project_name or "").strip() or os.path.basename(filename)
    for suffix in (".gcode.3mf", ".3mf", ".gcode"):
        if base.lower().endswith(suffix):
            base = base[: -len(suffix)]
            break
    return (base or "Orca") + ext


def build_status_payload(state: dict, now_ms: int) -> dict:
    """Printlooms Druckerzustand → Geräte-Bericht im Bambu-Format.

    Absichtlich schlank: kein „fun", kein „ipcam" — daran würde Orca Bambu-eigene
    Übertragungswege einschalten, die am Plugin vorbei direkt zum Drucker gingen.
    Speicherkarte „vorhanden", sonst sperrt Orcas Sende-Dialog. Fehlerfelder 0: Fehler
    behandelt die Farm; eine 1 öffnete in Orca einen allgemeinen Fehlerdialog."""
    report = (state or {}).get("print") or {}
    gstate = str(report.get("gcode_state") or "IDLE").upper()
    body = {
        "command": "push_status",
        "msg": 0,                       # 0 = vollständiger Bericht
        "support_mqtt_alive": True,
        "gcode_state": gstate,
        "mc_print_stage": _STAGE_OF_STATE.get(gstate, 0),
        "print_error": 0,
        "mc_print_error_code": 0,
        "sdcard": True,
        "home_flag": SDCARD_NORMAL << 8,  # Bits 8–9: Speicher-Zustand
        "support_send_to_sd": True,
        "nozzle_temp_range": [100, 300],
        "bed_temp_range": [0, 120],
    }
    for key in PASS_KEYS:
        if key in report:
            body[key] = report[key]
    return {"print": body, "t_utc": int(now_ms)}


def version_reply(version: str) -> dict:
    """Antwort auf Orcas get_version — ohne sie bleibt der Druckdialog bei „Lese…"."""
    return {"info": {"command": "get_version", "result": "success",
                     "module": [{"name": "ota", "sw_ver": version or VERSION,
                                 "product_name": "Printloom"}]}}


def describe_checks(lang: str, checks: list) -> tuple:
    """Prüfergebnisse aus Printloom → (Warnungen, Hinweise, Kurzfazit)."""
    warnings, hints = [], []
    slots_needed, spool_states = 1, []
    for c in checks or []:
        prefix = tr(lang, "plate", n=c["plate"]) if c.get("plate") else ""
        crash = c.get("crash") or {}
        if crash.get("crash_risk"):
            warnings.append(prefix + tr(lang, "crash", zlim=crash.get("z_limit_mm") or 30,
                                        x=crash.get("hit_x_mm") or 0,
                                        margin=crash.get("x_margin_mm") or 10))
        height = c.get("height") or {}
        if height.get("ok") is False:
            warnings.append(prefix + tr(lang, "too_tall", h=height.get("height_mm") or 0,
                                        max=height.get("max_height_mm") or 0))
        elif (height.get("slots_needed") or 1) > 1:
            hints.append(prefix + tr(lang, "slots_hint", n=height["slots_needed"],
                                     h=height.get("height_mm") or 0))
        slots_needed = max(slots_needed, height.get("slots_needed") or 1)
        spool = c.get("spool") or {}
        spool_states.append(spool.get("state") or "unknown")
        for item in spool.get("items") or []:
            if item.get("status") == "short":
                warnings.append(prefix + tr(lang, "spool_short", label=item.get("label") or "?",
                                            type=item.get("type") or "?",
                                            left=item.get("left_g") or 0,
                                            need=item.get("need_g") or 0))
            elif item.get("status") == "no_material":
                warnings.append(prefix + tr(lang, "spool_missing", type=item.get("type") or "?"))
    slots = tr(lang, "slots_one") if slots_needed <= 1 else tr(lang, "slots_many", n=slots_needed)
    spool = tr(lang, "spool_ok") if spool_states and all(s == "ok" for s in spool_states) \
        else tr(lang, "spool_unknown")
    summary = tr(lang, "check_ok", slots=slots, spool=spool)
    return warnings, hints, summary


class PrintloomError(Exception):
    pass


class _ProgressFile:
    """Datei für den Upload: meldet den Fortschritt und bricht bei Abbruch ab —
    urllib liest den Body stückweise über read()."""

    def __init__(self, path: str, progress: dict, cancelled: threading.Event):
        self._f = open(path, "rb")
        self._progress = progress
        self._cancelled = cancelled

    def read(self, n: int = -1) -> bytes:
        if self._cancelled.is_set():
            raise PrintloomError("abgebrochen")
        chunk = self._f.read(n if n and n > 0 else 1024 * 1024)
        self._progress["sent"] = self._progress.get("sent", 0) + len(chunk)
        return chunk

    def close(self) -> None:
        self._f.close()


class Client:
    """HTTP zu Printloom. Hinter einer Anmeldung (authentik) per Basic-Auth mit
    Benutzer und (App-)Passwort; im Heimnetz ohne."""

    def __init__(self, url: str, user: str = "", password: str = ""):
        self.base = normalize_url(url)
        if not self.base:
            raise PrintloomError("keine Adresse")
        self._auth = ""
        if user or password:
            token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
            self._auth = f"Basic {token}"

    def request(self, method: str, path: str, body=None, headers=None, timeout: float = 15.0):
        hdrs = {"Accept": "application/json", "User-Agent": f"Printloom-Orca/{VERSION}"}
        hdrs.update(headers or {})
        if self._auth:
            hdrs["Authorization"] = self._auth
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=hdrs)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read()
                ctype = resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = json.loads(e.read() or b"{}").get("detail") or ""
            except (ValueError, AttributeError):
                detail = ""
            if e.code in (401, 403) and not detail:
                detail = "Anmeldung abgelehnt"
            raise PrintloomError(f"HTTP {e.code}{': ' + str(detail) if detail else ''}") from None
        except (urllib.error.URLError, OSError) as e:
            reason = getattr(e, "reason", None) or e
            raise PrintloomError(str(reason)) from None
        if "json" not in ctype:
            # Eine Anmeldeseite (authentik) statt der API: Zugangsdaten fehlen.
            raise PrintloomError("keine Printloom-Antwort (Anmeldeseite? Benutzer/Passwort prüfen)")
        return json.loads(raw or b"null")

    def info(self) -> dict:
        data = self.request("GET", "/api/slicer/info", timeout=8.0)
        if not isinstance(data, dict) or data.get("api") != API_VERSION:
            raise PrintloomError("Printloom zu alt oder zu neu für dieses Plugin")
        return data

    def check_gcode(self, data: bytes) -> dict:
        body = gzip.compress(data, compresslevel=1)
        return self.request("POST", "/api/slicer/check", body,
                            {"Content-Type": "application/octet-stream",
                             "Content-Encoding": "gzip"}, timeout=180.0)

    def upload(self, path: str, name: str, queue: bool, progress: dict,
               cancelled: threading.Event) -> dict:
        size = os.path.getsize(path)
        progress["total"] = size
        query = urllib.parse.urlencode({"filename": name, "queue": "true" if queue else "false"})
        body = _ProgressFile(path, progress, cancelled)
        try:
            return self.request("POST", "/api/slicer/upload?" + query, body,
                                {"Content-Type": "application/octet-stream",
                                 "Content-Length": str(size)}, timeout=900.0)
        finally:
            body.close()

    def overview(self) -> dict:
        return self.request("GET", "/api/slicer/overview")

    def printer_state(self) -> dict:
        return self.request("GET", "/api/slicer/printer/state", timeout=10.0)


class Settings:
    DEFAULTS = {"url": "", "user": "", "password": "", "check_after_slice": True,
                "send_queues": True}

    def __init__(self, folder: str = ""):
        # Bewusst nicht „config": Pfade mit „conf" blockt Orca für Plugins.
        self.path = os.path.join(folder, "settings.json") if folder else ""
        self.data = dict(self.DEFAULTS)

    def load(self) -> None:
        if not self.path or not os.path.exists(self.path):
            return
        try:
            with open(self.path, "r", encoding="utf-8") as f:
                stored = json.load(f)
            if isinstance(stored, dict):
                self.data.update({k: stored[k] for k in self.DEFAULTS if k in stored})
        except (OSError, ValueError) as e:
            _log(f"Einstellungen nicht lesbar: {e}")

    def update(self, new: dict) -> None:
        new = new or {}
        for key in ("url", "user"):
            if key in new:
                self.data[key] = str(new[key] or "").strip()
        self.data["url"] = normalize_url(self.data["url"])
        if new.get("clear_password"):
            self.data["password"] = ""
        elif new.get("password"):
            self.data["password"] = str(new["password"])
        for key in ("check_after_slice", "send_queues"):
            if key in new:
                self.data[key] = bool(new[key])
        if self.path:
            with open(self.path, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2)

    def public(self) -> dict:
        """Für die Seite — das Passwort selbst verlässt das Plugin nie."""
        out = {k: v for k, v in self.data.items() if k != "password"}
        out["has_password"] = bool(self.data.get("password"))
        return out

    def client(self) -> Client:
        if not self.data.get("url"):
            raise PrintloomError("keine Adresse")
        return Client(self.data["url"], self.data.get("user", ""), self.data.get("password", ""))


# ── Kern: Threads, Zustand, Benachrichtigungen ────────────────────────────────

class Core:
    """Gemeinsamer Zustand aller Teile des Plugins (Tab und Agent laufen im selben
    Modul, Orca instanziiert sie getrennt)."""

    def __init__(self):
        self.lock = threading.RLock()
        self.users = 0
        self.lang = "en"
        self.settings = Settings()
        self.pool = None
        self.stop_event = threading.Event()
        self.wake = threading.Event()
        self.page = None
        self.page_visible = False
        self.agent = None
        self.info = None
        self.info_error = None
        self.overview = None
        self.overview_error = None
        self.last_check = None
        self.last_send = None
        self._checked = {}

    # Lebenszyklus — Tab und Agent rufen beide; erst der letzte beendet.
    def start(self, storage_dir: str, lang: str) -> None:
        with self.lock:
            self.users += 1
            if self.users > 1:
                return
            self.lang = lang
            self.settings = Settings(storage_dir)
            self.settings.load()
            self.stop_event.clear()
            self.pool = ThreadPoolExecutor(max_workers=3, thread_name_prefix="printloom")
            threading.Thread(target=self._poll_loop, name="printloom-poll", daemon=True).start()
        if self.settings.data.get("url"):
            self.submit(self.refresh_info)

    def stop(self) -> None:
        with self.lock:
            self.users = max(0, self.users - 1)
            if self.users:
                return
            self.stop_event.set()
            self.wake.set()
            pool, self.pool = self.pool, None
        if pool:
            pool.shutdown(wait=False, cancel_futures=True)

    def submit(self, fn, *args):
        pool = self.pool
        if pool is None:
            raise PrintloomError("Plugin nicht gestartet")
        return pool.submit(self._guard, fn, *args)

    @staticmethod
    def _guard(fn, *args):
        try:
            return fn(*args)
        except PrintloomError as e:
            _log(f"{getattr(fn, '__name__', fn)}: {e}")   # erwartbar (Netz, Anmeldung)
            raise
        except Exception:
            _log(traceback.format_exc())
            raise

    # Netzwerk (nur aus eigenen Threads) ───────────────────────────────────────
    def refresh_info(self) -> dict:
        try:
            info = self.settings.client().info()
        except PrintloomError as e:
            with self.lock:
                self.info, self.info_error = None, str(e)
            self.push_page()
            raise
        with self.lock:
            self.info, self.info_error = info, None
        self.push_page()
        return info

    def refresh_overview(self) -> None:
        try:
            data = self.settings.client().overview()
            with self.lock:
                self.overview, self.overview_error = data, None
        except PrintloomError as e:
            with self.lock:
                self.overview_error = str(e)
        self.push_page()

    def check_after_slice(self, path: str, sig: tuple) -> None:
        """Teil 1 + 4: den eben exportierten Platten-G-code prüfen lassen. Die Datei
        wird sofort gelesen — Orca ersetzt sie beim nächsten Slicen."""
        with open(path, "rb") as f:
            data = f.read()
        try:
            result = self.settings.client().check_gcode(data)
        except PrintloomError as e:
            self.notify("warning", tr(self.lang, "check_failed", err=e))
            return
        with self.lock:
            self._checked[path] = sig
            self.last_check = {"at": time.time(), "name": os.path.basename(path),
                               "checks": [result]}
        self.announce_checks([result])
        self.push_page()

    def send_file(self, path: str, name: str, queue: bool, progress: dict,
                  cancelled: threading.Event) -> dict:
        """Teil 2: in die Bibliothek (und Warteschlange) — danach dieselbe Prüfung
        mit der echten Datei, je Platte."""
        result = self.settings.client().upload(path, name, queue, progress, cancelled)
        jobs = result.get("job_ids") or []
        with self.lock:
            self.last_send = {"at": time.time(), "name": result.get("file_name") or name,
                              "jobs": jobs}
            self.last_check = {"at": time.time(), "name": result.get("file_name") or name,
                               "checks": result.get("checks") or []}
        if jobs:
            label = tr(self.lang, "jobs_one") if len(jobs) == 1 else tr(self.lang, "jobs_many", n=len(jobs))
            self.notify("regular", tr(self.lang, "sent_queue", name=result.get("file_name") or name,
                                      jobs=label))
        else:
            self.notify("regular", tr(self.lang, "sent_library", name=result.get("file_name") or name))
        self.announce_checks(result.get("checks") or [], quiet_ok=True)
        self.wake.set()
        return result

    def announce_checks(self, checks: list, quiet_ok: bool = False) -> None:
        warnings, hints, summary = describe_checks(self.lang, checks)
        if warnings:
            self.notify("warning", "Printloom: " + " · ".join(warnings))
        elif not quiet_ok:
            self.notify("regular", summary)
        if hints:
            self.notify("hint", "Printloom: " + " · ".join(hints))

    # Orca-Ereignisse ──────────────────────────────────────────────────────────
    def on_export_finished(self, path: str) -> None:
        """Läuft auf dem Slicing-Thread: nur einreihen, nie warten, keine Oberfläche."""
        if not self.settings.data.get("check_after_slice") or not self.settings.data.get("url"):
            return
        if not path or not path.lower().endswith(".gcode") or not os.path.isfile(path):
            return
        st = os.stat(path)
        sig = (st.st_size, int(st.st_mtime))
        with self.lock:
            if self._checked.get(path) == sig:
                return
        self.submit(self.check_after_slice, path, sig)

    # Oberfläche ───────────────────────────────────────────────────────────────
    def notify(self, level: str, text: str) -> None:
        try:
            lvl = orca.host.ui.NotificationLevel
            kind = {"warning": lvl.WarningNotificationLevel, "hint": lvl.HintNotificationLevel}.get(
                level, lvl.RegularNotificationLevel)
            orca.host.ui.push_notification(kind, text)
        except Exception as e:
            _log(f"Hinweis nicht angezeigt ({e}): {text}")

    def page_state(self) -> dict:
        with self.lock:
            return {"type": "state", "lang": self.lang, "texts": PAGE_TEXT.get(self.lang, PAGE_TEXT["en"]),
                    "settings": self.settings.public(), "info": self.info,
                    "info_error": self.info_error, "overview": self.overview,
                    "overview_error": self.overview_error, "last_check": self.last_check,
                    "last_send": self.last_send,
                    "check_text": describe_checks(self.lang, (self.last_check or {}).get("checks") or [])
                    if self.last_check else None}

    def push_page(self) -> None:
        page = self.page
        if page is None:
            return
        try:
            page.post_message(self.page_state())
        except Exception as e:
            _log(f"Tab nicht aktualisiert: {e}")

    def on_page_message(self, data: dict) -> None:
        """Läuft auf dem Oberflächen-Thread: kurz halten, Netzwerk in den Pool."""
        kind = (data or {}).get("type")
        if kind == "ready":
            # Beim Laden kennt Orca seine Sprache evtl. noch nicht — jetzt schon.
            self.lang = _detect_lang(self.lang)
            self.page_visible = True
            self.push_page()
            if self.settings.data.get("url"):
                self.submit(self.refresh_overview)
        elif kind == "visible":
            self.page_visible = bool(data.get("visible"))
            if self.page_visible:
                self.wake.set()
        elif kind in ("save", "test"):
            self.submit(self._save_and_test, data.get("settings") or {})
        elif kind == "refresh":
            self.submit(self.refresh_overview)

    def _save_and_test(self, new: dict) -> None:
        self.settings.update(new)
        try:
            self.refresh_info()
        except PrintloomError:
            return
        self.refresh_overview()
        agent = self.agent
        if agent is not None:
            agent.announce()

    # Hintergrund: Geräte-Tab und Printloom-Tab aktuell halten ─────────────────
    def _poll_loop(self) -> None:
        last_status = last_overview = 0.0
        while not self.stop_event.is_set():
            now = time.monotonic()
            agent = self.agent
            try:
                if agent is not None and agent.dev_id and now - last_status >= STATUS_INTERVAL_S:
                    last_status = now
                    agent.poll_state()
                if self.page is not None and self.page_visible and self.settings.data.get("url") \
                        and now - last_overview >= OVERVIEW_INTERVAL_S:
                    last_overview = now
                    self.refresh_overview()
            except Exception:
                _log(traceback.format_exc())
            self.wake.wait(1.0)
            if self.wake.is_set():
                self.wake.clear()
                last_status = last_overview = 0.0


CORE = Core()


def _detect_lang(fallback: str = "en") -> str:
    try:
        return "de" if (orca.host.app_language() or "").lower().startswith("de") else "en"
    except Exception:
        return fallback          # Oberfläche noch nicht bereit


def _start_core() -> None:
    try:
        storage = orca.host.plugin.storage()
    except Exception as e:
        _log(f"kein Plugin-Ordner ({e}) — Einstellungen werden nicht gespeichert")
        storage = ""
    CORE.start(storage, _detect_lang())


# ── Teil 5: Tab „Printloom" ───────────────────────────────────────────────────

PAGE_HTML = r"""<!doctype html>
<html><head><meta charset="utf-8">
<style>
  body { font-family: var(--orca-font); color: var(--orca-fg); background: var(--orca-bg);
         margin: 0; padding: 14px 18px; font-size: 13px; }
  h1 { font-size: 17px; margin: 0; }
  h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .05em;
       color: var(--orca-muted); margin: 0 0 6px; }
  .bar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
  .grow { flex: 1; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; }
  .card { border: 1px solid var(--orca-border); border-radius: 6px; padding: 10px 12px; }
  .muted { color: var(--orca-muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: var(--orca-muted); }
  .dot.ok { background: #2e9d5b; } .dot.bad { background: #c8423a; }
  .row { display: flex; justify-content: space-between; gap: 8px; padding: 2px 0; }
  .prog { height: 5px; background: var(--orca-border); border-radius: 3px; overflow: hidden; margin: 4px 0; }
  .prog > div { height: 100%; background: var(--orca-accent); }
  .chip { display: inline-flex; align-items: center; gap: 5px; border: 1px solid var(--orca-border);
          border-radius: 12px; padding: 2px 8px; margin: 2px 4px 2px 0; }
  .sw { width: 11px; height: 11px; border-radius: 50%; border: 1px solid var(--orca-border); }
  .msg { padding: 6px 8px; border-radius: 5px; border: 1px solid var(--orca-border); margin: 4px 0; }
  .msg.warn { border-color: #d08a12; } .msg.bad { border-color: #c8423a; }
  label { display: block; margin: 6px 0 2px; }
  input[type=text], input[type=password] { width: 100%; box-sizing: border-box; padding: 4px 6px; }
  .check { display: flex; gap: 6px; align-items: center; margin: 6px 0; }
  .check label { margin: 0; }
  details > summary { cursor: pointer; }
  ul { margin: 0; padding-left: 16px; }
</style></head>
<body>
  <div class="bar"><span id="dot" class="dot"></span><h1 id="title">Printloom</h1>
    <span id="conn" class="muted grow"></span><button id="refresh"></button></div>
  <div id="cards" class="grid"></div>
  <details id="settings" class="card" style="margin-top:10px">
    <summary id="s_title"></summary>
    <label for="url" id="l_url"></label><input id="url" type="text">
    <div class="muted" id="h_url"></div>
    <label for="user" id="l_user"></label><input id="user" type="text" autocomplete="off">
    <label for="password" id="l_password"></label><input id="password" type="password" autocomplete="off">
    <div class="check"><input id="clear_password" type="checkbox"><label for="clear_password" id="l_clear"></label></div>
    <div class="check"><input id="check_after_slice" type="checkbox"><label for="check_after_slice" id="l_check"></label></div>
    <div class="check"><input id="send_queues" type="checkbox"><label for="send_queues" id="l_queue"></label></div>
    <div style="margin-top:8px"><button id="save"></button> <span id="s_msg" class="muted"></span></div>
  </details>
<script>
let S = null, T = {};
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const t = (k, v) => (T[k] || k).replace(/\{(\w+)\}/g, (_, n) => (v && v[n] !== undefined) ? v[n] : '');
function card(title, html) { return `<div class="card"><h2>${esc(title)}</h2>${html}</div>`; }

function render() {
  if (!S) return;
  T = S.texts || {};
  $('refresh').textContent = t('refresh'); $('s_title').textContent = t('settings');
  $('l_url').textContent = t('url'); $('h_url').textContent = t('url_hint');
  $('l_user').textContent = t('user'); $('l_password').textContent = t('password');
  $('l_clear').textContent = t('password_clear'); $('l_check').textContent = t('check_after_slice');
  $('l_queue').textContent = t('send_queues'); $('save').textContent = t('save');
  const st = S.settings || {};
  if (document.activeElement?.tagName !== 'INPUT') {
    $('url').value = st.url || ''; $('user').value = st.user || '';
    $('password').placeholder = st.has_password ? t('password_saved') : '';
    $('check_after_slice').checked = !!st.check_after_slice; $('send_queues').checked = !!st.send_queues;
  }
  const ok = !!S.info;
  $('dot').className = 'dot ' + (ok ? 'ok' : (st.url ? 'bad' : ''));
  $('conn').textContent = ok ? t('connected', {v: S.info.version}) : (S.info_error ? `${t('not_connected')} — ${S.info_error}` : t('not_connected'));
  if (!ok) $('settings').open = true;

  const o = S.overview, cards = [];
  if (o) {
    const f = o.farm || {};
    const fs = f.stopping ? t('stopping') : f.paused ? t('paused') : f.running ? (f.idle ? t('idle') : t('running')) : t('stopped');
    let fh = `<div class="row"><span>${esc(fs)}</span>${f.countdown ? `<span class="muted">${esc(t('countdown', {s: f.countdown}))}</span>` : ''}</div>`;
    if (f.error) fh += `<div class="msg bad">${esc(f.error)}</div>`;
    if (f.current) fh += `<div class="row"><span>${esc(t('current'))}</span><span>${esc(f.current.name)}${f.current.plate ? ' · ' + esc(t('plate', {n: f.current.plate})) : ''}</span></div>`;
    cards.push(card(t('farm'), fh));

    const j = o.jobs || {};
    let jh = `<div class="row muted"><span>${j.pending || 0} ${esc(t('pending'))}</span><span>${j.done || 0} ${esc(t('done'))}</span><span>${j.error || 0} ${esc(t('error'))}</span></div>`;
    const list = (j.list || []).map(x => `<li>${esc(x.name)}${x.plate ? ' · ' + esc(x.plate_name || t('plate', {n: x.plate})) : ''}${x.status !== 'pending' ? ` <span class="muted">(${esc(t(x.status) || x.status)})</span>` : ''}</li>`).join('');
    jh += list ? `<ul>${list}</ul>` : `<div class="muted">${esc(t('empty_queue'))}</div>`;
    cards.push(card(t('queue'), jh));

    const r = o.rack || {};
    cards.push(card(t('rack'), `<div>${esc(t('free_slots', {free: r.free ?? '?', total: r.total ?? '?'}))}</div><div class="muted">${esc(t('empty_plates', {n: r.empty_plates ?? '?'}))}</div>`));

    const p = o.printer;
    if (p) {
      let ph = `<div class="row"><span>${esc(p.name)}</span><span class="muted">${esc(p.connected ? (p.state || t('unknown')) : t('offline'))}</span></div>`;
      if (p.subtask) ph += `<div class="muted">${esc(p.subtask)}</div>`;
      if (typeof p.progress === 'number' && p.state === 'RUNNING') {
        ph += `<div class="prog"><div style="width:${Math.max(0, Math.min(100, p.progress))}%"></div></div>`;
        ph += `<div class="row muted"><span>${esc(t('progress', {p: p.progress}))}</span>${p.remaining_min != null ? `<span>${esc(t('remaining', {m: p.remaining_min}))}</span>` : ''}${p.total_layers ? `<span>${esc(t('layer', {a: p.layer || 0, b: p.total_layers}))}</span>` : ''}</div>`;
      }
      const temp = (k, v) => v != null ? `<span>${esc(t(k))} ${Math.round(v)} °C</span>` : '';
      ph += `<div class="row muted">${temp('nozzle', p.nozzle)}${temp('bed', p.bed)}${temp('chamber', p.chamber)}</div>`;
      cards.push(card(t('printer'), ph));
    }
    const ams = (o.ams || []).map(a => `<span class="chip"><span class="sw" style="background:#${esc(a.color || '000000')}"></span>${esc(a.label)} ${esc(a.type)}${a.remain >= 0 ? ' ' + a.remain + ' %' : ''}</span>`).join('');
    if (ams) cards.push(card(t('ams'), ams));
  } else if (S.overview_error && st.url) {
    cards.push(card(t('farm'), `<div class="msg bad">${esc(S.overview_error)}</div>`));
  }

  let ch = `<div class="muted">${esc(t('nothing_yet'))}</div>`;
  if (S.last_check && S.check_text) {
    const [warns, hints, summary] = S.check_text;
    ch = `<div class="muted">${esc(S.last_check.name)}</div>`;
    ch += warns.length ? warns.map(w => `<div class="msg warn">${esc(w)}</div>`).join('') : `<div class="msg">${esc(summary)}</div>`;
    ch += hints.map(h => `<div class="muted">${esc(h)}</div>`).join('');
  }
  cards.push(card(t('last_check'), ch));
  if (S.last_send) cards.push(card(t('last_send'), `<div>${esc(S.last_send.name)}</div><div class="muted">${esc((S.last_send.jobs || []).map(i => '#' + i).join(', '))}</div>`));
  $('cards').innerHTML = cards.join('');
}

orca.onMessage(d => { if (d && d.type === 'state') { S = d; render(); } });
$('refresh').onclick = () => orca.postMessage({type: 'refresh'});
$('save').onclick = () => {
  orca.postMessage({type: 'save', settings: {
    url: $('url').value, user: $('user').value, password: $('password').value,
    clear_password: $('clear_password').checked,
    check_after_slice: $('check_after_slice').checked, send_queues: $('send_queues').checked}});
  $('password').value = ''; $('clear_password').checked = false; $('s_msg').textContent = t('saved');
  setTimeout(() => $('s_msg').textContent = '', 3000);
};
document.addEventListener('visibilitychange', () => orca.postMessage({type: 'visible', visible: !document.hidden}));
orca.postMessage({type: 'ready'});
</script>
</body></html>
"""


class PrintloomTab(orca.pages.PagesPluginCapabilityBase):
    """Teil 5 — und der Empfänger der Slicing-Ereignisse (Teil 1): Jede Fähigkeit
    bekommt jedes Ereignis, also hört genau eine hin."""

    def get_name(self):
        return "Printloom"

    def get_ui(self):
        return PAGE_HTML

    def on_load(self):
        _start_core()
        CORE.page = self

    def on_unload(self):
        if CORE.page is self:
            CORE.page = None
        CORE.stop()

    def on_message(self, data):
        CORE.on_page_message(data)

    def on_lifecycle_event(self, event, ctx):
        if event == orca.LifecycleEvent.GCodeExportFinished and ctx.code == orca.LifecycleEvtCode.Ok:
            CORE.on_export_finished(ctx.msg)


# ── Teil 2 + 3: Drucker-Agent „Printloom" ─────────────────────────────────────

pa = orca.printer_agent


def _call(fn, *args):
    if fn is None:
        return None
    try:
        return fn(*args)
    except Exception as e:
        _log(f"Orca-Rückruf fehlgeschlagen: {e}")
        return None


class PrintloomAgent(pa.PrinterAgentBase):
    """Orca sieht die Farm als Drucker: Senden und Drucken legen den Druck in
    Printlooms Warteschlange, der Geräte-Tab zeigt den Drucker über Printloom.

    Befehle an den Drucker (Achsen, Temperaturen, Licht) beantwortet der Agent mit
    „nicht unterstützt": Was Hardware bewegt, bleibt in Printloom."""

    def __init__(self):
        super().__init__()
        self.cb = {}
        self.selected = ""
        self.dev_id = ""
        self.access_code = ""
        self._lost = False

    def get_name(self):
        return "Printloom"

    def get_agent_info(self):
        return pa.AgentInfo(AGENT_ID, "Printloom", VERSION, tr(CORE.lang, "agent_desc"))

    def on_load(self):
        _start_core()
        CORE.agent = self

    def on_unload(self):
        if CORE.agent is self:
            CORE.agent = None
        CORE.stop()

    # Rückrufe der Host-Seite ─────────────────────────────────────────────────
    def _store(self, key, fn):
        self.cb[key] = fn
        return 0

    def set_on_ssdp_msg_fn(self, fn): return self._store("ssdp", fn)
    def set_on_local_connect_fn(self, fn): return self._store("local_connect", fn)
    def set_on_local_message_fn(self, fn): return self._store("local_message", fn)
    def set_on_message_fn(self, fn): return self._store("message", fn)
    def set_on_user_message_fn(self, fn): return self._store("user_message", fn)
    def set_on_printer_connected_fn(self, fn): return self._store("printer_connected", fn)
    def set_on_subscribe_failure_fn(self, fn): return self._store("subscribe_failure", fn)
    def set_server_callback(self, fn): return self._store("server_error", fn)
    def set_queue_on_main_fn(self, fn): return self._store("queue_on_main", fn)

    def _emit(self, key, *args):
        _call(self.cb.get(key), *args)

    # Suche und Auswahl ───────────────────────────────────────────────────────
    def start_discovery(self, start, sending):
        if start:
            self.announce()
        return True

    def announce(self):
        """Die Farm als Gerät melden. Ist im Drucker-Profil keine Adresse eingetragen,
        wählt Orca dieses Gerät, weil es das einzige des Agenten ist."""
        url = CORE.settings.data.get("url")
        if not url:
            return
        try:
            CORE.submit(self._announce, device_id_for(url))
        except PrintloomError as e:
            _log(f"Ankündigung später: {e}")

    def _announce(self, dev):
        info = CORE.info or CORE.refresh_info()
        model = next((p.get("dev_model") for p in info.get("printers") or [] if p.get("dev_model")), "")
        self._emit("ssdp", json.dumps({
            "dev_id": dev, "dev_name": "Printloom", "dev_ip": dev, "dev_type": model,
            "dev_signal": "", "connect_type": "lan", "bind_state": "free",
            "connection_name": "Printloom"}))

    def get_user_selected_machine(self):
        return self.selected

    def set_user_selected_machine(self, dev_id):
        self.selected = dev_id or ""
        return 0

    # Verbindung ──────────────────────────────────────────────────────────────
    def connect_printer(self, params):
        self.dev_id = params.dev_id or device_id_for(CORE.settings.data.get("url", ""))
        self.access_code = params.password or ""
        try:
            CORE.submit(self._connect)
        except PrintloomError as e:
            self._emit("local_connect", 1, self.dev_id, str(e))
            return -1
        return 0

    def _connect(self):
        dev = self.dev_id
        try:
            CORE.refresh_info()
        except PrintloomError as e:
            self._emit("local_connect", 1, dev, str(e))
            return
        self._emit("local_connect", 0, dev, "")
        self._emit("local_message", dev, json.dumps(version_reply((CORE.info or {}).get("version"))))
        self.poll_state()

    def disconnect_printer(self):
        self.dev_id = ""
        return 0

    def poll_state(self):
        """Aus dem Poll-Thread: Druckerzustand holen und als Geräte-Bericht melden."""
        dev = self.dev_id
        if not dev:
            return
        try:
            state = CORE.settings.client().printer_state()
        except PrintloomError as e:
            if not self._lost:
                self._lost = True
                self._emit("local_connect", 2, dev, str(e))
            return
        if self._lost:
            self._lost = False
            self._emit("local_connect", 0, dev, "")
        self._emit("local_message", dev, json.dumps(build_status_payload(state, time.time() * 1000)))

    # Befehle aus Orca ────────────────────────────────────────────────────────
    def send_message(self, dev_id, json_str, qos, flag):
        return self._handle(dev_id, json_str)

    def send_message_to_printer(self, dev_id, json_str, qos, flag):
        return self._handle(dev_id, json_str)

    def _handle(self, dev_id, json_str):
        try:
            msg = json.loads(json_str)
        except (TypeError, ValueError):
            return -1
        if ((msg.get("info") or {}).get("command")) == "get_version":
            self._emit("local_message", dev_id, json.dumps(version_reply((CORE.info or {}).get("version"))))
            return 0
        if ((msg.get("system") or {}).get("command")) == "get_access_code":
            self._emit("local_message", dev_id, json.dumps(
                {"system": {"command": "get_access_code", "access_code": self.access_code}}))
            return 0
        if ((msg.get("print") or {}).get("command")) == "pushall":
            CORE.wake.set()
            return 0
        return NOT_SUPPORTED

    # Aufträge ────────────────────────────────────────────────────────────────
    def start_send_gcode_to_sdcard(self, params, update_fn, cancel_fn, wait_fn):
        if params.project_name == "verify_job":
            # Orcas Probe vor jedem Senden („stimmen Adresse und Zugangscode?").
            # Nichts hochladen, nur prüfen, ob Printloom antwortet.
            try:
                CORE.submit(CORE.refresh_info).result(timeout=15)
                return 0
            except Exception:
                return ERR_CONNECT
        return self._send(params, update_fn, cancel_fn,
                          bool(CORE.settings.data.get("send_queues", True)))

    def start_local_print(self, params, update_fn, cancel_fn):
        return self._send(params, update_fn, cancel_fn, True)

    def start_local_print_with_record(self, params, update_fn, cancel_fn, wait_fn):
        return self._send(params, update_fn, cancel_fn, True)

    def start_print(self, params, update_fn, cancel_fn, wait_fn):
        return self._send(params, update_fn, cancel_fn, True)

    def start_sdcard_print(self, params, update_fn, cancel_fn):
        return NOT_SUPPORTED

    def _send(self, params, update_fn, cancel_fn, queue: bool) -> int:
        """Läuft auf Orcas Job-Thread: das Hochladen geschieht im Pool, hier wird
        gewartet, Fortschritt gemeldet und auf Abbruch geachtet."""
        path = params.filename or ""
        if not os.path.isfile(path):
            return ERR_FILE
        if not CORE.settings.data.get("url"):
            CORE.notify("warning", tr(CORE.lang, "not_configured"))
            return ERR_CONNECT
        _call(update_fn, STAGE_CREATE, 0, tr(CORE.lang, "preparing"))
        progress = {"sent": 0, "total": os.path.getsize(path) or 1}
        cancelled = threading.Event()
        try:
            future = CORE.submit(CORE.send_file, path, upload_name(params.project_name, path),
                                 queue, progress, cancelled)
        except PrintloomError:
            return ERR_CONNECT
        while not future.done():
            if cancel_fn is not None and _call(cancel_fn):
                cancelled.set()
                try:
                    future.result(timeout=30)
                except Exception:
                    pass
                return ERR_CANCELED
            pct = min(99, int(100 * progress["sent"] / max(1, progress["total"])))
            _call(update_fn, STAGE_UPLOAD, pct, tr(CORE.lang, "uploading", pct=pct))
            time.sleep(0.25)
        try:
            future.result()
        except Exception as e:
            CORE.notify("warning", tr(CORE.lang, "send_failed", err=e))
            _call(update_fn, STAGE_ERROR, 0, str(e))
            return ERR_UPLOAD
        _call(update_fn, STAGE_FINISHED, 100, tr(CORE.lang, "sent"))
        return 0

    # Binden/Zertifikate: gibt es bei Printloom nicht ──────────────────────────
    def bind_detect(self, dev_ip, sec_link, detect):
        detect.dev_id = device_id_for(CORE.settings.data.get("url", "")) or dev_ip
        detect.dev_name = "Printloom"
        detect.connect_type = "lan"
        detect.bind_state = "free"
        return 0

    def check_cert(self): return 0
    def ping_bind(self, ping_code): return 0
    def bind(self, dev_ip, dev_id, dev_model, sec_link, timezone, improved, update_fn): return 0
    def unbind(self, dev_id): return 0
    def request_bind_ticket(self): return (0, "")

    # AMS-Abgleich in der Seitenleiste: die AMS-Daten kommen mit jedem Bericht.
    def get_filament_sync_mode(self):
        return pa.FilamentSyncMode.Subscription

    def get_camera_stream_mode(self):
        return pa.CameraStreamMode.None_


@orca.plugin
class PrintloomPlugin(orca.base):
    def register_capabilities(self):
        # Eigene Threads, damit Orca beim Prüfen und Senden nie wartet. Orca fragt
        # einmal beim ersten Laden; Netzwerk geht nur an die eingetragene Adresse.
        orca.request_permissions(threading=True)
        orca.register_capability(PrintloomTab)
        orca.register_capability(PrintloomAgent)
