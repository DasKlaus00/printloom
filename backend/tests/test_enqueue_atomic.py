"""Einreihen ganz oder gar nicht (seit v1.1.55).

- Ein Stopp, während die Höhe einer Datei analysiert wird, verliert den Job nicht:
  Er landet in der gespeicherten Warteschlange. Bis v1.1.54 hängte er sich an die
  Liste einer Farm, die sie schon weggeschrieben hatte — weg.
- Mehrere Platten (Plugin, Bibliothek): Scheitert Platte 2, wird keine eingereiht.
  Bis v1.1.54 lag Platte 1 schon in der Farm, ein erneutes Senden druckte sie doppelt.
- Eine doppelte ID lehnt den ganzen Satz ab.
"""
import asyncio
import json

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")


from app.routers import autofarm as af  # noqa: E402


@pytest.fixture(autouse=True)
def farm(monkeypatch, tmp_path):
    queue = tmp_path / "farm_queue.json"
    monkeypatch.setattr(af, "QUEUE_PATH", str(queue))
    for key, val in {"running": True, "paused": False, "stopping": False,
                     "jobs": [], "log": [], "_queue_next_id": 1}.items():
        monkeypatch.setitem(af._farm, key, val)
    return queue


def _req(**kw):
    return af.EnqueueRequest(**{"fileId": 3, "fileName": "teil.3mf", "slot": "1-0", **kw})


def test_stopp_waehrend_der_hoehenanalyse_verliert_den_job_nicht(farm, monkeypatch):
    async def hoehe(job):
        af._farm["running"] = False          # Farm wird gestoppt, während wir warten
        return 12.5, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)
    out = asyncio.run(af.enqueue_job(_req()))
    gespeichert = json.loads(farm.read_text(encoding="utf-8"))["jobs"]
    assert [j["id"] for j in gespeichert] == [out["id"]]
    assert gespeichert[0]["object_height_mm"] == 12.5
    assert [j["id"] for j in af._farm["jobs"]] == [out["id"]]   # dieselbe Liste


def test_scheitert_platte_2_wird_keine_eingereiht(monkeypatch):
    async def hoehe(job):
        if job["plate"] == 2:
            raise RuntimeError("Platte 2 nicht lesbar")
        return 10.0, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)
    with pytest.raises(RuntimeError):
        asyncio.run(af.add_library_jobs(3, "teil.3mf", [(1, 2, "A"), (2, 2, "B")]))
    assert af._farm["jobs"] == []


def test_alle_platten_bekommen_eigene_ids(monkeypatch):
    async def hoehe(job):
        return 10.0, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)
    af._farm["jobs"] = [{"id": 4, "fileName": "alt.3mf"}]
    ids = asyncio.run(af.add_library_jobs(3, "teil.3mf", [(1, 2, "A"), (2, 2, "B")]))
    assert ids == [5, 6]
    assert [j["plate"] for j in af._farm["jobs"][1:]] == [1, 2]
    assert all(j["slot"] == "1-0" for j in af._farm["jobs"][1:])


def test_id_vom_client_wird_ignoriert(monkeypatch):
    async def hoehe(job):
        return 10.0, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)
    af._farm["jobs"] = [{"id": 9, "fileName": "alt.3mf", "status": "pending"}]
    out = asyncio.run(af.enqueue_job(_req(id=9)))
    assert out["id"] == 10 and [j["id"] for j in af._farm["jobs"]] == [9, 10]


def test_gleichzeitig_eingereiht_ergibt_zwei_ids(monkeypatch):
    """Plugin und Bibliothek zugleich: Die Höhen-Analyse wartet, das Anhängen nicht."""
    async def hoehe(job):
        await asyncio.sleep(0)
        return 10.0, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)

    async def beide():
        return await asyncio.gather(af.enqueue_job(_req()), af.enqueue_job(_req()))
    a, b = asyncio.run(beide())
    assert a["id"] != b["id"]
    assert len({j["id"] for j in af._farm["jobs"]}) == 2


def test_ohne_laufende_farm_geht_es_in_die_gespeicherte_warteschlange(farm, monkeypatch):
    async def hoehe(job):
        return 10.0, 0.2
    monkeypatch.setattr(af, "_job_height", hoehe)
    af._farm["running"] = False
    farm.write_text(json.dumps({"jobs": [{"id": 2, "fileId": 1, "fileName": "x.3mf"}]}),
                    encoding="utf-8")
    af.reload_queue()                       # so liegt sie beim Start der App da
    ids = asyncio.run(af.add_library_jobs(3, "teil.3mf", [(None, None, "")]))
    gespeichert = json.loads(farm.read_text(encoding="utf-8"))["jobs"]
    assert ids == [3]
    assert [j["id"] for j in gespeichert] == [2, 3]
