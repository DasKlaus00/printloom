"""Magnet-Greifer: greifen und ablegen ohne Weg nach links/rechts.

Beim Original-Greifer klemmt der Arm die Platte seitlich — er fährt in X über den
Greifpunkt hinaus (clamp_push_mm) und wieder zurück. Der Magnet-Greifer nimmt die
Platte magnetisch auf: der Arm senkt sich nur ab und hebt wieder.

Genau das ist hier die Zusage, und sie darf nicht still kaputtgehen: ein X-Weg
im Magnet-Ablauf würde die Platte aus ihrer Halterung schieben.
"""
import re

import pytest

from app.services import ottoeject_motion as m

GEOM = {
    "racks": 3, "storage_slots": 6, "magazine_slot": 7,
    "storage": {"x_unclamp": 26, "y_engage": 335, "first_z_flat": 7,
                "slot_gap": 25, "y_pullback_limit": 5, "rack_x_gap": 312},
}


def geo(**rest):
    return m.merge_defaults({**GEOM, **rest})


def magnet(**rest):
    return geo(gripper="magnet", gripper_motion="magnet", **rest)


def coords(script, axis):
    """Koordinaten einer Achse — NUR aus Fahrbefehlen.

    Über den ganzen Text zu suchen liest sonst den Druckernamen aus der
    M117-Zeile mit: "X1C" ergibt eine X-Koordinate 1."""
    return [float(v)
            for line in script.splitlines() if line.startswith(("G1 ", "G2 ", "G3 "))
            for v in re.findall(rf"\b{axis}(-?\d+(?:\.\d+)?)", line)]


# ── Greif-Art erkennen ───────────────────────────────────────────────────────

def test_ohne_angabe_gilt_der_original_greifer():
    """Bestandsanlagen haben kein gripper-Feld — sie müssen weiter klemmen."""
    assert m.gripper_motion(geo()) == "clamp"


def test_magnet_wird_erkannt():
    assert m.gripper_motion(magnet()) == "magnet"


def test_unbekannte_kennung_klemmt():
    """Eine Kennung, die niemand kennt, darf nie eine andere Bewegung fahren."""
    assert m.gripper_motion(geo(gripper="irgendwas", gripper_motion="irgendwas")) == "clamp"


def test_gripper_allein_reicht_als_angabe():
    """Wenn nur der Greifer gespeichert ist, folgt die Greif-Art daraus."""
    assert m.gripper_motion(geo(gripper="magnet")) == "magnet"


# ── Kein Weg nach links/rechts ───────────────────────────────────────────────

def test_greifen_faehrt_nur_eine_x_position():
    x = coords(m.build_op(magnet(), "grab", rack=2, slot=3, check=False), "X")
    assert len(set(x)) == 1


def test_ablegen_faehrt_nur_eine_x_position():
    x = coords(m.build_op(magnet(), "store", rack=2, slot=3, check=False), "X")
    assert len(set(x)) == 1


def test_die_eine_x_position_ist_das_fach():
    """Nicht irgendein X — genau die X des Regals."""
    g = magnet()
    x_slot = m.slot_position(g, 2, 3)[0]
    for op in ("grab", "store"):
        assert set(coords(m.build_op(g, op, rack=2, slot=3, check=False), "X")) == {x_slot}


def test_der_klemmweg_wird_nicht_mehr_eingerechnet():
    """clamp_push_mm gehört zum Klemm-Greifer — beim Magnet darf er nichts ändern."""
    a = m.build_op(magnet(clamp_push_mm=30), "grab", rack=1, slot=2, check=False)
    b = m.build_op(magnet(clamp_push_mm=0), "grab", rack=1, slot=2, check=False)
    assert a == b


def test_der_original_greifer_klemmt_weiter():
    """Gegenprobe: ohne Magnet-Greifer bleibt der seitliche Klemmweg drin."""
    x = coords(m.build_op(geo(), "grab", rack=2, slot=3, check=False), "X")
    assert len(set(x)) == 2


# ── Nur nach unten: die Z-Reihenfolge ────────────────────────────────────────

def test_greifen_faehrt_unter_die_platte_und_hebt_an():
    """Gemessen am realen Aufbau: Z auf Fachhoehe -> einfahren -> ANHEBEN.

    Meine erste Fassung fuhr ueber der Platte ein und senkte sich auf sie ab. Der
    Magnet nimmt die Platte aber von UNTEN auf: der Arm schiebt sich unter sie und
    hebt sie an. Beides sieht im G-code aehnlich aus und ist mechanisch das
    Gegenteil — deshalb steht die Richtung hier als Zusage."""
    g = magnet()
    z_flat = m.slot_position(g, 2, 3)[2]
    z = coords(m.build_op(g, "grab", rack=2, slot=3, check=False), "Z")
    assert z[0] == z_flat          # auf Fachhoehe unter die Platte
    assert z[-1] > z_flat          # anheben -> Platte haftet
    assert len(z) == 2             # dazwischen keine weitere Z-Fahrt


def test_greifen_faehrt_nie_unter_die_fachhoehe():
    """Beim Greifen liegt die Platte noch im Fach — tiefer waere die Halterung."""
    g = magnet()
    z_flat = m.slot_position(g, 1, 1)[2]
    assert min(coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z")) >= z_flat


def test_ablegen_kommt_hoeher_herein_und_senkt_unter_die_fachhoehe():
    """Das ist die Antwort auf die offene Abloese-Frage: der Arm faehrt UEBER der
    Fachhoehe herein, setzt die Platte ab und geht DARUNTER weg. Der Magnet loest
    sich, weil die Platte auf dem Fach aufliegt — kein Abstreifer noetig."""
    g = magnet()
    z_flat = m.slot_position(g, 2, 3)[2]
    z = coords(m.build_op(g, "store", rack=2, slot=3, check=False), "Z")
    assert z[0] > z_flat           # hoeher hereinfahren als das Fach
    assert z[-1] < z_flat          # unter die Fachhoehe absenken -> Platte bleibt


def test_die_gemessene_bewegung_kommt_exakt_heraus():
    """Regal 3 Fach 1 am Referenz-Aufbau: z_flat 15, y_engage 342.
        Greifen  Y280 -> Z15 -> Y300 -> Y342 -> Z30 -> Y25
        Ablegen  Y25 -> Z50 -> Y300 -> Y340 -> Z10 -> Y300
    Wenn diese Zahlen wandern, ist die Bewegung eine andere als die gefahrene."""
    g = m.merge_defaults({
        "racks": 3, "gripper": "magnet", "storage": {"y_pullback_limit": 20},
        "rack_geo": {"3": {"x": 100, "y_engage": 342, "first_z": 15, "slot_gap": 25}}})
    grab = m.build_op(g, "grab", rack=3, slot=1, check=False)
    assert coords(grab, "Z") == [15.0, 30.0]
    assert coords(grab, "Y") == [280.0, 300.0, 342.0, 25.0]
    store = m.build_op(g, "store", rack=3, slot=1, check=False)
    assert coords(store, "Z") == [50.0, 10.0]
    assert coords(store, "Y") == [25.0, 300.0, 340.0, 300.0]


def test_die_x_ausrichtung_passiert_genau_einmal_als_erste_fahrt():
    """Eine X-Fahrt auf Fachhoehe wuerde an den Platten entlangschrammen — X muss
    fertig sein, bevor der Arm in Z geht."""
    g = magnet()
    for op in ("grab", "store"):
        lines = [l for l in m.build_op(g, op, rack=2, slot=3, check=False).splitlines()
                 if l.startswith("G1 ")]
        x_moves = [l for l in lines if " X" in l]
        assert len(x_moves) == 1
        assert lines.index(x_moves[0]) == 0


def test_greifen_richtet_x_auf_der_reise_y_aus():
    """Der Rueckzugsanschlag ist die falsche Stelle dafuer: von dort auf Fachhoehe
    zu gehen kostet nur Weg. 280 ist dieselbe Reise-Y wie beim Original-Greifer."""
    g = magnet(magnet_y_travel_mm=280)
    first = [l for l in m.build_op(g, "grab", rack=2, slot=3, check=False).splitlines()
             if l.startswith("G1 ")][0]
    assert "Y280" in first


def test_ablegen_richtet_x_auf_der_schranke_aus():
    """Hier traegt der Arm einen fertigen Druck. Der Rueckzugsanschlag ist auf den
    LEEREN Greifer bemessen — mit Platte gilt die Schranke (siehe loaded_y_floor)."""
    g = magnet(magnet_y_min_loaded_mm=25)
    first = [l for l in m.build_op(g, "store", rack=2, slot=3, check=False).splitlines()
             if l.startswith("G1 ")][0]
    assert "Y25" in first


def test_der_rueckzug_nach_dem_greifen_ist_einstellbar():
    """Der Arm traegt hier eine Platte und muss nur weit genug heraus, um frei zu
    sein — nicht bis an den Anschlag."""
    g = magnet(magnet_y_retract_mm=25)
    assert coords(m.build_op(g, "grab", rack=2, slot=3, check=False), "Y")[-1] == 25.0
    g2 = magnet(magnet_y_retract_mm=60)
    assert coords(m.build_op(g2, "grab", rack=2, slot=3, check=False), "Y")[-1] == 60.0


def test_negative_y_werte_werden_verweigert():
    """Hinter dem Endschalter gibt es nichts — Klipper braeche die Fahrt ab."""
    travel, _clear, retract = m._magnet_y({"magnet_y_travel_mm": -50,
                                           "magnet_y_retract_mm": -10})
    assert travel >= 0 and retract >= 0


# ── Magazin ──────────────────────────────────────────────────────────────────

def test_magazin_und_lagerfach_sind_dieselbe_bewegung():
    """Der NOLIFT-Sonderweg des Originals entfällt: flach gestapelt oder einzeln
    liegend greift der Magnet gleich. Nur die Fachhöhe unterscheidet sich."""
    g = magnet()
    a = m.build_op(g, "grab", rack=1, slot=7, check=False)          # Magazin-Fach
    b = m.build_op(g, "grab_magazine", rack=1, slot=1, check=False)
    assert a == b


def test_die_durchbiegung_des_stapels_wird_weiter_eingerechnet():
    """Der Stapel hängt durch — das gilt unabhängig vom Greifer."""
    ohne = m.build_op(magnet(magazine_counts=[0, 0, 0]), "grab_magazine",
                      rack=1, slot=1, check=False)
    mit = m.build_op(magnet(magazine_counts=[6, 0, 0]), "grab_magazine",
                     rack=1, slot=1, check=False)
    assert min(coords(mit, "Z")) < min(coords(ohne, "Z"))


# -- Halterung und Greifer sind getrennt --------------------------------------

def test_die_halterung_aendert_die_bewegung_nicht():
    """Der Magnet tauscht Greifarm und Greifmechanismus, nicht die Regalstruktur.
    Dieselbe Bewegung muss also bei jeder Halterung herauskommen."""
    a = m.build_op(geo(holder="standard", gripper="magnet"), "grab", rack=1, slot=2, check=False)
    b = m.build_op(geo(holder="compact", gripper="magnet"), "grab", rack=1, slot=2, check=False)
    assert a == b


def test_eine_magnet_halterung_bleibt_ohne_wirkung():
    """Nur der Greifer entscheidet ueber die Bewegung — eine Halterung namens
    "magnet" darf sie nicht umstellen."""
    assert m.gripper_motion(geo(holder="magnet")) == "clamp"


# -- Einstellbare Z-Wege (seit der Freigabe zum Austesten) --------------------

def test_anhebeweg_ist_einstellbar():
    """Der Greifer ist freigegeben, aber nicht ueberall vermessen — wer die Werte
    nicht verstellen kann, braucht fuer jeden Testlauf eine Code-Aenderung."""
    g = magnet(magnet_lift_mm=40)
    flat = m.slot_position(g, 1, 1)[2]
    assert coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z") == [flat, flat + 40]


def test_einfahrhoehe_und_abloesetiefe_sind_einstellbar():
    g = magnet(magnet_store_z_mm=60, magnet_release_mm=8)
    flat = m.slot_position(g, 1, 1)[2]
    assert coords(m.build_op(g, "store", rack=1, slot=1, check=False), "Z") == [flat + 60, flat - 8]


def test_y_vorposition_ist_einstellbar():
    g = magnet(magnet_y_clear_mm=70)
    y_eng = m.slot_position(g, 1, 1)[1]
    assert (y_eng - 70) in coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Y")


def test_anhebeweg_null_wird_verweigert():
    """Bei 0 hebt der Arm die Platte gar nicht an und faehrt leer heraus."""
    g = magnet(magnet_lift_mm=0)
    flat = m.slot_position(g, 1, 1)[2]
    assert max(coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z")) > flat


def test_einfahrhoehe_unter_dem_anhebeweg_wird_angehoben():
    """Sonst streift die getragene Platte beim Einfahren das Fach darueber."""
    lift, store_z, _rel = m._magnet_z({"magnet_lift_mm": 40, "magnet_store_z_mm": 5})
    assert store_z > lift


def test_negative_abloesetiefe_wird_verweigert():
    """Negativ hiesse: der Arm hebt beim Ablegen an, statt die Platte abzusetzen."""
    _l, _s, release = m._magnet_z({"magnet_release_mm": -20})
    assert release >= 0


def test_muell_faellt_auf_die_startwerte_zurueck():
    for bad in (None, "", "viel", float("nan")):
        assert m._magnet_z({"magnet_lift_mm": bad, "magnet_store_z_mm": bad,
                            "magnet_release_mm": bad}) == (
            m.MAGNET_LIFT_MM, m.MAGNET_STORE_Z_MM, m.MAGNET_RELEASE_MM)
        assert m._magnet_y({"magnet_y_travel_mm": bad, "magnet_y_clear_mm": bad,
                            "magnet_y_retract_mm": bad}) == (
            m.MAGNET_Y_TRAVEL_MM, m.MAGNET_Y_CLEAR_MM, m.MAGNET_Y_RETRACT_MM)


def test_die_z_wege_beruehren_den_klemm_greifer_nicht():
    g = m.merge_defaults({"racks": 3, "gripper": "standard", "magnet_lift_mm": 99,
                          "magnet_store_z_mm": 99, "magnet_release_mm": 99})
    b = m.build_op(m.merge_defaults({"racks": 3, "gripper": "standard"}),
                   "grab", rack=1, slot=1, check=False)
    assert m.build_op(g, "grab", rack=1, slot=1, check=False) == b


def test_ablegen_kann_in_x_versetzt_werden():
    """Die gemessene Bewegung enthaelt keine X-Fahrt; ob das Ablegen versetzt
    stattfindet, haengt am Aufbau. Standard 0 = dieselbe X wie beim Greifen."""
    g = magnet(magnet_store_x_mm=-30)
    x_grab = coords(m.build_op(g, "grab", rack=2, slot=3, check=False), "X")[0]
    x_store = coords(m.build_op(g, "store", rack=2, slot=3, check=False), "X")[0]
    assert x_store == x_grab - 30
    assert coords(m.build_op(magnet(), "store", rack=2, slot=3, check=False), "X")[0] == x_grab


# -- Mit Platte nie unter die Schranke ---------------------------------------
#
# Der Rueckzugsanschlag (y_pullback_limit) ist auf den LEEREN Greifer bemessen.
# Mit Platte steht der Arm weiter vorn im Raum, und wie weit er zurueck darf, ist
# eine andere Zahl. Sie gilt fuer JEDE Fahrt mit Platte — nicht nur fuers Ablegen.

LOADED_OPS = ("store", "move_to_printer", "eject", "place")


def with_printer(**rest):
    return m.merge_defaults({
        "racks": 3, "gripper": "magnet", "storage": {"y_pullback_limit": 5},
        "rack_geo": {"3": {"x": 100, "y_engage": 342, "first_z": 15, "slot_gap": 25}},
        "printers": [{"id": "p1", "name": "X1C",
                      "eject": {"x": 400, "y": 330, "z": 20},
                      "load": {"x": 400, "y": 330, "z": 20}}],
        **rest})


@pytest.mark.parametrize("op", LOADED_OPS)
def test_keine_fahrt_unter_die_schranke(op):
    g = with_printer()
    assert min(coords(m.build_op(g, op, rack=3, slot=1, check=False), "Y")) >= 25


def test_auch_der_rueckzug_nach_dem_greifen_haelt_die_schranke():
    g = with_printer(magnet_y_retract_mm=5)      # bewusst zu klein eingetragen
    assert min(coords(m.build_op(g, "grab", rack=3, slot=1, check=False), "Y")) >= 25


def test_die_auswurf_rampe_taucht_nicht_darunter():
    """Bei einem engen Greif-Y lagen die Zwischenpunkte der Rampe frueher unter 25
    — die Regel haette dann nur zufaellig gegolten."""
    g = with_printer(printers=[{"id": "p1", "name": "X1C",
                                "eject": {"x": 400, "y": 200, "z": 20},
                                "load": {"x": 400, "y": 200, "z": 20}}])
    assert min(coords(m.build_op(g, "eject", check=False), "Y")) >= 25


def test_die_schranke_ist_einstellbar():
    g = with_printer(magnet_y_min_loaded_mm=60)
    for op in LOADED_OPS:
        assert min(coords(m.build_op(g, op, rack=3, slot=1, check=False), "Y")) >= 60


def test_der_klemm_greifer_behaelt_seine_gemessenen_wege():
    """Die Schranke gilt nur fuer den Magneten — der Klemm-Greifer haelt die Platte
    anders und faehrt seine Wege seit jeher ohne sie."""
    g = with_printer(gripper="standard")
    assert m.loaded_y_floor(g) == 0.0
    assert min(coords(m.build_op(g, "store", rack=3, slot=1, check=False), "Y")) == 5


def test_die_schranke_hebt_nur_an_und_senkt_nie():
    """max(), nicht ersetzen: ein bereits hoeherer Wert bleibt stehen."""
    g = with_printer(magnet_y_min_loaded_mm=25)
    assert m._y_loaded(g, 300) == 300
    assert m._y_loaded(g, 5) == 25


# -- Ablegen kurz vor dem Greif-Y --------------------------------------------

def test_abgesetzt_wird_kurz_vor_dem_greif_y():
    """Nicht auf dem Greif-Y selbst: dort steht der Arm beim HOLEN unter der Platte.
    Beim Ablegen traegt er sie darueber und braucht den Abstand."""
    g = with_printer()
    y = coords(m.build_op(g, "store", rack=3, slot=1, check=False), "Y")
    assert 340.0 in y and 342.0 not in y


def test_der_abstand_zum_greif_y_ist_einstellbar():
    g = with_printer(magnet_store_y_back_mm=4)
    assert 338.0 in coords(m.build_op(g, "store", rack=3, slot=1, check=False), "Y")


def test_negativer_abstand_wird_verweigert():
    """Negativ hiesse ueber das Greif-Y hinaus — der Arm faehrt ins Regal."""
    g = with_printer(magnet_store_y_back_mm=-10)
    assert max(coords(m.build_op(g, "store", rack=3, slot=1, check=False), "Y")) <= 342


# -- Drucker-Seite: eigene Bewegung statt der Klemm-Wege --------------------
#
# Bis v1.1.25 nutzte der Magnet am Drucker die Klemm-Bewegung samt X-Andruck. Das
# war der letzte Ort, an dem er noch seitlich gefahren waere.

def printer_geo(**rest):
    return m.merge_defaults({
        "racks": 1, "gripper": "magnet", "storage": {"y_pullback_limit": 5},
        "printers": [{"id": "p1", "name": "X1C",
                      "eject": {"x": 1067, "y": 343, "z": 20},
                      "load": {"x": 1067, "y": 343, "z": 20}}],
        **rest})


def test_auswerfen_trifft_die_gemessene_bewegung():
    """Gemessen: Y250 X1067 Z20 · Y343 · Z76 · Y300 Z73 · Y250 Z70 · Y225 Z60 · Y25 Z40"""
    script = m.build_op(printer_geo(), "eject", check=False)
    assert coords(script, "X") == [1067.0]
    assert coords(script, "Y") == [250.0, 343.0, 300.0, 250.0, 225.0, 25.0]
    assert coords(script, "Z") == [20.0, 76.0, 73.0, 70.0, 60.0, 40.0]


def test_einlegen_trifft_die_gemessene_bewegung():
    """Gemessen: X1067 Y25 Z73 · Y220 · Z75 · Y343 · Z20"""
    script = m.build_op(printer_geo(), "place", check=False)
    assert coords(script, "X") == [1067.0]
    assert coords(script, "Y") == [25.0, 220.0, 343.0]
    assert coords(script, "Z") == [73.0, 75.0, 20.0]


@pytest.mark.parametrize("op", ("eject", "place"))
def test_am_drucker_faehrt_der_magnet_nur_einmal_in_x(op):
    """Der Andruck-Weg war der letzte Rest seitlicher Bewegung — er gehoert zum
    Klemm-Greifer. Der Magnet richtet X genau einmal aus und laesst sie stehen."""
    assert len(coords(m.build_op(printer_geo(), op, check=False), "X")) == 1


@pytest.mark.parametrize("op", ("eject", "place"))
def test_der_andruck_weg_aendert_die_magnet_bewegung_nicht(op):
    a = m.build_op(printer_geo(clamp_push_mm=30), op, check=False)
    b = m.build_op(printer_geo(clamp_push_mm=0), op, check=False)
    assert a == b


def test_die_drucker_bewegung_wandert_mit_dem_drucker():
    g = printer_geo(printers=[{"id": "p1", "name": "X1C",
                               "eject": {"x": 500, "y": 300, "z": 10},
                               "load": {"x": 500, "y": 300, "z": 10}}])
    script = m.build_op(g, "eject", check=False)
    assert coords(script, "X") == [500.0]
    assert coords(script, "Y")[0] == 300.0 - 93.0        # Anfahr-Y
    assert coords(script, "Z")[1] == 10.0 + 56.0         # Anheben


@pytest.mark.parametrize("op", ("eject", "place"))
def test_die_schranke_gilt_auch_am_drucker(op):
    g = printer_geo(magnet_y_min_loaded_mm=60)
    assert min(coords(m.build_op(g, op, check=False), "Y")) >= 60


@pytest.mark.parametrize("op", ("eject", "place"))
def test_der_klemm_greifer_faehrt_am_drucker_unveraendert(op):
    """Gegenprobe: die gemessenen Klemm-Wege duerfen sich nicht mitbewegt haben."""
    a = m.build_op(printer_geo(gripper="standard"), op, check=False)
    b = m.build_op(m.merge_defaults({
        "racks": 1, "storage": {"y_pullback_limit": 5},
        "printers": [{"id": "p1", "name": "X1C",
                      "eject": {"x": 1067, "y": 343, "z": 20},
                      "load": {"x": 1067, "y": 343, "z": 20}}]}), op, check=False)
    assert a == b
