"""Regeln der Warteschlange (app/services/farm_queue.py, seit v1.1.57)."""
import json

import pytest

from app.services import farm_queue as fq
from app.services import storage


def _job(i, status="pending", **kw):
    # Form der Farm-Jobs (autofarm._prepare_job), gekürzt auf die gelesenen Felder
    return {"id": i, "fileId": 3, "fileName": f"teil{i}.3mf", "slot": "1-0",
            "status": status, "progress": 0, "remaining": 0, **kw}


def test_umsortieren_behaelt_einen_fehlenden_wartenden_job_hinten():
    jobs = [_job(1, "printing"), _job(2), _job(3), _job(4)]
    out = fq.reorder(jobs, [3, 2])            # Job 4 kam nach dem Laden der Seite dazu
    assert [j["id"] for j in out] == [1, 3, 2, 4]


def test_umsortieren_zaehlt_doppelte_einmal_und_ignoriert_fremde():
    out = fq.reorder([_job(1), _job(2)], [2, 2, 9, 1])
    assert [j["id"] for j in out] == [2, 1]


def test_reset_setzt_fertige_nie_zurueck():
    out = fq.reset_failed([_job(1, "done"), _job(2, "error", reason="FAILED")])
    assert out[0]["status"] == "done"
    assert out[1]["status"] == "pending" and out[1]["reason"] == ""


@pytest.mark.parametrize("fn,grund", [(fq.finalize_after_stop, fq.REASON_STOPPED),
                                      (fq.recover_after_restart, fq.REASON_RESTART)])
def test_nach_stopp_oder_neustart(fn, grund):
    jobs = [_job(1, "done"), _job(2, "printing"), _job(3, "sending"), _job(4), _job(5, "error")]
    out = fn(jobs)
    assert [j["id"] for j in out] == [2, 3, 4, 5]
    assert [j["status"] for j in out] == ["error", "error", "pending", "error"]
    assert out[0]["reason"] == grund and out[2].get("reason", "") == ""


def test_entfernen():
    assert [j["id"] for j in fq.remove([_job(1), _job(2, "done")], 2)] == [1]
    with pytest.raises(ValueError):
        fq.remove([_job(1, "printing")], 1)
    with pytest.raises(KeyError):
        fq.remove([_job(1)], 7)


def test_id_wird_nach_dem_entfernen_nicht_wiederverwendet(tmp_path):
    path = str(tmp_path / "q.json")
    jobs = [_job(1), _job(2)]
    fq.save(fq.remove(jobs, 2), fq.next_id(jobs), path)
    jobs2, nid = fq.load(path)
    assert [j["id"] for j in jobs2] == [1] and nid == 3


def test_altformat_ohne_zaehler(tmp_path):
    p = tmp_path / "q.json"
    p.write_text(json.dumps({"jobs": [_job(4), _job(9)]}), encoding="utf-8")
    jobs, nid = fq.load(str(p))
    assert [j["id"] for j in jobs] == [4, 9] and nid == 10


def test_fehlende_datei_ist_leer_kaputte_nicht(tmp_path):
    assert fq.load(str(tmp_path / "fehlt.json")) == ([], 1)
    kaputt = tmp_path / "kaputt.json"
    kaputt.write_text("{", encoding="utf-8")
    with pytest.raises(storage.BrokenFile):
        fq.load(str(kaputt))


def test_farm_umsortieren_verliert_keinen_job(monkeypatch):
    pytest.importorskip("fastapi")
    import asyncio
    from app.routers import autofarm as af
    monkeypatch.setitem(af._farm, "running", True)
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "jobs", [_job(1, "printing"), _job(2), _job(3)])
    asyncio.run(af.reorder_jobs(af.ReorderPayload(job_ids=[3])))   # Seite kennt Job 2 nicht
    assert [j["id"] for j in af._farm["jobs"]] == [1, 3, 2]
    asyncio.run(af.remove_job_from_farm(2))
    assert [j["id"] for j in af._farm["jobs"]] == [1, 3]
