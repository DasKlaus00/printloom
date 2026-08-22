"""Tuerbewegung: die gemessene Form, verschoben auf den eingegebenen Startpunkt.

Die EINGEGEBENEN X/Y/Z sind der erste Fahrpunkt; alle Zwischenpunkte sind Versaetze
davon. Damit wandert die ganze Schwenkform mit, wenn der Drucker woanders steht —
ohne dass jemand die Zwischenpunkte kennen muss.

Der Bogen ist der heikle Teil: I/J sind RELATIV zum Bogenstart. Verschiebt man Start
und Ende gemeinsam, bleiben sie gueltig; rechnet man sie falsch, faehrt Klipper einen
anderen Radius oder bricht mit "Arc is not valid" ab.
"""
import math
import re

import pytest

from app.services import ottoeject_motion as m


REF_OPEN = {"x": 720, "y": 280, "z": 85, "d": 356.6}
REF_CLOSE = {"x": 1065, "y": 0, "z": 85, "d": 356.0}


def geo(op=None, cl=None):
    return m.merge_defaults({"racks": 1, "printers": [{
        "id": "p1", "name": "X1C",
        "door": {"open": dict(op or REF_OPEN), "close": dict(cl or REF_CLOSE)}}]})


def lines(script):
    return [l for l in script.splitlines() if l.startswith(("G1 ", "G2 ", "G3 "))]


def arc(script):
    """(x, y, i, j) des Bogens."""
    ln = next(l for l in script.splitlines() if l.startswith(("G2 ", "G3 ")))
    v = dict(re.findall(r"([XYIJ])(-?\d+(?:\.\d+)?)", ln))
    return tuple(float(v[k]) for k in "XYIJ")


def axis(script, ax):
    return [float(v) for v in re.findall(rf"\b{ax}(-?\d+(?:\.\d+)?)", script)]


# -- Die gemessene Bewegung kommt heraus -------------------------------------

def test_oeffnen_trifft_die_gemessenen_punkte():
    got = lines(m.build_op(geo(), "open_door", check=False))
    assert got[0] == "G1 Z85 F1000"
    assert got[1] == "G1 X720 Y280 F3000"
    assert got[2] == "G1 Y343 F3000"          # Zustellung zum Tuerblatt
    assert got[3] == "G1 Z115 F1000"          # Stift greift hinter die Tuer
    assert got[4] == "G1 Y323 F1000"          # Bogenstart


def test_schliessen_trifft_die_gemessenen_punkte():
    got = lines(m.build_op(geo(), "close_door", check=False))
    assert got[0] == "G1 Z85 F1000"
    assert got[1] == "G1 X1065 Y0 F3000"
    assert got[2] == "G1 Z115 F3000"
    assert got[3] == "G1 X965 F3000"          # Anlauf vor dem Bogen


def test_oeffnungsbogen_entspricht_der_messung():
    x, y, i, j = arc(m.build_op(geo(), "open_door", check=False))
    assert (round(x), round(y)) == (1075, 0)
    assert (round(i), round(j, 1)) == (355, 33.6)


def test_schliessbogen_entspricht_der_messung():
    x, y, i, j = arc(m.build_op(geo(), "close_door", check=False))
    assert (round(x), round(y)) == (723, 280)
    assert (round(i, 1), round(j, 1)) == (109.1, 338.9)


# -- Der Bogen bleibt geometrisch gueltig ------------------------------------

def test_oeffnungsbogen_hat_ueberall_denselben_radius():
    """Start und Ende muessen gleich weit vom Mittelpunkt liegen — sonst faehrt
    Klipper einen anderen Bogen als gemeint.

    Toleranz 0.01 mm statt exakt: der G-code rundet auf drei Nachkommastellen,
    daraus bleibt ein Rest im Mikrometerbereich. Enger zu pruefen hiesse die
    Rundung zu pruefen, nicht die Geometrie."""
    x, y, i, j = arc(m.build_op(geo(), "open_door", check=False))
    sx, sy = 720.0, 323.0                      # Bogenstart = Y280+43
    cx, cy = sx + i, sy + j
    assert math.isclose(math.hypot(cx - sx, cy - sy),
                        math.hypot(cx - x, cy - y), abs_tol=0.01)


def test_schliessbogen_hat_ueberall_denselben_radius():
    x, y, i, j = arc(m.build_op(geo(), "close_door", check=False))
    sx, sy = 965.0, 0.0
    cx, cy = sx + i, sy + j
    assert math.isclose(math.hypot(cx - sx, cy - sy),
                        math.hypot(cx - x, cy - y), abs_tol=0.01)


def test_der_schliessbogen_schwenkt_ueber_die_maschine():
    """Von zwei moeglichen Mittelpunkten ist der mit groesserem Y richtig — das
    Scharnier sitzt hinten. Der andere schwenkte die Tuer nach vorn durch."""
    _x, _y, _i, j = arc(m.build_op(geo(), "close_door", check=False))
    assert j > 0


# -- Verschieben auf einen anderen Startpunkt --------------------------------

def test_ein_anderer_startpunkt_verschiebt_die_ganze_form():
    a = axis(m.build_op(geo(), "open_door", check=False), "X")
    b = axis(m.build_op(geo({**REF_OPEN, "x": 620}), "open_door", check=False), "X")
    assert [round(v - w) for v, w in zip(a, b)] == [100] * len(a)


def test_die_hoehe_wandert_mit():
    z = axis(m.build_op(geo({**REF_OPEN, "z": 105}), "open_door", check=False), "Z")
    assert z[0] == 105 and 135 in z            # Eingriffshoehe = Startpunkt + 30


def test_der_bogen_bleibt_beim_verschieben_gueltig():
    x, y, i, j = arc(m.build_op(geo({**REF_OPEN, "x": 400}), "open_door", check=False))
    sx, sy = 400.0, 323.0
    cx, cy = sx + i, sy + j
    assert math.isclose(math.hypot(cx - sx, cy - sy),
                        math.hypot(cx - x, cy - y), abs_tol=0.01)


def test_die_zu_position_kommt_vom_oeffnen():
    """Sonst braeuchte dieselbe Stelle zwei getrennt gepflegte Zahlen."""
    x, _y, _i, _j = arc(m.build_op(geo({**REF_OPEN, "x": 500}), "close_door", check=False))
    assert round(x) == 503                     # 500 + Andrueck-Weg der Tuer


# -- Unmoegliche Eingaben brechen nicht --------------------------------------

def test_zu_kleiner_radius_ergibt_trotzdem_gueltigen_gcode():
    """Ein Zahlendreher beim Bogenradius darf keine Wurzel aus einer negativen
    Zahl und keinen NaN im G-code erzeugen."""
    for d in (1, 10, 50):
        for op in ("open_door", "close_door"):
            script = m.build_op(geo({**REF_OPEN, "d": d}, {**REF_CLOSE, "d": d}), op, check=False)
            assert "nan" not in script.lower()
            assert arc(script)


def test_ohne_tuer_kein_bogen():
    g = m.merge_defaults({"racks": 1, "printers": [{"id": "p1", "name": "offen", "door": None}]})
    for op in ("open_door", "close_door"):
        assert "no door macro" in m.build_op(g, op, check=False)


def test_ohne_schliess_block_gilt_der_oeffnen_block():
    """Altbestand hat nur einen Tuer-Punkt — das darf die Bewegung nicht sprengen."""
    g = m.merge_defaults({"racks": 1, "printers": [{
        "id": "p1", "name": "X1C", "door": {"open": dict(REF_OPEN)}}]})
    assert arc(m.build_op(g, "close_door", check=False))
