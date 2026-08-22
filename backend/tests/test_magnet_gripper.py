"""Magnet-Greifer: greifen und ablegen ohne Weg nach links/rechts.

Beim Original-Greifer klemmt der Arm die Platte seitlich — er fährt in X über den
Greifpunkt hinaus (clamp_push_mm) und wieder zurück. Der Magnet-Greifer nimmt die
Platte magnetisch auf: der Arm senkt sich nur ab und hebt wieder.

Genau das ist hier die Zusage, und sie darf nicht still kaputtgehen: ein X-Weg
im Magnet-Ablauf würde die Platte aus ihrer Halterung schieben.
"""
import re

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
    return [float(v) for v in re.findall(rf"\b{axis}(-?\d+(?:\.\d+)?)", script)]


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

def test_greifen_senkt_ab_und_hebt_dann_an():
    """Über der Platte einfahren → auf sie absenken → mit ihr anheben."""
    g = magnet()
    z_flat = m.slot_position(g, 2, 3)[2]
    z = coords(m.build_op(g, "grab", rack=2, slot=3, check=False), "Z")
    assert z[0] > z_flat          # einfahren ÜBER der Platte
    assert z[1] == z_flat         # absenken auf die Platte
    assert z[2] > z_flat          # mit Platte anheben


def test_ablegen_setzt_ab_und_loest_nach_oben():
    g = magnet()
    z_flat = m.slot_position(g, 2, 3)[2]
    z = coords(m.build_op(g, "store", rack=2, slot=3, check=False), "Z")
    assert z[0] > z_flat          # über dem Fach anfahren
    assert min(z) == z_flat       # absetzen
    assert z[-1] > z_flat         # Greifer löst nach oben, nicht seitlich


def test_kein_zug_unter_die_fachhoehe():
    """Der Arm darf nie tiefer als die Platte — sonst rammt er die Halterung."""
    g = magnet()
    z_flat = m.slot_position(g, 1, 1)[2]
    for op in ("grab", "store"):
        z = coords(m.build_op(g, op, rack=1, slot=1, check=False), "Z")
        assert min(z) >= z_flat


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

def test_schwebehoehe_ist_einstellbar():
    """Der Greifer ist freigegeben, aber nicht vermessen — wer die Werte nicht
    verstellen kann, braucht fuer jeden Testlauf eine Code-Aenderung."""
    g = magnet(magnet_hover_mm=20, magnet_lift_mm=40)
    z = coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z")
    flat = m.slot_position(g, 1, 1)[2]
    assert flat + 20 in z
    assert flat + 40 in z


def test_anhebeweg_ist_einstellbar_beim_ablegen():
    g = magnet(magnet_hover_mm=15, magnet_lift_mm=35)
    z = coords(m.build_op(g, "store", rack=1, slot=1, check=False), "Z")
    flat = m.slot_position(g, 1, 1)[2]
    assert flat + 15 in z and flat + 35 in z


def test_schwebehoehe_null_wird_verweigert():
    """Bei 0 fuehre der Arm auf Plattenhoehe ein und schoebe sie vor sich her.
    Ein Tippfehler im Eingabefeld darf keine solche Bewegung erzeugen."""
    g = magnet(magnet_hover_mm=0)
    flat = m.slot_position(g, 1, 1)[2]
    z = coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z")
    assert all(v >= flat for v in z)
    assert max(z) > flat


def test_negative_schwebehoehe_wird_verweigert():
    g = magnet(magnet_hover_mm=-30)
    flat = m.slot_position(g, 1, 1)[2]
    assert all(v >= flat for v in coords(m.build_op(g, "grab", rack=1, slot=1, check=False), "Z"))


def test_anhebeweg_unter_der_schwebehoehe_wird_angehoben():
    """Sonst zoege der Arm die Platte gar nicht erst aus dem Fach."""
    hover, lift = m._magnet_z({"magnet_hover_mm": 20, "magnet_lift_mm": 5})
    assert lift > hover


def test_muell_faellt_auf_die_startwerte_zurueck():
    for bad in (None, "", "viel", float("nan")):
        hover, lift = m._magnet_z({"magnet_hover_mm": bad, "magnet_lift_mm": bad})
        assert hover == m.MAGNET_HOVER_MM and lift == m.MAGNET_LIFT_MM


def test_die_z_wege_beruehren_den_klemm_greifer_nicht():
    g = m.merge_defaults({"racks": 3, "gripper": "standard",
                          "magnet_hover_mm": 99, "magnet_lift_mm": 99})
    a = m.build_op(g, "grab", rack=1, slot=1, check=False)
    b = m.build_op(m.merge_defaults({"racks": 3, "gripper": "standard"}),
                   "grab", rack=1, slot=1, check=False)
    assert a == b
