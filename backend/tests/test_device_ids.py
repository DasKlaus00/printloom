"""Geräte: aufräumen beim Löschen, IDs nie wiederverwenden, Backup nach Namen (seit v1.1.51).

Bis v1.1.50 blieben die Einstellungen eines gelöschten Geräts stehen, SQLite vergab
die ID des zuletzt gelöschten Geräts neu (das neue erbte Kamera-URL, Steckdose und
die Drucker-Positionen), und nach einem Backup auf frischer Datenbank zeigten die
Drucker-Blöcke der Geometrie auf falsche Geräte.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.models.models import Base, Device, PrinterType  # noqa: E402
from app.routers import devices, system  # noqa: E402
from app.schemas.schemas import DeviceCreate  # noqa: E402
from app.services import camera_hub, device_settings  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


def _neu(db, name):
    d = DeviceCreate(name=name, device_type=PrinterType.BAMBU_LAB, ip_address="10.0.0.5", port=990)
    return asyncio.run(devices.create_device(d, db))


def test_ids_werden_nicht_wiederverwendet(db):
    a, b = _neu(db, "A"), _neu(db, "B")
    assert (a.id, b.id) == (1, 2)
    asyncio.run(devices.delete_device(b.id, db))
    assert _neu(db, "C").id == 3


def test_geloeschtes_geraet_hinterlaesst_keine_einstellungen(db, monkeypatch):
    geschlossen = []
    monkeypatch.setattr(camera_hub, "drop_for_device", lambda ip, code: geschlossen.append(ip) or 1)
    a = _neu(db, "A")
    device_settings.put(db, a.id, {"webcam_url": "http://cam", "ha_url": "http://ha"})
    asyncio.run(devices.delete_device(a.id, db))
    assert device_settings.get(db, a.id) == {}
    assert geschlossen == ["10.0.0.5"]


def test_kamera_hubs_eines_geraets_werden_beendet(monkeypatch):
    class Hub:
        def __init__(self):
            self.zu = False

        def close(self):
            self.zu = True
    h1, h2 = Hub(), Hub()
    monkeypatch.setattr(camera_hub, "_hubs", {("rtsp", "10.0.0.5", "123"): h1, ("rtsp", "10.0.0.6", "123"): h2})
    assert camera_hub.drop_for_device("10.0.0.5", "123") == 1
    assert h1.zu and not h2.zu


def test_backup_auf_neuer_datenbank_ordnet_die_geometrie_neu_zu(db):
    alt = [{"id": 2, "name": "OTTOeject", "device_type": "klipper", "port": 7125},
           {"id": 3, "name": "X1C-B", "device_type": "bambu_lab", "port": 990},
           {"id": 4, "name": "X1C-C", "device_type": "bambu_lab", "port": 990}]
    name_to_id = {}
    system._restore_devices(db, alt, {}, name_to_id)
    geom = {"printers": [{"id": "p1", "device_id": 3, "name": "X1C-B"},
                         {"id": "p2", "device_id": 4, "name": "X1C-C"},
                         {"id": "p3", "device_id": 9, "name": "Weg"}]}
    neu, ohne = system._remap_geometry(geom, alt, name_to_id)
    ids = {d.name: d.id for d in db.query(Device).all()}
    assert neu["printers"][0]["device_id"] == ids["X1C-B"]
    assert neu["printers"][1]["device_id"] == ids["X1C-C"]
    assert neu["printers"][2]["device_id"] is None and ohne == ["Weg"]
