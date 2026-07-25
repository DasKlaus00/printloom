"""Woher kommt die nächste LEERE Platte? — zwei Aufbauten, ein Ablauf.

  • MIT Magazin (7. Fach): Stapel Leerplatten liegt im Magazin-Fach, Bestand = Zähler.
  • OHNE Magazin: die leeren Platten liegen einzeln in normalen Fächern. Welches
    Fach eine hält, MARKIERT der Nutzer (`empty_plate`, seit v1.0.163). Der alte
    Zähler bleibt Rückfall für Bestände, die noch nicht migriert sind.

Kollisionsgefahr im zweiten Fall: die Fächer mit Leerplatten melden „frei", sind
aber physisch belegt. Werden sie nicht reserviert, legt der Arm einen fertigen
Druck auf eine liegende Platte. Deshalb hier beide Seiten geprüft."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm  # noqa: E402


def _src(data):
    return autofarm._plate_source(data)


def _marked(*keys, slots_per_rack=6, num_racks=3, extra=None):
    """slots.json ohne Magazin, in der die genannten Fächer eine Leerplatte halten."""
    slots = {f"{r}-{s}": {"status": "free", "empty_plate": f"{r}-{s}" in keys}
             for r in range(1, num_racks + 1) for s in range(1, slots_per_rack + 1)}
    for key, patch in (extra or {}).items():
        slots.setdefault(key, {"status": "free"}).update(patch)
    return {"magazine_slot": 0, "num_racks": num_racks,
            "slots_per_rack": slots_per_rack, "slots": slots}


# ── Mit Magazin ──────────────────────────────────────────────────────────────
def test_magazin_wird_gegriffen():
    d = {"magazine_slot": 7, "magazine_counts": [4, 4, 4]}
    assert _src(d) == (1, 7, True)


def test_leeres_regal_wird_uebersprungen():
    assert _src({"magazine_slot": 7, "magazine_counts": [0, 3, 4]}) == (2, 7, True)


def test_alle_magazine_leer_faellt_auf_regal_1_zurueck():
    assert _src({"magazine_slot": 7, "magazine_counts": [0, 0, 0]}) == (1, 7, True)


def test_mit_magazin_sind_keine_faecher_reserviert():
    """Mit Magazin sind alle normalen Fächer als Ablageziel frei."""
    assert autofarm._reserved_source_slots({"magazine_slot": 7,
                                            "magazine_counts": [4, 4, 4]}) == set()


# ── Ohne Magazin: markierte Fächer (der Nutzer sagt, wo eine Platte liegt) ───
def test_markiertes_fach_wird_gegriffen():
    assert _src(_marked("1-3")) == (1, 3, False)


def test_von_oben_nach_unten_gegriffen():
    """Sonst müsste der Arm über eine noch liegende Platte hinwegfahren."""
    assert _src(_marked("1-1", "1-2", "1-5")) == (1, 5, False)


def test_luecken_sind_erlaubt():
    """Genau der Grund für die Markierung: der Bestand muss nicht lückenlos
    von unten liegen (das nahm der alte Zähler an)."""
    assert _src(_marked("2-4", "2-6")) == (2, 6, False)


def test_erstes_regal_mit_platte_gewinnt():
    assert _src(_marked("2-2", "3-5")) == (2, 2, False)


def test_markierung_schlaegt_den_alten_zaehler():
    """Bestand ist migriert → der Zähler darf nicht mehr mitreden."""
    d = _marked("1-5")
    d["magazine_counts"] = [3, 0, 0]
    assert _src(d) == (1, 5, False)


def test_nur_markierte_faecher_sind_reserviert():
    d = _marked("1-2", "1-5", "3-1")
    assert autofarm._reserved_source_slots(d) == {"1-2", "1-5", "3-1"}


def test_ablage_geht_dorthin_wo_keine_platte_liegt():
    """„Modell dort zurücklegen, wo gerade keine Platte ist" — das Ziel darf
    kein markiertes Fach sein."""
    d = _marked("1-1", "1-2", "1-3")
    reserved = autofarm._reserved_source_slots(d)
    frei = [k for k, s in d["slots"].items()
            if s.get("status") == "free" and k not in reserved]
    assert "1-4" in frei and "2-1" in frei
    assert not ({"1-1", "1-2", "1-3"} & set(frei))


def test_keine_markierung_keine_reservierung():
    assert autofarm._reserved_source_slots(_marked()) == set()


def test_bestand_ist_die_zahl_der_markierungen():
    from app.services import rack_logic
    assert rack_logic.empty_plate_count(_marked("1-1", "2-3", "3-6")) == 3
    assert rack_logic.empty_plate_count(_marked()) == 0


def test_freie_ablageziele_von_unten():
    """Zurücklegen bevorzugt das unterste freie Fach — dort stapelt sich nichts
    über einer liegenden Platte."""
    from app.services import rack_logic
    d = _marked("1-1", extra={"1-2": {"status": "done"}, "1-3": {"status": "locked"}})
    frei = rack_logic.free_slots_for_empty_plate(d)
    assert (1, 4) in frei
    assert (1, 1) not in frei and (1, 2) not in frei and (1, 3) not in frei
    assert frei == sorted(frei)


# ── Ohne Magazin, noch nicht migriert: Zähler als Rückfall ───────────────────
def test_ohne_magazin_wird_von_oben_gegriffen():
    """Fach = Bestand: der Arm muss nie über eine noch liegende Platte hinweg."""
    assert _src({"magazine_slot": 0, "magazine_counts": [7, 7, 7]}) == (1, 7, False)
    assert _src({"magazine_slot": 0, "magazine_counts": [3, 7, 7]}) == (1, 3, False)
    assert _src({"magazine_slot": 0, "magazine_counts": [1, 7, 7]}) == (1, 1, False)


def test_ohne_magazin_naechstes_regal():
    assert _src({"magazine_slot": 0, "magazine_counts": [0, 5, 7]}) == (2, 5, False)


def test_ohne_magazin_nie_fach_null():
    """Fach 0 gibt es nicht — ein Griff dorthin würde unter das erste Fach fahren."""
    assert _src({"magazine_slot": 0, "magazine_counts": [0, 0, 0]}) == (1, 1, False)


def test_ohne_magazin_kein_magazin_griff():
    """grab_magazine greift flach/NOLIFT für einen Stapel — das passt hier nicht."""
    assert _src({"magazine_slot": 0, "magazine_counts": [2]})[2] is False


# ── Reservierte Quell-Fächer (Kollisionsschutz) ──────────────────────────────
def test_belegte_quellfaecher_sind_kein_ablageziel():
    r = autofarm._reserved_source_slots({"magazine_slot": 0, "magazine_counts": [3, 1, 0]})
    assert {"1-1", "1-2", "1-3"} <= r
    assert "1-4" not in r                       # darüber ist frei
    assert "2-1" in r and "2-2" not in r
    assert not any(k.startswith("3-") for k in r)
    assert len(r) == 4


def test_nach_entnahme_wird_das_fach_wieder_frei():
    after = autofarm._reserved_source_slots({"magazine_slot": 0, "magazine_counts": [2, 1, 0]})
    assert "1-3" not in after


# ── Robustheit ───────────────────────────────────────────────────────────────
def test_fehlende_oder_kaputte_zaehler():
    assert _src({"magazine_slot": 7})[0] == 1
    assert _src({"magazine_slot": 0, "magazine_counts": ["x", 4]}) == (2, 4, False)
    assert isinstance(autofarm._reserved_source_slots(
        {"magazine_slot": 0, "magazine_counts": [None, 2]}), set)


def test_magazin_fach_konfiguration():
    assert autofarm._magazine_slot_cfg({"magazine_slot": 7}) == 7
    assert autofarm._magazine_slot_cfg({}) == 7              # Standard = mit Magazin
    assert autofarm._magazine_slot_cfg({"magazine_slot": -3}) == 0
    assert autofarm._magazine_slot_cfg({"magazine_slot": "abc"}) == 7
