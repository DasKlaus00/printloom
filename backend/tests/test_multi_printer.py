"""Mehrere Drucker und unterschiedlich gebaute Regale (seit v1.1.9).

Bis v1.1.8 kannte die Geometrie GENAU EINEN Drucker, dessen X als Basis gespeichert
war (gefahren wurde Basis + (Regale−1)·rack_x_gap), und die Regale lagen auf einer
Formel mit gleichem Abstand. Jetzt hat jeder Drucker und jedes Regal seinen eigenen
Block mit ABSOLUTEN Werten.

Der wichtigste Test hier ist der erste: eine Bestandsanlage darf sich durch die
Umstellung um KEINEN Millimeter verschieben. Alles andere ist Komfort — das hier ist
die Zusage, dass niemandes Arm nach dem Update woanders hinfährt.
"""
import pytest

from app.services import geometry_check as gc
from app.services import ottoeject_motion as motion

# Anlage in der alten Form: 3 Regale, ein Drucker, X als Basis + Δ je Regal.
ALT = {
    "racks": 3, "storage_slots": 6, "magazine_slot": 7,
    "printer_id": "x1c", "printer_name": "Bambu Lab X1C", "enclosed": True,
    "storage": {"x_unclamp": 43, "y_engage": 335, "first_z_flat": 7,
                "slot_gap": 25, "y_pullback_limit": 5, "rack_x_gap": 250},
    "rack_x_trim": {"2": -1.5, "3": -11},
    "printer": {"eject": {"x": 442, "y": 319, "z": 21},
                "load": {"x": 425, "y": 340, "z": 17.5},
                "move": {"x": 430, "y": 340, "z": 17.5},
                "door": {"open": {"x": 104, "y": 319, "z": 105, "d": 370},
                         "close": {"x": 103, "y": 322, "z": 105, "d": 375}}},
    "use_gcode": {"eject": True, "grab": True},
    "speed_factors": {"eject": 200},
    "clamp_push_mm": 30,
}

ALLE_OPS = ("open_door", "close_door", "move_to_printer", "eject", "place",
            "grab", "grab_magazine", "store", "approach")


def _gcode(g):
    """G-code ALLER Operationen über alle Regale und Randfächer."""
    out = {}
    for op in ALLE_OPS:
        for rack in (1, 2, 3):
            for slot in (1, 6, 7):
                out[(op, rack, slot)] = motion.build_op(
                    g, op, rack=rack, slot=slot, check=False)
    return out


# ── Die Zusage: nichts verschiebt sich ───────────────────────────────────────
def test_umstellung_faehrt_exakt_dieselben_koordinaten():
    """expand() schreibt die Anlage in die neue Form — Bewegung identisch."""
    alt = motion.merge_defaults(ALT)
    neu = motion.expand(motion.merge_defaults(ALT))

    assert neu["printers"] and neu["rack_geo"], "volle Form nicht erzeugt"
    assert _gcode(neu) == _gcode(alt), "G-code hat sich durch die Umstellung geändert"


def test_umstellung_ist_wiederholbar():
    """Ein zweites expand() darf nichts mehr ändern — sonst würde jede Runde
    den Regal-Versatz erneut aufaddieren."""
    einmal = motion.expand(motion.merge_defaults(ALT))
    zweimal = motion.expand(einmal)
    assert zweimal["printers"] == einmal["printers"]
    assert zweimal["rack_geo"] == einmal["rack_geo"]
    assert _gcode(zweimal) == _gcode(einmal)


def test_drucker_x_wird_absolut_ausgeschrieben():
    """Alt: Basis 442 + (3−1)·250. Neu steht die gefahrene Zahl da."""
    neu = motion.expand(motion.merge_defaults(ALT))
    p = neu["printers"][0]
    assert p["eject"]["x"] == 942
    assert p["load"]["x"] == 925
    assert p["move"]["x"] == 930
    assert p["door"]["open"]["x"] == 604
    assert p["preset"] == "x1c"          # Vorlage bleibt am Drucker hängen


def test_regal_werte_werden_ausgeschrieben():
    neu = motion.expand(motion.merge_defaults(ALT))
    rg = neu["rack_geo"]
    assert rg["1"]["x"] == 543           # 43 + 2·250
    assert rg["2"]["x"] == 291.5         # Δ −1.5
    assert rg["3"]["x"] == 32            # Δ −11
    for r in ("1", "2", "3"):
        assert rg[r]["y_engage"] == 335 and rg[r]["first_z"] == 7
        assert rg[r]["slot_gap"] == 25


def test_regalzahl_verschiebt_den_drucker_nicht_mehr():
    """Alt-Modell: ein zusätzliches Regal schob den Drucker still um rack_x_gap.
    Mit absoluter X bleibt er stehen, wo er eingemessen wurde."""
    neu = motion.expand(motion.merge_defaults(ALT))
    vorher = motion.build_op(neu, "eject", check=False)
    neu["racks"] = 4
    assert motion.build_op(neu, "eject", check=False) == vorher


# ── Mehrere Drucker ──────────────────────────────────────────────────────────
def _zwei_drucker():
    g = motion.expand(motion.merge_defaults(ALT))
    zweiter = {**g["printers"][0], "id": "printer-2", "name": "P1S",
               "device_id": 5, "preset": "p1s",
               "eject": {"x": 500, "y": 300, "z": 15},
               "load": {"x": 490, "y": 300, "z": 15},
               "move": {"x": 495, "y": 300, "z": 15},
               "door": None, "use_gcode": {}, "gcode_override": {},
               "speed_factors": {}}
    g["printers"] = [g["printers"][0], zweiter]
    return g


def test_jeder_drucker_faehrt_seine_eigenen_koordinaten():
    g = _zwei_drucker()
    eins = motion.build_op(g, "eject", printer="printer-1", check=False)
    zwei = motion.build_op(g, "eject", printer="printer-2", check=False)
    assert "X942" in eins and "X942" not in zwei
    assert "X500" in zwei
    assert "Bambu Lab X1C" in eins and "P1S" in zwei


def test_ohne_angabe_faehrt_der_erste_drucker():
    g = _zwei_drucker()
    assert motion.build_op(g, "eject", check=False) == \
        motion.build_op(g, "eject", printer="printer-1", check=False)


def test_unbekannter_drucker_faellt_auf_den_ersten_zurueck():
    """Lieber der erste Drucker als ein Absturz mitten in der Sequenz."""
    g = _zwei_drucker()
    assert motion.build_op(g, "eject", printer="gibts-nicht", check=False) == \
        motion.build_op(g, "eject", printer="printer-1", check=False)


def test_drucker_ohne_tuer_macht_keine_tuerbewegung():
    g = _zwei_drucker()
    assert "no door macro" in motion.build_op(g, "open_door", printer="printer-2", check=False)
    assert "Opening door" in motion.build_op(g, "open_door", printer="printer-1", check=False)


def test_eigener_gcode_gilt_nur_fuer_seinen_drucker():
    g = _zwei_drucker()
    g["printers"][1]["gcode_override"]["eject"] = "G1 X123 F3000"
    assert "X123" in motion.build_op(g, "eject", printer="printer-2", check=False)
    assert "X123" not in motion.build_op(g, "eject", printer="printer-1", check=False)


def test_geschwindigkeit_je_drucker():
    g = _zwei_drucker()
    g["printers"][1]["speed_factors"]["eject"] = 300
    assert "M220 S300" in motion.build_op(g, "eject", printer="printer-2", check=False)
    assert "M220 S200" in motion.build_op(g, "eject", printer="printer-1", check=False)


def test_farm_freigabe_je_drucker():
    """„Farm nutzt diese Position" ist eine Entscheidung PRO Drucker — sonst würde
    ein frisch angelegter zweiter Drucker sofort mitfahren, ohne eingemessen zu sein."""
    g = _zwei_drucker()
    g["printers"][0]["use_gcode"] = {"eject": True}
    g["printers"][1]["use_gcode"] = {"eject": False}
    assert motion.op_uses_gcode(g, "eject", "printer-1") is True
    assert motion.op_uses_gcode(g, "eject", "printer-2") is False
    # Regal-Operationen bleiben gemeinsam (der Greifer ist derselbe).
    assert motion.op_uses_gcode(g, "grab", "printer-2") is True


# ── Unterschiedliche Regale ──────────────────────────────────────────────────
def test_regal_mit_eigenen_werten():
    g = motion.expand(motion.merge_defaults(ALT))
    g["rack_geo"]["2"] = {"x": 300, "y_engage": 320, "first_z": 12, "slot_gap": 40}
    x, y, z, _ = motion.slot_position(g, 2, 3)
    assert (x, y) == (300, 320)
    assert z == 12 + 2 * (40 + motion.SLOT_Z_EXTRA)
    # Regal 1 bleibt unberührt
    x1, y1, z1, _ = motion.slot_position(g, 1, 3)
    assert (x1, y1, z1) == (543, 335, 7 + 2 * (25 + motion.SLOT_Z_EXTRA))


def test_regal_erbt_fehlende_werte():
    """Ein Regal, das nur eine eigene X hat, nutzt sonst die gemeinsamen Werte."""
    g = motion.merge_defaults({**ALT, "rack_geo": {"2": {"x": 300}}})
    x, y, z, _ = motion.slot_position(g, 2, 1)
    assert (x, y, z) == (300, 335, 7)


def test_zuordnung_regal_zu_drucker():
    g = _zwei_drucker()
    g["rack_geo"]["1"]["printer"] = "printer-1"
    g["rack_geo"]["2"]["printer"] = "printer-2"
    g["rack_geo"]["3"]["printer"] = "printer-2"
    assert motion.racks_of_printer(g, "printer-1") == [1]
    assert motion.racks_of_printer(g, "printer-2") == [2, 3]


def test_ohne_zuordnung_darf_jeder_drucker_jedes_regal():
    """Sonst stünde eine frische Anlage ohne Ablageplatz da."""
    g = _zwei_drucker()
    for r in ("1", "2", "3"):
        g["rack_geo"][r]["printer"] = None
    assert motion.racks_of_printer(g, "printer-2") == [1, 2, 3]


# ── Prüfung ──────────────────────────────────────────────────────────────────
def test_pruefung_nennt_den_drucker_bei_mehreren():
    g = _zwei_drucker()
    g["machine_limits"] = {"x": 1000, "y": 400, "z": 400}
    g["printers"][1]["eject"] = {"x": 1500, "y": 300, "z": 15}
    r = gc.check_geometry(g)
    hit = [p for p in r["errors"] if p.get("printer") == "printer-2"]
    assert hit, "Fehler am zweiten Drucker nicht gemeldet"
    assert any("P1S" in str(p.get("params")) for p in hit)


def test_pruefung_uebersieht_den_zweiten_drucker_nicht():
    """Vor v1.1.9 wurden Drucker-Ops nur einmal geprüft — ein falsch eingemessener
    zweiter Drucker wäre unbemerkt geblieben."""
    g = _zwei_drucker()
    g["machine_limits"] = {"x": 1200, "y": 400, "z": 400}
    g["printers"][1]["eject"] = {"x": -50, "y": 300, "z": 15}
    codes = [p["code"] for p in gc.check_geometry(g)["errors"]]
    assert "axis_below_zero" in codes


def test_zwei_drucker_an_derselben_stelle():
    g = _zwei_drucker()
    g["printers"][1]["eject"] = dict(g["printers"][0]["eject"])
    codes = [p["code"] for p in gc.check_geometry(g)["errors"]]
    assert "printers_same_x" in codes


def test_zwei_regale_an_derselben_stelle():
    g = motion.expand(motion.merge_defaults(ALT))
    g["rack_geo"]["2"]["x"] = g["rack_geo"]["3"]["x"]
    codes = [p["code"] for p in gc.check_geometry(g)["errors"]]
    assert "no_rack_gap" in codes


def test_fach_abstand_wird_je_regal_geprueft():
    g = motion.expand(motion.merge_defaults(ALT))
    g["rack_geo"]["2"]["slot_gap"] = -40
    bad = [p for p in gc.check_geometry(g)["errors"] if p["code"] == "no_slot_step"]
    assert bad and bad[0].get("rack") == 2


# ── Start-Sperre: kein Block für dieses Gerät ────────────────────────────────
def _farm_with(geom, monkeypatch):
    pytest.importorskip("fastapi")
    from app.routers import autofarm
    monkeypatch.setattr(autofarm, "_load_farm_geometry", lambda: geom)
    return autofarm


def test_start_verweigert_drucker_ohne_eigene_positionen(monkeypatch):
    """Sonst führe die Farm für Drucker 2 die Koordinaten von Drucker 1 — also
    gegen die falsche Maschine."""
    from fastapi import HTTPException
    g = _zwei_drucker()
    g["printers"][0]["device_id"] = 1
    g["printers"][0]["use_gcode"] = {"eject": True}
    del g["printers"][1]                       # Gerät 9 hat keinen Block
    af = _farm_with(g, monkeypatch)
    with pytest.raises(HTTPException) as e:
        af._assert_printer_geometry(9)
    assert e.value.status_code == 400
    af._assert_printer_geometry(1)             # der eingemessene Drucker startet


def test_start_geht_ohne_geraete_zuordnung(monkeypatch):
    """Bestandsanlage: ein Block, keinem Gerät zugeordnet — der Rückfall auf den
    ersten Drucker ist hier richtig und darf den Start nicht blockieren."""
    g = motion.expand(motion.merge_defaults(ALT))
    g["printers"][0]["use_gcode"] = {"eject": True}
    af = _farm_with(g, monkeypatch)
    af._assert_printer_geometry(7)


def test_start_geht_wenn_die_farm_nur_macros_faehrt(monkeypatch):
    """Ohne aktivierte App-Position spielt die Geometrie für die Farm keine Rolle."""
    g = _zwei_drucker()
    g["printers"][0]["device_id"] = 1
    g["printers"][0]["use_gcode"] = {o: False for o in motion.PRINTER_OPS}
    g["use_gcode"] = {"grab": True}          # Regal-Ops zählen hier nicht
    del g["printers"][1]
    af = _farm_with(g, monkeypatch)
    af._assert_printer_geometry(9)


# ── Der ganze Weg: Datei → Oberfläche → speichern → fahren ───────────────────
def test_speichern_und_wieder_laden_aendert_nichts(tmp_path, monkeypatch):
    """Der Rundlauf, den die Oberfläche jedes Mal macht: laden, (unverändert)
    zurückschreiben, wieder laden. Verschöbe der eine Millimeter, würde sich die
    Anlage bei jedem Öffnen des Tabs ein Stück weiterschieben."""
    pytest.importorskip("fastapi")
    from app.routers import control
    from app.services import storage

    path = str(tmp_path / "geometry.json")
    storage.write_json(path, ALT)                 # Bestandsdatei in der ALTEN Form
    monkeypatch.setattr(control, "GEOMETRY_PATH", path)
    monkeypatch.setattr(control, "_rack_config",
                        lambda: {"num_racks": 3, "slots_per_rack": 6, "magazine_slot": 7})

    erst = control._load_geometry()
    assert erst["printers"][0]["eject"]["x"] == 942
    assert [erst["rack_geo"][str(r)]["x"] for r in (1, 2, 3)] == [543, 291.5, 32]

    # Was die Oberfläche zurückschickt, ist genau das Gelesene.
    storage.write_json(path, motion.merge_defaults(erst))
    zweit = control._load_geometry()
    assert zweit["printers"] == erst["printers"]
    assert zweit["rack_geo"] == erst["rack_geo"]
    assert _gcode(zweit) == _gcode(motion.merge_defaults(ALT))


def test_zweiter_drucker_ueberlebt_das_speichern(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from app.routers import control
    from app.services import storage

    path = str(tmp_path / "geometry.json")
    storage.write_json(path, ALT)
    monkeypatch.setattr(control, "GEOMETRY_PATH", path)
    monkeypatch.setattr(control, "_rack_config",
                        lambda: {"num_racks": 3, "slots_per_rack": 6, "magazine_slot": 7})

    g = control._load_geometry()
    g["printers"].append({**g["printers"][0], "id": "printer-2", "name": "P1S",
                          "device_id": 5, "eject": {"x": 542, "y": 300, "z": 15},
                          "load": {"x": 542, "y": 300, "z": 15}, "move": None,
                          "door": None, "use_gcode": {}, "gcode_override": {},
                          "speed_factors": {}})
    g["rack_geo"]["3"]["printer"] = "printer-2"
    storage.write_json(path, motion.merge_defaults(g))

    wieder = control._load_geometry()
    assert [p["id"] for p in wieder["printers"]] == ["printer-1", "printer-2"]
    assert wieder["printers"][1]["device_id"] == 5
    assert motion.racks_of_printer(wieder, "printer-2") == [3]
    assert "X542" in motion.build_op(wieder, "eject", printer="printer-2", check=False)
    assert "X942" in motion.build_op(wieder, "eject", printer="printer-1", check=False)
