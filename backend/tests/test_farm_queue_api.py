"""Einzel-Endpunkte der Warteschlange (seit v1.1.58): Die Seiten ändern nur noch
einzelne Jobs, die ganze Liste schreibt nur der Server.

Bis v1.1.57 speicherte die Auto-Farm-Seite alle 800 ms ihre ganze Kopie (PUT /queue)
und löschte so, was inzwischen Bibliothek oder OrcaSlicer eingereiht hatten.
"""
import zipfile

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import autofarm as af  # noqa: E402
from app.services import farm_queue  # noqa: E402

client = TestClient(app)


class Zeile:
    # Form eines echten UploadedFile-Eintrags (nur die gelesenen Felder)
    def __init__(self, path, name):
        self.id, self.file_path, self.file_type, self.original_filename = 3, str(path), ".3mf", name


@pytest.fixture
def liste(tmp_path, monkeypatch):
    monkeypatch.setattr(af, "QUEUE_PATH", str(tmp_path / "farm_queue.json"))
    for key, val in {"running": False, "jobs": [], "log": [], "_queue_next_id": 1,
                     "_queue_broken": None}.items():
        monkeypatch.setitem(af._farm, key, val)
    datei = tmp_path / "set.gcode.3mf"
    with zipfile.ZipFile(datei, "w") as z:
        for p in (1, 2, 3):
            z.writestr(f"Metadata/plate_{p}.gcode", "G1 Z10\n")
    zeile = Zeile(datei, "Set.gcode.3mf")

    class DB:
        def query(self, *a):
            class Q:
                def filter(self, *a, **kw):
                    return self

                def first(self):
                    return zeile
            return Q()

        def close(self):
            pass

    async def hoehe(job):
        return 12.0, 0.2
    monkeypatch.setattr(af, "SessionLocal", DB)
    monkeypatch.setattr(af, "_job_height", hoehe)
    return tmp_path


def _job(i, status="pending"):
    return farm_queue.normalize_job({"id": i, "fileId": 3, "fileName": f"t{i}", "status": status})


def test_mehrplatten_ohne_plate_ergibt_je_platte_einen_job(liste):
    r = client.post("/api/autofarm/queue/jobs", json={"fileId": 3, "count": 2}).json()
    assert [(j["plate"], j["plateTotal"]) for j in r["jobs"]] == [(1, 3), (1, 3), (2, 3), (2, 3),
                                                                (3, 3), (3, 3)]
    assert r["ids"] == [1, 2, 3, 4, 5, 6] and all(j["fileName"] == "Set.gcode.3mf" for j in r["jobs"])


def test_eine_platte(liste):
    r = client.post("/api/autofarm/queue/jobs", json={"fileId": 3, "plate": 2, "tag": "proj:9"}).json()
    assert [(j["plate"], j["tag"], j["object_height_mm"]) for j in r["jobs"]] == [(2, "proj:9", 12.0)]


def test_put_queue_entfernt_keine_fremd_hinzugefuegten_jobs(liste):
    af._farm["jobs"] = [_job(1)]
    etag = client.get("/api/autofarm/queue").headers["etag"]
    client.post("/api/autofarm/queue/jobs", json={"fileId": 3, "plate": 1})   # Plugin reiht ein
    r = client.put("/api/autofarm/queue", json={"jobs": [_job(1)]}, headers={"If-Match": etag})
    assert r.status_code == 409
    assert len(af._farm["jobs"]) == 2


def test_put_queue_ohne_if_match_wird_abgelehnt(liste):
    af._farm["jobs"] = [_job(1)]
    assert client.put("/api/autofarm/queue", json={"jobs": []}).status_code == 409
    assert len(af._farm["jobs"]) == 1


def test_put_queue_mit_aktuellem_stand(liste):
    af._farm["jobs"] = [_job(1), _job(2)]
    etag = client.get("/api/autofarm/queue").headers["etag"]
    r = client.put("/api/autofarm/queue", json={"jobs": [_job(2)]}, headers={"If-Match": etag})
    assert r.status_code == 200 and [j["id"] for j in af._farm["jobs"]] == [2]


def test_put_queue_bei_laufender_farm_wird_abgelehnt(liste, monkeypatch):
    monkeypatch.setitem(af._farm, "running", True)
    etag = client.get("/api/autofarm/queue").headers["etag"]
    assert client.put("/api/autofarm/queue", json={"jobs": []},
                      headers={"If-Match": etag}).status_code == 409


def test_reorder_ohne_lauf_verliert_keine_wartenden_jobs(liste):
    af._farm["jobs"] = [_job(1), _job(2), _job(3)]
    r = client.put("/api/autofarm/queue/order", json={"job_ids": [3, 1]}).json()
    assert [j["id"] for j in r["jobs"]] == [3, 1, 2]


def test_entfernen_ohne_lauf(liste):
    af._farm["jobs"] = [_job(1), _job(2, "printing")]
    assert client.delete("/api/autofarm/queue/jobs/1").status_code == 200
    assert client.delete("/api/autofarm/queue/jobs/2").status_code == 400
    assert [j["id"] for j in af._farm["jobs"]] == [2]


def test_wiederholen_nur_bei_fehler(liste):
    af._farm["jobs"] = [_job(1, "error"), _job(2, "done")]
    assert client.patch("/api/autofarm/queue/jobs/1", json={"retry": True}).json()["jobs"][0]["status"] == "pending"
    assert client.patch("/api/autofarm/queue/jobs/2", json={"retry": True}).status_code == 409


def test_ams_zuordnung_hebt_die_sperre_auf(liste):
    af._farm["jobs"] = [{**_job(1), "needs_ams": True}]
    job = client.patch("/api/autofarm/queue/jobs/1", json={"amsMap": " 0,2 "}).json()["jobs"][0]
    assert job["amsMap"] == "0,2" and job["needs_ams"] is False


def test_reset_setzt_fertige_nicht_zurueck(liste):
    af._farm["jobs"] = [_job(1, "error"), _job(2, "done")]
    r = client.post("/api/autofarm/queue/reset-failed").json()
    assert [j["status"] for j in r["jobs"]] == ["pending", "done"]
