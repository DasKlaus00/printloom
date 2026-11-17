"""Backup und Update nur bei Stillstand (seit v1.1.61, Umbauplan Schritt 15).

Bis v1.1.60:
- spielte ein Backup mitten im Lauf Sequenzen, Regal und Geometrie ein;
- ersetzte es die echte Fach-Belegung (die Farm legte danach eine Platte auf ein
  belegtes Fach) und schrieb jeden Abschnitt ungeprüft;
- startete ein Update auch während einer Fahrt und meldete immer „Fertig";
- rollte ein gescheitertes Docker-Update auf den Tag zurück, der schon auf das neue
  Image zeigte.
"""
import asyncio
import json
import types

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm, system  # noqa: E402
from app.services import rack_store, updater  # noqa: E402

ZYKLUS = [{"id": 1, "type": "send_file"}, {"id": 2, "type": "wait_print"}]


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def ablage(tmp_path, monkeypatch):
    seq = tmp_path / "seq.json"
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "slots.json"))
    monkeypatch.setattr(system, "_backup_files", lambda: [(str(seq), "sequences"),
                                                          (rack_store.SLOTS_PATH, "rack_slots")])
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    monkeypatch.setattr(autofarm, "_stress_task", None)
    return types.SimpleNamespace(seq=seq, slots=tmp_path / "slots.json")


# ── Backup ───────────────────────────────────────────────────────────────────

def test_einspielen_bei_laufender_farm_wird_abgelehnt(ablage, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", True)
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"sequences": {"seq_new": [], "seq_next": ZYKLUS}}))
    assert e.value.status_code == 409 and not ablage.seq.exists()


def test_einspielen_auch_bei_pausierter_farm_abgelehnt(ablage, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", True)
    monkeypatch.setitem(autofarm._farm, "paused", True)
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"sequences": {"seq_new": [], "seq_next": ZYKLUS}}))
    assert e.value.status_code == 409


def test_einspielen_ueberschreibt_keine_belegten_faecher(ablage):
    rack_store.ensure_file()
    with rack_store.edit() as data:
        data["slots"]["1-1"] = {**data["slots"]["1-1"], "status": "done", "file_name": "Teil"}
        data["magazine_counts"] = [3] * data["num_racks"]   # echte Form: ein Wert je Regal
    backup = rack_store.default_data()       # im Backup ist 1-1 frei, Bestand voll
    backup["slot_height_mm"] = 55.0
    r = _run(system.import_backup({"rack_slots": backup}))
    live = rack_store.load()
    assert live["slots"]["1-1"]["status"] == "done"
    assert live["magazine_counts"] == [3] * live["num_racks"]
    assert live["slot_height_mm"] == 55.0 and "rack_slots" in r["restored"]


def test_ohne_regal_datei_wird_es_frei_angelegt_mit_hinweis(ablage):
    r = _run(system.import_backup({"rack_slots": rack_store.default_data()}))
    assert any("Regal neu angelegt" in n for n in r["notes"])
    assert all(s["status"] == "free" for s in rack_store.load()["slots"].values())


def test_einspielen_prueft_die_form_der_abschnitte(ablage):
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"sequences": {"seq_new": [], "seq_next": ZYKLUS},
                                   "rack_slots": [1, 2, 3]}))
    assert e.value.status_code == 400
    assert not ablage.seq.exists()            # nichts halb eingespielt


def test_sequenzen_werden_bereinigt_und_bekommen_das_schema(ablage):
    r = _run(system.import_backup({"sequences": {"seq_new": [], "seq_next": ZYKLUS + [
        {"id": 3, "type": "teleport"}, {"id": 4, "type": "delay", "geheim": 1}]}}))
    data = json.loads(ablage.seq.read_text(encoding="utf-8"))
    assert [s["type"] for s in data["seq_next"]] == ["send_file", "wait_print", "delay"]
    assert "geheim" not in data["seq_next"][2]
    assert data["schema_version"] == autofarm.SEQ_SCHEMA_VERSION
    assert any("unbekannte Schritt" in n for n in r["notes"])


def test_fremdes_schema_wird_abgelehnt(ablage):
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"schema": "fremdes-tool/2", "sequences": {"seq_next": ZYKLUS}}))
    assert e.value.status_code == 400 and not ablage.seq.exists()


def test_geraet_mit_kaputtem_port_wird_abgelehnt(ablage):
    with pytest.raises(HTTPException) as e:
        _run(system.import_backup({"devices": [{"name": "X", "device_type": "klipper",
                                                "port": "sieben"}]}))
    assert e.value.status_code == 400


# ── Update ───────────────────────────────────────────────────────────────────

def test_update_bei_laufender_farm_wird_abgelehnt(ablage, monkeypatch):
    monkeypatch.setitem(autofarm._farm, "running", True)
    gezogen = []
    monkeypatch.setattr(updater, "pull_image", lambda img: gezogen.append(img) or (True, ""))
    with pytest.raises(HTTPException) as e:
        _run(system.trigger_update(system.UpdateIn(channel="beta")))
    assert e.value.status_code == 409 and gezogen == []


def test_update_marker(tmp_path, monkeypatch):
    monkeypatch.setattr(system, "_update_marker_path", lambda: str(tmp_path / "update_pending.json"))
    assert system.update_result("1.1.60") is None
    system._write_update_marker({"from_version": "1.1.60", "target_image": "x:beta", "at": 0})
    assert system.update_result("1.1.60")["state"] == "failed"      # 10 min um, gleiche Version
    import time
    system._write_update_marker({"from_version": "1.1.60", "at": time.time()})
    assert system.update_result("1.1.60")["state"] == "pending"
    assert system.update_result("1.1.61") == {"state": "ok", "from": "1.1.60", "to": "1.1.61"}
    assert system.update_result("1.1.61") is None                   # Marker ist weg


def test_rollback_nutzt_die_image_id(monkeypatch):
    laeufe = []

    class Alt:
        image = types.SimpleNamespace(id="sha256:alt")
        attrs = {"Config": {"Image": "ghcr.io/x/printloom:beta", "Env": []}, "HostConfig": {},
                 "NetworkSettings": {}}

        def stop(self, timeout=0):
            raise RuntimeError("hängt")

        def remove(self, force=False):
            pass

    class Containers:
        def get(self, name):
            return Alt()

        def run(self, **kw):
            laeufe.append(kw["image"])
            if len(laeufe) == 1:
                raise RuntimeError("neuer Container startet nicht")

    client = types.SimpleNamespace(images=types.SimpleNamespace(pull=lambda img: None),
                                   containers=Containers())
    monkeypatch.setattr(updater, "_client", lambda: client)
    with pytest.raises(RuntimeError):
        updater.recreate("ghcr.io/x/printloom:beta", "printloom")
    assert laeufe == ["ghcr.io/x/printloom:beta", "sha256:alt"]
