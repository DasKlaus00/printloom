"""Greifer und Druckbett während Fahrten und beim Druckstart (seit v1.1.55).

Aus dem Review von Schritt 4–9:
- Ein Upload, der während Stopp/Notaus fertig wurde, startete trotzdem den Druck.
- Die Farm buchte das Bett nach dem Druckstart nie als „Druck".
- Bricht eine Arm-Fahrt ab, stand im Merker noch der alte Stand (z. B. „leer").
- Ein Tor außerhalb der Farm (Stresstest) wartete endlos auf ein „Fortsetzen".
- Der Stresstest-Umweg buchte das Bett nicht; der Start prüfte weder Platte noch Drucker.
- Eine kaputte Datei vor einem Schritt ließ den ganzen Job neu beginnen.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.services import storage  # noqa: E402


class Drucker:
    id, name = 2, "X1C"
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"


class Datei:
    # Form eines echten UploadedFile-Eintrags (nur die gelesenen Felder)
    id = 3
    original_filename = "teil.3mf"
    file_path = "/daten/teil.3mf"
    file_type = ".3mf"


def _job(**kw):
    return af.JobIn(id=7, fileId=3, fileName="teil.3mf", slot="2-3", **kw).model_dump()


@pytest.fixture(autouse=True)
def stand(monkeypatch, tmp_path):
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af, "_persist_state", lambda: None)
    monkeypatch.setattr(af, "_notaus_aktiv", lambda: False)

    async def nichts(*a, **kw):
        return None
    monkeypatch.setattr(af, "_notify", nichts)
    for key, val in {"running": False, "paused": False, "stopping": False, "log": [],
                     "error": None, "bed": "empty",
                     "arm": {"holding": "none", "from": "", "job_id": None}}.items():
        monkeypatch.setitem(af._farm, key, val)
    real_sleep = asyncio.sleep

    async def schnell(_=0):
        await real_sleep(0)
    monkeypatch.setattr(af.asyncio, "sleep", schnell)


# ── Druckstart ────────────────────────────────────────────────────────────────

@pytest.fixture
def senden(monkeypatch):
    lage = {"gestartet": [], "beim_upload": None}

    class DB:
        def query(self, *a):
            class Q:
                def filter(self, *a, **kw):
                    return self

                def first(self):
                    return Datei()
            return Q()

        def close(self):
            pass

    class FTP:
        def __init__(self, ip, code):
            pass

        def upload_file(self, path, name):
            if lage["beim_upload"]:
                lage["beim_upload"]()
            return True

    async def frei(*a, **kw):
        return None

    def start_print(device, name, **kw):
        lage["gestartet"].append(name)
        return True
    monkeypatch.setattr(af, "SessionLocal", DB)
    monkeypatch.setattr(af, "BambuFTP", FTP)
    monkeypatch.setattr(af, "_printer_gate", frei)
    monkeypatch.setattr(af.ams_match, "file_map", lambda fid: "")
    monkeypatch.setattr(af.bambu_manager, "ensure", lambda d, **kw: True)
    monkeypatch.setattr(af.bambu_manager, "start_print", start_print)
    monkeypatch.setattr(af.print_file, "upload_plan",
                        lambda p, t, plate: (p, None, "Metadata/plate_1.gcode", ""))
    monkeypatch.setitem(af._farm, "running", True)
    return lage


def test_druckstart_bucht_das_bett(senden):
    asyncio.run(af._do_send_file(_job(), Drucker(), False))
    assert len(senden["gestartet"]) == 1
    assert af._farm["bed"] == "printing"


def test_stopp_waehrend_des_uploads_startet_keinen_druck(senden):
    senden["beim_upload"] = lambda: af._farm.__setitem__("stopping", True)
    with pytest.raises(RuntimeError, match="Gestoppt"):
        asyncio.run(af._do_send_file(_job(), Drucker(), False))
    assert senden["gestartet"] == []
    assert af._farm["bed"] == "empty"


def test_notaus_waehrend_des_uploads_startet_keinen_druck(senden, monkeypatch):
    notaus = {"an": False}
    monkeypatch.setattr(af, "_notaus_aktiv", lambda: notaus["an"])
    senden["beim_upload"] = lambda: notaus.__setitem__("an", True)
    with pytest.raises(RuntimeError, match="Gestoppt"):
        asyncio.run(af._do_send_file(_job(), Drucker(), False))
    assert senden["gestartet"] == []


# ── Tore außerhalb der Farm ───────────────────────────────────────────────────

def test_tor_ausserhalb_der_farm_meldet_statt_endlos_zu_warten():
    af._farm["arm"] = {"holding": "empty", "from": "1-7", "job_id": None}
    with pytest.raises(RuntimeError, match="Greifer"):
        asyncio.run(asyncio.wait_for(af._gripper_gate("Platte holen"), 2))
    assert af._farm["paused"] is False


def test_tor_in_der_farm_pausiert_weiter(monkeypatch):
    af._farm["running"] = True
    af._farm["arm"] = {"holding": "empty", "from": "1-7", "job_id": None}

    async def lauf():
        task = asyncio.ensure_future(af._gripper_gate("Platte holen"))
        for _ in range(20):
            await asyncio.sleep(0)
        assert af._farm["paused"] is True
        af._farm["paused"] = False          # Nutzer: abgenommen, fortsetzen
        await asyncio.wait_for(task, 2)
    asyncio.run(lauf())
    assert af._farm["arm"]["holding"] == "none"


# ── Arm-Fahrten: unterwegs „unbekannt" ───────────────────────────────────────

@pytest.mark.parametrize("op", ["grab", "grab_magazine", "store", "eject"])
def test_vor_der_fahrt_ist_der_greifer_unbekannt(op):
    af._farm["arm"] = {"holding": "empty", "from": "1-7", "job_id": 7}
    af._mark_in_motion(op)
    assert af._farm["arm"] == {"holding": "unknown", "from": "1-7", "job_id": 7}


def test_beim_einlegen_gilt_das_bett_sofort_als_belegt():
    af._mark_in_motion("place")
    assert af._farm["bed"] == "plate"
    assert af._farm["arm"]["holding"] == "unknown"


@pytest.mark.parametrize("op", ["open_door", "close_door", "move_to_printer", "park", None])
def test_fahrten_ohne_platte_lassen_den_merker(op):
    af._farm["arm"] = {"holding": "empty", "from": "1-7", "job_id": 7}
    af._mark_in_motion(op)
    assert af._farm["arm"]["holding"] == "empty"
    assert af._farm["bed"] == "empty"


# ── Stresstest ────────────────────────────────────────────────────────────────

MOVES = [{"from": "1-7", "to": "2-3", "from_rack": 1, "from_slot": 7,
          "to_rack": 2, "to_slot": 3, "from_magazine": True}]


@pytest.fixture
def stress(monkeypatch):
    lage = {"fehler_bei": None}

    async def do_macro(op, *a, **kw):
        if op == lage["fehler_bei"]:
            raise RuntimeError(f"Klipper: {op} fehlgeschlagen")

    async def nichts(*a, **kw):
        return None
    monkeypatch.setattr(af, "_do_macro", do_macro)
    monkeypatch.setattr(af, "_start_homing_print", nichts)
    monkeypatch.setattr(af, "_wait_bambu_finish", nichts)
    monkeypatch.setattr(af._motion, "build_op", lambda g, op, **kw: op)
    monkeypatch.setattr(af, "_magazine_take", lambda r: None)
    monkeypatch.setattr(af, "_rack_update", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_magazine_slot_cfg", lambda: 7)
    monkeypatch.setattr(af._stress_service, "has_door", lambda g, p=None: False)
    monkeypatch.setattr(af._stress_service, "printer_ops", lambda g, p=None: ("place", "eject"))
    monkeypatch.setattr(af, "_stress_geometry", lambda: {})
    monkeypatch.setattr(af, "_farm_printer", lambda g=None: None)
    monkeypatch.setitem(af._stress, "running", False)
    return lage


def test_stresstest_umweg_endet_mit_leerem_bett(stress):
    asyncio.run(af._run_stress_test(MOVES, True, Drucker()))
    assert af._farm["bed"] == "empty"
    assert af._farm["arm"]["holding"] == "none"


def test_stresstest_abbruch_beim_herunternehmen_laesst_platte_im_drucker(stress):
    stress["fehler_bei"] = "eject"
    asyncio.run(af._run_stress_test(MOVES, True, Drucker()))
    assert af._farm["bed"] == "plate"
    assert af._farm["arm"]["holding"] == "unknown"
    assert af._plate_left()


def test_stresstest_abbruch_beim_einlagern_greifer_unbekannt(stress):
    stress["fehler_bei"] = "store"
    asyncio.run(af._run_stress_test(MOVES, False, None))
    assert af._farm["arm"]["holding"] == "unknown"


def test_stresstest_start_mit_platte_im_drucker_wird_abgelehnt(monkeypatch):
    async def frei():
        return None
    monkeypatch.setattr(af, "_assert_released", lambda: None)
    monkeypatch.setattr(af, "_assert_arm_idle_for_start", frei)
    monkeypatch.setattr(af, "_load_recovery", lambda: {"bed": "plate"})
    monkeypatch.setitem(af._stress, "running", False)
    af._farm["bed"] = "plate"
    with pytest.raises(HTTPException) as e:
        asyncio.run(af.start_stress_test(af.StressStartBody()))
    assert e.value.status_code == 409
    assert "Platte" in e.value.detail


def test_stresstest_start_prueft_den_drucker(monkeypatch):
    async def frei():
        return None
    gefragt = []

    async def drucker_frei(bambu_id):
        gefragt.append(bambu_id)
        raise HTTPException(409, "Drucker druckt gerade")
    monkeypatch.setattr(af, "_assert_released", lambda: None)
    monkeypatch.setattr(af, "_assert_arm_idle_for_start", frei)
    monkeypatch.setattr(af, "_stress_bambu", lambda did: Drucker())
    monkeypatch.setattr(af, "_assert_printer_idle_for_start", drucker_frei)
    monkeypatch.setitem(af._stress, "running", False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(af.start_stress_test(af.StressStartBody(include_printer=True, device_id=2)))
    assert e.value.status_code == 409
    assert gefragt == [2]


# ── Kaputte Datei vor einem Schritt ──────────────────────────────────────────

def test_kaputte_geometrie_haelt_an_und_wiederholt_nur_diesen_schritt(monkeypatch):
    af._farm["running"] = True
    lauf = {"ladungen": 0, "schritte": []}

    def geometrie():
        lauf["ladungen"] += 1
        if lauf["ladungen"] == 1:
            raise storage.BrokenFile("printer_geometry.json", "kein JSON")
        return {}

    async def schritt(step, *a, **kw):
        lauf["schritte"].append(step["label"])
    monkeypatch.setattr(af, "_load_farm_geometry", geometrie)
    monkeypatch.setattr(af, "_refresh_live_settings", lambda: None)
    monkeypatch.setattr(af, "_run_step_checked", schritt)

    async def ablauf():
        task = asyncio.ensure_future(af._exec_sequence(
            [{"type": "macro", "value": "PARK_OTTOEJECT", "label": "Parken"}],
            _job(), Drucker(), False, 1, 0, []))
        for _ in range(20):
            await asyncio.sleep(0)
        assert af._farm["paused"] is True
        assert "Datenspeicher" in af._farm["error"]
        assert lauf["schritte"] == []           # vor der Pause nichts bewegt
        af._farm["paused"] = False
        await asyncio.wait_for(task, 2)
    asyncio.run(ablauf())
    assert lauf["schritte"] == ["Parken"]       # genau einmal, nach dem Fortsetzen
    assert af._farm["error"] is None
