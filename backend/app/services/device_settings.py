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


def read(device_id: int) -> dict:
    """Wie get(), mit eigener Sitzung — für Abläufe außerhalb eines Requests (Farm)."""
    from app.db.database import SessionLocal
    db = SessionLocal()
    try:
        return get(db, device_id)
    finally:
        db.close()
