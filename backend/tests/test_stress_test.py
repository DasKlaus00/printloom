"""Stresstest: Umzugsplan und Zeitschätzung.

Der Plan bewegt echte Mechanik. Alles, was hier festgehalten ist, ist entweder
eine Kollisionsregel oder eine Zusage an den Nutzer — beides darf nicht still
kaputtgehen."""
import pytest

from app.services import ottoeject_motion as m
from app.services import stress_test as st


def geo(racks=3):
    return m.expand(m.merge_defaults({"racks": racks}))


def rack_data(belegt=None, racks=3, slots=6, magazin=7, **rest):
    """Regal-Stand: `belegt` = {"1-2": {...Fach-Felder...}}."""
    data = {
        "num_racks": racks, "slots_per_rack": slots, "slot_height_mm": 50,
        "magazine_slot": magazin,
        "slots": {f"{r}-{s}": {"status": "free", "empty_plate": False,
                               "object_height_mm": None}
                  for r in range(1, racks + 1) for s in range(1, slots + 1)},
    }
    for key, felder in (belegt or {}).items():
        data["slots"][key] = {**data["slots"].get(key, {}), **felder}
    data.update(rest)
    return data


def druck(h=40):
    return {"status": "done", "object_height_mm": h}


# ── Welches Regal ist das entfernteste? ──────────────────────────────────────

def test_zielregal_ist_das_vom_drucker_entfernteste():
    """Regal 1 steht am Drucker, das höchste am anderen Ende der Schiene. Ein Test,
    der ins Regal AM Drucker umlagert, würde die kürzesten Wege fahren."""
    g = geo(3)
    assert st.printer_x(g) > m.rack_x(g, 1) > m.rack_x(g, 3)
    assert st.farthest_rack(g) == 3


def test_ein_einziges_regal_ist_auch_das_entfernteste():
    assert st.farthest_rack(geo(1)) == 1


def test_ohne_bekannte_drucker_position_gilt_die_nummerierung(monkeypatch):
    """Käme aus der Geometrie keine Drucker-X (kaputte/halbe Konfiguration), darf
    der Test nicht aufgeben — dann gilt die Nummerierung: R1 steht am Drucker."""
    monkeypatch.setattr(st, "printer_x", lambda *a, **k: None)
    assert st.farthest_rack(geo(3)) == 3


# ── Welche Platten kommen mit? ───────────────────────────────────────────────

def test_eingelagerte_drucke_und_markierte_leerplatten_kommen_mit():
    data = rack_data({"1-1": druck(40), "1-3": {"status": "free", "empty_plate": True}})
    gefunden = st.plates_in_racks(data, magazine_slot=7)
    assert {(r, s, art) for r, s, _, art in gefunden} == {(1, 1, "druck"), (1, 3, "leerplatte")}


def test_das_magazin_bleibt_unangetastet():
    """Im Magazin liegt ein STAPEL in EINEM Fach. Er wird flach gegriffen und lässt
    sich nicht auf einzelne Fächer verteilen — außerdem ist er der Nachschub."""
    data = rack_data({"1-7": druck(10)}, slots=7, magazin=7)
    assert st.plates_in_racks(data, magazine_slot=7) == []


def test_gesperrte_faecher_bleiben_liegen():
    data = rack_data({"1-2": {"status": "locked"}})
    assert st.plates_in_racks(data, magazine_slot=7) == []


def test_leere_faecher_liefern_nichts():
    assert st.plates_in_racks(rack_data(), magazine_slot=7) == []


def test_gegriffen_wird_von_oben_nach_unten():
    """Über einer noch liegenden Platte fährt der Arm nicht hinweg — das oberste
    Fach eines Regals muss zuerst geräumt werden."""
    data = rack_data({"1-1": druck(10), "1-4": druck(10), "1-2": druck(10)})
    reihenfolge = [(r, s) for r, s, _, _ in st.plates_in_racks(data, 7)]
    assert reihenfolge == [(1, 4), (1, 2), (1, 1)]


# ── Der Plan ─────────────────────────────────────────────────────────────────

def test_platten_wandern_ins_entfernteste_regal():
    plan = st.plan(rack_data({"1-1": druck(40), "2-2": druck(30)}), geo(3))
    assert plan["target_rack"] == 3
    assert [mv["from"] for mv in plan["moves"]] == ["1-1", "2-2"]
    assert all(mv["to_rack"] == 3 for mv in plan["moves"])


def test_was_schon_im_zielregal_liegt_bleibt_liegen():
    """Im selben Regal umsetzen wäre der kürzeste denkbare Weg — für einen
    Stresstest wertlos, und es verbraucht die Fächer, die die anderen brauchen."""
    plan = st.plan(rack_data({"3-1": druck(40), "1-1": druck(40)}), geo(3))
    assert [mv["from"] for mv in plan["moves"]] == ["1-1"]
    assert plan["skipped"] == [{"from": "3-1", "reason": "liegt schon im Zielregal"}]


def test_ziele_werden_nie_doppelt_vergeben():
    belegt = {f"{r}-{s}": druck(10) for r in (1, 2) for s in (1, 2, 3)}
    plan = st.plan(rack_data(belegt), geo(3))
    ziele = [mv["to"] for mv in plan["moves"]]
    assert len(ziele) == len(set(ziele))


def test_hohe_objekte_belegen_mehrere_faecher():
    """Ein 100-mm-Teil braucht zwei Fachhöhen — das nächste Ziel darf frühestens
    darüber beginnen, sonst stellt der Arm die Platte in das Teil hinein."""
    plan = st.plan(rack_data({"1-1": druck(100), "1-2": druck(10)}), geo(3))
    ziele = {mv["from"]: mv["to_slot"] for mv in plan["moves"]}
    assert ziele["1-2"] == 1                    # von oben geräumt, kommt zuerst
    assert ziele["1-1"] >= ziele["1-2"] + 1     # 100 mm beginnt über dem 10-mm-Teil


def test_der_plan_prueft_gegen_sich_selbst():
    """Die Falle: Der Plan legt zuerst ein 60-mm-Teil ins Ziel. Für das nächste Fach
    darüber gilt dann die verringerte Nutzhöhe — obwohl im AUSGANGSZUSTAND dort
    nichts lag. Wer nur den Anfangszustand prüft, stellt die zweite Platte in das
    erste Teil hinein."""
    plan = st.plan(rack_data({"1-1": druck(60), "1-2": druck(60)}), geo(3))
    ziele = sorted(mv["to_slot"] for mv in plan["moves"])
    assert len(ziele) == 2
    # 60 mm passt bei freier Decke in EIN Fach (50 + 20 Toleranz), ragt aber in den
    # Raum, den die nächste Platte zum Einfahren braucht → ein Fach Luft dazwischen.
    assert ziele[1] - ziele[0] >= 2


def test_volles_zielregal_meldet_was_liegen_bleibt():
    """Keine stille Teilausführung: was nicht passt, wird benannt."""
    voll = {f"3-{s}": druck(10) for s in range(1, 7)}
    voll["1-1"] = druck(10)
    plan = st.plan(rack_data(voll), geo(3))
    assert plan["moves"] == []
    assert plan["skipped"], "ein liegengebliebenes Fach muss gemeldet werden"
    assert any("1-1" == s["from"] for s in plan["skipped"])


def test_nichts_zu_tun_ist_ein_gueltiger_plan():
    plan = st.plan(rack_data(), geo(3))
    assert plan["moves"] == [] and plan["seconds"] == 0 and plan["plate_count"] == 0


def test_leerplatte_behaelt_ihre_art():
    """Die Markierung muss am Ziel wieder gesetzt werden — sonst hält die Farm die
    Platte für verschwunden und greift ins Leere."""
    plan = st.plan(rack_data({"1-2": {"status": "free", "empty_plate": True}}), geo(3))
    assert plan["moves"][0]["kind"] == "leerplatte"


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
    """Der Weg ZWISCHEN den Regalen ist beim Stresstest der lange — er zählt nur
    mit, wenn die Endposition in den nächsten Abschnitt übergeht."""
    _, pos = st.script_seconds("G1 X0 Y0 Z0 F3000\n")
    secs, _ = st.script_seconds("G1 X600 F3000\n", pos)
    assert secs == pytest.approx(12.0, abs=0.01)


def test_wartezeiten_zaehlen_mit():
    secs, _ = st.script_seconds("G4 P1500\n")
    assert secs == pytest.approx(1.5, abs=0.01)


def test_mehr_platten_dauern_laenger():
    g = geo(3)
    eine  = st.plan(rack_data({"1-1": druck(10)}), g)
    zwei  = st.plan(rack_data({"1-1": druck(10), "2-1": druck(10)}), g)
    assert 0 < eine["seconds"] < zwei["seconds"]


def test_geschaetzte_zeit_ist_plausibel():
    """Ein Umzug quer über die Schiene ist keine Sekunde und keine Stunde. Die
    Schranken sind weit — sie fangen nur Vorzeichen-/Einheitenfehler ab."""
    plan = st.plan(rack_data({"1-1": druck(10)}), geo(3))
    assert 5 < plan["seconds"] < 600
