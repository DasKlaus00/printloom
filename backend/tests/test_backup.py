"""Backup: Was der Nutzer eingerichtet hat, muss nach einer Wiederherstellung da sein.

Bis v1.1.34 fehlten Projekte, die manuellen AMS-Zuordnungen je Datei und das
Drucker-Modell. Und ein Backup aus einem Notaus-Zustand spielte die Geräte
gesperrt ein.
"""
import pytest

pytest.importorskip("fastapi")

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.models.models import Base, Device, PrinterType  # noqa: E402
from app.routers import system  # noqa: E402
from app.services import device_settings  # noqa: E402


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


def _namen():
    return [name for _, name in system._backup_files()]


def test_projekte_und_ams_zuordnungen_sind_dabei():
    assert "projects" in _namen()
    assert "file_ams_map" in _namen()


def test_entfernte_teile_stehen_nicht_mehr_drin():
    for alt in ("calibration", "racks", "schedules", "notifications"):
        assert alt not in _namen()


def test_drucker_modell_wird_gesichert(db):
    db.add(Device(name="X1C", device_type=PrinterType.BAMBU_LAB, model="x1c",
                  ip_address="10.0.0.5", port=990, access_code="geheim"))
    db.commit()
    geraete, _ = system._export_devices(db)
    assert geraete[0]["model"] == "x1c"
    assert "is_active" not in geraete[0]


def test_einstellungen_je_geraet_wandern_mit(db):
    d = Device(name="X1C", device_type=PrinterType.BAMBU_LAB, ip_address="10.0.0.5", port=990)
    db.add(d)
    db.commit()
    device_settings.put(db, d.id, {"webcam_url": "http://cam"})
    _, einstellungen = system._export_devices(db)
    assert einstellungen == {"X1C": {"webcam_url": "http://cam"}}


def test_wiederherstellung_ist_nie_gesperrt(db):
    """Ältere Backups enthalten `is_active` — eines aus dem Notaus-Zustand hätte die
    frische Anlage gesperrt eingespielt."""
    system._restore_devices(db, [{"name": "OTTOeject", "device_type": "klipper",
                                  "ip_address": "10.0.0.6", "port": 7125,
                                  "is_active": False}], {})
    assert db.query(Device).one().is_active is True


def test_modell_wird_wiederhergestellt_oder_aus_der_seriennummer_erraten(db):
    system._restore_devices(db, [
        {"name": "A", "device_type": "bambu_lab", "model": "x1c", "port": 990},
        {"name": "B", "device_type": "bambu_lab", "serial_number": "01P00A000000000", "port": 990},
    ], {})
    modelle = {d.name: d.model for d in db.query(Device).all()}
    assert modelle["A"] == "x1c"
    assert modelle["B"]          # aus der Seriennummer (P1S), nicht leer


def test_einstellungen_landen_unter_der_neuen_id(db):
    system._restore_devices(db, [{"name": "X1C", "device_type": "bambu_lab", "port": 990}],
                            {"X1C": {"ha_url": "http://ha"}, "Unbekannt": {"x": 1}})
    d = db.query(Device).one()
    assert device_settings.get(db, d.id) == {"ha_url": "http://ha"}


def test_alte_abschnitte_stoeren_die_wiederherstellung_nicht(tmp_path, monkeypatch):
    import asyncio
    ziel = tmp_path / "seq.json"
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(ziel), "sequences")])
    r = asyncio.run(system.import_backup({
        "sequences": {"seq_new": [], "seq_next": [{"type": "delay"}]},
        "notifications": {"telegram_bot_token": "x"},
        "calibration": {"a": 1},
    }))
    assert r["restored"] == ["sequences"]
    assert ziel.exists()
