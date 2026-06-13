"""Central JSON persistence with atomic writes + per-path locking.

Why: the AutoFarm background loop and the API handlers read/write the same JSON
files in backend/db/ concurrently. Plain open()+json.dump can interleave writes
or leave a truncated/corrupt file if the process dies mid-write. This module
serializes access per file path (threading.Lock) and writes atomically via a
temp file + os.replace, so readers never observe a partially written file.

All routers should go through read_json/write_json instead of opening files
directly.
"""
import json
import logging
import os
import threading
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


def read_json(path: str, default: Any = None) -> Any:
    """Return parsed JSON from path, or `default` if missing/unreadable."""
    with _lock_for(path):
        try:
            if os.path.exists(path):
                with open(path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception as e:
            logger.warning(f"read_json failed for {path}: {e}")
        return default


def write_json(path: str, data: Any) -> None:
    """Atomically write `data` as JSON to path (temp file + os.replace)."""
    with _lock_for(path):
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
            except Exception:
                pass
            raise
