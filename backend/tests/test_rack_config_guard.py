"""Regal-Eingaben löschen nichts und setzen den Bestand nicht still zurück (seit v1.1.50).

Bis v1.1.49:
- Verkleinern (weniger Fächer/Regale) löschte belegte Fächer still: Die Platte lag
  weiter im Regal, Printloom wusste nichts mehr davon und legte später darauf ab.
- Ein leeres Feld wurde 0 oder brachte einen Absturz.
- Ein Magazin-Fach innerhalb der Fächer wurde Ablageziel.
- Jede neue Sollzahl setzte den Live-Bestand zurück; der Arm griff ins leere Magazin.
"""
import json

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import autofarm  # noqa: E402
from app.services import rack_store  # noqa: E402

client = TestClient(app)


@pytest.fixture
def regal(tmp_path, monkeypatch):
    f = tmp_path / "rack_slots.json"
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(f))
    d = rack_store.default_data()
    d["slots"]["1-5"]["status"] = "done"
    d["slots"]["1-5"]["object_height_mm"] = 42.0
    f.write_text(json.dumps(d), encoding="utf-8")
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    return f


def test_verkleinern_ueber_belegte_faecher_wird_abgelehnt(regal):
    alt = regal.read_bytes()
    r = client.put("/api/rack-manager/config", json={"slots_per_rack": 3})
    assert r.status_code == 409
    assert "1-5" in r.json()["detail"]["slots"]
    assert regal.read_bytes() == alt


def test_verkleinern_ueber_freie_faecher_geht(regal):
    r = client.put("/api/rack-manager/config", json={"slots_per_rack": 5})
    assert r.status_code == 200
    assert rack_store.load()["slots_per_rack"] == 5


@pytest.mark.parametrize("wert", ["", None, "abc"])
def test_leerer_wert_wird_400(wert, regal):
    alt = regal.read_bytes()
    r = client.put("/api/rack-manager/config", json={"slot_height_mm": wert})
    assert r.status_code == 400 and "slot_height_mm" in r.json()["detail"]
    assert regal.read_bytes() == alt


def test_komma_dezimal_wird_verstanden(regal):
    assert client.put("/api/rack-manager/config", json={"slot_height_mm": "52,5"}).status_code == 200
    assert rack_store.load()["slot_height_mm"] == 52.5


def test_magazin_fach_innerhalb_der_faecher_400(regal):
    d = rack_store.load()
    r = client.put("/api/rack-manager/config", json={"magazine_slot": d["slots_per_rack"]})
    assert r.status_code == 400 and "Magazin" in r.json()["detail"]


def test_sollzahl_setzt_bestand_nicht_zurueck(regal):
    d = rack_store.load()
    n = d["num_racks"]
    client.put("/api/rack-manager/config", json={"magazine_counts": [1] * n})
    client.put("/api/rack-manager/config", json={"magazine_defaults": [6] * n})
    d = rack_store.load()
    assert d["magazine_defaults"] == [6] * n
    assert d["magazine_counts"] == [1] * n


def test_reset_counts_fuellt_auf(regal):
    n = rack_store.load()["num_racks"]
    client.put("/api/rack-manager/config", json={"magazine_counts": [1] * n})
    client.put("/api/rack-manager/config", json={"magazine_defaults": [6] * n, "reset_counts": True})
    assert rack_store.load()["magazine_counts"] == [6] * n


def test_sinkende_sollzahl_kappt_den_bestand(regal):
    n = rack_store.load()["num_racks"]
    client.put("/api/rack-manager/config", json={"magazine_defaults": [8] * n, "reset_counts": True})
    client.put("/api/rack-manager/config", json={"magazine_defaults": [3] * n})
    assert rack_store.load()["magazine_counts"] == [3] * n


def test_bestand_ueber_der_sollzahl_bleibt_ohne_auftrag(regal):
    """Echter Fall: Soll 4, Bestand 6 (von Hand eingetragen). Ein anderes Speichern
    darf den Bestand nicht still kappen."""
    n = rack_store.load()["num_racks"]
    client.put("/api/rack-manager/config", json={"magazine_defaults": [4] * n})
    client.put("/api/rack-manager/config", json={"magazine_counts": [6] * n})
    client.put("/api/rack-manager/config", json={"height_margin_pct": 20})
    assert rack_store.load()["magazine_counts"] == [6] * n


def test_struktur_aendern_bei_laufender_farm_409(regal, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", True)
    assert client.put("/api/rack-manager/config", json={"num_racks": 2}).status_code == 409
    # Zuschlag und Toleranz dürfen sich ändern (sie wirken auf den nächsten Job).
    assert client.put("/api/rack-manager/config", json={"height_margin_pct": 20}).status_code == 200


def test_grenzen_kommen_vom_backend(regal):
    limits = client.get("/api/rack-manager/").json()["limits"]
    assert limits["slots_per_rack"] == [1, 20]


# ── Magazin-Fach ist nie Ablageziel ───────────────────────────────────────────

def test_magazin_fach_ist_nie_ablageziel(monkeypatch):
    """Ältere Anlagen können ein Magazin-Fach innerhalb der Fächer gespeichert haben."""
    d = rack_store.default_data()
    d["slots_per_rack"] = 7
    d["magazine_slot"] = 7
    d["slots"] = {f"{r}-{s}": rack_store.default_slot() for r in range(1, d["num_racks"] + 1)
                  for s in range(1, 8)}
    d["magazine_counts"] = [0] * d["num_racks"]
    monkeypatch.setattr(autofarm, "_rack_data", lambda: d)
    monkeypatch.setitem(autofarm._farm, "jobs", [])
    gefunden = autofarm._find_slot_for_height(40)
    assert gefunden and not gefunden.endswith("-7")
    # Ein Objekt, das alle sieben Fächer bräuchte, passt nirgends (Magazin zählt nicht).
    assert autofarm._find_slot_for_height(d["slot_height_mm"] * 7 + 1) is None
