"""Farm-Layout: Module mit eigener X-Referenz statt einer Abstands-Formel.

Der wichtigste Test der ganzen Datei ist `test_migration_verschiebt_keine_position`:
Ein laufender Aufbau muss nach der Umstellung EXAKT dieselben Koordinaten fahren.
Wäre das nicht so, müsste jeder Nutzer nach dem Update neu einmessen — und der
erste Fehlversuch würde den Arm gegen den Drucker fahren."""
import pytest

from app.services import farm_layout as fl
from app.services import ottoeject_motion as motion

GEOM = {
    "racks": 3,
    "storage": {"x_unclamp": 43, "rack_x_gap": 250, "y_engage": 335,
                "first_z_flat": 7, "slot_gap": 25, "y_pullback_limit": 5},
    "printer": {"eject": {"x": 442, "y": 319, "z": 21},
                "load": {"x": 425, "y": 340, "z": 17.5}},
    "rack_x_trim": {"2": -1.5},
}
CFG = {"num_racks": 3, "slots_per_rack": 6, "slot_height_mm": 50, "magazine_slot": 7}


# ── Migration ────────────────────────────────────────────────────────────────
def test_migration_erzeugt_alle_module():
    lay = fl.from_geometry(GEOM, CFG, [{"id": 1, "name": "X1C", "model": "x1c"}])
    types = [m["type"] for m in lay["modules"]]
    assert types.count("rack") == 3
    assert types.count("printer") == 1
    assert types.count("home") == 1
    assert lay["locked"] is True          # neu erzeugtes Layout ist gesperrt


def test_migration_uebernimmt_die_formel_inklusive_trim():
    lay = fl.from_geometry(GEOM, CFG)
    xs = fl.rack_x_map(lay)
    # x = x_unclamp + (racks − r)·gap + trim
    assert xs[1] == 43 + 2 * 250          # 543
    assert xs[2] == 43 + 1 * 250 - 1.5    # 291.5 (Trim!)
    assert xs[3] == 43                    # am Home-Anker
    assert fl.printer_x(lay) == 442 + 2 * 250


def test_migration_verschiebt_keine_position():
    """DER Test: gleiche Koordinaten vor und nach der Umstellung."""
    g = motion.merge_defaults({**GEOM, "storage_slots": 6, "magazine_slot": 7})
    vorher = {r: motion.slot_position(g, r, s) for r in (1, 2, 3) for s in (1, 6)}
    vorher_gcode = {op: motion.build_op(g, op, rack=2, slot=3, check=False)
                    for op in ("grab", "store", "eject", "place", "move_to_printer")}

    lay = fl.from_geometry(GEOM, CFG)
    g2 = motion.apply_layout(motion.merge_defaults({**GEOM, "storage_slots": 6,
                                                    "magazine_slot": 7}), lay)
    nachher = {r: motion.slot_position(g2, r, s) for r in (1, 2, 3) for s in (1, 6)}
    nachher_gcode = {op: motion.build_op(g2, op, rack=2, slot=3, check=False)
                     for op in ("grab", "store", "eject", "place", "move_to_printer")}

    assert nachher == vorher, "Fach-Positionen haben sich verschoben"
    assert nachher_gcode == vorher_gcode, "G-code hat sich geändert"


def test_ohne_layout_bleibt_die_formel():
    g = motion.merge_defaults(GEOM)
    assert motion.rack_x(g, 1) == 43 + 2 * 250
    assert g.get("layout") == {}


def test_layout_schlaegt_die_formel():
    g = motion.merge_defaults({**GEOM, "layout": {"rack_x": {"1": 1000}}})
    assert motion.rack_x(g, 1) == 1000
    assert motion.rack_x(g, 3) == 43        # ohne Eintrag weiter per Formel


def test_ungleiche_abstaende_sind_moeglich():
    """Genau das kann die Formel nicht — der Grund für das ganze Layout."""
    lay = {"modules": [
        {"id": "rack-1", "type": "rack", "x_ref": 600, "legacy_rack": 1},
        {"id": "rack-2", "type": "rack", "x_ref": 310, "legacy_rack": 2},
        {"id": "rack-3", "type": "rack", "x_ref": 40,  "legacy_rack": 3},
    ]}
    g = motion.apply_layout(motion.merge_defaults(GEOM), lay)
    assert (motion.rack_x(g, 1), motion.rack_x(g, 2), motion.rack_x(g, 3)) == (600, 310, 40)


def test_drucker_x_folgt_dem_layout():
    """Der Drucker hängt am Modul; die eingemessenen Feinwerte (X-Differenz
    zwischen eject und load) bleiben erhalten."""
    g = motion.merge_defaults({**GEOM, "layout": {"printer_x": 900}})
    eject = motion.build_op(g, "eject", check=False)
    place = motion.build_op(g, "place", check=False)
    assert "X900" in eject                       # Auswurf steht auf der Modul-X
    assert "X883" in place                       # load lag 17 mm davor → bleibt


# ── Normalisieren ────────────────────────────────────────────────────────────
def test_clean_wirft_muell_raus():
    lay = fl.clean({"modules": [
        {"id": "a", "type": "rack", "x_ref": "12.5"},
        {"id": "b", "type": "raumschiff", "x_ref": 3},
        "kein dict",
        {"id": "a", "type": "printer", "x_ref": 9},    # doppelte ID
    ]})
    assert [m["id"] for m in lay["modules"]] == ["a"]
    assert lay["modules"][0]["x_ref"] == 12.5


def test_clean_sortiert_nach_x():
    lay = fl.clean({"modules": [
        {"id": "p", "type": "printer", "x_ref": 900},
        {"id": "h", "type": "home", "x_ref": 0},
        {"id": "r", "type": "rack", "x_ref": 300},
    ]})
    assert [m["id"] for m in lay["modules"]] == ["h", "r", "p"]


def test_clean_ist_standardmaessig_gesperrt():
    assert fl.clean({"modules": []})["locked"] is True
    assert fl.clean({"modules": [], "locked": False})["locked"] is False


# ── Prüfung ──────────────────────────────────────────────────────────────────
def _codes(problems):
    return {p["code"] for p in problems}


def test_negatives_x_ist_fehler():
    lay = {"modules": [{"id": "r", "type": "rack", "x_ref": -5},
                       {"id": "p", "type": "printer", "x_ref": 500}]}
    assert "x_below_zero" in _codes(fl.check(lay))


def test_ueber_der_achsgrenze_ist_fehler():
    lay = {"modules": [{"id": "p", "type": "printer", "x_ref": 1200}]}
    assert "x_above_limit" in _codes(fl.check(lay, {"x": 900}))
    assert "x_above_limit" not in _codes(fl.check(lay))      # ohne Grenze kein Fehler


def test_module_zu_dicht_beieinander():
    lay = {"modules": [{"id": "a", "type": "rack", "x_ref": 100},
                       {"id": "b", "type": "rack", "x_ref": 105},
                       {"id": "p", "type": "printer", "x_ref": 500}]}
    assert "too_close" in _codes(fl.check(lay))


def test_fehlender_drucker_und_verwaistes_regal():
    assert "no_printer" in _codes(fl.check({"modules": [
        {"id": "r", "type": "rack", "x_ref": 100}]}))
    assert "orphan_rack" in _codes(fl.check({"modules": [
        {"id": "p", "type": "printer", "x_ref": 500},
        {"id": "r", "type": "rack", "x_ref": 100, "printer": "gibtsnicht"}]}))


def test_zwei_module_auf_dasselbe_geraet():
    lay = {"modules": [{"id": "p1", "type": "printer", "x_ref": 500, "device_id": 1},
                       {"id": "p2", "type": "printer", "x_ref": 900, "device_id": 1}]}
    assert "duplicate_device" in _codes(fl.check(lay))


def test_sauberes_layout_ohne_probleme():
    lay = fl.from_geometry(GEOM, CFG, [{"id": 1, "name": "X1C"}])
    assert fl.check(lay, {"x": 1200}) == []


def test_layout_meldungen_sind_uebersetzbar():
    """Wie in der Geometrie-Prüfung: Vorlage + Werte, damit die Oberfläche in der
    eingestellten Sprache anzeigen kann. `message` bleibt der deutsche Satz."""
    from app.services.geometry_check import _fmt
    lay = {"modules": [{"id": "r1", "type": "rack", "x_ref": -5, "legacy_rack": 1}]}
    found = fl.check(lay, {"x": 900})
    assert found
    for p in found:
        assert p.get("template"), f"Meldung ohne Vorlage: {p}"
        assert _fmt(p["template"], p.get("params") or []) == p["message"]


# ── Zuordnung Regal → Drucker ────────────────────────────────────────────────
def test_regale_je_drucker():
    lay = {"modules": [
        {"id": "p1", "type": "printer", "x_ref": 900},
        {"id": "p2", "type": "printer", "x_ref": 1600},
        {"id": "r1", "type": "rack", "x_ref": 100, "printer": "p1", "legacy_rack": 1},
        {"id": "r2", "type": "rack", "x_ref": 400, "printer": "p2", "legacy_rack": 2},
    ]}
    assert [r["id"] for r in fl.racks_for_printer(lay, "p1")] == ["r1"]
    assert [r["id"] for r in fl.racks_for_printer(lay, "p2")] == ["r2"]


def test_ohne_zuordnung_gemeinsamer_pool():
    lay = {"modules": [
        {"id": "p1", "type": "printer", "x_ref": 900},
        {"id": "r1", "type": "rack", "x_ref": 100, "legacy_rack": 1},
        {"id": "r2", "type": "rack", "x_ref": 400, "legacy_rack": 2},
    ]}
    assert len(fl.racks_for_printer(lay, "p1")) == 2
