"""Safety-critical slot-assignment logic (the Python half of the rack planner)."""
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
