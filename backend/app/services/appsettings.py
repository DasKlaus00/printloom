"""Kleine App-weite Einstellungen, die zu keinem einzelnen Gerät gehören.

Derzeit: der globale Kamera-Schalter (Energiesparmodus). Gespeichert über das
atomare ``storage``-Modul, damit gleichzeitiges Lesen aus Farm und Health-Checks
sicher ist.
"""
from pathlib import Path

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
