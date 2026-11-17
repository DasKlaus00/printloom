"""Moonraker-Ablehnungen als ein Satz (seit v1.1.66).

Bis v1.1.65 stand die ganze JSON-Antwort von Moonraker in der Meldung, und ein nicht
freigegebenes Makro bekam eine lange englische Liste aller Makros.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import control  # noqa: E402
from app.schemas.schemas import MacroExecutionRequest  # noqa: E402


def _antwort(status, body):
    return httpx.Response(status, json=body, request=httpx.Request("POST", "http://k/printer/gcode/script"))


def test_ablehnung_ist_ein_satz():
    r = _antwort(400, {"error": {"code": 400, "message": 'Unknown command: "FOO"'}})
    assert control._moonraker_reason(r) == 'Unknown command: "FOO"'


def test_lange_antwort_wird_gekuerzt():
    r = httpx.Response(500, text="x" * 500, request=httpx.Request("GET", "http://k/"))
    assert len(control._moonraker_reason(r)) == 198


def test_skript_ablehnung_ohne_json_klammern(monkeypatch):
    class Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None):
            return _antwort(400, {"error": {"code": 400, "message": 'Unknown command: "FOO"'}})
    monkeypatch.setattr(control.httpx, "AsyncClient", Client)
    with pytest.raises(HTTPException) as e:
        asyncio.run(control._fire_moonraker_script("http://k/printer/gcode/script", "FOO"))
    assert e.value.detail == 'Moonraker: Unknown command: "FOO"'


def test_nicht_freigegebenes_makro_ohne_liste():
    with pytest.raises(HTTPException) as e:
        asyncio.run(control.execute_macro(MacroExecutionRequest(macro_name="GRAB_FROM_SLOT_7"), None))
    assert e.value.status_code == 400
    assert "nicht freigegeben" in e.value.detail and "Valid macros" not in e.value.detail


# ── AMS-Klima aus dem Drucker-Report (seit v1.1.66) ─────────────────────────────

def test_ams_feuchte_roh_und_fehlend_ist_none():
    from app.routers import printer
    # Echte Form eines X1C-Reports (Strings), gekürzt
    raw = {"print": {"gcode_state": "IDLE", "ams": {"ams": [
        {"id": "0", "humidity": "4", "humidity_raw": "37", "temp": "24.1", "tray": []}]}}}
    unit = printer._status_from_raw(raw)["ams_units"][0]
    assert (unit["humidity"], unit["humidity_raw"], unit["temp"]) == ("4", "37", "24.1")
    ohne = printer._status_from_raw({"print": {"gcode_state": "IDLE", "ams": {"ams": [{"id": "0", "tray": []}]}}})
    assert ohne["ams_units"][0]["temp"] is None and ohne["ams_units"][0]["humidity_raw"] is None
