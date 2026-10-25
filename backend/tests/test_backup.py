"""Backup: Was der Nutzer eingerichtet hat, muss nach einer Wiederherstellung da sein.

Bis v1.1.34 fehlten Projekte, die manuellen AMS-Zuordnungen je Datei und das
Drucker-Modell. Und ein Backup aus einem Notaus-Zustand spielte die Geräte
gesperrt ein.

Bis v1.1.38 stand jedes Zugangsdatum im Klartext im Backup. Seit v1.1.39 nur auf
ausdrücklichen Wunsch, auf Wunsch verschlüsselt — und ein Backup ohne Zugangsdaten
darf beim Einspielen keine vorhandenen löschen.
"""
import json

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.models.models import Base, Device, PrinterType  # noqa: E402
from app.routers import system  # noqa: E402
from app.services import credentials, device_settings  # noqa: E402

GEHEIM = {"ha_token": "eyJhbGciOi-geheim", "plug_password": "steckdose123",
          "webcam_url": "rtsp://admin:kamera@10.0.0.9/stream"}


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


@pytest.fixture
def anlage(db, monkeypatch, tmp_path):
    """Ein Drucker mit Access-Code und Geheimnissen in den Einstellungen; die
    Endpunkte arbeiten auf derselben Datenbank, Konfig-Dateien im Temp-Ordner."""
    d = Device(name="X1C", device_type=PrinterType.BAMBU_LAB, model="x1c",
               ip_address="10.0.0.5", port=990, serial_number="00M00A000000000",
               access_code="12345678")
    db.add(d)
    db.commit()
    device_settings.put(db, d.id, {"ha_url": "http://ha:8123", "plug_type": "ha", **GEHEIM})
    monkeypatch.setattr(system, "SessionLocal", lambda: _NichtSchliessen(db))
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(tmp_path / "seq.json"), "sequences")])
    return d


class _NichtSchliessen:
    """Die Endpunkte schließen ihre Sitzung — der Test braucht sie danach noch."""
    def __init__(self, s):
        self._s = s

    def __getattr__(self, name):
        return getattr(self._s, name)

    def close(self):
        pass


def _namen():
    return [name for _, name in system._backup_files()]


def _run(coro):
    import asyncio
    return asyncio.run(coro)


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
    geraete, _, _ = system._export_devices(db)
    assert geraete[0]["model"] == "x1c"
    assert "is_active" not in geraete[0]


def test_einstellungen_je_geraet_wandern_mit(db):
    d = Device(name="X1C", device_type=PrinterType.BAMBU_LAB, ip_address="10.0.0.5", port=990)
    db.add(d)
    db.commit()
    device_settings.put(db, d.id, {"webcam_url": "http://cam"})
    _, einstellungen, _ = system._export_devices(db)
    assert einstellungen == {"X1C": {"webcam_url": "http://cam"}}


# ── Zugangsdaten ────────────────────────────────────────────────────────────────

def test_standard_backup_enthaelt_keine_zugangsdaten(anlage):
    text = json.dumps(_run(system.export_backup()))
    for geheim in ("12345678", *GEHEIM.values()):
        assert geheim not in text
    assert "secrets" not in json.loads(text)


def test_standard_backup_behaelt_was_kein_geheimnis_ist(anlage):
    b = _run(system.export_backup())
    assert b["devices"][0]["ip_address"] == "10.0.0.5"
    assert b["devices"][0]["serial_number"] == "00M00A000000000"
    assert b["device_settings"]["X1C"] == {"ha_url": "http://ha:8123", "plug_type": "ha"}


def test_url_ohne_passwort_ist_kein_geheimnis():
    assert not credentials.is_secret("webcam_url", "rtsp://admin@10.0.0.9/stream")
    assert credentials.is_secret("webcam_url", "rtsp://admin:pw@10.0.0.9/stream")
    assert credentials.is_secret("plug_token", "x")


def test_mit_zugangsdaten_und_passwort_ist_verschluesselt(anlage):
    b = _run(system.export_backup_with_options(
        system.BackupExportIn(include_secrets=True, password="langes-passwort")))
    text = json.dumps(b)
    for geheim in ("12345678", *GEHEIM.values()):
        assert geheim not in text
    assert b["secrets"]["encrypted"] is True


def test_zu_kurzes_passwort_wird_abgelehnt(anlage):
    with pytest.raises(HTTPException) as e:
        _run(system.export_backup_with_options(
            system.BackupExportIn(include_secrets=True, password="kurz")))
    assert e.value.status_code == 400


def test_verschluesseltes_backup_kommt_vollstaendig_zurueck(anlage, db):
    b = _run(system.export_backup_with_options(
        system.BackupExportIn(include_secrets=True, password="langes-passwort")))
    anlage.access_code = None
    device_settings.put(db, anlage.id, {})
    db.commit()

    r = _run(system.import_backup({"backup": b, "password": "langes-passwort"}))
    assert r["secrets"] == "restored"
    assert db.query(Device).one().access_code == "12345678"
    assert device_settings.get(db, anlage.id) == {"ha_url": "http://ha:8123",
                                                  "plug_type": "ha", **GEHEIM}


def test_falsches_passwort_spielt_nichts_ein(anlage, db):
    b = _run(system.export_backup_with_options(
        system.BackupExportIn(include_secrets=True, password="langes-passwort")))
    b["devices"][0]["ip_address"] = "10.0.0.99"
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"backup": b, "password": "falsches-passwort"}))
    assert e.value.detail == "BACKUP_PASSWORT_FALSCH"
    assert db.query(Device).one().ip_address == "10.0.0.5"


def test_ohne_passwort_wird_alles_ausser_zugangsdaten_eingespielt(anlage, db):
    b = _run(system.export_backup_with_options(
        system.BackupExportIn(include_secrets=True, password="langes-passwort")))
    b["devices"][0]["ip_address"] = "10.0.0.99"
    r = _run(system.import_backup(b))
    assert r["secrets"] == "skipped"
    assert db.query(Device).one().ip_address == "10.0.0.99"
    assert db.query(Device).one().access_code == "12345678"


def test_backup_ohne_zugangsdaten_loescht_keine_vorhandenen(anlage, db):
    """Der häufige Fall: Backup vor dem Update ziehen, später einspielen."""
    b = _run(system.export_backup())
    b["device_settings"]["X1C"]["ha_url"] = "http://neu:8123"
    r = _run(system.import_backup(b))
    assert r["secrets"] == "none"
    assert db.query(Device).one().access_code == "12345678"
    s = device_settings.get(db, anlage.id)
    assert s["ha_url"] == "http://neu:8123"
    assert s["ha_token"] == GEHEIM["ha_token"]
    assert s["webcam_url"] == GEHEIM["webcam_url"]


def test_klartext_zugangsdaten_auf_ausdruecklichen_wunsch(anlage, db):
    b = _run(system.export_backup_with_options(system.BackupExportIn(include_secrets=True)))
    assert b["secrets"]["encrypted"] is False
    anlage.access_code = None
    db.commit()
    assert _run(system.import_backup(b))["secrets"] == "restored"
    assert db.query(Device).one().access_code == "12345678"


def test_altes_backup_mit_zugangsdaten_im_klartext_geht_weiter(db, monkeypatch):
    """Format bis v1.1.38: Access-Code und Tokens direkt in devices/device_settings."""
    monkeypatch.setattr(system, "SessionLocal", lambda: _NichtSchliessen(db))
    monkeypatch.setattr(system, "_backup_files", lambda: [])
    r = _run(system.import_backup({
        "schema": "printloom-backup/2",
        "devices": [{"name": "X1C", "device_type": "bambu_lab", "port": 990,
                     "access_code": "alt-code"}],
        "device_settings": {"X1C": {"ha_token": "alt-token"}},
    }))
    assert r["secrets"] == "restored"
    d = db.query(Device).one()
    assert d.access_code == "alt-code"
    assert device_settings.get(db, d.id) == {"ha_token": "alt-token"}


# ── Wiederherstellung allgemein ─────────────────────────────────────────────────

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
    ziel = tmp_path / "seq.json"
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(ziel), "sequences")])
    r = _run(system.import_backup({
        "sequences": {"seq_new": [], "seq_next": [{"type": "delay"}]},
        "notifications": {"telegram_bot_token": "x"},
        "calibration": {"a": 1},
    }))
    assert r["restored"] == ["sequences"]
    assert ziel.exists()
