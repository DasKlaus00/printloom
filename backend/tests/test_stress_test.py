"""Stresstest: Magazine leerräumen, Platte für Platte in ein zufälliges Fach.

Der Plan bewegt echte Mechanik. Alles hier ist entweder eine Kollisionsregel oder
eine Zusage an den Nutzer — beides darf nicht still kaputtgehen.

Gewürfelt wird mit festem `seed`, damit die Tests reproduzierbar sind."""
import pytest

from app.services import ottoeject_motion as m
from app.services import stress_test as st


def geo(racks=3):
    return m.expand(m.merge_defaults({"racks": racks}))


def rack_data(counts=(2, 0, 0), belegt=None, racks=3, slots=6, magazin=7, **rest):
    """Regal-Stand. `counts` = Magazin-Bestand je Regal."""
    data = {
        "num_racks": racks, "slots_per_rack": slots, "slot_height_mm": 50,
        "magazine_slot": magazin, "magazine_counts": list(counts),
        "slots": {f"{r}-{s}": {"status": "free", "empty_plate": False,
                               "object_height_mm": None}
                  for r in range(1, racks + 1) for s in range(1, slots + 1)},
    }
    for key, felder in (belegt or {}).items():
        data["slots"][key] = {**data["slots"].get(key, {}), **felder}
    data.update(rest)
    return data


def druck(h=40):
    return {"status": "done", "object_height_mm": h, "empty_plate": False}


# ── Quelle: die Magazine ─────────────────────────────────────────────────────

def test_jede_platte_im_magazin_wird_eine_fahrt():
    """Der Zähler sagt, wie viele Platten im Stapel liegen — jede einzeln."""
    quellen = st.magazine_sources(rack_data(counts=(3, 1, 0)))
    assert len(quellen) == 4
    assert all(aus_mag for _, _, aus_mag in quellen)


def test_magazin_eins_wird_zuerst_geleert():
    quellen = st.magazine_sources(rack_data(counts=(2, 2, 1)))
    assert [r for r, _, _ in quellen] == [1, 1, 2, 2, 3]


def test_alle_platten_kommen_aus_dem_magazin_fach():
    quellen = st.magazine_sources(rack_data(counts=(2, 0, 0), magazin=7))
    assert {s for _, s, _ in quellen} == {7}


def test_leere_magazine_liefern_nichts():
    assert st.magazine_sources(rack_data(counts=(0, 0, 0))) == []


def test_ohne_magazin_sind_die_markierten_faecher_die_quelle():
    """Aufbau „alle Fächer sind Lagerfächer": kein Stapel, sondern einzeln liegende
    Platten — und die werden normal gegriffen, nicht flach."""
    data = rack_data(counts=(), magazin=0,
                     belegt={"1-2": {"status": "free", "empty_plate": True},
                             "2-4": {"status": "free", "empty_plate": True}})
    quellen = st.magazine_sources(data)
    assert {(r, s) for r, s, _ in quellen} == {(1, 2), (2, 4)}
    assert not any(aus_mag for _, _, aus_mag in quellen)


# ── Ziel: irgendein freies Fach ──────────────────────────────────────────────

def test_magazin_faecher_sind_kein_ziel():
    """Dort steht der Stapel — eine Platte obendrauf wäre eine Kollision."""
    frei = st.free_slots(rack_data(slots=7, magazin=7), geo(3))
    assert all(s != 7 for _, s in frei)


def test_belegte_und_gesperrte_faecher_sind_kein_ziel():
    data = rack_data(belegt={"1-1": druck(), "1-2": {"status": "locked"},
                             "1-3": {"status": "free", "empty_plate": True}})
    frei = st.free_slots(data, geo(3))
    assert (1, 1) not in frei and (1, 2) not in frei and (1, 3) not in frei
    assert (1, 4) in frei


def test_ziele_liegen_ueber_alle_regale_verteilt():
    """„Irgendwohin" heißt quer über die Anlage — sonst wäre es kein Stresstest."""
    plan = st.plan(rack_data(counts=(6, 0, 0)), geo(3), seed=1)
    assert len({mv["to_rack"] for mv in plan["moves"]}) > 1


# ── Der Plan ─────────────────────────────────────────────────────────────────

def test_jede_magazin_platte_bekommt_eine_fahrt():
    plan = st.plan(rack_data(counts=(2, 3, 0)), geo(3), seed=7)
    assert plan["plate_count"] == 5
    assert len(plan["moves"]) == 5
    assert all(mv["from_magazine"] for mv in plan["moves"])


def test_kein_fach_wird_doppelt_vergeben():
    plan = st.plan(rack_data(counts=(5, 5, 5)), geo(3), seed=3)
    ziele = [mv["to"] for mv in plan["moves"]]
    assert len(ziele) == len(set(ziele))


def test_mehr_platten_als_faecher_meldet_den_rest():
    """Keine stille Teilausführung: was nicht mehr passt, wird benannt."""
    plan = st.plan(rack_data(counts=(50, 0, 0)), geo(1), seed=5)
    assert plan["plate_count"] == 50
    assert len(plan["moves"]) == plan["free_count"] < 50
    assert len(plan["skipped"]) == 50 - len(plan["moves"])


def test_hoher_druck_darunter_sperrt_das_fach():
    """Ein 100-mm-Teil in 1-1 belegt zwei Fachhöhen — in 1-2 kann keine Platte
    einfahren, auch wenn der Status dort „frei" sagt."""
    plan = st.plan(rack_data(counts=(9, 0, 0), belegt={"1-1": druck(100)}),
                   geo(1), seed=2)
    assert "1-2" not in {mv["to"] for mv in plan["moves"]}


def test_derselbe_wurf_ergibt_denselben_plan():
    """Gefahren werden muss, was angezeigt wurde."""
    a = st.plan(rack_data(counts=(4, 0, 0)), geo(3), seed=42)
    b = st.plan(rack_data(counts=(4, 0, 0)), geo(3), seed=42)
    assert [x["to"] for x in a["moves"]] == [x["to"] for x in b["moves"]]


def test_verschiedene_wuerfe_verteilen_anders():
    a = st.plan(rack_data(counts=(8, 0, 0)), geo(3), seed=1)
    b = st.plan(rack_data(counts=(8, 0, 0)), geo(3), seed=2)
    assert [x["to"] for x in a["moves"]] != [x["to"] for x in b["moves"]]


def test_leere_magazine_ergeben_einen_leeren_plan():
    plan = st.plan(rack_data(counts=(0, 0, 0)), geo(3), seed=1)
    assert plan["moves"] == [] and plan["plate_count"] == 0 and plan["seconds"] == 0


def test_ohne_magazin_wird_normal_gegriffen():
    data = rack_data(counts=(), magazin=0,
                     belegt={"1-2": {"status": "free", "empty_plate": True}})
    plan = st.plan(data, geo(3), seed=1)
    assert plan["moves"][0]["from_magazine"] is False


# ── Zeitschätzung ────────────────────────────────────────────────────────────

def test_zeit_kommt_aus_strecke_und_vorschub():
    # 600 mm bei F3000 (= 50 mm/s) sind 12 s.
    secs, pos = st.script_seconds("G1 X0 Y0 Z0 F3000\nG1 X600 F3000\n")
    assert secs == pytest.approx(12.0, abs=0.01)
    assert pos["X"] == 600.0


def test_der_erste_zug_zaehlt_nicht_ins_leere():
    """Woher der Arm zu Beginn kommt, weiß niemand — daraus eine Strecke zu
    erfinden wäre geraten."""
    secs, _ = st.script_seconds("G1 X600 F3000\n")
    assert secs == 0.0


def test_position_wandert_von_op_zu_op():
    """Der Weg zwischen Magazin und Ziel ist hier der lange — er zählt nur mit,
    wenn die Endposition in den nächsten Abschnitt übergeht."""
    _, pos = st.script_seconds("G1 X0 Y0 Z0 F3000\n")
    secs, _ = st.script_seconds("G1 X600 F3000\n", pos)
    assert secs == pytest.approx(12.0, abs=0.01)


def test_wartezeiten_zaehlen_mit():
    secs, _ = st.script_seconds("G4 P1500\n")
    assert secs == pytest.approx(1.5, abs=0.01)


def test_mehr_platten_dauern_laenger():
    g = geo(3)
    eine = st.plan(rack_data(counts=(1, 0, 0)), g, seed=1)
    fuenf = st.plan(rack_data(counts=(5, 0, 0)), g, seed=1)
    assert 0 < eine["seconds"] < fuenf["seconds"]


def test_geschaetzte_zeit_ist_plausibel():
    """Eine Fahrt quer über die Schiene ist keine Sekunde und keine Stunde. Die
    Schranken sind weit — sie fangen nur Vorzeichen-/Einheitenfehler ab."""
    plan = st.plan(rack_data(counts=(1, 0, 0)), geo(3), seed=1)
    assert 5 < plan["seconds"] < 600


# ── Anzeige ──────────────────────────────────────────────────────────────────

def test_entferntestes_regal_wird_gemeldet():
    """Nur zur Einordnung in der Oberfläche („die weitesten Wege gehen bis R3")."""
    g = geo(3)
    assert st.printer_x(g) > m.rack_x(g, 1) > m.rack_x(g, 3)
    assert st.plan(rack_data(counts=(1, 0, 0)), g, seed=1)["farthest_rack"] == 3


# ── Option: Umweg über den Drucker ───────────────────────────────────────────
# „Jede Platte zwischendurch auf den Drucker legen, wieder nehmen, dann ins Fach."
# Das ist die Zusage; die Tests halten sie fest.

def test_ohne_option_bleibt_der_drucker_aussen_vor():
    """Vorgabe ist AUS. Wer nur den Regal-Lauf will, darf kein Bett auf Z200 und
    keine offene Tuer bekommen."""
    p = st.plan(rack_data(counts=(2, 0, 0)), geo(), seed=1)
    assert p["include_printer"] is False
    assert p["has_door"] is False


def test_mit_option_meldet_der_plan_den_umweg():
    p = st.plan(rack_data(counts=(2, 0, 0)), geo(), seed=1, include_printer=True)
    assert p["include_printer"] is True


def test_der_umweg_ist_auflegen_und_wieder_herunternehmen():
    """Reihenfolge ist die Zusage: erst auf den Drucker, dann herunter, dann ins
    Fach. Umgedreht griffe der Arm ins Leere."""
    assert st.printer_ops(geo()) == ("place", "eject")


def test_der_umweg_aendert_die_ziele_nicht():
    """Der Drucker ist eine Zwischenstation, kein Ziel — dieselben Faecher wie ohne."""
    a = st.plan(rack_data(counts=(3, 0, 0)), geo(), seed=7)
    b = st.plan(rack_data(counts=(3, 0, 0)), geo(), seed=7, include_printer=True)
    assert a["moves"] == b["moves"]


def test_der_umweg_kostet_zeit_und_die_schaetzung_zeigt_es():
    """Wer den Haken setzt, soll VOR dem Start sehen, dass es laenger dauert."""
    a = st.plan(rack_data(counts=(3, 0, 0)), geo(), seed=7)
    b = st.plan(rack_data(counts=(3, 0, 0)), geo(), seed=7, include_printer=True)
    assert b["seconds"] > a["seconds"]


def test_ohne_platten_kostet_der_umweg_nichts():
    """Kein Umzug, keine Umwegzeit — sonst zeigte die Vorschau eine Dauer fuer
    einen Lauf, der gar nicht stattfindet."""
    g = m.expand(m.merge_defaults({
        "racks": 3,
        "printers": [{"id": "p1", "name": "Offen", "enclosed": False,
                      "eject": {"x": 1067, "y": 343, "z": 20},
                      "load": {"x": 1067, "y": 343, "z": 20}}],
    }))
    assert st.has_door(g) is False        # Vorbedingung: keine Tuerzeit im Sockel
    assert st.estimate_seconds(g, [], include_printer=True) == 0


def test_eine_tuer_wird_einmal_gefahren_nicht_pro_platte():
    """Auf und zu bei jeder Platte waere nur Verschleiss. Der Beleg: die Tuerzeit
    haengt nicht an der Plattenzahl."""
    g = m.expand(m.merge_defaults({
        "racks": 3,
        "printers": [{"id": "p1", "name": "X1C", "enclosed": True,
                      "eject": {"x": 1067, "y": 343, "z": 20},
                      "load": {"x": 1067, "y": 343, "z": 20},
                      "door": {"open": {"x": 720, "y": 280, "z": 85},
                               "close": {"x": 1065, "y": 0, "z": 85}}}],
    }))
    assert st.has_door(g) is True
    # Tuerzeit = Aufschlag gegenueber demselben Drucker ohne Tuer. Er muss bei einer
    # Platte GENAUSO gross sein wie bei fuenf; waere die Tuer pro Platte dabei,
    # wuechse er mit.
    ohne = m.expand(m.merge_defaults({
        "racks": 3,
        "printers": [{**g["printers"][0], "door": None}],
    }))
    assert st.has_door(ohne) is False

    def aufschlag(n):
        d = rack_data(counts=(n, 0, 0))
        return (st.plan(d, g, seed=3, include_printer=True)["seconds"]
                - st.plan(d, ohne, seed=3, include_printer=True)["seconds"])

    assert aufschlag(1) == aufschlag(5) > 0


def test_ohne_tuer_wird_keine_gefahren():
    """Ein offener Drucker hat nichts zu oeffnen — sonst faehrt der Arm eine
    Tuerbewegung ins Nichts."""
    g = m.expand(m.merge_defaults({
        "racks": 3,
        "printers": [{"id": "p1", "name": "Offen", "enclosed": False,
                      "eject": {"x": 1067, "y": 343, "z": 20},
                      "load": {"x": 1067, "y": 343, "z": 20}}],
    }))
    assert st.has_door(g) is False
    assert st.plan(rack_data(counts=(2, 0, 0)), g, seed=1,
                   include_printer=True)["has_door"] is False
