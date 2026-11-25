"""Snapmaker U1 in der Farm (seit v1.1.87).

Die Farm spricht den Drucker über services/printer_link.py an: Bambu wie bisher (MQTT),
der U1 über Moonraker. Geprüft wird hier mit der echten Datenform der Moonraker-Antworten
(u1_status aus test_snapmaker_u1): Zustand im Farm-Format, Sicherheits-Tor, Homing,
Datei senden, Filament je Kopf und die Startprüfung (eigene Positionen, keine Bambu-Macros).
"""
import asyncio
import zipfile

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.models.models import PrinterType  # noqa: E402
from app.routers import autofarm as af  # noqa: E402
from app.services import ams_match, homing_3mf, moonraker_printer as mp  # noqa: E402
from app.services import print_file, printer_guard, printer_link, printer_models  # noqa: E402
from test_snapmaker_u1 import OBJECTS, u1_status  # noqa: E402


class U1:
    id, name, model = 31, "U1", "u1"
    device_type = PrinterType.MOONRAKER
    ip_address, port, access_code, serial_number = "192.0.2.30", 7125, "", None


class X1C:
    id, name, model = 2, "X1C", "x1c"
    device_type = PrinterType.BAMBU_LAB
    ip_address, port, access_code, serial_number = "192.0.2.5", 8883, "12345678", "00M00A000000000"


def norm(state="printing", klippy="ready", idle="Ready", **extra):
    st = u1_status(state, klippy)
    st["idle_timeout"] = {"state": idle}
    st.update(extra)
    return mp.normalize(st)


# ── Zustand im Farm-Format ──────────────────────────────────────────────────
def test_zustand_in_der_sprache_der_farm():
    p = mp.farm_print_status(norm("printing"))
    assert p["gcode_state"] == "RUNNING"
    assert (p["mc_percent"], p["mc_remaining_time"]) == (25, 60)
    assert (p["layer_num"], p["total_layer_num"]) == (42, 120)
    assert p["bed_temper"] == 60.1 and p["nozzle_temper"] == 219.8
    assert p["chamber_temper"] == 31.5                    # Fühler „cavity" am U1
    assert p["hms"] == [] and p["subtask_name"] == "halter.gcode"
    assert isinstance(p["mc_percent"], int) and isinstance(p["mc_remaining_time"], int)


@pytest.mark.parametrize("state,erwartet", [
    ("paused", "PAUSE"), ("complete", "FINISH"), ("error", "FAILED"),
    ("cancelled", "FAILED"), ("standby", "IDLE")])
def test_druckzustaende(state, erwartet):
    assert mp.farm_print_status(norm(state))["gcode_state"] == erwartet


def test_abgebrochen_ist_fuer_die_farm_gescheitert_aber_frei():
    # Die Anzeige sagt „frei" (IDLE); der Farm-Zyklus darf nicht auf ein Druckende warten,
    # das nach einem Abbruch nie kommt. Hineinfahren darf der Arm trotzdem.
    s = norm("cancelled")
    assert s["gcode_state"] == "IDLE"
    assert mp.farm_print_status(s)["gcode_state"] == "FAILED"
    assert printer_guard.busy_reason(mp.live_state_of(s)) is None


def test_arbeitet_g_code_ab_heisst_belegt():
    # G28 vom Display oder das Endskript nach dem Druck: kein Druck, aber Bewegung.
    assert mp.farm_print_status(norm("standby", idle="Printing"))["gcode_state"] == "PREPARE"
    assert mp.farm_print_status(norm("complete", idle="Printing"))["gcode_state"] == "PREPARE"
    assert printer_guard.busy_reason("PREPARE")


def test_klipper_aus_ist_fehler_im_druck_und_nicht_frei_fuer_den_arm():
    s = norm("printing", klippy="shutdown")
    assert mp.farm_print_status(s)["gcode_state"] == "FAILED"     # Druck ist tot
    assert mp.live_state_of(s) == "NOT_READY"                      # Arm bleibt draußen
    assert "nicht bereit" in printer_guard.busy_reason("NOT_READY")
    assert mp.live_state_of({"online": False}) is None


def test_unbekannte_temperatur_fehlt_statt_null():
    p = mp.farm_print_status(mp.normalize({"print_stats": {"state": "standby"},
                                           "webhooks": {"state": "ready"}}))
    assert "bed_temper" not in p and "nozzle_temper" not in p and p["mc_percent"] == 0


# ── printer_link ────────────────────────────────────────────────────────────
@pytest.fixture
def moon(monkeypatch):
    """Fake-Moonraker in der echten Antwortform; G-code und Aktionen mitgeschrieben."""
    lage = {"status": u1_status("standby"), "gcode": [], "actions": [], "fail": None}
    lage["status"]["idle_timeout"] = {"state": "Ready"}
    printer_link._moon.clear()

    def query_sync(device, timeout=5.0):
        if lage["fail"]:
            raise lage["fail"]
        return mp.pick_objects(OBJECTS), lage["status"]

    def run_gcode_sync(device, script, timeout=15.0):
        lage["gcode"].append(script)
        if lage.get("reject"):
            raise RuntimeError(lage["reject"])

    def print_action_sync(device, action):
        lage["actions"].append(action)
    monkeypatch.setattr(mp, "query_sync", query_sync)
    monkeypatch.setattr(mp, "run_gcode_sync", run_gcode_sync)
    monkeypatch.setattr(mp, "print_action_sync", print_action_sync)
    return lage


def test_printer_link_spricht_moonraker(moon):
    d = U1()
    assert printer_link.is_moonraker(d) and printer_link.is_farm_printer(d)
    assert printer_link.last_status(d) is None and not printer_link.is_connected(d)
    assert printer_link.ensure(d)
    raw = printer_link.last_status(d)
    assert raw["print"]["gcode_state"] == "IDLE"
    assert printer_link.is_connected(d) and printer_link.status_age(d) < 5
    assert printer_link.print_command(d, "stop") and moon["actions"] == ["cancel"]
    assert not printer_link.print_command(d, "calibrate")
    assert printer_link.send_gcode(d, "G28") and moon["gcode"] == ["G28"]
    moon["reject"] = "Must home axis first"
    assert printer_link.send_gcode(d, "G1 Z10") is False


def test_nicht_erreichbar_ist_unbekannt(moon):
    import httpx
    moon["fail"] = httpx.ConnectError("weg")
    d = U1()
    assert not printer_link.ensure(d)
    assert printer_guard.live_state(d) is None              # unbekannt ist nicht frei
    assert printer_guard.busy_reason(None)


def test_tor_fragt_den_u1_frisch(moon):
    d = U1()
    assert printer_guard.live_state(d) == "IDLE"
    moon["status"]["print_stats"]["state"] = "printing"
    assert printer_guard.live_state(d) == "RUNNING"
    moon["status"]["webhooks"]["state"] = "shutdown"
    assert printer_guard.live_state(d) == "NOT_READY"


def test_run_gcode_nur_fuer_moonraker():
    with pytest.raises(RuntimeError):
        printer_link.run_gcode(X1C(), "G28", 10)


# ── Filament je Kopf ────────────────────────────────────────────────────────
TOOLS = mp.normalize(u1_status())["tools"]   # T0 PLA orange, T1 PETG blau, T2 leer, T3 unbekannt


def test_filament_passt_zum_kopf():
    usage = [{"slot": 1, "type": "PLA", "color": "#FF6A00", "grams": 12.0},
             {"slot": 2, "type": "PETG", "color": "#00AAFF", "grams": 3.0}]
    assert ams_match.check_tools(usage, TOOLS) == ([], [])


def test_falsches_material_leerer_kopf_und_fehlender_kopf():
    usage = [{"slot": 1, "type": "PETG", "color": "", "grams": 1.0},
             {"slot": 3, "type": "PLA", "color": "", "grams": 1.0},
             {"slot": 5, "type": "PLA", "color": "", "grams": 1.0}]
    missing, unknown = ams_match.check_tools(usage, TOOLS)
    gruende = [m["reason"] for m in missing]
    assert gruende == ["T0 hat PLA, die Datei braucht PETG", "T2 ist leer",
                       "T4 gibt es an diesem Drucker nicht"]
    assert unknown == []


def test_unbekanntes_filament_blockiert_nicht():
    tools = [dict(TOOLS[3], filament=None, sensor=None)]
    missing, unknown = ams_match.check_tools([{"slot": 4, "type": "PLA", "color": ""}], tools)
    assert missing == [] and unknown == ["T3"]


def test_exakte_farbe_nur_auf_wunsch():
    usage = [{"slot": 1, "type": "PLA", "color": "#0000FF", "grams": 1.0}]
    assert ams_match.check_tools(usage, TOOLS) == ([], [])
    missing, _ = ams_match.check_tools(usage, TOOLS, exact_only=True)
    assert missing[0]["reason"] == "T0: keine exakte Farbe geladen"


# ── Dateien ─────────────────────────────────────────────────────────────────
ORCA_U1 = ("; HEADER_BLOCK_START\n; generated by OrcaSlicer 2.3.1\n; HEADER_BLOCK_END\n"
           "G28\nT1\nG1 X10 Y10 E1\n"
           "; filament used [g] = 0.00, 5.10\n"
           "; CONFIG_BLOCK_START\n; filament_type = PLA;PETG\n; filament_colour = #FF6A00;#00AAFF\n"
           "; printer_model = Snapmaker U1\n; printer_settings_id = Snapmaker U1 (0.4 nozzle)\n"
           "; CONFIG_BLOCK_END\n")
BAMBU_X1C = ("; HEADER_BLOCK_START\n; BambuStudio 02.00.00.00\n; printer_model = Bambu Lab X1 Carbon\n"
             "; HEADER_BLOCK_END\nM73 P0 R10\nG28\n")


def _3mf(tmp_path, name, plates):
    p = tmp_path / name
    with zipfile.ZipFile(p, "w") as z:
        z.writestr("3D/3dmodel.model", "<model/>")
        for n, gcode in plates.items():
            z.writestr(f"Metadata/plate_{n}.gcode", gcode)
    return str(p)


def test_dateiname_auf_dem_drucker():
    assert print_file.moon_print_name("Halter v2.gcode.3mf") == "Halter_v2.gcode"
    assert print_file.moon_print_name("C:\\x\\teil.gcode") == "teil.gcode"
    assert print_file.moon_print_name("") == "druck.gcode"


def test_gcode_bleibt_3mf_wird_ausgepackt(tmp_path):
    g = tmp_path / "teil.gcode"
    g.write_text(ORCA_U1, encoding="utf-8")
    assert print_file.gcode_for_moonraker(str(g), ".gcode") == (str(g), None)
    p = _3mf(tmp_path, "zwei.gcode.3mf", {1: "; eins\n", 2: ORCA_U1})
    path, tmp = print_file.gcode_for_moonraker(p, ".3mf", plate=2)
    try:
        assert path == tmp and open(tmp, encoding="utf-8").read() == ORCA_U1
    finally:
        import os
        os.remove(tmp)
    leer = _3mf(tmp_path, "projekt.3mf", {})
    with pytest.raises(ValueError, match="keinen G-code"):
        print_file.gcode_for_moonraker(leer, ".3mf")


def test_fuer_welchen_drucker_gesliced(tmp_path):
    g = tmp_path / "u1.gcode"
    g.write_text(ORCA_U1, encoding="utf-8")
    assert print_file.sliced_for(str(g), ".gcode") == "Snapmaker U1"      # steht am Dateiende
    b = _3mf(tmp_path, "x1c.gcode.3mf", {1: BAMBU_X1C})
    assert print_file.sliced_for(b, ".3mf") == "Bambu Lab X1 Carbon"      # steht im Kopf
    c = tmp_path / "cura.gcode"
    c.write_text(";FLAVOR:Marlin\nG28\n", encoding="utf-8")
    assert print_file.sliced_for(str(c), ".gcode") is None


def test_nur_fuer_den_u1_geslicter_g_code():
    assert printer_models.sliced_for_problem("u1", "Snapmaker U1 (0.4 nozzle)") is None
    assert printer_models.sliced_for_problem("u1", None) is None
    assert "Bambu Lab X1 Carbon" in printer_models.sliced_for_problem("u1", "Bambu Lab X1 Carbon")
    assert "erkennt Printloom nicht" in printer_models.sliced_for_problem("u1", "Voron 2.4 350")


def test_dateipruefung_fuer_den_u1(tmp_path):
    g = tmp_path / "u1.gcode"
    g.write_text(ORCA_U1, encoding="utf-8")
    assert af.moon_file_problem(U1(), str(g), ".gcode") is None
    assert "keinen G-code" in af.moon_file_problem(U1(), _3mf(tmp_path, "p.3mf", {}), ".3mf")
    assert "Bambu Lab X1 Carbon" in af.moon_file_problem(
        U1(), _3mf(tmp_path, "b.gcode.3mf", {1: BAMBU_X1C}), ".3mf")
    assert af.moon_file_problem(U1(), str(g), ".stl")


def test_homing_g_code_wie_beim_bambu():
    g = homing_3mf.homing_gcode_klipper()
    assert g.startswith("G90\n")                       # absolut, egal was davor lief
    assert g[len("G90\n"):] == homing_3mf._HOMING_GCODE   # eine Quelle für Z und Vorschub
    assert "G28" in g and "G1 Z200" in g


# ── Farm-Zyklus mit dem U1 ──────────────────────────────────────────────────
@pytest.fixture
def farm(monkeypatch, tmp_path, moon):
    lage = {"pushes": [], "uploads": [], "started": []}

    async def notify(msg):
        lage["pushes"].append(msg)

    async def upload(device, path, name):
        lage["uploads"].append((path, name, open(path, encoding="utf-8").read()))
        return f"sub/{name}"

    async def start_print(device, filename):
        lage["started"].append(filename)
    monkeypatch.setattr(af, "_notify", notify)
    monkeypatch.setattr(af, "GATE_GRACE_S", 0.0)
    monkeypatch.setattr(af, "_notaus_aktiv", lambda: False)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(mp, "upload", upload)
    monkeypatch.setattr(mp, "start_print", start_print)
    for key, val in {"running": True, "paused": False, "stopping": False, "bed": "empty",
                     "arm": dict(af._ARM_EMPTY), "log": [], "error": None, "jobs": []}.items():
        monkeypatch.setitem(af._farm, key, val)
    af._farm.pop("_moon_homing", None)
    lage["moon"] = moon
    return lage


class Datei:
    def __init__(self, path, ftype, name):
        self.id, self.file_path, self.file_type, self.original_filename = 3, path, ftype, name


def test_datei_senden_laedt_g_code_hoch_und_startet(farm, tmp_path):
    p = _3mf(tmp_path, "Halter.gcode.3mf", {1: ORCA_U1})
    job = {"id": 7, "fileId": 3, "fileName": "Halter.gcode.3mf", "slot": "1-1", "plate": 1}
    asyncio.run(af._do_send_file_moonraker(job, U1(), Datei(p, ".3mf", "Halter.gcode.3mf")))
    (path, name, inhalt), = farm["uploads"]
    assert name == "Halter.gcode" and inhalt == ORCA_U1
    assert farm["started"] == ["sub/Halter.gcode"] and af._farm["bed"] == "printing"
    import os
    assert not os.path.exists(path)                       # Temp-Datei wieder weg


def test_bambu_g_code_wird_am_u1_nicht_gedruckt(farm, tmp_path):
    p = _3mf(tmp_path, "x1c.gcode.3mf", {1: BAMBU_X1C})
    job = {"id": 7, "fileId": 3, "fileName": "x1c.gcode.3mf", "slot": "1-1"}
    with pytest.raises(RuntimeError, match="Bambu Lab X1 Carbon"):
        asyncio.run(af._do_send_file_moonraker(job, U1(), Datei(p, ".3mf", "x1c.gcode.3mf")))
    assert farm["uploads"] == [] and farm["started"] == []


def test_nie_in_einen_laufenden_druck(farm, tmp_path):
    farm["moon"]["status"]["print_stats"]["state"] = "printing"
    g = tmp_path / "u1.gcode"
    g.write_text(ORCA_U1, encoding="utf-8")
    af._farm["running"] = False               # außerhalb der Farm: Fehler statt Pause
    with pytest.raises(RuntimeError, match="belegt"):
        asyncio.run(af._do_send_file_moonraker({"id": 7, "fileId": 3, "fileName": "u1.gcode", "slot": "1-1"},
                                               U1(), Datei(str(g), ".gcode", "u1.gcode")))
    assert farm["uploads"] == []


def test_homing_als_g_code_und_warten_bis_fertig(farm):
    async def ablauf():
        await af._start_homing_print(U1())
        await af._wait_bambu_finish(U1(), label="Homing", timeout=30)
    asyncio.run(ablauf())
    assert farm["moon"]["gcode"] == [homing_3mf.homing_gcode_klipper()]
    assert any("Homing — Position erreicht" in z for z in af._farm["log"])


def test_homing_fehler_kommt_an(farm):
    farm["moon"]["reject"] = "Endstop z still triggered after retract"

    async def ablauf():
        await af._start_homing_print(U1())
        await af._wait_bambu_finish(U1(), label="Homing", timeout=30)
    with pytest.raises(RuntimeError, match="Endstop z"):
        asyncio.run(ablauf())


def test_falsches_filament_ueberspringt_nach_strategie(farm, tmp_path, monkeypatch):
    g = tmp_path / "petg.gcode"
    g.write_text(ORCA_U1.replace("PLA;PETG", "PETG;PETG"), encoding="utf-8")

    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return Datei(str(g), ".gcode", "petg.gcode")

    class DB:
        def query(self, *a):
            return Q()

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    monkeypatch.setitem(af._farm, "error_strategy", {"ams_unmatched": "skip"})
    # Benutzt wird nur Filament 2 (PETG) → T1 hat PETG → passt.
    job = {"id": 7, "fileId": 3, "fileName": "petg.gcode", "slot": "1-1"}
    asyncio.run(af._ensure_ams_ready(job, U1(), True))
    # Jetzt braucht die Datei an T1 PLA, geladen ist PETG → überspringen.
    g.write_text(ORCA_U1.replace("PLA;PETG", "PETG;PLA"), encoding="utf-8")
    with pytest.raises(RuntimeError, match="T1 hat PETG, die Datei braucht PLA"):
        asyncio.run(af._ensure_ams_ready(job, U1(), True))
    assert any("Filament passt nicht" in p for p in farm["pushes"])


def test_live_status_fuer_bedingungen_und_abkuehlen(farm):
    af._farm.pop("_status_cache", None)
    p = asyncio.run(af._read_live_print(U1()))
    assert p["gcode_state"] == "IDLE" and p["bed_temper"] == 60.1


# ── Start nur mit eigenen Positionen und ohne Bambu-Macros ─────────────────
def test_start_braucht_eigene_positionen_am_u1():
    geom = af._motion.merge_defaults(None)
    assert "keine eigenen Positionen" in af.moon_start_problems(geom, None, [])[0]


def test_geraete_macro_an_den_drucker_ist_am_u1_gesperrt(monkeypatch):
    geom = af._motion.merge_defaults(None)
    block = af._motion.printer_list(geom)[0]["id"]
    steps = [{"type": "macro", "value": "EJECT_FROM_PRINTER", "label": "Auswerfen"},
             {"type": "macro", "value": "GRAB_FROM_RACK RACK=1 SLOT=7"},
             {"type": "macro", "value": "PLACE_ONTO_PRINTER", "disabled": True},
             {"type": "app_op", "value": "place"}]
    monkeypatch.setattr(af._motion, "op_uses_gcode", lambda g, op, p=None: False)
    probleme = af.moon_start_problems(geom, block, steps)
    assert len(probleme) == 1 and "Auswerfen" in probleme[0] and "eject" in probleme[0]
    monkeypatch.setattr(af._motion, "op_uses_gcode", lambda g, op, p=None: True)
    assert af.moon_start_problems(geom, block, steps) == []


def test_startpruefung_nur_fuer_den_u1(monkeypatch):
    geraete = {31: U1(), 2: X1C()}

    class Q:
        def __init__(self):
            self.id = None

        def filter(self, *crit):
            for c in crit:
                v = getattr(getattr(c, "right", None), "value", None)
                if isinstance(v, int):
                    self.id = v
            return self

        def first(self):
            return geraete.get(self.id)

    class DB:
        def query(self, *a):
            return Q()

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: af._motion.merge_defaults(None))
    af._assert_moon_ready(2, {"seq_new": [], "seq_next": []})       # Bambu: unverändert
    with pytest.raises(HTTPException) as e:
        af._assert_moon_ready(31, {"seq_new": [], "seq_next": []})
    assert e.value.status_code == 400 and "U1" in e.value.detail


def test_positionen_muessen_fuer_genau_diesen_u1_bestaetigt_sein():
    geom = af._motion.merge_defaults({"printers": [
        {"id": "p-u1", "name": "U1", "device_id": 31, "eject": {"x": 100, "y": 300, "z": 20}}]})
    block = af._motion.printer_list(geom)[0]
    assert block["confirmed_for"] is None                     # neu angelegt: unbestätigt
    assert "nicht bestätigt" in af.moon_start_problems(geom, "p-u1", [], device_id=31)[0]
    geom = af._motion.merge_defaults({"printers": [dict(block, confirmed_for=31)]})
    assert af._motion.printer_list(geom)[0]["confirmed_for"] == 31   # übersteht das Speichern
    assert af.moon_start_problems(geom, "p-u1", [], device_id=31) == []
    # Bestätigt für ein anderes Gerät zählt nicht (Block hat das Gerät gewechselt).
    assert af.moon_start_problems(geom, "p-u1", [], device_id=32)


class _EinDB:
    """SessionLocal-Ersatz: jede Abfrage liefert `obj`."""
    def __init__(self, obj):
        self.obj = obj

    def query(self, *a):
        return self

    def filter(self, *a, **kw):
        return self

    def first(self):
        return self.obj

    def close(self):
        pass


def test_einreihen_lehnt_ab_was_der_u1_nicht_drucken_kann(monkeypatch, tmp_path):
    p = _3mf(tmp_path, "x1c.gcode.3mf", {1: BAMBU_X1C})
    monkeypatch.setattr(af, "SessionLocal", lambda: _EinDB(Datei(p, ".3mf", "x1c.gcode.3mf")))
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: U1())
    with pytest.raises(HTTPException) as e:
        asyncio.run(af._assert_fits_farm_printer(3, None))
    assert e.value.status_code == 400 and "Bambu Lab X1 Carbon" in e.value.detail
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: X1C())
    asyncio.run(af._assert_fits_farm_printer(3, None))          # Bambu: wie bisher


def test_oberflaeche_fragt_den_farm_drucker(monkeypatch):
    monkeypatch.setattr(af, "SessionLocal", lambda: _EinDB(None))
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: U1())
    r = asyncio.run(af.get_farm_printer())
    assert r == {"device_id": 31, "device_type": "moonraker", "name": "U1", "model": "u1"}
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: None)
    assert asyncio.run(af.get_farm_printer())["device_id"] is None
