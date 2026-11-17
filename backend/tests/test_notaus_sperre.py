"""Notaus-Sperre: Nach einem Notaus bewegt sich nichts, bis „Betrieb fortsetzen".

Bis v1.1.34 beachtete nur der Makro-Knopf einen ausgelösten Notaus. Joggen,
G-code, die Bewegungen aus dem Drucker-Tab, der Farm-Start, der Stresstest und der
Direktdruck liefen trotzdem los — nach M112 scheiterten sie zwar an Klipper, aber
mit dessen Fehlermeldung; und hatte Klipper den Notaus gar nicht bestätigt (nicht
erreichbar), wäre die Bewegung durchgegangen.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.routers import control, printer  # noqa: E402
from app.schemas.schemas import MacroExecutionRequest  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402


class Geraet:
    device_type = None
    ip_address = "127.0.0.1"
    port = 7125
    name = "OTTOeject"

    def __init__(self, aktiv):
        self.is_active = aktiv


class FakeDB:
    def __init__(self, aktiv=False):
        self.geraete = [Geraet(aktiv)]

    def query(self, *a):
        db = self

        class Q:
            def filter(self, *a, **kw):
                return self

            def first(self):
                return db.geraete[0]

            def all(self):
                return list(db.geraete)
        return Q()

    def close(self):
        pass


def _abgelehnt(coro):
    with pytest.raises(HTTPException) as e:
        asyncio.run(coro)
    assert e.value.status_code == 409
    assert "Notaus" in e.value.detail


@pytest.fixture(autouse=True)
def nichts_senden(monkeypatch):
    """Rutscht etwas durch, darf es trotzdem nirgends ankommen."""
    async def boom(*a, **kw):
        raise AssertionError("trotz Notaus gesendet")
    monkeypatch.setattr(control, "_fire_moonraker_script", boom)
    monkeypatch.setattr(control, "_load_geometry", lambda: motion.merge_defaults(None))
    monkeypatch.setattr(control, "_rack_config", lambda: None)


def test_joggen(nichts_senden):
    _abgelehnt(control.jog_ottoeject({"axis": "x", "delta": 1}, FakeDB()))


def test_gcode(nichts_senden):
    _abgelehnt(control.send_klipper_gcode({"gcode": "G28"}, FakeDB()))


def test_bewegung_aus_dem_drucker_tab(nichts_senden):
    _abgelehnt(control.run_ottoeject_op({"op": "park"}, FakeDB()))


def test_geraete_makro(nichts_senden):
    _abgelehnt(control.execute_macro(MacroExecutionRequest(macro_name="OTTOEJECT_HOME"), FakeDB()))


def test_direktdruck(nichts_senden):
    _abgelehnt(printer.send_file_to_printer(1, 1, db=FakeDB()))


def test_farm_start(monkeypatch):
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB())
    _abgelehnt(af.start_farm(af.StartRequest(bambu_id=1, jobs=[])))
    assert af._farm["running"] is False


def test_stresstest(monkeypatch):
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB())
    _abgelehnt(af.start_stress_test(af.StressStartBody()))
    assert af._stress["running"] is False


def test_nach_dem_fortsetzen_geht_es_wieder(monkeypatch):
    gesendet = []

    async def merken(url, script):
        gesendet.append(script)
        return False
    monkeypatch.setattr(control, "_fire_moonraker_script", merken)
    asyncio.run(control.send_klipper_gcode({"gcode": "G28"}, FakeDB(aktiv=True)))
    assert gesendet and "G28" in gesendet[0]


def test_lesen_bleibt_moeglich():
    """Position ansehen, Geometrie prüfen — das bewegt nichts und darf weiter gehen."""
    assert control._klipper(FakeDB(aktiv=False)).name == "OTTOeject"


# ── Abschluss-Bewegungen nach dem Notaus (seit v1.1.43) ──────────────────────────
# Farm und Stresstest räumen im finally auf (parken, Tür schließen). Bis v1.1.42
# fuhr dieses Aufräumen nach dem Notaus noch los, weil nur der Makro-Knopf die
# Sperre prüfte.

class _Mitschrift:
    """httpx-Attrappe: schreibt jedes Skript mit, das an Klipper ginge."""
    def __init__(self, sent):
        self.sent = sent

    def __call__(self, *a, **kw):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def post(self, url, json=None):
        self.sent.append(json["script"])

        class R:
            status_code, text = 200, ""
        return R()


@pytest.fixture
def klipper_mitschrift(monkeypatch):
    import httpx
    sent = []

    class Mod:
        AsyncClient = _Mitschrift(sent)
        ReadTimeout = httpx.ReadTimeout
        HTTPError = httpx.HTTPError
    monkeypatch.setattr(af, "httpx", Mod)
    monkeypatch.setitem(af._farm, "needs_home", False)
    return sent


def test_nach_notaus_parkt_die_farm_nicht(monkeypatch, klipper_mitschrift):
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB(aktiv=False))
    with pytest.raises(RuntimeError, match="Gestoppt"):
        asyncio.run(af._do_macro("PARK_OTTOEJECT"))
    assert klipper_mitschrift == []


def test_auch_die_referenzfahrt_wartet_auf_die_freigabe(monkeypatch, klipper_mitschrift):
    # needs_home steht nach jedem Notaus; die Sperre greift VOR der Referenzfahrt.
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB(aktiv=False))
    monkeypatch.setitem(af._farm, "needs_home", True)
    with pytest.raises(RuntimeError, match="Gestoppt"):
        asyncio.run(af._do_macro("GRAB_FROM_RACK RACK=1 SLOT=2"))
    assert klipper_mitschrift == []
    assert af._farm["needs_home"] is True


def test_ohne_notaus_geht_die_bewegung_raus(monkeypatch, klipper_mitschrift):
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB(aktiv=True))
    asyncio.run(af._do_macro("PARK_OTTOEJECT"))
    assert klipper_mitschrift and "PARK_OTTOEJECT" in klipper_mitschrift[0]


def test_unlesbarer_zustand_gilt_als_notaus(monkeypatch):
    class Kaputt:
        def query(self, *a):
            raise RuntimeError("no such table: devices")

        def close(self):
            pass
    monkeypatch.setattr(af, "SessionLocal", lambda: Kaputt())
    assert af._notaus_aktiv() is True


def test_nach_notaus_schliesst_der_stresstest_die_tuer_nicht(monkeypatch, tmp_path):
    gesendet = []

    async def do_macro(script, *a, **kw):
        gesendet.append(script)
        if script == "grab":
            raise RuntimeError("Gestoppt")
    monkeypatch.setattr(af, "_do_macro", do_macro)
    monkeypatch.setattr(af, "_notaus_aktiv", lambda: True)
    monkeypatch.setattr(af._stress_service, "has_door", lambda g, p=None: True)
    monkeypatch.setattr(af, "_stress_geometry", lambda: {})
    monkeypatch.setattr(af, "_farm_printer", lambda g=None: None)
    monkeypatch.setattr(af._motion, "build_op", lambda g, op, **kw: {"open_door": "open",
                                                                    "close_door": "close"}.get(op, "grab"))

    async def nichts(*a, **kw):
        return None
    monkeypatch.setattr(af, "_start_homing_print", nichts)
    monkeypatch.setattr(af, "_wait_bambu_finish", nichts)
    for name in ("_magazine_take", "_rack_update", "_set_arm", "_persist_state"):
        monkeypatch.setattr(af, name, lambda *a, **kw: None)
    monkeypatch.setattr(af, "_magazine_slot_cfg", lambda: 7)
    monkeypatch.setitem(af._farm, "log", [])
    moves = [{"from": "1-7", "to": "2-3", "from_rack": 1, "from_slot": 7,
              "to_rack": 2, "to_slot": 3, "from_magazine": True}]

    class Drucker:
        name = "X1C"
    asyncio.run(af._run_stress_test(moves, True, Drucker()))
    assert "open" in gesendet          # die Tür war offen …
    assert "close" not in gesendet     # … und bleibt es nach dem Notaus
    assert any("Tür bleibt offen" in z for z in af._farm["log"])
