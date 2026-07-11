"""Zentrale, plattformübergreifende Pfad-Auflösung.

Bis v1.0.141 waren Datenpfade an ~20 Stellen als feste Docker-Strings
(``/app/db/...``, ``/app/uploads``, ``/app/frontend/dist``) verdrahtet. Für die
native Desktop-Version (Windows/macOS, PyInstaller) muss der Datenordner in ein
beschreibbares Nutzerverzeichnis wandern, während die Docker-Version **unverändert**
weiter unter ``/app`` läuft. Diese Datei ist die EINZIGE Quelle der Wahrheit dafür.

Drei Laufzeit-Modi (``RUNTIME``):

* ``docker``  – im Container: ``/app`` existiert → alles bleibt wie bisher.
* ``native``  – gebündelte Desktop-App (``sys.frozen``): Daten in
  ``%APPDATA%/Printloom`` (Windows) bzw. ``~/Library/Application Support/Printloom``
  (macOS); Frontend/ffmpeg/version.txt kommen aus dem PyInstaller-Bundle.
* ``dev``     – lokaler Quellcode-Checkout: Daten unter ``backend/`` (wie zuvor der
  ``else``-Zweig von ``database.py``/``files.py``).

Override jederzeit per Umgebungsvariable ``PRINTLOOM_DATA_DIR``.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

APP_NAME = "Printloom"

# Verzeichnis von backend/app  → parents[1] = backend/
_APP_DIR = Path(__file__).resolve().parent
_BACKEND_DIR = _APP_DIR.parent


def _is_frozen() -> bool:
    """True, wenn als PyInstaller-Bundle gestartet (Desktop-App)."""
    return bool(getattr(sys, "frozen", False))


def _bundle_dir() -> Path:
    """Verzeichnis der gebündelten Ressourcen (PyInstaller ``_MEIPASS``)."""
    mei = getattr(sys, "_MEIPASS", None)
    if mei:
        return Path(mei)
    return _BACKEND_DIR


def _user_data_base() -> Path:
    """Betriebssystem-typischer, pro-Nutzer beschreibbarer Basisordner."""
    if sys.platform == "win32":
        base = os.environ.get("APPDATA") or str(Path.home() / "AppData" / "Roaming")
    elif sys.platform == "darwin":
        base = str(Path.home() / "Library" / "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base)


def _resolve_runtime() -> str:
    if os.path.exists("/app"):
        return "docker"
    if _is_frozen():
        return "native"
    return "dev"


RUNTIME = _resolve_runtime()


def _resolve_data_root() -> Path:
    # 1) Expliziter Override hat immer Vorrang.
    env = os.environ.get("PRINTLOOM_DATA_DIR")
    if env:
        return Path(env)
    # 2) Docker: unverändert /app (db/ + uploads/ liegen als Volume darunter).
    if RUNTIME == "docker":
        return Path("/app")
    # 3) Native Desktop-App: pro-Nutzer-Datenordner.
    if RUNTIME == "native":
        return _user_data_base() / APP_NAME
    # 4) Lokaler Dev-Checkout: backend/ (wie bisher backend/db, backend/uploads).
    return _BACKEND_DIR


DATA_ROOT = _resolve_data_root()
DB_DIR = DATA_ROOT / "db"
UPLOADS_DIR = DATA_ROOT / "uploads"


def ensure_dirs() -> None:
    """Datenordner anlegen (idempotent). Beim Start einmal aufrufen."""
    DB_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def db_path(name: str) -> str:
    """Absoluter Pfad einer Datei im db-Ordner, als str (für storage.*)."""
    return str(DB_DIR / name)


def uploads_path(name: str) -> str:
    return str(UPLOADS_DIR / name)


def frontend_dir() -> Path:
    """Verzeichnis des gebauten Frontends (``dist``)."""
    if RUNTIME == "docker":
        return Path("/app/frontend/dist")
    if RUNTIME == "native":
        return _bundle_dir() / "frontend" / "dist"
    # Dev: gebautes Frontend im Repo (frontend/dist).
    return _BACKEND_DIR.parent / "frontend" / "dist"


def version_file() -> Path:
    """Pfad zur version.txt (je nach Laufzeit)."""
    if RUNTIME == "docker":
        return Path("/app/version.txt")
    if RUNTIME == "native":
        return _bundle_dir() / "version.txt"
    return _BACKEND_DIR / "version.txt"


def resolve_ffmpeg() -> str:
    """ffmpeg-Aufrufpfad. Nativ: gebündelte Binärdatei bevorzugen, sonst PATH.

    Reihenfolge: neben der EXE liegendes ffmpeg → im Bundle (_MEIPASS) →
    blanker Name ``ffmpeg`` (nutzt System-PATH, wie in Docker)."""
    exe = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    candidates = []
    if _is_frozen():
        # 1) neben der ausführbaren Datei (Installer legt es dort ab)
        candidates.append(Path(sys.executable).resolve().parent / exe)
        # 2) im entpackten Bundle
        candidates.append(_bundle_dir() / exe)
    for c in candidates:
        if c.is_file():
            return str(c)
    return "ffmpeg"
