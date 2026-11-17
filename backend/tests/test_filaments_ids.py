"""Filamente über feste ID (seit v1.1.64).

Bis v1.1.63 zeigte die Seite über die Listen-Position auf ein Filament. Mit gesetztem
Filter ist Position 1 der gefilterten Liste ein anderes Filament als Position 1 der
Datei: „×" löschte das falsche. Und beim Bearbeiten fiel die Herkunft (AMS) weg.
"""
import json

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import filaments  # noqa: E402

client = TestClient(app)


@pytest.fixture
def datei(tmp_path, monkeypatch):
    p = tmp_path / "filaments.json"
    monkeypatch.setattr(filaments, "CUSTOM_PATH", str(p))
    return p


def _neu(brand, material, color):
    r = client.post("/api/filaments/custom", json={"brand": brand, "material": material,
                                                    "name": "", "color_hex": color})
    assert r.status_code == 200
    return r.json()["id"]


def test_custom_filament_update_delete_per_id(datei):
    a = _neu("Bambu Lab", "PLA", "#FF0000")
    b = _neu("Bambu Lab", "PETG", "#00FF00")
    assert client.delete(f"/api/filaments/custom/id/{b}").status_code == 200
    rest = client.get("/api/filaments/").json()["custom"]
    assert [f["id"] for f in rest] == [a]
    r = client.put(f"/api/filaments/custom/id/{a}", json={"brand": "Bambu Lab", "material": "PLA",
                                                          "name": "Rot", "color_hex": "#FF0000"})
    assert r.json()["filament"]["name"] == "Rot" and r.json()["filament"]["id"] == a
    assert client.delete("/api/filaments/custom/id/gibtsnicht").status_code == 404


def test_altbestand_bekommt_ids(datei):
    # Form, wie sie bis v1.1.63 gespeichert wurde (aus dem AMS gelernt, ohne ID)
    datei.write_text(json.dumps([
        {"brand": "AMS", "material": "PLA", "name": "", "color_hex": "#0078BF", "article": "", "source": "ams"},
        {"brand": "AMS", "material": "PETG", "name": "", "color_hex": "#D6001C", "article": "", "source": "ams"},
    ]), encoding="utf-8")
    custom = client.get("/api/filaments/").json()["custom"]
    ids = [f["id"] for f in custom]
    assert all(ids) and len(set(ids)) == 2
    assert [f["id"] for f in json.loads(datei.read_text(encoding="utf-8"))] == ids   # einmal gespeichert


def test_bearbeiten_behaelt_die_herkunft(datei):
    client.post("/api/filaments/learn", json={"slots": [{"type": "PLA", "color": "0078BF"}]})
    f = client.get("/api/filaments/").json()["custom"][0]
    r = client.put(f"/api/filaments/custom/id/{f['id']}", json={"brand": "Bambu Lab", "material": "PLA",
                                                                "name": "Blau", "color_hex": "#0078BF"})
    assert r.json()["filament"]["source"] == "ams"
