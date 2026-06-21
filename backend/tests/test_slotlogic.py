"""Safety-critical slot-assignment logic (the Python half of the rack planner)."""
import pytest

pytest.importorskip("httpx")
pytest.importorskip("paho.mqtt.client")
pytest.importorskip("fastapi")

from app.routers import autofarm  # noqa: E402
from app.services import storage  # noqa: E402


def test_slots_needed_with_tolerance():
    # 20mm Toleranz: max(1, ceil((h - 20) / slot_h))
    assert autofarm._slots_needed(40, 50.0) == 1
    assert autofarm._slots_needed(70, 50.0) == 1   # slotH + Toleranz
    assert autofarm._slots_needed(71, 50.0) == 2
    assert autofarm._slots_needed(100, 50.0) == 2
    assert autofarm._slots_needed(170, 50.0) == 3


def test_is_blocked_from_below():
    # 100mm object in 50mm slots → 2 Fächer (20mm Toleranz) → blockiert 1-1,1-2
    slots = {"1-1": {"object_height_mm": 100}}
    assert autofarm._is_blocked_from_below(1, 2, slots, 50.0) is True
    assert autofarm._is_blocked_from_below(1, 3, slots, 50.0) is False
    # 170mm → 3 Fächer → blockiert 1-1..1-3
    tall = {"1-1": {"object_height_mm": 170}}
    assert autofarm._is_blocked_from_below(1, 3, tall, 50.0) is True
    assert autofarm._is_blocked_from_below(1, 4, tall, 50.0) is False


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
