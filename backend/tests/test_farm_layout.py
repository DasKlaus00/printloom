"""Farm-Layout: Drucker und Regale als Module auf einer X-Schiene.

Seit v1.1.8 hält das Layout keine eigenen X-Positionen mehr, sondern leitet sie
aus der Drucker-Geometrie ab. Vorher stand jede Position zweimal in der App und
beide Stellen wurden getrennt gepflegt: der Test-Knopf im Drucker-Tab fuhr nach
der Formel, die Farm nach dem Layout. Die Tests hier halten fest, dass es nur
noch EINE Quelle gibt und dass die Ableitung exakt das trifft, was der Arm
fährt."""
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


# ── Ableitung aus der Geometrie ──────────────────────────────────────────────
def test_ableitung_erzeugt_alle_module():
    lay = fl.from_geometry(GEOM, CFG, [{"id": 1, "name": "X1C", "model": "x1c"}])
    types = [m["type"] for m in lay["modules"]]
    assert types.count("rack") == 3
    assert types.count("printer") == 1
    assert types.count("home") == 1
    assert lay["locked"] is True          # neu erzeugtes Layout ist gesperrt


def test_ableitung_uebernimmt_die_formel_inklusive_trim():
    lay = fl.from_geometry(GEOM, CFG)
    xs = fl.rack_x_map(lay)
    # x = x_unclamp + (racks − r)·gap + trim
    assert xs[1] == 43 + 2 * 250          # 543
    assert xs[2] == 43 + 1 * 250 - 1.5    # 291.5 (Trim!)
    assert xs[3] == 43                    # am Home-Anker
    assert fl.printer_x(lay) == 442 + 2 * 250


def test_ableitung_verschiebt_keine_position():
    """DER Test: die abgeleitete Sicht ändert die gefahrenen Koordinaten NICHT."""
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


def test_test_knopf_und_farm_fahren_dasselbe():
    """Der eigentliche Fehler, der zur Zusammenlegung führte.

    Der Test-Knopf im Drucker-Tab schickt die Geometrie MIT (ungespeicherte
    Werte), die Farm liest die gespeicherte. Vorher wurde nur auf einem der
    beiden Wege das Layout überlagert — derselbe Knopf konnte je nach Weg
    andere Positionen fahren. Beide Wege müssen identischen G-code erzeugen."""
    stored = {**GEOM, "storage_slots": 6, "magazine_slot": 7}

    # Weg 1: gespeicherte Geometrie (Farm-Zyklus)
    g_farm = motion.apply_layout(motion.merge_defaults(dict(stored)), None)
    # Weg 2: Geometrie aus dem Request (Test-Knopf), zusätzlich mit einem noch
    # gespeicherten Alt-Überlagerungsblock, wie ihn v1.1.3–v1.1.7 anlegten.
    g_test = motion.apply_layout(
        motion.merge_defaults({**stored, "layout": {"rack_x": {"1": 4242}}}), None)

    for op in ("grab", "store", "eject", "place", "move_to_printer"):
        assert (motion.build_op(g_farm, op, rack=1, slot=2, check=False)
                == motion.build_op(g_test, op, rack=1, slot=2, check=False))


# ── EINE Quelle für X (seit v1.1.8) ──────────────────────────────────────────
# Vorher hielt das Layout eigene X-Referenzen, die die Geometrie überlagerten.
# Gepflegt wurden beide getrennt: der Test-Knopf im Drucker-Tab fuhr nach der
# Formel, die Farm nach dem Layout. Jetzt gibt es nur noch die Geometrie.
def test_x_kommt_immer_aus_der_geometrie():
    g = motion.merge_defaults(GEOM)
    assert motion.rack_x(g, 1) == 43 + 2 * 250
    assert "layout" not in g


def test_alter_layout_block_wird_ignoriert():
    """Altbestand: In gespeicherten Geometrien kann noch ein Überlagerungs-Block
    stehen. Der darf die Positionen NICHT mehr verändern."""
    g = motion.apply_layout(
        motion.merge_defaults({**GEOM, "layout": {"rack_x": {"1": 1000},
                                                  "printer_x": 900}}), None)
    assert motion.rack_x(g, 1) == 43 + 2 * 250
    assert "X1000" not in motion.build_op(g, "grab", rack=1, slot=1, check=False)


def test_ungleiche_abstaende_ueber_die_korrektur():
    """Ungleiche Regal-Abstände brauchen keine zweite Positionsverwaltung — die
    Δ-Korrektur je Regal (Drucker-Tab) kann jede beliebige X-Position abbilden."""
    g = motion.merge_defaults({**GEOM, "rack_x_trim": {"1": 57, "2": 17, "3": -3}})
    assert (motion.rack_x(g, 1), motion.rack_x(g, 2), motion.rack_x(g, 3)) == (600, 310, 40)


def test_abgeleitete_module_treffen_die_bewegung():
    """Was das Layout anzeigt, muss exakt das sein, was der Arm fährt."""
    g = motion.merge_defaults({**GEOM, "rack_x_trim": {"1": 57, "2": 17, "3": -3}})
    lay = fl.from_geometry(g, CFG)
    assert fl.rack_x_map(lay) == {1: 600.0, 2: 310.0, 3: 40.0}
    assert fl.printer_x(lay) == 442 + 2 * 250


def test_sync_behaelt_zuordnung_nimmt_aber_die_geometrie_x():
    """Namen und Zuordnungen des Nutzers bleiben; eine veraltete X aus der Datei
    darf sich NICHT gegen die Geometrie durchsetzen."""
    stored = {"locked": False, "modules": [
        {"id": "rack-2", "type": "rack", "x_ref": 9999, "name": "Hohes Regal",
         "printer": "printer-1", "legacy_rack": 2},
        {"id": "printer-1", "type": "printer", "x_ref": 1, "name": "X1C links",
         "device_id": 7},
    ]}
    lay = fl.sync_from_geometry(stored, GEOM, CFG)
    by_id = {m["id"]: m for m in lay["modules"]}
    assert by_id["rack-2"]["x_ref"] == 43 + 250 - 1.5  # Geometrie inkl. Δ gewinnt
    assert by_id["rack-2"]["name"] == "Hohes Regal"    # eigener Name bleibt
    assert by_id["printer-1"]["device_id"] == 7        # Gerät bleibt
    assert by_id["printer-1"]["x_ref"] == 442 + 2 * 250
    assert lay["locked"] is False


def test_sync_ohne_gespeichertes_layout():
    lay = fl.sync_from_geometry(None, GEOM, CFG)
    assert [m["id"] for m in lay["modules"]][0] == "home"
    assert fl.rack_x_map(lay) == {1: 543.0, 2: 291.5, 3: 43.0}


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
