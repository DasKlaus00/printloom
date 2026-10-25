"""Smart-Steckdose in der Kopfleiste: die gesammelte Liste /devices/power.

Die Kopfleiste zeigt den Schalter dauerhaft und fragt ihn im Takt ab. Deshalb
liefert EIN Endpunkt alle eingerichteten Steckdosen auf einmal, statt die Leiste
je Drucker anfragen zu lassen.

Die Tests laufen gegen eine eigene Datenbank im Arbeitsspeicher (get_db wird
überschrieben) — die echte printloom.db wird nicht angefasst."""
import json

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient      # noqa: E402
from sqlalchemy import create_engine           # noqa: E402
from sqlalchemy.orm import sessionmaker        # noqa: E402
from sqlalchemy.pool import StaticPool         # noqa: E402

from app.db.database import get_db             # noqa: E402
from app.main import app                       # noqa: E402
from app.models.models import Base, Device, PrinterType, SystemConfig   # noqa: E402
from app.services import power                 # noqa: E402


@pytest.fixture
def db():
    """Frische Datenbank je Test. StaticPool = alle Sessions teilen sich DIESELBE
    In-Memory-Datenbank (sonst sähe jede Verbindung eine eigene, leere)."""
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    s = Session()
    app.dependency_overrides[get_db] = lambda: Session()
    try:
        yield s
    finally:
        app.dependency_overrides.pop(get_db, None)
        s.close()
        engine.dispose()


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def drucker(db):
    def _neu(name="Drucker 01", settings=None, typ=PrinterType.BAMBU_LAB):
        d = Device(name=name, device_type=typ, ip_address="10.0.0.5",
                   access_code="abc", serial_number=f"S-{name}")
        db.add(d); db.commit(); db.refresh(d)
        if settings is not None:
            db.add(SystemConfig(key=f"device_settings_{d.id}", value=json.dumps(settings)))
            db.commit()
        return d
    return _neu


HA = {
    "plug_type": "ha", "plug_url": "http://10.0.0.9:8123", "plug_token": "t",
    "plug_switch_entity": "switch.dose",
}


def test_pfad_wird_nicht_als_geraete_id_gelesen(client, db):
    """/devices/power steht VOR /devices/{device_id} — sonst versucht FastAPI,
    „power" als Zahl zu lesen, und antwortet mit 422 statt mit der Liste."""
    r = client.get("/api/devices/power")
    assert r.status_code == 200
    assert r.json() == {"plugs": []}


def test_ohne_eingerichtete_steckdose_bleibt_die_liste_leer(client, drucker):
    drucker(name="Ohne Dose")
    assert client.get("/api/devices/power").json()["plugs"] == []


def test_halb_ausgefuellte_einstellungen_zaehlen_nicht(client, drucker):
    """Ohne Schalter-Entität kann nichts geschaltet werden — dann darf auch kein
    Knopf erscheinen, der nichts tut."""
    drucker(name="Halbe Dose", settings={**HA, "plug_switch_entity": ""})
    assert client.get("/api/devices/power").json()["plugs"] == []


def test_eingerichtete_steckdose_wird_mit_werten_gemeldet(client, drucker, monkeypatch):
    d = drucker(name="Mit Dose", settings=HA)

    async def fake(_s):
        return {"watts": 142.4, "energy_kwh": 0.8, "on": True}
    monkeypatch.setattr(power, "read_power", fake)

    assert client.get("/api/devices/power").json()["plugs"] == [
        {"device_id": d.id, "name": "Mit Dose", "watts": 142.4, "energy_kwh": 0.8, "on": True}]


def test_unerreichbare_steckdose_meldet_unbekannt_statt_aus(client, drucker, monkeypatch):
    """Wichtig: `on` muss null sein, nicht False. Sonst zeigt die Leiste „Aus",
    obwohl niemand weiß, wie die Dose steht — und jemand schaltet blind."""
    drucker(name="Kaputte Dose", settings=HA)

    async def kaputt(_s):
        raise ConnectionError("Home Assistant weg")
    monkeypatch.setattr(power, "read_power", kaputt)

    eintrag = client.get("/api/devices/power").json()["plugs"][0]
    assert eintrag["on"] is None
    assert eintrag["watts"] is None


def test_eine_kaputte_dose_verdeckt_die_anderen_nicht(client, drucker, monkeypatch):
    gut = drucker(name="Gute Dose", settings=HA)
    schlecht = drucker(name="Kaputte Dose", settings=HA)
    ruf = {"n": 0}

    async def je_nach_reihenfolge(_s):
        ruf["n"] += 1
        if ruf["n"] > 1:
            raise ConnectionError("weg")
        return {"watts": 5.0, "energy_kwh": 0.1, "on": False}
    monkeypatch.setattr(power, "read_power", je_nach_reihenfolge)

    plugs = {p["device_id"]: p for p in client.get("/api/devices/power").json()["plugs"]}
    assert plugs[gut.id]["on"] is False
    assert plugs[schlecht.id]["on"] is None


def test_klipper_hat_keine_druckersteckdose(client, drucker):
    """Der Schalter gehört zum Drucker. Ein Klipper-Gerät (der OTTOeject) taucht
    hier nicht auf, auch wenn jemand ihm Steckdosen-Einstellungen verpasst."""
    drucker(name="OTTOeject", settings=HA, typ=PrinterType.KLIPPER)
    assert client.get("/api/devices/power").json()["plugs"] == []
