"""Drucker frei und Druckbett leer, bevor der Arm einfährt (seit v1.1.45).

Bis v1.1.44 fuhr die Farm blind: Nach „Verbindung verloren → überspringen" startete
der nächste Job in den laufenden Druck, nach einem übersprungenen oder
fehlgeschlagenen Job legte sie die neue Platte auf die alte. Der Macro-Weg buchte
Auswerfen und Einlegen gar nicht, also wusste niemand, was auf dem Bett liegt.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.services import farm_settings, printer_guard  # noqa: E402

# Echte Form der MQTT-Daten (Ausschnitt eines X1C-Reports)
LAEUFT = {"print": {"gcode_state": "RUNNING", "mc_percent": 3, "mc_remaining_time": 95}}


class Drucker:
    id, name = 2, "X1C"
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"


def _job(**kw):
    return af.JobIn(id=7, fileId=3, fileName="teil.3mf", slot="2-3", **kw).model_dump()


@pytest.fixture
def farm(monkeypatch, tmp_path):
    """Farm im Lauf, alles Bewegende mitgeschrieben, Drucker per Zustand steuerbar."""
    lage = {"state": "FINISH", "macros": [], "pushes": []}

    async def do_macro(script, *a, **kw):
        lage["macros"].append(script)

    async def notify(msg):
        lage["pushes"].append(msg)
    monkeypatch.setattr(af, "_do_macro", do_macro)
    monkeypatch.setattr(af, "_notify", notify)
    monkeypatch.setattr(printer_guard, "live_state", lambda device, **kw: lage["state"])
    monkeypatch.setattr(af, "GATE_GRACE_S", 0.0)
    monkeypatch.setattr(af, "STATE_PATH", str(tmp_path / "farm_state.json"))
    monkeypatch.setattr(af, "_rack_update", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_decrement_magazine", lambda *a, **kw: None)
    monkeypatch.setattr(af, "_magazine_gate", _magazin_voll)
    monkeypatch.setattr(af._motion, "build_op", lambda g, op, **kw: f"OP:{op}")
    # Echte Datenform: Vorgabe-Geometrie (merge_defaults), kein leeres dict.
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: af._motion.merge_defaults(None))
    monkeypatch.setattr(af, "_farm_printer", lambda g=None: None)
    for key, val in {"running": True, "paused": False, "stopping": False, "bed": "empty",
                     "arm": dict(af._ARM_EMPTY), "log": [], "error": None,
                     "_in_first_start": False, "geometry": af._motion.merge_defaults(None)}.items():
        monkeypatch.setitem(af._farm, key, val)
    return lage


async def _magazin_voll():
    return ("1", "7")


def _step(kind, value):
    return {"type": kind, "value": value, "label": value}


def _run(step, job=None):
    return asyncio.run(af._exec_step(step, job or _job(), Drucker(), True, 20, 0, []))


# ── Buchung: beide Wege, Geräte-Macro und Printloom-Op ────────────────────────

@pytest.mark.parametrize("step", [_step("macro", "LOAD_ONTO_BAMBULAB_X_ONE_C"), _step("app_op", "place")])
def test_einlegen_bucht_greifer_und_bett(step, farm):
    af._farm["arm"] = {"holding": "empty", "from": "1-7", "job_id": 7}
    _run(step)
    assert af._farm["arm"]["holding"] == "none"
    assert af._farm["bed"] == "plate"


@pytest.mark.parametrize("step", [_step("macro", "EJECT_FROM_BAMBULAB_X_ONE_C"), _step("app_op", "eject")])
def test_auswerfen_bucht_greifer_und_bett(step, farm):
    af._farm["bed"] = "printed"
    _run(step)
    assert af._farm["arm"]["holding"] == "printed"
    assert af._farm["bed"] == "empty"


# ── Tore ──────────────────────────────────────────────────────────────────────

async def _mit_fortsetzen(coro, bedingung, nachher=None):
    """Läuft coro, bis die Farm pausiert; dann (optional nachher()) fortsetzen."""
    task = asyncio.ensure_future(coro)
    for _ in range(200):
        await asyncio.sleep(0.01)
        if bedingung():
            break
    assert bedingung(), "Farm hat nicht pausiert"
    if nachher:
        nachher()
    af._farm["paused"] = False
    await asyncio.wait_for(task, 5)


def test_einlegen_bei_laufendem_druck_pausiert(farm):
    farm["state"] = "RUNNING"

    def drucker_fertig():
        assert farm["macros"] == []          # nichts gefahren, solange er druckt
        farm["state"] = "FINISH"
    asyncio.run(_mit_fortsetzen(af._exec_step(_step("app_op", "place"), _job(), Drucker(), True, 20, 0, []),
                                lambda: af._farm["paused"], drucker_fertig))
    assert farm["macros"] == ["OP:place"]
    assert "belegt" in farm["pushes"][0]


def test_platte_vom_vorjob_haelt_das_einlegen_an(farm):
    # Vorjob übersprungen: Druck gestartet, nie ausgeworfen.
    af._farm["bed"] = "printing"
    asyncio.run(_mit_fortsetzen(af._exec_step(_step("app_op", "place"), _job(), Drucker(), True, 20, 0, []),
                                lambda: af._farm["paused"],
                                lambda: farm["macros"] == [] or pytest.fail("trotz Platte gefahren")))
    assert farm["macros"] == ["OP:place"]
    assert af._farm["bed"] == "plate"
    assert any("Druckbett" in z for z in af._farm["log"])


def test_unbekannter_druckerzustand_pausiert(farm):
    farm["state"] = None
    asyncio.run(_mit_fortsetzen(af._exec_step(_step("app_op", "eject"), _job(), Drucker(), True, 20, 0, []),
                                lambda: af._farm["paused"], lambda: farm.update(state="FINISH")))
    assert farm["macros"] == ["OP:eject"]


def test_greifen_mit_voller_hand_pausiert(farm):
    af._farm["arm"] = {"holding": "printed", "from": "", "job_id": 6}
    asyncio.run(_mit_fortsetzen(af._exec_step(_step("app_op", "grab_magazine"), _job(), Drucker(), True, 20, 0, []),
                                lambda: af._farm["paused"],
                                lambda: farm["macros"] == [] or pytest.fail("trotz voller Hand gegriffen")))
    assert farm["macros"] == ["OP:grab_magazine"]
    assert af._farm["arm"]["holding"] == "empty"


def test_stopp_waehrend_des_tors_faehrt_nicht(farm):
    farm["state"] = "RUNNING"

    async def lauf():
        task = asyncio.ensure_future(af._exec_step(_step("app_op", "place"), _job(), Drucker(), True, 20, 0, []))
        await asyncio.sleep(0.05)
        af._farm["stopping"] = True
        with pytest.raises(RuntimeError, match="Gestoppt"):
            await asyncio.wait_for(task, 5)
    asyncio.run(lauf())
    assert farm["macros"] == []


def test_kurzer_zwischenzustand_pausiert_nicht(farm, monkeypatch):
    """Nach einer Bett-Fahrt meldet der Drucker kurz RUNNING; das Tor wartet erst."""
    monkeypatch.setattr(af, "GATE_GRACE_S", 30.0)
    zustaende = iter(["RUNNING", "RUNNING", "FINISH"])
    monkeypatch.setattr(printer_guard, "live_state", lambda device, **kw: next(zustaende))

    async def schnell(_):
        return None
    monkeypatch.setattr(af.asyncio, "sleep", schnell)
    _run(_step("app_op", "eject"))
    assert af._farm["paused"] is False
    assert farm["macros"] == ["OP:eject"]


def test_homing_datei_geht_nicht_in_einen_laufenden_druck(farm, monkeypatch):
    farm["state"] = "RUNNING"
    hochgeladen = []

    class FTP:
        def __init__(self, *a):
            pass

        def upload_file(self, *a):
            hochgeladen.append(a)
            return True
    monkeypatch.setattr(af, "BambuFTP", FTP)

    async def lauf():
        task = asyncio.ensure_future(af._start_homing_print(Drucker()))
        await asyncio.sleep(0.05)
        assert af._farm["paused"] is True
        af._farm["stopping"] = True
        with pytest.raises(RuntimeError, match="Gestoppt"):
            await asyncio.wait_for(task, 5)
    asyncio.run(lauf())
    assert hochgeladen == []


def test_start_bei_laufendem_druck_wird_abgelehnt(monkeypatch):
    monkeypatch.setattr(printer_guard, "live_state", lambda device, **kw: "RUNNING")

    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return Drucker()

    class DB:
        def query(self, *a):
            return Q()

        def expunge(self, _):
            pass

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    with pytest.raises(HTTPException) as e:
        asyncio.run(af._assert_printer_idle_for_start(2))
    assert e.value.status_code == 409
    assert "laufenden Druck" in e.value.detail


# ── Fehlerstrategie ───────────────────────────────────────────────────────────

def test_verbindung_verloren_ueberspringen_wird_zur_pause(monkeypatch):
    monkeypatch.setitem(af._farm, "error_strategy", {"connection_lost": "skip"})
    monkeypatch.setitem(af._farm, "log", [])
    af._farm.pop("_conn_skip_logged", None)
    assert af._estrat("connection_lost") == "pause"
    assert af._estrat("connection_lost") == "pause"
    assert sum("gibt es nicht mehr" in z for z in af._farm["log"]) == 1


def test_vorgaben_aus_einer_quelle():
    assert af._ERROR_DEFAULTS is farm_settings.ERROR_DEFAULTS
    assert farm_settings.ERROR_DEFAULTS["connection_lost"] == "pause"
    assert farm_settings.DEFAULTS["failed_retries"] == 0
    s = asyncio.run(af.get_settings())
    assert s["error_strategy_defaults"] == farm_settings.ERROR_DEFAULTS


def test_jeder_endpunkt_ist_eine_oeffentliche_funktion():
    """Ein Helfer zwischen @router.post und der Funktion macht IHN zum Endpunkt
    (beim Bau von v1.1.45 passiert, vom Test gefunden)."""
    from app.main import app
    for route in app.routes:
        ep = getattr(route, "endpoint", None)
        if ep is not None and getattr(route, "path", "").startswith("/api/"):
            assert not ep.__name__.startswith("_"), f"{route.path} → {ep.__name__}"


# ── Nachträge aus der Prüfung von v1.1.43/44 ──────────────────────────────────

def test_notaus_waehrend_des_uploads_startet_keinen_druck(farm, monkeypatch):
    """halt_all setzt nur „stopping"; der Upload lief zu Ende, und bis v1.1.44 ging
    danach trotzdem der Druckstart raus (Bett homet, Arm evtl. im Bauraum)."""
    gestartet = []

    class FTP:
        def __init__(self, *a):
            pass

        def upload_file(self, *a):
            # Während des Uploads kommt der Notaus.
            monkeypatch.setattr(af, "_notaus_aktiv", lambda: True)
            return True

    async def schnell(_):
        return None
    monkeypatch.setattr(af, "BambuFTP", FTP)
    monkeypatch.setattr(af, "_notaus_aktiv", lambda: False)
    monkeypatch.setattr(af.bambu_manager, "ensure", lambda d, **kw: True)
    monkeypatch.setattr(af.bambu_manager, "start_print", lambda *a, **kw: gestartet.append(a) or True)
    monkeypatch.setattr(af.asyncio, "sleep", schnell)
    with pytest.raises(RuntimeError, match="Gestoppt"):
        asyncio.run(af._start_homing_print(Drucker()))
    assert gestartet == []


def test_start_waehrend_einer_handfahrt_wird_abgelehnt(monkeypatch):
    import httpx
    echt = httpx.AsyncClient

    def handler(request):
        assert request.url.path == "/printer/objects/query"
        return httpx.Response(200, json={"result": {"status": {"idle_timeout": {"state": "Printing"}}}})

    class Arm:
        ip_address, port = "10.0.0.6", 7125

    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return Arm()

    class DB:
        def query(self, *a):
            return Q()

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    monkeypatch.setattr(af.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(HTTPException) as e:
        asyncio.run(af._assert_arm_idle_for_start())
    assert e.value.status_code == 409 and "Handfahrt" in e.value.detail


def test_klipper_nicht_erreichbar_sperrt_den_start_nicht(monkeypatch):
    import httpx
    echt = httpx.AsyncClient

    def handler(request):
        raise httpx.ConnectError("weg")

    class Arm:
        ip_address, port = "10.0.0.6", 7125

    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return Arm()

    class DB:
        def query(self, *a):
            return Q()

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: DB())
    monkeypatch.setattr(af.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    asyncio.run(af._assert_arm_idle_for_start())   # kein Fehler
