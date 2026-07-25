"""Woher kommt die nächste LEERE Platte? — zwei Aufbauten, ein Ablauf.

  • MIT Magazin (7. Fach): Stapel Leerplatten liegt im Magazin-Fach.
  • OHNE Magazin: die leeren Platten stecken bereits in den Fächern 1..n und
    werden von OBEN nach unten gegriffen.

Kollisionsgefahr im zweiten Fall: die Fächer mit Leerplatten melden „frei", sind
aber physisch belegt. Werden sie nicht reserviert, legt der Arm einen fertigen
Druck auf eine liegende Platte. Deshalb hier beide Seiten geprüft."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import autofarm  # noqa: E402


def _src(data):
    return autofarm._plate_source(data)


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


# ── Ohne Magazin ─────────────────────────────────────────────────────────────
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
