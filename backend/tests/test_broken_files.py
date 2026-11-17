"""Kaputte Dateien überschreiben nichts mehr (seit v1.1.48).

Bis v1.1.47 lasen fast alle Stellen mit read_json(path, Vorgabe): Eine abgeschnittene
oder fremde Datei kam still als Vorgabe zurück, und das nächste Speichern schrieb
die Vorgabe über die echten Daten. Beim Regal hieß das: Platten liegen im Regal, das
Regal gilt als leer, die Farm legt die nächste Platte in ein belegtes Fach.
"""
import asyncio
import json
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import autofarm, control, filaments, system  # noqa: E402
from app.services import farm_settings, rack_store, storage  # noqa: E402

client = TestClient(app)
ABGESCHNITTEN = '{"num_racks": 3, "slots": {"1-1": {"status": "done"'


# ── storage ───────────────────────────────────────────────────────────────────

def test_kaputt_ergibt_brokenfile(tmp_path):
    f = tmp_path / "x.json"
    f.write_text(ABGESCHNITTEN, encoding="utf-8")
    with pytest.raises(storage.BrokenFile):
        storage.read_json_checked(str(f), {})
    # Das alte read_json bleibt tolerant (Statistik, Log).
    assert storage.read_json(str(f), {"a": 1}) == {"a": 1}


def test_liste_statt_objekt_ergibt_brokenfile(tmp_path):
    f = tmp_path / "x.json"
    f.write_text("[1, 2]", encoding="utf-8")
    with pytest.raises(storage.BrokenFile):
        storage.read_json_checked(str(f), {}, expect=dict)


def test_fehlende_datei_ergibt_die_vorgabe(tmp_path):
    assert storage.read_json_checked(str(tmp_path / "fehlt.json"), {"jobs": []}) == {"jobs": []}


def test_schreiben_mit_revision(tmp_path):
    f = tmp_path / "q.json"
    storage.write_json(str(f), {"jobs": [1]})
    alt = f.read_bytes()
    with pytest.raises(storage.Conflict):
        storage.write_json_if(str(f), {"jobs": []}, "falsch")
    assert f.read_bytes() == alt
    neu = storage.write_json_if(str(f), {"jobs": [1, 2]}, storage.etag({"jobs": [1]}))
    assert neu == storage.etag({"jobs": [1, 2]})


def test_sicherungskopie(tmp_path):
    f = tmp_path / "rack.json"
    f.write_text(ABGESCHNITTEN, encoding="utf-8")
    kopie = Path(storage.backup_broken(str(f)))
    assert kopie.name.startswith("rack.json.broken-") and kopie.read_text(encoding="utf-8") == ABGESCHNITTEN


# ── Regal ─────────────────────────────────────────────────────────────────────

@pytest.fixture
def regal(tmp_path, monkeypatch):
    f = tmp_path / "rack_slots.json"
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(f))
    return f


@pytest.mark.parametrize("inhalt", [ABGESCHNITTEN, "[1, 2, 3]"])
def test_kaputte_regal_datei_wird_nicht_ueberschrieben(inhalt, regal, monkeypatch):
    regal.write_text(inhalt, encoding="utf-8")
    alt = regal.read_bytes()
    with pytest.raises(storage.BrokenFile):
        rack_store.update_slot("1-2", "printing")
    assert regal.read_bytes() == alt
    # Die Farm wählt kein Fach und hält an, statt das Regal für leer zu halten.
    monkeypatch.setitem(autofarm._farm, "running", True)
    monkeypatch.setitem(autofarm._farm, "paused", False)
    monkeypatch.setitem(autofarm._farm, "log", [])
    assert autofarm._find_slot_for_height(40) is None
    assert autofarm._farm["paused"] is True and "unlesbar" in autofarm._farm["error"]
    assert regal.read_bytes() == alt


def test_null_im_magazinbestand_legt_nichts_lahm(regal):
    d = rack_store.default_data()
    d["magazine_counts"] = [None, "x", 3]
    regal.write_text(json.dumps(d), encoding="utf-8")
    data = rack_store.load()
    assert data["magazine_counts"][:3] == [0, 0, 3]


def test_neuinstallation_legt_die_regal_datei_an(regal):
    assert not regal.exists()
    rack_store.ensure_file()
    assert json.loads(regal.read_text(encoding="utf-8"))["num_racks"] == rack_store.default_data()["num_racks"]


# ── Schreib-Endpunkte lassen eine kaputte Datei stehen ────────────────────────

@pytest.fixture
def dateien(tmp_path, monkeypatch):
    pfade = {
        "settings": tmp_path / "farm_settings.json",
        "queue": tmp_path / "farm_queue.json",
        "sequences": tmp_path / "farm_sequences.json",
        "geometry": tmp_path / "ottoeject_geometry.json",
        "filaments": tmp_path / "filaments.json",
    }
    monkeypatch.setattr(autofarm, "SETTINGS_PATH", str(pfade["settings"]))
    monkeypatch.setattr(farm_settings, "PATH", str(pfade["settings"]))
    monkeypatch.setattr(autofarm, "QUEUE_PATH", str(pfade["queue"]))
    monkeypatch.setattr(autofarm, "SEQ_PATH", str(pfade["sequences"]))
    monkeypatch.setattr(control, "GEOMETRY_PATH", str(pfade["geometry"]))
    monkeypatch.setattr(filaments, "CUSTOM_PATH", str(pfade["filaments"]))
    for f in pfade.values():
        f.write_text(ABGESCHNITTEN, encoding="utf-8")
    # Die Farm liest die Warteschlange beim Start der App (seit v1.1.58 immer geladen).
    monkeypatch.setitem(autofarm._farm, "jobs", [])
    monkeypatch.setitem(autofarm._farm, "_queue_next_id", 1)
    monkeypatch.setitem(autofarm._farm, "_queue_broken", None)
    autofarm.reload_queue()
    return pfade


@pytest.mark.parametrize("key,method,url,body", [
    ("settings", "put", "/api/autofarm/settings", {"poll_interval": 30}),
    ("queue", "put", "/api/autofarm/queue", {"jobs": []}),
    ("sequences", "put", "/api/autofarm/sequences", {"seq_new": [], "seq_next": []}),
    ("geometry", "put", "/api/control/ottoeject/geometry", {}),
    ("filaments", "post", "/api/filaments/custom",
     {"brand": "Bambu Lab", "material": "PLA", "name": "PLA Basic Rot", "color_hex": "#C12E1F"}),
])
def test_schreiben_ueberschreibt_keine_kaputte_datei(key, method, url, body, dateien):
    alt = dateien[key].read_bytes()
    r = getattr(client, method)(url, json=body)
    assert r.status_code in (409, 503), r.text
    assert r.json()["detail"] == "DATEI_UNLESBAR"
    assert dateien[key].read_bytes() == alt


def test_kaputte_warteschlange_sperrt_lesen_und_einreihen(dateien):
    assert client.get("/api/autofarm/queue").json()["detail"] == "DATEI_UNLESBAR"
    r = client.delete("/api/autofarm/queue/jobs/1")
    assert r.status_code == 503 and dateien["queue"].read_text(encoding="utf-8") == ABGESCHNITTEN


def test_reset_der_warteschlange_laedt_sie_neu(dateien, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    assert client.post("/api/system/data-files/queue/reset").status_code == 200
    assert not autofarm._farm.get("_queue_broken")
    assert client.get("/api/autofarm/queue").json() == []


def test_lesen_liefert_keine_vorgaben(dateien):
    r = client.get("/api/autofarm/settings")
    assert r.status_code == 503 and r.json()["file"] == "farm_settings.json"


def test_start_bei_kaputter_datei_wird_verweigert(dateien, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    monkeypatch.setattr(autofarm, "_stress_task", None)
    monkeypatch.setattr(autofarm, "_assert_released", lambda: None)
    with pytest.raises(storage.BrokenFile):
        asyncio.run(autofarm.start_farm(autofarm.StartRequest(bambu_id=1, jobs=[])))
    assert autofarm._farm["running"] is False


# ── Datenspeicher: melden und bewusst zurücksetzen ────────────────────────────

def test_kaputte_datei_wird_gemeldet(dateien, monkeypatch):
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(dateien["settings"]), "settings")])
    r = client.get("/api/system/data-files").json()
    eintrag = next(f for f in r["files"] if f["key"] == "settings")
    assert eintrag["broken"] is True and eintrag["resettable"] is True
    assert r["broken"] >= 1


def test_reset_legt_kopie_an_und_schreibt_vorgabe(dateien, monkeypatch):
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(dateien["settings"]), "settings")])
    monkeypatch.setitem(autofarm._farm, "running", False)
    r = client.post("/api/system/data-files/settings/reset")
    assert r.status_code == 200, r.text
    assert (dateien["settings"].parent / r.json()["backup"]).read_text(encoding="utf-8") == ABGESCHNITTEN
    assert json.loads(dateien["settings"].read_text(encoding="utf-8")) == farm_settings.DEFAULTS


def test_lesbare_datei_wird_nie_zurueckgesetzt(tmp_path, monkeypatch):
    f = tmp_path / "farm_settings.json"
    f.write_text('{"poll_interval": 42}', encoding="utf-8")
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(f), "settings")])
    monkeypatch.setitem(autofarm._farm, "running", False)
    assert client.post("/api/system/data-files/settings/reset").status_code == 400
    assert json.loads(f.read_text(encoding="utf-8")) == {"poll_interval": 42}


def test_reset_bei_laufender_farm_409(dateien, monkeypatch):
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(dateien["settings"]), "settings")])
    monkeypatch.setitem(autofarm._farm, "running", True)
    assert client.post("/api/system/data-files/settings/reset").status_code == 409
