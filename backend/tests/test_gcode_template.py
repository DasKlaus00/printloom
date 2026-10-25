"""Eigener G-code fürs Ablegen/Greifen — Vorlage mit Platzhaltern.

Ein eigener G-code muss die Bewegung ersetzen können, OHNE die Zuordnung „Regal 1
Fach 3" mitzunehmen. Sonst führe derselbe bearbeitete G-code jedes Regal und jedes
Fach an dieselbe Stelle. Deshalb erzeugt `op_template` die eingebaute Bewegung mit
Platzhaltern ({rack_x}, {slot_z+25} …), und `fill_placeholders` setzt beim Fahren
die Werte des tatsächlichen Fachs ein.
"""
import pytest

from app.services import ottoeject_motion as motion

GEOM = {
    "racks": 3, "storage_slots": 6, "magazine_slot": 7,
    "storage": {"x_unclamp": 26, "y_engage": 335, "first_z_flat": 7,
                "slot_gap": 25, "y_pullback_limit": 5, "rack_x_gap": 312},
}


def _g():
    return motion.merge_defaults(dict(GEOM))


# ── Platzhalter ──────────────────────────────────────────────────────────────
def test_platzhalter_werden_ersetzt():
    g = _g()
    out = motion.fill_placeholders(
        "G1 X{rack_x} Y{y_engage} Z{slot_z} R{rack} S{slot}", g, 2, 3)
    x, y, z, _ = motion.slot_position(g, 2, 3)
    assert out == f"G1 X{x:g} Y{y:g} Z{z:g} R2 S3"


def test_platzhalter_koennen_rechnen():
    """Ohne Rechenweg ließe sich die eingebaute Bewegung nicht als Vorlage
    ausdrücken — sie fährt genau solche Versätze (z. B. Fachhöhe + 25 mm)."""
    g = _g()
    _, _, z, _ = motion.slot_position(g, 1, 2)
    assert motion.fill_placeholders("Z{slot_z+25}", g, 1, 2) == f"Z{z + 25:g}"
    assert motion.fill_placeholders("Y{y_engage-35}", g, 1, 2) == f"Y{335 - 35:g}"
    assert motion.fill_placeholders("X{rack_x+0.5}", g, 1, 1) == f"X{motion.rack_x(g, 1) + 0.5:g}"


def test_fach_nummern_rechnen_nicht():
    """{rack+1} wäre ein anderes Fach — das darf kein Rechenausdruck sein."""
    assert motion.fill_placeholders("R{rack+1}", _g(), 2, 3) == "R{rack+1}"


def test_unbekannter_platzhalter_bleibt_stehen():
    assert motion.fill_placeholders("{gibts_nicht}", _g(), 1, 1) == "{gibts_nicht}"


# ── Vorlage ──────────────────────────────────────────────────────────────────
def test_vorlage_enthaelt_keine_festen_koordinaten():
    tpl = motion.op_template(_g(), "store")
    assert "{rack_x}" in tpl and "{slot_z}" in tpl and "{y_engage}" in tpl
    # Kein Wert eines konkreten Fachs (Regal 1 liegt bei X 650, Fachhöhe 7).
    assert "X650" not in tpl and "Z7 " not in tpl
    # G90/M220 setzt build_op selbst davor — nicht doppelt in die Vorlage.
    assert not tpl.startswith("G90") and "M220" not in tpl


def test_vorlage_faehrt_exakt_die_eingebaute_bewegung():
    """DER Test: Vorlage als eigener G-code hinterlegt → identische Bewegung,
    für jedes Regal und jedes Fach."""
    g = _g()
    tpl = motion.op_template(g, "store")
    mit_ov = motion.merge_defaults({**GEOM, "gcode_override": {"store": tpl}})
    for rack in (1, 2, 3):
        for slot in (1, 4, 6):
            eingebaut = motion.build_op(g, "store", rack=rack, slot=slot, check=False)
            eigen = motion.build_op(mit_ov, "store", rack=rack, slot=slot, check=False)
            assert eigen == eingebaut, f"R{rack} Fach {slot} weicht ab"


def test_vorlage_auch_fuers_greifen():
    g = _g()
    tpl = motion.op_template(g, "grab")
    mit_ov = motion.merge_defaults({**GEOM, "gcode_override": {"grab": tpl}})
    for rack in (1, 3):
        for slot in (1, 6):
            assert motion.build_op(mit_ov, "grab", rack=rack, slot=slot, check=False) == \
                motion.build_op(g, "grab", rack=rack, slot=slot, check=False)


def test_vorlage_nimmt_die_werte_des_regals():
    """Regale dürfen unterschiedlich gebaut sein (v1.1.9) — die Vorlage muss auch
    deren eigene X/Y/Fachhöhe treffen, nicht die des ersten Regals."""
    g = motion.merge_defaults({**GEOM, "rack_geo": {
        "2": {"x": 300, "y_engage": 320, "first_z": 12, "slot_gap": 40}}})
    tpl = motion.op_template(g, "store")
    mit_ov = motion.merge_defaults({**GEOM, "rack_geo": g["rack_geo"],
                                    "gcode_override": {"store": tpl}})
    got = motion.build_op(mit_ov, "store", rack=2, slot=2, check=False)
    assert got == motion.build_op(g, "store", rack=2, slot=2, check=False)
    assert "X300" in got and "Y320" in got


def test_vorlage_bleibt_bearbeitbar():
    """Der eigentliche Zweck: eine Zeile ändern, Rest bleibt regal-unabhängig."""
    g = _g()
    tpl = motion.op_template(g, "store").replace("{slot_z+25}", "{slot_z+15}")
    mit_ov = motion.merge_defaults({**GEOM, "gcode_override": {"store": tpl}})
    got = motion.build_op(mit_ov, "store", rack=3, slot=2, check=False)
    _, _, z, _ = motion.slot_position(g, 3, 2)
    assert f"Z{z + 15:g}" in got and f"Z{z + 25:g}" not in got
    assert f"X{motion.rack_x(g, 3):g}" in got      # Regal-X weiterhin korrekt


def test_anzeigetext_wandert_mit():
    tpl = motion.op_template(_g(), "store")
    assert "rack {rack} slot {slot}" in tpl
    assert "M117 Store rack 2 slot 5" in motion.fill_placeholders(tpl, _g(), 2, 5)


def test_vorschau_ueber_den_router(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from app.routers import control
    monkeypatch.setattr(control, "_rack_config", lambda: None)
    import asyncio
    r = asyncio.run(control.preview_ottoeject_op(
        {"op": "store", "geometry": dict(GEOM), "template": True}))
    assert r["template"] is True and "{rack_x}" in r["script"]
