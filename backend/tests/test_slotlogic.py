"""Safety-critical slot-assignment logic (the Python half of the rack planner)."""
import asyncio
from datetime import datetime

import pytest

pytest.importorskip("httpx")
pytest.importorskip("paho.mqtt.client")
pytest.importorskip("fastapi")

from app.routers import autofarm  # noqa: E402
from app.services import storage  # noqa: E402

# Reine Fächer-Mathematik (slots_needed / is_blocked_from_below) → siehe
# test_rack_logic.py (läuft ohne FastAPI). Hier nur die zustandsbehaftete
# Slot-Zuweisung, die _farm + slots.json einbezieht.


def test_find_slot_for_height(tmp_path, monkeypatch):
    data = {
        "num_racks": 1, "slots_per_rack": 6, "slot_height_mm": 50,
        "slots": {f"1-{s}": {"status": "free"} for s in range(1, 7)},
    }
    p = str(tmp_path / "slots.json")
    storage.write_json(p, data)
    monkeypatch.setattr(autofarm, "SLOTS_PATH", p)
    monkeypatch.setitem(autofarm._farm, "jobs", [])

    assert autofarm._find_slot_for_height(30) == "1-1"

    for s in (1, 2, 3):
        data["slots"][f"1-{s}"]["status"] = "done"
    storage.write_json(p, data)
    assert autofarm._find_slot_for_height(30) == "1-4"


def test_find_slot_returns_none_when_full(tmp_path, monkeypatch):
    data = {
        "num_racks": 1, "slots_per_rack": 2, "slot_height_mm": 50,
        "slots": {"1-1": {"status": "done"}, "1-2": {"status": "done"}},
    }
    p = str(tmp_path / "slots.json")
    storage.write_json(p, data)
    monkeypatch.setattr(autofarm, "SLOTS_PATH", p)
    monkeypatch.setitem(autofarm._farm, "jobs", [])
    assert autofarm._find_slot_for_height(30) is None


# ── Start-Countdown nach Leerlauf ────────────────────────────
def test_prestart_countdown_aborts_when_stopping(monkeypatch):
    """Stopp während des Countdowns → kein Start (False), Anzeige zurückgesetzt."""
    monkeypatch.setitem(autofarm._farm, "stopping", True)
    monkeypatch.setitem(autofarm._farm, "paused", False)
    monkeypatch.setitem(autofarm._farm, "jobs", [{"id": 1, "status": "pending"}])
    monkeypatch.setitem(autofarm._farm, "start_countdown", 0)
    assert asyncio.run(autofarm._prestart_countdown(15)) is False
    assert autofarm._farm["start_countdown"] == 0


def test_prestart_countdown_aborts_when_queue_empty(monkeypatch):
    """Letzter Job während des Countdowns entfernt → kein Start (False)."""
    monkeypatch.setitem(autofarm._farm, "stopping", False)
    monkeypatch.setitem(autofarm._farm, "paused", False)
    monkeypatch.setitem(autofarm._farm, "jobs", [])
    monkeypatch.setitem(autofarm._farm, "start_countdown", 0)
    assert asyncio.run(autofarm._prestart_countdown(15)) is False
    assert autofarm._farm["start_countdown"] == 0


# ── Betriebszeiten: Pro-Tag-Fenster ──────────────────────────
def test_operating_schedule_migration():
    """Legacy operating_days + start/end → 7-Tage-Plan."""
    s = {"operating_days": [0, 2], "operating_start": "08:00", "operating_end": "20:00"}
    sched = autofarm._operating_schedule(s)
    assert len(sched) == 7
    assert sched[0] == {"enabled": True, "start": "08:00", "end": "20:00"}
    assert sched[1]["enabled"] is False
    assert sched[2]["enabled"] is True


def _set_sched(monkeypatch, sched):
    monkeypatch.setitem(autofarm._farm, "operating_hours_enabled", True)
    monkeypatch.setitem(autofarm._farm, "operating_schedule", sched)


def test_operating_window_disabled(monkeypatch):
    monkeypatch.setitem(autofarm._farm, "operating_hours_enabled", False)
    assert autofarm._now_in_operating_window(datetime(2026, 6, 24, 3, 0)) is True


def test_operating_window_per_day(monkeypatch):
    sched = [{"enabled": True, "start": "08:00", "end": "20:00"} for _ in range(7)]
    sched[2] = {"enabled": False, "start": "08:00", "end": "20:00"}   # Mi aus
    _set_sched(monkeypatch, sched)
    assert autofarm._now_in_operating_window(datetime(2026, 6, 22, 12, 0)) is True   # Mo 12:00
    assert autofarm._now_in_operating_window(datetime(2026, 6, 22, 22, 0)) is False  # Mo 22:00
    assert autofarm._now_in_operating_window(datetime(2026, 6, 24, 12, 0)) is False  # Mi aus


def test_operating_window_overnight(monkeypatch):
    sched = [{"enabled": True, "start": "22:00", "end": "06:00"} for _ in range(7)]
    sched[2] = {"enabled": False, "start": "22:00", "end": "06:00"}   # Mi aus
    _set_sched(monkeypatch, sched)
    assert autofarm._now_in_operating_window(datetime(2026, 6, 22, 23, 0)) is True   # Mo 23:00 (Abend)
    assert autofarm._now_in_operating_window(datetime(2026, 6, 23, 3, 0))  is True   # Di 03:00 (zu Mo)
    assert autofarm._now_in_operating_window(datetime(2026, 6, 22, 12, 0)) is False  # Mo 12:00
    assert autofarm._now_in_operating_window(datetime(2026, 6, 24, 23, 0)) is False  # Mi aus
    assert autofarm._now_in_operating_window(datetime(2026, 6, 25, 3, 0))  is False  # Do 03:00 zu Mi-Abend (aus)
