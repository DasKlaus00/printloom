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
    # 1-3: das Objekt endet direkt darunter. Mit 100 % (= keine Stapel-Regel)
    # dürfte dort eine Platte einfahren, mit dem Standard 50 % nicht.
    assert rack_logic.is_blocked_from_below(1, 3, slots, 50.0, stacked_pct=100) is False
    # 170mm → 3 Fächer → blockiert 1-1..1-3, dazu 1-4: es nutzt die Toleranz aus,
    # ragt also in den Raum, den die einfahrende Platte bräuchte.
    tall = {"1-1": {"object_height_mm": 170}}
    assert rack_logic.is_blocked_from_below(1, 3, tall, 50.0) is True
    assert rack_logic.is_blocked_from_below(1, 4, tall, 50.0, stacked_pct=100) is True
    assert rack_logic.is_blocked_from_below(1, 5, tall, 50.0) is False   # zwei Fächer Abstand


def test_is_blocked_honors_tolerance():
    # Mit 0mm Toleranz belegt 100mm 2 Fächer -> blockiert auch 1-2
    slots = {"1-1": {"object_height_mm": 100}}
    assert rack_logic.is_blocked_from_below(1, 2, slots, 50.0, 0) is True
    # 110mm @0mm Toleranz → 3 Fächer → blockiert bis 1-3
    slots = {"1-1": {"object_height_mm": 110}}
    assert rack_logic.is_blocked_from_below(1, 3, slots, 50.0, 0) is True


# ── Platte darüber: die einfahrende Platte braucht mehr Luft als das Objekt hoch ist ──
def test_objekt_unter_einer_platte_darf_nur_den_anteil_hoch_sein():
    """Die Platte fährt ~25 mm erhöht ein und wird abgesenkt; beim Holen wird sie
    genauso angehoben. Ein Objekt, das die halbe Fachhöhe überschreitet, käme dabei
    an die Platte darüber — dieses Fach darf dann keine mehr bekommen."""
    # 50 mm Fachhöhe, Standard 50 % → bis 25 mm ist eine Platte darüber möglich
    assert rack_logic.height_limit(1, 50.0, 20, plate_above=True) == 25.0
    assert rack_logic.height_limit(1, 50.0, 20, plate_above=False) == 70.0
    ok = {"1-1": {"object_height_mm": 25}}
    zu_hoch = {"1-1": {"object_height_mm": 26}}
    assert rack_logic.is_blocked_from_below(1, 2, ok, 50.0) is False
    assert rack_logic.is_blocked_from_below(1, 2, zu_hoch, 50.0) is True


def test_anteil_ist_einstellbar():
    """100 % ist die Obergrenze der Skala: volle Fachhöhe, aber OHNE die Toleranz —
    die beschreibt ja gerade den Platz, den es unter einer Platte nicht gibt."""
    slots = {"1-1": {"object_height_mm": 40}}
    assert rack_logic.is_blocked_from_below(1, 2, slots, 50.0, stacked_pct=50) is True
    assert rack_logic.is_blocked_from_below(1, 2, slots, 50.0, stacked_pct=80) is False
    assert rack_logic.height_limit(1, 50.0, 20, plate_above=True, stacked_pct=100) == 50.0
    # 0 % = über einem belegten Objekt darf gar nichts mehr liegen
    leer = {"1-1": {"object_height_mm": 1}}
    assert rack_logic.is_blocked_from_below(1, 2, leer, 50.0, stacked_pct=0) is True


def test_magazin_gilt_immer_als_belegt():
    """Auch bei Zähler 0 — das Magazin wird von Hand nachgefüllt, jederzeit. Eine
    Höhe, die nur bei leerem Magazin passt, wäre danach falsch."""
    assert rack_logic.slot_has_plate(1, 7, {}, magazine_slot=7) is True
    assert rack_logic.slot_has_plate(1, 6, {}, magazine_slot=7) is False


def test_platte_erkennt_belegte_und_markierte_faecher():
    slots = {
        "1-2": {"status": "done"},
        "1-3": {"status": "free", "empty_plate": True},
        "1-4": {"status": "ready"},
        "1-5": {"status": "free"},
    }
    assert rack_logic.slot_has_plate(1, 2, slots) is True     # eingelagert
    assert rack_logic.slot_has_plate(1, 3, slots) is True     # markierte Leerplatte
    assert rack_logic.slot_has_plate(1, 4, slots) is False    # „bereit" = belegbar
    assert rack_logic.slot_has_plate(1, 5, slots) is False
    assert rack_logic.slot_has_plate(1, 9, slots) is False    # gibt es nicht → offene Luft
    # Ein Fach, das ein anderer Job gleich bekommt, zählt schon als belegt.
    assert rack_logic.slot_has_plate(1, 5, slots, taken={"1-5"}) is True


def test_prozentsatz_aus_der_konfiguration():
    assert rack_logic.stacked_pct_of({}) == rack_logic.DEFAULT_STACKED_PCT
    assert rack_logic.stacked_pct_of({"slot_stacked_pct": 30}) == 30
    assert rack_logic.stacked_pct_of({"slot_stacked_pct": 999}) == 100
    assert rack_logic.stacked_pct_of({"slot_stacked_pct": "quatsch"}) == rack_logic.DEFAULT_STACKED_PCT
