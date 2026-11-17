"""Central JSON persistence with atomic writes + per-path locking.

Why: the AutoFarm background loop and the API handlers read/write the same JSON
files in backend/db/ concurrently. Plain open()+json.dump can interleave writes
or leave a truncated/corrupt file if the process dies mid-write. This module
serializes access per file path (threading.Lock) and writes atomically via a
temp file + os.replace, so readers never observe a partially written file.

All routers should go through read_json/write_json instead of opening files
directly.
"""
import hashlib
import json
import logging
import os
import shutil
import threading
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# One lock per absolute path, created on demand.
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(path: str) -> threading.Lock:
    key = os.path.abspath(path)
    with _locks_guard:
        lk = _locks.get(key)
        if lk is None:
            lk = threading.Lock()
            _locks[key] = lk
        return lk


class BrokenFile(Exception):
    """Eine Datendatei ist da, aber unlesbar (kein JSON, falscher Typ)."""

    def __init__(self, path: str, reason: str):
        super().__init__(f"{os.path.basename(path)} unlesbar: {reason}")
        self.path, self.reason = path, reason


class Conflict(Exception):
    """write_json_if: Die Datei hat sich seit dem Lesen geändert."""

    def __init__(self, current_etag: str):
        super().__init__("Datei wurde inzwischen geändert")
        self.current_etag = current_etag


def read_json(path: str, default: Any = None) -> Any:
    """Return parsed JSON from path, or `default` if missing/unreadable.

    Nur für Dateien, bei denen eine Vorgabe harmlos ist (Statistik, Log, Verlauf).
    Für alles, was Hardware bewegt oder vom Nutzer gepflegt wird (Regal,
    Warteschlange, Sequenzen, Geometrie, Einstellungen, Filamente), read_json_checked:
    Mit read_json wurde eine kaputte Datei bis v1.1.47 still durch die Vorgabe
    ersetzt, und das nächste Speichern überschrieb die echten Daten damit."""
    with _lock_for(path):
        try:
            return _read_unlocked(path, default)
        except Exception as e:
            logger.warning(f"read_json failed for {path}: {e}")
            return default


def _read_unlocked(path: str, default: Any) -> Any:
    if not os.path.exists(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def read_json_checked(path: str, default: Any = None, expect: type = dict) -> Any:
    """Fehlt die Datei: `default`. Ist sie da, aber kaputt oder vom falschen Typ:
    BrokenFile. Nie still eine Vorgabe über echte Daten."""
    with _lock_for(path):
        try:
            data = _read_unlocked(path, default)
        except (OSError, ValueError) as e:
            raise BrokenFile(path, str(e)[:160])
    if os.path.exists(path) and expect is not None and not isinstance(data, expect):
        raise BrokenFile(path, f"{type(data).__name__} statt {expect.__name__}")
    return data


def backup_broken(path: str) -> str:
    """Kopie einer kaputten Datei neben ihr ablegen (<datei>.broken-YYYYmmdd-HHMMSS)."""
    target = f"{path}.broken-{datetime.now().strftime('%Y%m%d-%H%M%S')}"
    with _lock_for(path):
        shutil.copy2(path, target)
    return target


def etag(data: Any) -> str:
    """Kurzer Fingerabdruck eines Inhalts (für Schreiben mit Revision)."""
    raw = json.dumps(data, sort_keys=True, ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()[:16]


def write_json(path: str, data: Any) -> None:
    """Atomically write `data` as JSON to path (temp file + os.replace)."""
    with _lock_for(path):
        _write_unlocked(path, data)


def write_json_if(path: str, data: Any, expected_etag: str) -> str:
    """Nur schreiben, wenn die Datei noch den Stand `expected_etag` hat (gelesen,
    verglichen und geschrieben unter EINER Sperre). Sonst Conflict. → neuer etag."""
    with _lock_for(path):
        current = _read_unlocked(path, None)
        cur = etag(current)
        if cur != expected_etag:
            raise Conflict(cur)
        _write_unlocked(path, data)
        return etag(data)


def _write_unlocked(path: str, data: Any) -> None:
    d = os.path.dirname(path)
    if d:
        os.makedirs(d, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}.{threading.get_ident()}"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except Exception:
        # Don't leave a stray temp file behind on failure.
        try:
            if os.path.exists(tmp):
                os.remove(tmp)
        except OSError as e:
            logger.warning(f"Temp-Datei {tmp} nicht entfernt: {e}")
        raise
