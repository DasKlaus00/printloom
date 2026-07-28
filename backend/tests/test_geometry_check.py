"""Plausibilitätsprüfung der Geometrie — der Tippfehler-Fänger.

Kern der Zusage: eine Bewegung, die die Achse verlässt, wird NICHT gesendet.
Genauso wichtig ist die Gegenrichtung: solange die Achsgrenzen des Geräts nicht
bekannt sind, darf die Prüfung NICHTS nach oben blockieren — wer seine
X-Schiene verlängert hat, fährt legitim weit jenseits des Standardaufbaus."""
import pytest

from app.services import geometry_check as gc
from app.services import ottoeject_motion as motion

LIMITS = {"x": 485, "y": 407, "z": 365}


def _geom(**over):
    return motion.merge_defaults({"racks": 1, "storage_slots": 6, "magazine_slot": 7, **over})


# ── G-code lesen ─────────────────────────────────────────────────────────────
def test_liest_koordinaten_aus_bewegungen():
    got = gc.script_coords("G90\nG1 X10 Y20.5 Z-3 F4000\nM400")
    assert ("x", 10.0) in got and ("y", 20.5) in got and ("z", -3.0) in got


def test_ignoriert_nicht_bewegungen():
    """M117-Texte und M220 dürfen nicht als Koordinaten gelesen werden."""
    assert gc.script_coords("M117 Grab rack 1 slot 2...\nM220 S100\nM400") == []


def test_liest_bogen_endpunkte():
    got = gc.script_coords("G3 X100 Y200 I85 J375 F3000")
    assert ("x", 100.0) in got and ("y", 200.0) in got
    assert not any(a in ("i", "j") for a, _ in got)


def test_leerer_und_kaputter_input():
    assert gc.script_coords("") == []
    assert gc.script_coords(None) == []
    assert gc.script_coords(["G1 X5", "M400"]) == [("x", 5.0)]


# ── Achsgrenzen lesen ────────────────────────────────────────────────────────
def test_grenzen_unbekannt_ist_none_nicht_null():
    """0 als Grenze wäre fatal: dann wäre JEDE Bewegung ein Fehler."""
    for raw in ({}, None, {"x": 0}, {"x": "abc"}, {"x": -5}, "quatsch"):
        limits = gc.limits_from({"machine_limits": raw})
        assert limits["x"] is None


def test_grenzen_werden_uebernommen():
    limits = gc.limits_from({"machine_limits": {"x": 485, "y": 340.5, "z": 365}})
    assert limits == {"x": 485.0, "y": 340.5, "z": 365.0}
    assert gc.limits_known(limits) is True
    assert gc.limits_known({"x": 485.0, "y": None, "z": 365.0}) is False


def test_grenzen_werden_beim_speichern_gesaeubert():
    """merge/sanitize darf keine 0-Grenze durchlassen (siehe oben)."""
    g = motion._sanitize_geometry(motion.merge_defaults({"machine_limits": {"x": 485, "y": 0, "e": 9}}))
    assert g["machine_limits"] == {"x": 485.0}


# ── Ohne bekannte Grenzen: nur „unter 0" blockiert ────────────────────────────
def test_ohne_grenzen_kein_fehler_nach_oben():
    """Drei Regale schieben den Drucker weit über den Standardaufbau — das ist ein
    normaler Aufbau und darf nichts blockieren."""
    r = gc.check_geometry(_geom(racks=3))
    assert r["ok"] is True
    assert all(p["code"] != "axis_above_limit" for p in r["warnings"])


def test_ohne_grenzen_kommt_ein_hinweis():
    r = gc.check_geometry(_geom())
    assert r["limits_known"] is False
    assert any(p["code"] == "limits_unknown" for p in r["warnings"])


def test_negative_koordinate_ist_immer_fehler():
    """Der Endschalter liegt bei 0 — das gilt für JEDEN Aufbau, also hart."""
    r = gc.check_geometry(_geom(storage={"x_unclamp": 5}, clamp_push_mm=30))
    assert r["ok"] is False
    assert any(p["code"] == "axis_below_zero" and p["axis"] == "x" for p in r["errors"])


# ── Mit bekannten Grenzen ────────────────────────────────────────────────────
def test_tippfehler_wird_gefunden():
    """X 4250 statt 425 — genau der Fall, um den es geht."""
    r = gc.check_geometry(_geom(printer={"eject": {"x": 4250, "y": 319, "z": 21}},
                                machine_limits=LIMITS))
    bad = [p for p in r["errors"] if p["code"] == "axis_above_limit" and p["axis"] == "x"]
    assert bad and max(p["value"] for p in bad) >= 4250
    assert r["ok"] is False


def test_saubere_geometrie_mit_grenzen_ist_ok():
    """Ohne Tür (offener Drucker) muss die Standard-Geometrie fehlerfrei sein."""
    g = _geom(machine_limits=LIMITS)
    g["printer"]["door"] = None
    r = gc.check_geometry(g)
    assert r["errors"] == [], [p["message"] for p in r["errors"]]
    assert r["limits_known"] is True


def test_pro_achse_nur_eine_meldung():
    """Sonst käme bei 10 Regalen dieselbe Ursache dutzendfach."""
    g = _geom(racks=5, machine_limits={"x": 100, "y": 407, "z": 365})
    g["printer"]["door"] = None
    x_errs = [p for p in gc.check_geometry(g)["errors"]
              if p["axis"] == "x" and p.get("op") == "grab"]
    assert len(x_errs) == 1


def test_magazin_ist_nie_ablageziel():
    """„Platte ablegen" fährt höher als „holen". Für das Magazin-Fach (reine Quelle)
    darf das keine Fehlmeldung geben — die Bewegung gibt es im Betrieb nicht."""
    g = _geom(machine_limits={"x": 485, "y": 407, "z": 360})
    g["printer"]["door"] = None
    store_z = [p for p in gc.check_geometry(g)["errors"]
               if p.get("op") == "store" and p.get("slot") == 7]
    assert store_z == []


# ── Struktur ─────────────────────────────────────────────────────────────────
def test_kein_schritt_nach_oben():
    """slot_gap so klein, dass alle Fächer auf gleicher Höhe lägen."""
    codes = [p["code"] for p in gc.check_geometry(_geom(storage={"slot_gap": -30}))["errors"]]
    assert "no_slot_step" in codes


def test_mehrere_regale_ohne_abstand():
    codes = [p["code"] for p in gc.check_geometry(
        _geom(racks=3, storage={"rack_x_gap": 0}))["errors"]]
    assert "no_rack_gap" in codes


def test_greif_y_hinter_der_rueckzugsposition():
    codes = [p["code"] for p in gc.check_geometry(
        _geom(storage={"y_engage": 5, "y_pullback_limit": 5}))["errors"]]
    assert "y_engage_behind_pullback" in codes


def test_magazin_ueber_dem_regal_ist_nur_hinweis():
    r = gc.check_geometry(_geom(storage_slots=6, magazine_slot=12))
    assert any(p["code"] == "magazine_above_rack" for p in r["warnings"])


def test_negativer_andruck_ist_nur_hinweis():
    r = gc.check_geometry(_geom(clamp_push_mm=-5))
    assert any(p["code"] == "negative_clamp_push" for p in r["warnings"])


def test_leere_geometrie_crasht_nicht():
    for g in ({}, None):
        r = gc.check_geometry(g)
        assert isinstance(r["errors"], list) and isinstance(r["warnings"], list)


# ── Das Gate in build_op ─────────────────────────────────────────────────────
def test_build_op_verweigert_bewegung_ausserhalb_der_achse():
    g = _geom(printer={"eject": {"x": 4250, "y": 319, "z": 21}}, machine_limits=LIMITS)
    with pytest.raises(gc.GeometryError) as e:
        motion.build_op(g, "eject")
    assert "485" in str(e.value) and "X" in str(e.value)


def test_build_op_ohne_pruefung_liefert_weiterhin_gcode():
    """Die Vorschau soll auch kaputte Werte zeigen können."""
    g = _geom(printer={"eject": {"x": 4250, "y": 319, "z": 21}}, machine_limits=LIMITS)
    assert "X4280" in motion.build_op(g, "eject", check=False)


def test_build_op_laesst_gute_geometrie_durch():
    g = _geom(machine_limits=LIMITS)
    for op in ("grab", "store", "eject", "place", "move_to_printer", "park"):
        assert motion.build_op(g, op, rack=1, slot=1)


def test_eigener_gcode_wird_mitgeprueft():
    """gcode_override umgeht die Berechnung — aber nicht die Achsprüfung."""
    g = _geom(machine_limits=LIMITS, gcode_override={"park": "G1 X9999 F3000"})
    with pytest.raises(gc.GeometryError):
        motion.build_op(g, "park")


def test_unbekannte_op_meldet_weiter_valueerror():
    with pytest.raises(ValueError):
        motion.build_op(_geom(), "gibtsnicht")


# ── Grenzen vom Gerät ────────────────────────────────────────────────────────
def test_grenzen_aus_moonraker_antwort():
    assert gc.limits_from_toolhead({"axis_maximum": [485.0, 340.0, 365.0, 0.0]}) == \
        {"x": 485.0, "y": 340.0, "z": 365.0}


def test_kaputte_moonraker_antwort():
    for raw in ({}, None, {"axis_maximum": []}, {"axis_maximum": [1, 2]},
                {"axis_maximum": "nope"}):
        assert gc.limits_from_toolhead(raw) == {}


def test_moonraker_antwort_mit_muell_werten():
    assert gc.limits_from_toolhead({"axis_maximum": ["a", 340.0, 365.0]}) == \
        {"y": 340.0, "z": 365.0}


# ── Übersetzbarkeit ──────────────────────────────────────────────────────────
# Meldungen gehen als Vorlage + Werte an die Oberfläche, weil das Backend die
# eingestellte Sprache nicht kennt (die steht im Browser). `message` ist nur die
# fertige deutsche Fassung — beides darf nie auseinanderlaufen.
def test_meldung_traegt_vorlage_und_werte():
    p = gc.problem("demo", "warning", "Regal {0} hat nur {1} Fächer", [2, 6])
    assert p["template"] == "Regal {0} hat nur {1} Fächer"
    assert p["params"] == [2, 6]
    assert p["message"] == "Regal 2 hat nur 6 Fächer"


def test_jede_meldung_laesst_sich_uebersetzen():
    """Kein Problem darf ohne Vorlage rausgehen, und die Vorlage muss den
    fertigen Satz exakt reproduzieren — sonst zeigt die englische Oberfläche
    etwas anderes als die deutsche."""
    g = _geom(machine_limits={"x": 10, "y": 10, "z": 10})   # erzwingt Achsfehler
    r = gc.check_geometry(g)
    found = r["errors"] + r["warnings"]
    assert found, "Test taugt nur mit mindestens einer Meldung"
    for p in found:
        assert p.get("template"), f"Meldung ohne Vorlage: {p}"
        assert gc._fmt(p["template"], p.get("params") or []) == p["message"]
