"""Small persisted app-level settings that don't belong to a single device.

Currently holds the marketplace connection (server URL + om4d_ API token).
Stored as plain JSON via the atomic ``storage`` module so concurrent reads from
the farm loop / health checks are safe. The token is a user-supplied bearer
token; it is intentionally kept out of the Docker image and git (db/ is mounted
at runtime and gitignored).
"""
import os
from pathlib import Path

from app.services import storage

_DB_CANDIDATES = [
    Path("/app/db"),
    Path(os.path.join(os.path.dirname(__file__), "../../db")),
]


def _db_dir() -> Path:
    for p in _DB_CANDIDATES:
        if p.exists():
            return p
    _DB_CANDIDATES[-1].mkdir(parents=True, exist_ok=True)
    return _DB_CANDIDATES[-1]


def _marketplace_file() -> str:
    return str(_db_dir() / "marketplace.json")


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
