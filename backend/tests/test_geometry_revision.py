"""Geometrie mit Revision: keine alte Kopie überschreibt neuere Positionen (seit v1.1.52).

Bis v1.1.51 schrieb jede Seite ihre ganze Kopie zurück. War der Drucker-Tab offen,
während der Setup-Assistent den Fach-Abstand änderte, überschrieb der Tab ihn beim
nächsten Autosave mit dem alten Wert.
"""
import json

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import control  # noqa: E402

client = TestClient(app)
URL = "/api/control/ottoeject/geometry"


@pytest.fixture
def datei(tmp_path, monkeypatch):
    f = tmp_path / "ottoeject_geometry.json"
    monkeypatch.setattr(control, "GEOMETRY_PATH", str(f))
    monkeypatch.setattr(control, "_rack_config", lambda: None)
    return f


def _laden():
    r = client.get(URL)
    assert r.status_code == 200
    return r.json()["geometry"], r.json()["revision"]


def test_geometrie_speichern_mit_veralteter_fassung_wird_abgelehnt(datei):
    g_a, rev_a = _laden()
    g_b, rev_b = _laden()                  # zwei Seiten, derselbe Stand
    g_a["printers"][0]["eject"]["x"] = 542
    r = client.put(URL, json=g_a, headers={"If-Match": rev_a})
    assert r.status_code == 200
    assert r.json()["revision"] != rev_a
    # B kommt mit der alten Revision: abgelehnt, mit dem aktuellen Stand.
    r = client.put(URL, json=g_b, headers={"If-Match": rev_b})
    assert r.status_code == 409
    assert r.json()["detail"]["geometry"]["printers"][0]["eject"]["x"] == 542
    assert json.loads(datei.read_text(encoding="utf-8"))["printers"][0]["eject"]["x"] == 542


def test_mit_frischer_revision_geht_es(datei):
    g, rev = _laden()
    r = client.put(URL, json=g, headers={"If-Match": rev})
    g2, rev2 = _laden()
    assert r.json()["revision"] == rev2
    assert client.put(URL, json=g2, headers={"If-Match": rev2}).status_code == 200


def test_ohne_if_match_428(datei):
    g, _ = _laden()
    assert client.put(URL, json=g).status_code == 428


@pytest.mark.parametrize("wert", [None, "", "abc"])
def test_leeres_positionsfeld_422(wert, datei):
    g, rev = _laden()
    g["printers"][0]["eject"]["x"] = wert
    r = client.put(URL, json=g, headers={"If-Match": rev})
    assert r.status_code == 422
    assert "printers[0].eject.x" in r.json()["detail"]["fields"]
    assert not datei.exists()          # nichts geschrieben


def test_etag_kopf(datei):
    r = client.get(URL)
    assert r.headers["etag"] == r.json()["revision"]
