"""Drucker-Befehle nur bei freiem Drucker: Bett-G-code, Kalibrierung, AMS, Direktdruck.

Bis v1.1.43 prüften diese Endpunkte höchstens den Cache-Status, und ein leerer Cache
ließ Kalibrierung und AMS durch. Ein Bett-G-code ging auch mitten in die Farm, und
nach einem Notaus fuhr das Bett weiter.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.models.models import PrinterType  # noqa: E402
from app.routers import autofarm as af  # noqa: E402
from app.routers import printer  # noqa: E402
from app.services import bambu_manager, printer_guard  # noqa: E402


class Drucker:
    id, name, device_type = 2, "X1C", PrinterType.BAMBU_LAB
    ip_address, serial_number, access_code = "10.0.0.5", "00M00A000000000", "12345678"

    def __init__(self, aktiv=True):
        self.is_active = aktiv


class FakeDB:
    def __init__(self, aktiv=True):
        self.geraete = [Drucker(aktiv)]

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


@pytest.fixture
def lage(monkeypatch):
    zustand = {"state": "FINISH"}

    def boom(*a, **kw):
        raise AssertionError("Befehl ging trotz Sperre an den Drucker")
    for name in ("send_gcode", "publish_command", "start_print"):
        monkeypatch.setattr(bambu_manager, name, boom)
    monkeypatch.setattr(printer_guard, "live_state", lambda device, **kw: zustand["state"])
    monkeypatch.setitem(af._farm, "running", False)
    monkeypatch.setitem(af._farm, "paused", False)
    monkeypatch.setitem(af._stress, "running", False)
    monkeypatch.setattr(af, "_stress_task", None)
    return zustand


BEFEHLE = [
    ("bett-gcode", lambda db: printer.send_gcode(2, "G28", db=db)),
    ("kalibrierung", lambda db: printer.calibrate_printer(2, {}, db=db)),
    ("ams-laden", lambda db: printer.ams_load_filament(2, {"tray": 0}, db=db)),
    ("ams-entladen", lambda db: printer.ams_unload_filament(2, db=db)),
    ("direktdruck", lambda db: printer.send_file_to_printer(2, 1, db=db)),
]
IDS = [n for n, _ in BEFEHLE]


def _abgelehnt(coro, wort):
    with pytest.raises(HTTPException) as e:
        asyncio.run(coro)
    assert e.value.status_code == 409, e.value.detail
    assert wort in e.value.detail


@pytest.mark.parametrize("name,aufruf", BEFEHLE, ids=IDS)
def test_nach_notaus(name, aufruf, lage):
    _abgelehnt(aufruf(FakeDB(aktiv=False)), "Notaus")


@pytest.mark.parametrize("name,aufruf", BEFEHLE, ids=IDS)
@pytest.mark.parametrize("pausiert", [False, True])
def test_bei_laufender_farm_auch_pausiert(name, aufruf, pausiert, lage, monkeypatch):
    monkeypatch.setitem(af._farm, "running", True)
    monkeypatch.setitem(af._farm, "paused", pausiert)
    _abgelehnt(aufruf(FakeDB()), "Auto Farm")


@pytest.mark.parametrize("name,aufruf", BEFEHLE, ids=IDS)
def test_drucker_druckt(name, aufruf, lage):
    lage["state"] = "RUNNING"
    _abgelehnt(aufruf(FakeDB()), "belegt")


@pytest.mark.parametrize("name,aufruf", BEFEHLE, ids=IDS)
def test_zustand_unbekannt(name, aufruf, lage):
    lage["state"] = None
    _abgelehnt(aufruf(FakeDB()), "unbekannt")


def test_filamentwechsel_in_der_pause_ist_erlaubt(lage, monkeypatch):
    lage["state"] = "PAUSE"
    gesendet = []
    monkeypatch.setattr(bambu_manager, "publish_command", lambda d, cmd: gesendet.append(cmd) or True)
    monkeypatch.setattr(bambu_manager, "last_status", lambda d: {})
    r = asyncio.run(printer.ams_unload_filament(2, db=FakeDB()))
    assert r["success"] and gesendet[0]["print"]["command"] == "unload_filament"


def test_kalibrierung_in_der_pause_nicht(lage):
    lage["state"] = "PAUSE"
    _abgelehnt(printer.calibrate_printer(2, {}, db=FakeDB()), "belegt")
