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
