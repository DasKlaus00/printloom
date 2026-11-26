"""Kleine App-weite Einstellungen, die zu keinem einzelnen Gerät gehören.

Derzeit: der globale Kamera-Schalter (Energiesparmodus). Gespeichert über das
atomare ``storage``-Modul, damit gleichzeitiges Lesen aus Farm und Health-Checks
sicher ist.
"""
import re
from pathlib import Path
from typing import Optional

from app.services import storage
from app.paths import DB_DIR


def _db_dir() -> Path:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return DB_DIR


# ── Kamera (global) ──────────────────────────────────────────────────────────
# disabled=True schaltet den ffmpeg-Kamerapfad KOMPLETT ab (Live-Stream +
# RTSPS-Snapshots) — für schwache Geräte (z. B. Raspberry Pi), wo der
# MJPEG-Transcode sonst alle Kerne auslastet. Externe Webcams (HTTP-URL)
# bleiben bewusst funktionsfähig (kostet keine CPU).
# Seit v1.0.150 ist die Kamera bei NEUINSTALLATIONEN standardmäßig deaktiviert;
# bestehende Installationen friert init_camera_default() auf „aktiv" ein.

CAMERA_DEFAULTS = {"disabled": True}


def _camera_file() -> str:
    return str(_db_dir() / "camera_settings.json")


def init_camera_default() -> None:
    """Einmal beim App-Start VOR init_db() aufrufen (main.py). Existiert noch
    keine camera_settings.json, aber schon eine Datenbank (= bestehende
    Installation, die gerade updated), wird die Kamera explizit auf AKTIV
    festgeschrieben — der neue Default „deaktiviert" gilt nur für echte
    Neuinstallationen."""
    try:
        if Path(_camera_file()).exists():
            return
        if (_db_dir() / "printloom.db").exists():
            write_camera({"disabled": False})
    except Exception:
        pass


def read_camera() -> dict:
    cfg = dict(CAMERA_DEFAULTS)
    stored = storage.read_json(_camera_file(), {}) or {}
    if isinstance(stored, dict):
        cfg.update({k: v for k, v in stored.items() if k in CAMERA_DEFAULTS})
    cfg["disabled"] = bool(cfg.get("disabled"))
    return cfg


def write_camera(cfg: dict) -> dict:
    merged = read_camera()
    if isinstance(cfg, dict) and "disabled" in cfg:
        merged["disabled"] = bool(cfg["disabled"])
    storage.write_json(_camera_file(), merged)
    return merged


# Eine Stelle für die Meldung (bis v1.1.76 viermal kopiert und mit falschem Ort
# „System → Kamera"; der Schalter liegt unter Konfiguration → Kameras).
CAMERA_DISABLED_TEXT = "Kamera in Printloom deaktiviert (Konfiguration → Kameras) — Energiesparmodus"


def camera_disabled() -> bool:
    """Fail-soft: bei Lesefehlern gilt die Kamera als AKTIV (kein Funktionsverlust)."""
    try:
        return bool(read_camera().get("disabled"))
    except Exception:
        return False


# ── Update-Kanal (latest/beta) ───────────────────────────────────────────────
# Der Kanal gehört zur Installation, nicht zum Browser. Bis v1.1.63 stand er im
# localStorage: Ein anderer Browser (Standard „latest") hätte eine Beta-Installation
# beim nächsten Klick auf „Update" auf den stabilen Stand zurückgestuft.
CHANNELS = ("latest", "beta")


def _channel_file() -> str:
    return str(_db_dir() / "update_channel.json")


def read_update_channel() -> str:
    try:
        ch = (storage.read_json(_channel_file(), {}) or {}).get("channel")
    except (OSError, ValueError):
        ch = None
    return ch if ch in CHANNELS else "latest"


def write_update_channel(channel: str) -> None:
    if channel in CHANNELS:
        storage.write_json(_channel_file(), {"channel": channel})


# ── Sprache der Oberfläche (seit v1.1.91) ────────────────────────────────────
# Bis v1.1.90 stand die Wahl nur im localStorage des Browsers. Neue Adresse (Windows-
# App auf anderem Port, neue Domain), anderer Browser oder gelöschte Website-Daten —
# und die Oberfläche war wieder deutsch. Jetzt gilt sie für die ganze Installation.
# `active` = im Store aktivierte Sprachen (Codes); welche es gibt, weiß das Frontend
# (services/lang/catalog.js) — hier wird nur die Form geprüft, nicht der Katalog.
LANG_CODE = re.compile(r"^[a-z]{2,3}(-[a-z0-9]{2,8})?$")
LANG_ACTIVE_MAX = 50


def _ui_language_file() -> str:
    return str(_db_dir() / "ui_language.json")


def clean_lang_code(code) -> Optional[str]:
    """„zh-CN" → „zh-cn"; alles, was keine Sprachkennung ist, → None."""
    c = str(code or "").strip().lower().replace("_", "-")
    return c if LANG_CODE.match(c) else None


def read_ui_language() -> dict:
    """{"language": code|None, "active": [codes]|None} — None = noch nie gewählt."""
    try:
        data = storage.read_json(_ui_language_file(), {}) or {}
    except (OSError, ValueError):
        data = {}
    lang = clean_lang_code(data.get("language"))
    active = data.get("active")
    if isinstance(active, list):
        active = [c for c in (clean_lang_code(a) for a in active) if c][:LANG_ACTIVE_MAX]
    else:
        active = None
    return {"language": lang, "active": active}


def write_ui_language(language=None, active=None) -> dict:
    """Nur übergebene Felder ändern. ValueError bei ungültiger Kennung."""
    cur = read_ui_language()
    if language is not None:
        lang = clean_lang_code(language)
        if not lang:
            raise ValueError("Ungültige Sprachkennung")
        cur["language"] = lang
    if active is not None:
        if not isinstance(active, list) or len(active) > LANG_ACTIVE_MAX:
            raise ValueError("Ungültige Liste aktiver Sprachen")
        codes = []
        for a in active:
            c = clean_lang_code(a)
            if not c:
                raise ValueError("Ungültige Sprachkennung")
            if c not in codes:
                codes.append(c)
        cur["active"] = codes
    storage.write_json(_ui_language_file(), cur)
    return cur
