"""Reine Fächer-/Höhen-Logik (app/services/rack_logic.py) — läuft ohne FastAPI,
also auch lokal. Sicherheitskritisch: legt fest, wie viele Regal-Fächer ein
Objekt belegt und ob es in ein Fach darüber ragt."""
from app.services import rack_logic


def test_slots_needed_default_tolerance():
    # Default 20mm: max(1, ceil((h - 20) / slot_h))
    assert rack_logic.slots_needed(0, 50.0) == 1
    assert rack_logic.slots_needed(40, 50.0) == 1
    assert rack_logic.slots_needed(70, 50.0) == 1     # slotH + Toleranz
    assert rack_logic.slots_needed(71, 50.0) == 2
    assert rack_logic.slots_needed(100, 50.0) == 2
    assert rack_logic.slots_needed(170, 50.0) == 3


def test_slots_needed_custom_tolerance():
    # 0mm Toleranz → strikt aufgerundet
    assert rack_logic.slots_needed(170, 50.0, 0) == 4
    assert rack_logic.slots_needed(51, 50.0, 0) == 2
    # mehr Toleranz → tendenziell weniger Fächer (170 bleibt 3)
    assert rack_logic.slots_needed(170, 50.0, 30) == 3
    assert rack_logic.slots_needed(120, 50.0, 30) == 2


def test_is_blocked_from_below():
    # 100mm-Objekt → 2 Fächer → blockiert 1-1, 1-2
    slots = {"1-1": {"object_height_mm": 100}}
    assert rack_logic.is_blocked_from_below(1, 2, slots, 50.0) is True
    assert rack_logic.is_blocked_from_below(1, 3, slots, 50.0) is False
    # 170mm → 3 Fächer → blockiert 1-1..1-3
    tall = {"1-1": {"object_height_mm": 170}}
    assert rack_logic.is_blocked_from_below(1, 3, tall, 50.0) is True
    assert rack_logic.is_blocked_from_below(1, 4, tall, 50.0) is False


def test_is_blocked_honors_tolerance():
    # Mit 0mm Toleranz belegt 100mm 2 Fächer -> blockiert auch 1-2 (3-1=2, slots_needed=2, 2>2 false → 1-3 frei)
    slots = {"1-1": {"object_height_mm": 100}}
    assert rack_logic.is_blocked_from_below(1, 2, slots, 50.0, 0) is True
    # 110mm @0mm Toleranz → 3 Fächer → blockiert bis 1-3
    slots = {"1-1": {"object_height_mm": 110}}
    assert rack_logic.is_blocked_from_below(1, 3, slots, 50.0, 0) is True
