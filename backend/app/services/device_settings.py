"""Einstellungen je Gerät (Kamera, Home Assistant, Steckdose, …).

Liegen als JSON in der Tabelle `system_config` unter `device_settings_<id>`.
Bis v1.1.34 stand dieses Lesen in vier Modulen ausgeschrieben, jedes mit eigener
Fehlerbehandlung — eines lieferte bei kaputtem JSON {"webcam_url": ""}, die
anderen {}.
"""
from __future__ import annotations

import json

from app.models.models import SystemConfig

KEY_PREFIX = "device_settings_"


def key(device_id: int) -> str:
    return f"{KEY_PREFIX}{device_id}"


def get(db, device_id: int) -> dict:
    """Einstellungen eines Geräts; {} wenn keine (lesbaren) da sind."""
    row = db.query(SystemConfig).filter(SystemConfig.key == key(device_id)).first()
    if not row or not row.value:
        return {}
    try:
        data = json.loads(row.value)
    except (TypeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def put(db, device_id: int, settings: dict) -> None:
    row = db.query(SystemConfig).filter(SystemConfig.key == key(device_id)).first()
    if row:
        row.value = json.dumps(settings)
    else:
        db.add(SystemConfig(key=key(device_id), value=json.dumps(settings)))
    db.commit()


def delete(db, device_id: int) -> None:
    """Einstellungen eines gelöschten Geräts entfernen. Bis v1.1.50 blieben sie stehen,
    und ein neues Gerät mit derselben ID erbte Kamera-URL, Steckdose und HA-Token."""
    db.query(SystemConfig).filter(SystemConfig.key == key(device_id)).delete()
    db.commit()


def next_device_id(db) -> int:
    """Nächste Geräte-ID über eine Hochwassermarke: Eine ID wird nie wiederverwendet.
    SQLite vergibt sonst nach dem Löschen des höchsten Geräts dieselbe Nummer neu, und
    Geometrie-Blöcke, die noch auf die alte ID zeigen, gehörten plötzlich dem neuen."""
    from app.models.models import Device
    from sqlalchemy import func
    row = db.query(SystemConfig).filter(SystemConfig.key == HWM_KEY).first()
    try:
        hwm = int(row.value) if row else 0
    except (TypeError, ValueError):
        hwm = 0
    top = db.query(func.max(Device.id)).scalar() or 0
    new = max(hwm, int(top)) + 1
    if row:
        row.value = str(new)
    else:
        db.add(SystemConfig(key=HWM_KEY, value=str(new)))
    return new


HWM_KEY = "device_id_hwm"


def read(device_id: int) -> dict:
    """Wie get(), mit eigener Sitzung — für Abläufe außerhalb eines Requests (Farm)."""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        return get(db, device_id)
    finally:
        db.close()
