"""Small persisted app-level settings that don't belong to a single device.

Currently holds the marketplace connection (server URL + om4d_ API token).
Stored as plain JSON via the atomic ``storage`` module so concurrent reads from
the farm loop / health checks are safe. The token is a user-supplied bearer
token; it is intentionally kept out of the Docker image and git (db/ is mounted
at runtime and gitignored).
"""
from pathlib import Path

from app.services import storage
from app.paths import DB_DIR


def _db_dir() -> Path:
    DB_DIR.mkdir(parents=True, exist_ok=True)
    return DB_DIR


def _marketplace_file() -> str:
    return str(_db_dir() / "marketplace.json")


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


def camera_disabled() -> bool:
    """Fail-soft: bei Lesefehlern gilt die Kamera als AKTIV (kein Funktionsverlust)."""
    try:
        return bool(read_camera().get("disabled"))
    except Exception:
        return False


MARKETPLACE_DEFAULTS = {
    "server_url": "https://marketplace.alexsz.de",
    "token": "",
}


def read_marketplace() -> dict:
    """Return marketplace settings merged over defaults (always all keys present)."""
    cfg = dict(MARKETPLACE_DEFAULTS)
    stored = storage.read_json(_marketplace_file(), {}) or {}
    if isinstance(stored, dict):
        cfg.update({k: v for k, v in stored.items() if k in MARKETPLACE_DEFAULTS})
    # normalise: strip trailing slash so we can concatenate paths safely
    cfg["server_url"] = (cfg.get("server_url") or "").strip().rstrip("/")
    cfg["token"] = (cfg.get("token") or "").strip()
    return cfg


def write_marketplace(cfg: dict) -> dict:
    """Persist marketplace settings (only known keys), return the stored result."""
    merged = read_marketplace()
    for k in MARKETPLACE_DEFAULTS:
        if k in cfg and cfg[k] is not None:
            merged[k] = str(cfg[k]).strip()
    merged["server_url"] = merged["server_url"].rstrip("/")
    storage.write_json(_marketplace_file(), merged)
    return merged
