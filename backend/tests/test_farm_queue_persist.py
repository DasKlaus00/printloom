"""Die Warteschlange übersteht Neustart, Update und Stopp (seit v1.1.58).

Bis v1.1.57 hielt die Farm die Liste nur während des Laufs im Speicher; gespeichert
hat die Auto-Farm-Seite ihre eigene Kopie, vor dem Start. Ein Neustart mitten im
Druck meldete den gedruckten Job danach wieder als „wartet" — die Farm hätte ihn ein
zweites Mal gedruckt.
"""
import asyncio
import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm as af  # noqa: E402
from app.services import farm_queue  # noqa: E402


def _job(i, status="pending", **kw):
    return farm_queue.normalize_job({"id": i, "fileId": 3, "fileName": f"teil{i}.3mf",
                                     "status": status, **kw})


@pytest.fixture
def liste(tmp_path, monkeypatch):
    path = tmp_path / "farm_queue.json"
    monkeypatch.setattr(af, "QUEUE_PATH", str(path))
    for key, val in {"running": False, "jobs": [], "log": [], "_queue_next_id": 1,
                     "_queue_saved_at": float("-inf"), "_queue_broken": None}.items():
        monkeypatch.setitem(af._farm, key, val)
    return path


def _datei(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_neustart_mitten_im_druck_meldet_keinen_wartenden_job(liste):
    # So lag die Datei da, als die App mitten im Druck neu startete (seit v1.1.58
    # schreibt die Farm jede Statusänderung sofort).
    liste.write_text(json.dumps({"jobs": [_job(1, "printing", slot="2-3"), _job(2, "done"),
                                          _job(3)], "next_id": 4}), encoding="utf-8")
    af.reload_queue()
    jobs = asyncio.run(af.get_queue(af.Response()))
    assert [(j["id"], j["status"]) for j in jobs] == [(1, "error"), (3, "pending")]
    assert jobs[0]["reason"] == farm_queue.REASON_RESTART
    assert [j["status"] for j in _datei(liste)["jobs"]] == ["error", "pending"]


def test_altes_format_der_seite_wird_gelesen(liste):
    # Form, die die Auto-Farm-Seite bis v1.1.57 speicherte (mit ihren Analyse-Feldern).
    liste.write_text(json.dumps({"jobs": [{
        "id": 7, "fileId": 3, "fileName": "a.3mf", "slot": None, "amsMap": "", "status": "pending",
        "plate": 2, "plateTotal": 3, "plateName": None, "objectHeight": 41.0,
        "computedHeight": 47.2, "heightLoading": False, "filaments": [{"type": "PLA"}],
        "progress": 0, "remaining": 0}]}), encoding="utf-8")
    af.reload_queue()
    job = af._farm["jobs"][0]
    assert job["object_height_mm"] == 47.2 and job["slot"] == "1-0" and "filaments" not in job
    assert af._farm["_queue_next_id"] == 8


def test_jede_statusaenderung_landet_sofort_in_der_datei(liste):
    af._farm["jobs"] = [_job(1)]
    af._set_job(1, {"status": "printing"})
    assert _datei(liste)["jobs"][0]["status"] == "printing"


def test_fortschritt_wird_gedrosselt_gespeichert(liste):
    af._farm["jobs"] = [_job(1, "printing")]
    af._set_job(1, {"progress": 10})               # erste Meldung: gespeichert
    af._set_job(1, {"progress": 11, "remaining": 50})   # gleich danach: nur im Speicher
    assert _datei(liste)["jobs"][0]["progress"] == 10
    assert af._farm["jobs"][0]["progress"] == 11
    af._set_job(1, {"status": "done"})             # Status: sofort, mit allem davor
    assert _datei(liste)["jobs"][0]["progress"] == 11


def test_start_ohne_jobliste_nimmt_die_gespeicherte(liste, monkeypatch):
    af._farm["jobs"] = [_job(1), _job(2, "error")]

    async def frei(*a, **kw):
        return None

    async def lauf(**kw):
        return None
    monkeypatch.setattr(af, "_read_checked", lambda path, default, expect=dict: {
        **default, "schema_version": af.SEQ_SCHEMA_VERSION,
        "seq_new": [], "seq_next": [{"type": "send_file"}, {"type": "wait_print"}]})
    monkeypatch.setattr(af.rack_store, "exists", lambda: True)
    monkeypatch.setattr(af.rack_store, "load", lambda: {})
    for name in ("_assert_printer_geometry", "_assert_released"):
        monkeypatch.setattr(af, name, lambda *a: None)
    monkeypatch.setattr(af, "_assert_arm_idle_for_start", frei)
    monkeypatch.setattr(af, "_assert_printer_idle_for_start", frei)
    monkeypatch.setattr(af, "_plate_left", lambda: False)
    monkeypatch.setattr(af, "_record_event", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_run_farm", lauf)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    monkeypatch.setattr(af, "_task", None)
    for key in ("stopping", "paused", "idle", "recovery"):
        monkeypatch.setitem(af._farm, key, af._farm.get(key))

    # Eine alte Seite (Browser-Cache) schickt noch ihre Liste: Bekanntes zählt nicht doppelt.
    alt = af.JobIn(id=1, fileId=3, fileName="teil1.3mf", slot="1-0")
    neu = af.JobIn(id=99, fileId=4, fileName="nur-im-browser.3mf", slot="1-0")
    r = asyncio.run(af.start_farm(af.StartRequest(bambu_id=1, jobs=[alt, neu])))
    assert r["job_count"] == 2
    assert [(j["id"], j["status"]) for j in af._farm["jobs"]] == [(1, "pending"), (2, "error"),
                                                                 (99, "pending")]


def test_stopp_behaelt_wartende_und_macht_laufende_zum_fehler():
    out = farm_queue.finalize_after_stop([_job(1, "done"), _job(2, "printing"), _job(3)])
    assert [(j["id"], j["status"], j["reason"]) for j in out] == [
        (2, "error", farm_queue.REASON_STOPPED), (3, "pending", "")]
