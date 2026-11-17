"""Sequenzen: nichts wird still ersetzt (seit v1.1.59).

Bis v1.1.58:
- lieferte GET /sequences bei altem Schema leere Listen, und der Editor speicherte den
  Standard über die eigenen Abläufe;
- speicherte PUT jeden Zwischenstand, auch einen Zyklus ohne „Druckdatei senden", und
  ein zweiter Tab überschrieb den ersten still;
- fiel ein unbekanntes Feld (Bibliothek: „sequences") weg, und trotzdem kam „übernommen".
"""
import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import autofarm as af  # noqa: E402

client = TestClient(app)

# Echte Form eines gespeicherten Zyklus (wie der Standard in sequenceData.js, gekürzt)
ZYKLUS = [
    {"id": 1, "type": "send_file", "label": "Druckdatei senden", "value": ""},
    {"id": 2, "type": "wait_print", "label": "Auf Druckende warten", "value": ""},
    {"id": 3, "type": "app_op", "label": "Auswerfen", "value": "eject"},
]


@pytest.fixture
def datei(tmp_path, monkeypatch):
    p = tmp_path / "farm_sequences.json"
    monkeypatch.setattr(af, "SEQ_PATH", str(p))
    return p


def _lesen():
    r = client.get("/api/autofarm/sequences")
    assert r.status_code == 200
    return r.json()


def _speichern(body, rev):
    return client.put("/api/autofarm/sequences", json=body, headers={"If-Match": rev})


def test_veraltetes_schema_liefert_den_inhalt_mit_kennzeichen(datei):
    datei.write_text(json.dumps({"seq_new": [], "seq_next": ZYKLUS, "schema_version": 1}),
                     encoding="utf-8")
    d = _lesen()
    assert d["outdated"] is True and d["schema_version"] == 1 and d["exists"] is True
    assert [s["type"] for s in d["seq_next"]] == ["send_file", "wait_print", "app_op"]


def test_ohne_datei_meldet_exists_false(datei):
    d = _lesen()
    assert d["exists"] is False and d["outdated"] is False and d["seq_next"] == []


def test_speichern_braucht_die_revision(datei):
    r = client.put("/api/autofarm/sequences", json={"seq_new": [], "seq_next": ZYKLUS})
    assert r.status_code == 428 and not datei.exists()


def test_veraltete_revision_wird_abgelehnt(datei):
    alt = _lesen()["revision"]
    assert _speichern({"seq_new": [], "seq_next": ZYKLUS}, alt).status_code == 200   # Tab 1
    r = _speichern({"seq_new": [], "seq_next": ZYKLUS[:2]}, alt)                     # Tab 2
    assert r.status_code == 409 and r.json()["detail"]["error"] == "SEQUENZ_GEAENDERT"
    assert len(json.loads(datei.read_text(encoding="utf-8"))["seq_next"]) == 3


def test_gespeichert_wird_mit_aktuellem_schema_und_neuer_revision(datei):
    rev = _lesen()["revision"]
    r = _speichern({"seq_new": [], "seq_next": ZYKLUS}, rev).json()
    gespeichert = json.loads(datei.read_text(encoding="utf-8"))
    assert gespeichert["schema_version"] == af.SEQ_SCHEMA_VERSION
    assert r["revision"] == _lesen()["revision"] != rev


def test_unbekannte_art_wird_abgelehnt_auch_deaktiviert(datei):
    rev = _lesen()["revision"]
    zyklus = ZYKLUS + [{"id": 9, "type": "teleport", "label": "Beamen", "disabled": True}]
    r = _speichern({"seq_new": [], "seq_next": zyklus}, rev)
    assert r.status_code == 400
    assert [p["code"] for p in r.json()["detail"]["problems"]] == ["seq_unknown_type"]
    assert not datei.exists()


@pytest.mark.parametrize("zyklus", [[], ZYKLUS[1:], ZYKLUS[:1]], ids=["leer", "ohne-senden", "ohne-warten"])
def test_zyklus_ohne_druck_wird_nicht_gespeichert(datei, zyklus):
    r = _speichern({"seq_new": [], "seq_next": zyklus}, _lesen()["revision"])
    assert r.status_code == 400 and r.json()["detail"]["error"] == "SEQUENZ_UNGUELTIG"
    assert not datei.exists()


def test_leerer_first_start_ist_erlaubt(datei):
    assert _speichern({"seq_new": [], "seq_next": ZYKLUS}, _lesen()["revision"]).status_code == 200
    assert json.loads(datei.read_text(encoding="utf-8"))["seq_new"] == []


def test_unbekanntes_feld_wird_abgelehnt(datei):
    # So schickte die Bibliothek bis v1.1.58 eine heruntergeladene Sequenz.
    r = _speichern({"seq_new": [], "seq_next": ZYKLUS, "sequences": [{"name": "x"}]},
                   _lesen()["revision"])
    assert r.status_code == 422 and not datei.exists()


def test_fremde_felder_eines_schritts_fallen_weg(datei):
    zyklus = [{**ZYKLUS[0], "geheim": "x"}] + ZYKLUS[1:]
    assert _speichern({"seq_new": [], "seq_next": zyklus}, _lesen()["revision"]).status_code == 200
    assert "geheim" not in json.loads(datei.read_text(encoding="utf-8"))["seq_next"][0]
