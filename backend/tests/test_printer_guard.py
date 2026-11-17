"""printer_guard: Nur ein frischer Druckerzustand zählt.

Bis v1.1.43 ließ ein leerer oder alter Cache-Status Kalibrierung und AMS-Befehle
durch. Unbekannt ist nicht frei.
"""
import pytest

from app.services import bambu_manager, printer_guard

REPORT = {"print": {"gcode_state": "RUNNING", "mc_percent": 42, "mc_remaining_time": 73,
                    "subtask_name": "Teil", "nozzle_temper": 219.8, "bed_temper": 55.0}}


@pytest.fixture
def drucker(monkeypatch):
    lage = {"ensure": True, "age": 1.0, "raw": REPORT, "pushall": 0}

    def pushall(d):
        lage["pushall"] += 1
        return True
    monkeypatch.setattr(bambu_manager, "ensure", lambda d, **kw: lage["ensure"])
    monkeypatch.setattr(bambu_manager, "request_pushall", pushall)
    monkeypatch.setattr(bambu_manager, "status_age", lambda d: lage["age"])
    monkeypatch.setattr(bambu_manager, "last_status", lambda d: lage["raw"])
    return lage


def test_druckt_ist_belegt(drucker):
    state = printer_guard.live_state(object())
    assert state == "RUNNING"
    assert "belegt" in printer_guard.busy_reason(state)
    assert drucker["pushall"] == 1


def test_fertig_ist_frei(drucker):
    drucker["raw"] = {"print": {**REPORT["print"], "gcode_state": "FINISH"}}
    assert printer_guard.busy_reason(printer_guard.live_state(object())) is None


def test_veralteter_status_ist_unbekannt(drucker):
    drucker["age"] = 600.0
    drucker["raw"] = {"print": {**REPORT["print"], "gcode_state": "FINISH"}}
    assert printer_guard.live_state(object(), wait_s=0.0) is None
    assert printer_guard.busy_reason(None) == printer_guard.UNKNOWN


def test_ohne_verbindung_ist_unbekannt(drucker):
    drucker["ensure"] = False
    assert printer_guard.live_state(object()) is None


def test_noch_nie_ein_telegramm_ist_unbekannt(drucker):
    drucker["age"] = None
    assert printer_guard.live_state(object(), wait_s=0.0) is None


def test_leerer_status_ist_unbekannt(drucker):
    drucker["raw"] = {}
    assert printer_guard.live_state(object()) is None


def test_pause_nur_wenn_erlaubt():
    assert printer_guard.busy_reason("PAUSE") is not None
    assert printer_guard.busy_reason("PAUSE", allow_pause=True) is None
