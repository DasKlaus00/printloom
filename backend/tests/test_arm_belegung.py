"""Nur einer bewegt den Arm: Farm, Stresstest und Handfahrten schließen sich aus.

Bis v1.1.43 gingen Handfahrten (Joggen, G-code, Drucker-Tab, Geräte-Makro) an der
Arm-Sperre der Farm vorbei. Bei laufender Farm hätte ein Klick im Drucker-Tab den Arm
mitten in eine Bewegung der Farm geschickt.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import autofarm as af  # noqa: E402
from app.routers import control  # noqa: E402
from app.schemas.schemas import MacroExecutionRequest  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402


class Geraet:
    device_type = None
    ip_address, port, name = "127.0.0.1", 7125, "OTTOeject"
    is_active = True   # kein Notaus


class FakeDB:
    def query(self, *a):
        class Q:
            def filter(self, *a, **kw):
                return self

            def first(self):
                return Geraet()

            def all(self):
                return [Geraet()]
        return Q()

    def close(self):
        pass


@pytest.fixture(autouse=True)
def nichts_senden(monkeypatch):
    async def boom(*a, **kw):
        raise AssertionError("trotz belegtem Arm gesendet")
    monkeypatch.setattr(control, "_fire_moonraker_script", boom)
    monkeypatch.setattr(control, "_load_geometry", lambda: motion.merge_defaults(None))
    monkeypatch.setattr(control, "_rack_config", lambda: None)
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._farm, "paused", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)


HANDFAHRTEN = [
    ("joggen", lambda: control.jog_ottoeject({"axis": "x", "delta": 1}, FakeDB())),
    ("gcode", lambda: control.send_klipper_gcode({"gcode": "G28"}, FakeDB())),
    ("drucker-tab", lambda: control.run_ottoeject_op({"op": "park"}, FakeDB())),
    ("makro", lambda: control.execute_macro(MacroExecutionRequest(macro_name="OTTOEJECT_HOME"), FakeDB())),
]


def _abgelehnt(coro, wort):
    with pytest.raises(HTTPException) as e:
        asyncio.run(coro)
    assert e.value.status_code == 409
    assert wort in e.value.detail


@pytest.mark.parametrize("name,aufruf", HANDFAHRTEN, ids=[n for n, _ in HANDFAHRTEN])
def test_handfahrt_bei_laufender_farm_wird_abgelehnt(name, aufruf, monkeypatch):
    monkeypatch.setitem(af._farm, "running", True)
    _abgelehnt(aufruf(), "Auto Farm")


@pytest.mark.parametrize("name,aufruf", HANDFAHRTEN, ids=[n for n, _ in HANDFAHRTEN])
def test_handfahrt_bei_laufendem_stresstest_wird_abgelehnt(name, aufruf, monkeypatch):
    monkeypatch.setitem(af._stress, "running", True)
    _abgelehnt(aufruf(), "Stresstest")


def test_handfahrt_waehrend_farm_bewegung_wird_abgelehnt(monkeypatch):
    async def lauf():
        async with af.arm_access("drucker-1", "Auswerfen"):
            await control.jog_ottoeject({"axis": "x", "delta": 1}, FakeDB())
    _abgelehnt(lauf(), "OTTOeject fährt gerade")


def test_farm_start_bei_laufendem_stresstest_wird_abgelehnt(monkeypatch):
    monkeypatch.setitem(af._stress, "running", True)
    monkeypatch.setattr(af, "SessionLocal", lambda: FakeDB())
    _abgelehnt(af.start_farm(af.StartRequest(bambu_id=1, jobs=[])), "Stresstest")
    assert af._farm["running"] is False


def test_handfahrt_bei_pausierter_farm_markiert_position_unbekannt(monkeypatch):
    monkeypatch.setitem(af._farm, "running", True)
    monkeypatch.setitem(af._farm, "paused", True)
    monkeypatch.setitem(af._farm, "needs_home", False)
    monkeypatch.setattr(af, "_persist_state", lambda: None)
    gesendet = []

    async def merken(url, script):
        gesendet.append(script)
        return False
    monkeypatch.setattr(control, "_fire_moonraker_script", merken)
    monkeypatch.setitem(af._farm, "arm", {"holding": "none", "from": "", "job_id": None})
    asyncio.run(control.send_klipper_gcode({"gcode": "G28"}, FakeDB()))
    assert gesendet
    assert af._farm["needs_home"] is True
    # Ob die Hand eine Platte geholt hat, weiß niemand: Das Greif-Tor fragt nach.
    assert af._farm["arm"]["holding"] == "unknown"


def test_ohne_ablauf_ist_der_arm_frei():
    assert af.motion_owner() is None
    assert af.motion_owner(include_paused=True) is None
