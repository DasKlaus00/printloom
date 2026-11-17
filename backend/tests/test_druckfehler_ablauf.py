"""Druckfehler und Hänger im Farm-Zyklus (seit v1.1.45).

- FAILED wird nur wiederholt, solange noch nichts gedruckt wurde. Bis v1.1.44 druckte
  der zweite Versuch auf den Resten des ersten (Vorgabe: eine Wiederholung).
- Mindestdruckzeit und Stillstand mit „überspringen" brechen den Druck am Drucker ab.
  Bis v1.1.44 druckte er weiter, während die Farm den nächsten Job vorbereitete.
- Nach einem Hänger mit „pausieren" beginnt der Job neu oder endet als Fehler; bis
  v1.1.44 blieb er für immer „running".
"""
import asyncio
from datetime import datetime

import pytest

pytest.importorskip("fastapi")

from app.routers import autofarm as af  # noqa: E402


class Drucker:
    id, name = 2, "X1C"
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"


def _report(state, pct=0, rem=0, layers=0):
    # Form eines echten X1C-Reports (Ausschnitt): print.gcode_state, mc_percent, …
    return {"print": {"gcode_state": state, "mc_percent": pct, "mc_remaining_time": rem,
                      "total_layer_num": layers, "hms": []}}


def _job(**kw):
    return af.JobIn(id=7, fileId=3, fileName="teil.3mf", slot="2-3", **kw).model_dump()


@pytest.fixture
def druck(monkeypatch, tmp_path):
    """_wait_print gegen eine Folge von Reports; Senden und Druckerbefehle mitgeschrieben."""
    lage = {"reports": [], "gesendet": [], "befehle": []}

    def last_status(device):
        if len(lage["reports"]) > 1:
            return lage["reports"].pop(0)
        return lage["reports"][0]

    async def do_send(job, device, use_ams):
        lage["gesendet"].append(job["id"])

    async def print_cmd(cmd):
        lage["befehle"].append(cmd)

    async def nichts(*a, **kw):
        return None

    real_sleep = asyncio.sleep

    async def schnell(_):
        await real_sleep(0)
    monkeypatch.setattr(af.bambu_manager, "ensure", lambda d, **kw: True)
    monkeypatch.setattr(af.bambu_manager, "request_pushall", lambda d: True)
    monkeypatch.setattr(af.bambu_manager, "last_status", last_status)
    monkeypatch.setattr(af, "_do_send_file", do_send)
    monkeypatch.setattr(af, "_send_print_cmd", print_cmd)
    monkeypatch.setattr(af, "capture_snapshot", nichts)
    monkeypatch.setattr(af, "_handle_hms", nichts)
    monkeypatch.setattr(af, "_notify", nichts)
    monkeypatch.setattr(af, "publish_live_status", lambda raw, did=None: None)
    monkeypatch.setattr(af, "_refresh_live_settings", lambda: None)
    monkeypatch.setattr(af, "_live", lambda key, fallback: fallback)
    monkeypatch.setattr(af, "_record_event", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_rack_update", lambda *a, **kw: None)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af.asyncio, "sleep", schnell)
    job = _job()
    for key, val in {"running": True, "paused": False, "stopping": False, "bed": "printing",
                     "jobs": [job], "log": [], "failed_retries": 1,
                     "error_strategy": {"print_failed": "skip", "progress_stall": "skip"}}.items():
        monkeypatch.setitem(af._farm, key, val)
    lage["job"] = job
    return lage


def _warte(lage, min_min=0):
    return asyncio.run(af._wait_print(lage["job"], Drucker(), 1, min_min, []))


def test_failed_nach_druckbeginn_wird_nicht_wiederholt(druck):
    druck["reports"] = [_report("RUNNING", 40, 30), _report("FAILED", 40), _report("FAILED", 40)]
    with pytest.raises(RuntimeError, match="FAILED"):
        _warte(druck)
    assert druck["gesendet"] == []
    assert any("Wiederholung übersprungen" in z for z in af._farm["log"])


def test_failed_vor_druckbeginn_wird_einmal_wiederholt(druck):
    druck["reports"] = [_report("FAILED"), _report("FAILED"), _report("FINISH", 100)]
    _warte(druck)
    assert druck["gesendet"] == [7]
    assert af._farm["bed"] == "printed"


def test_mindestdruckzeit_stoppt_den_druck(druck):
    # Echte Form: Der Drucker meldet die Schichtzahl, erst dann prüft die Farm die Zeit.
    druck["reports"] = [_report("RUNNING", 1, 3, layers=120)]
    with pytest.raises(RuntimeError, match="Mindestdruckzeit"):
        _warte(druck, min_min=10)
    assert druck["befehle"] == ["stop"]


def test_druckende_bucht_das_bett(druck):
    druck["reports"] = [_report("RUNNING", 50, 10), _report("FINISH", 100)]
    _warte(druck)
    assert af._farm["bed"] == "printed"


# ── Hänger mit „pausieren" ────────────────────────────────────────────────────

@pytest.fixture
def hänger(monkeypatch):
    erledigt = []
    monkeypatch.setattr(af, "_record_completed", lambda job, status, *a, **kw: erledigt.append(status))
    freigegeben = []
    monkeypatch.setattr(af, "_rack_update", lambda slot, status, *a, **kw: freigegeben.append((slot, status)))
    monkeypatch.setitem(af._farm, "log", [])
    return erledigt, freigegeben


def test_haenger_vor_dem_druck_beginnt_den_job_neu(hänger, monkeypatch):
    job = _job(status="running")
    monkeypatch.setitem(af._farm, "jobs", [job])
    af._resume_after_move_timeout(job, "2-3", datetime.now())
    assert af._farm["jobs"][0]["status"] == "pending"
    assert hänger == ([], [])


def test_haenger_nach_dem_druckstart_endet_als_fehler(hänger, monkeypatch):
    # Echte Lage: Das Fach des Jobs ist für den Druck reserviert („printing").
    monkeypatch.setattr(af, "_rack_data", lambda: {"slots": {"2-3": {"status": "printing"}}})
    job = _job(status="printing")
    monkeypatch.setitem(af._farm, "jobs", [job])
    af._resume_after_move_timeout(job, "2-3", datetime.now())
    assert af._farm["jobs"][0]["status"] == "error"
    erledigt, freigegeben = hänger
    assert erledigt == ["error"]
    assert freigegeben == [("2-3", "free")]
