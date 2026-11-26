"""Snapmaker U1 außerhalb der Farm (v1.1.89, Meldung eines Nutzers).

Mit einem U1 als einzigem Drucker stand die Kopfzeile grau („kein Drucker"), die
Farm-Kamera blieb schwarz (Live-Stream abgelehnt), die Steuerung zeigte Bambu und bot
Bambu-Macros an, und der Verbindungstest kam in jeder Sprache deutsch. Geprüft mit der
echten Antwortform von Moonraker (u1_status, Fake aus test_u1_farm).
"""
import asyncio
import itertools

import httpx
import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402
from fastapi.responses import StreamingResponse  # noqa: E402

from app.routers import autofarm as af, control, printer, system  # noqa: E402
from app.schemas.schemas import MacroExecutionRequest  # noqa: E402
from app.services import moonraker_printer as mp  # noqa: E402
from test_snapmaker_u1 import u1_status  # noqa: E402
from test_u1_farm import U1, X1C, moon  # noqa: E402,F401  (moon = Fixture)

SOI, EOI = b"\xff\xd8", b"\xff\xd9"


def jpeg(tag: bytes) -> bytes:
    return SOI + tag + EOI


class _DB:
    """SessionLocal-/get_db-Ersatz: jede Abfrage liefert `obj`."""
    def __init__(self, obj):
        self.obj = obj

    def query(self, *a):
        return self

    def filter(self, *a, **kw):
        return self

    def first(self):
        return self.obj

    def expunge(self, obj):
        pass

    def close(self):
        pass


# ── Kopfzeile: Drucker-Pille ────────────────────────────────────────────────
@pytest.fixture
def kopf(monkeypatch, moon):
    monkeypatch.setattr(system, "SessionLocal", lambda: _DB(None))
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: U1())
    return moon


def test_u1_allein_ist_in_der_kopfzeile_verbunden(kopf):
    r = asyncio.run(system._health_printer())
    assert r == {"status": "online", "detail": "U1"}


def test_u1_klipper_aus_ist_nicht_bereit(kopf):
    kopf["status"] = u1_status("standby", "shutdown")
    r = asyncio.run(system._health_printer())
    assert r["status"] == "stale" and r["detail"] == "U1: Klipper shutdown"


def test_u1_nicht_erreichbar_ist_offline(kopf):
    kopf["fail"] = httpx.ConnectError("weg")
    r = asyncio.run(system._health_printer())
    assert r == {"status": "offline", "detail": "Moonraker nicht erreichbar"}


def test_ohne_drucker_nicht_eingerichtet(monkeypatch):
    monkeypatch.setattr(system, "SessionLocal", lambda: _DB(None))
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: None)
    r = asyncio.run(system._health_printer())
    assert r["status"] == "unconfigured"


def test_ottoeject_pille_meint_nur_den_arm(monkeypatch):
    monkeypatch.setattr(system, "SessionLocal", lambda: _DB(None))
    r = asyncio.run(system._health_klipper())
    assert r == {"status": "unconfigured", "detail": "Kein OTTOeject konfiguriert"}


# ── Kamera: Live-Bild des U1 ────────────────────────────────────────────────
def test_jpeg_aus_dem_strom_schneiden():
    a, b = jpeg(b"eins"), jpeg(b"zwei")
    img, rest = mp.split_jpeg(b"--frame\r\n" + a + b"\r\n--frame\r\n" + b[:3])
    assert img == a and rest == b"\r\n--frame\r\n" + b[:3]     # halbes Bild wartet im Rest
    assert mp.split_jpeg(rest) == (None, b[:3])                # Trenner fällt weg
    img, rest = mp.split_jpeg(rest + b[3:])
    assert img == b and rest == b""
    assert mp.split_jpeg(b"kein bild\xff") == (None, b"\xff")   # 0xFF kann Marker-Anfang sein


def _u1_kamera(monkeypatch, stream_status=200, snap_status=200):
    """Fake-U1: Kameraliste, MJPEG-Strom mit zwei Bildern, Standbild."""
    seen = []

    def handler(req: httpx.Request):
        seen.append(req.url.path)
        if req.url.path == "/server/webcams/list":
            return httpx.Response(200, json={"result": {"webcams": [{
                "name": "cam", "enabled": True,
                "snapshot_url": "/webcam/?action=snapshot", "stream_url": "/webcam/?action=stream"}]}})
        if req.url.params.get("action") == "stream":
            body = (b"--b\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg(b"1") +
                    b"\r\n--b\r\nContent-Type: image/jpeg\r\n\r\n" + jpeg(b"2") + b"\r\n")
            return httpx.Response(stream_status, content=body)
        if req.url.params.get("action") == "snapshot":
            return httpx.Response(snap_status, content=jpeg(b"standbild"))
        return httpx.Response(404)

    echt = httpx.Client
    monkeypatch.setattr(mp.httpx, "Client",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(mp.time, "sleep", lambda s: None)
    return seen


def test_live_bild_aus_dem_mjpeg_strom(monkeypatch):
    _u1_kamera(monkeypatch)
    it = mp.stream_frames(U1())
    assert list(itertools.islice(it, 2)) == [jpeg(b"1"), jpeg(b"2")]
    it.close()


def test_ohne_strom_standbilder(monkeypatch):
    seen = _u1_kamera(monkeypatch, stream_status=404)
    it = mp.stream_frames(U1())
    assert next(it) == jpeg(b"standbild")
    it.close()
    assert "/server/webcams/list" in seen


def test_ohne_bild_endet_der_strom(monkeypatch):
    _u1_kamera(monkeypatch, stream_status=404, snap_status=404)
    assert list(mp.stream_frames(U1())) == []        # → Endpunkt antwortet 502


def test_endpunkt_liefert_den_u1_live(monkeypatch):
    monkeypatch.setattr(printer, "_camera_enabled", lambda db, did: True)
    from app.services import appsettings
    monkeypatch.setattr(appsettings, "camera_disabled", lambda: False)
    monkeypatch.setattr(mp, "stream_frames", lambda device: iter([jpeg(b"1")]))
    r = printer.camera_stream(31, db=_DB(U1()))
    assert isinstance(r, StreamingResponse)
    assert r.media_type.startswith("multipart/x-mixed-replace")


def test_endpunkt_ohne_bild_ist_502(monkeypatch):
    monkeypatch.setattr(printer, "_camera_enabled", lambda db, did: True)
    from app.services import appsettings
    monkeypatch.setattr(appsettings, "camera_disabled", lambda: False)
    monkeypatch.setattr(mp, "stream_frames", lambda device: iter([]))
    with pytest.raises(HTTPException) as e:
        printer.camera_stream(31, db=_DB(U1()))
    assert e.value.status_code == 502


def test_kammerlicht_nie_ueber_bambu_beim_u1(monkeypatch):
    monkeypatch.setattr(printer, "_camera_enabled", lambda db, did: True)
    from app.services import appsettings
    monkeypatch.setattr(appsettings, "camera_disabled", lambda: False)

    def nie(*a, **kw):
        raise AssertionError("Bambu-MQTT für den U1")
    monkeypatch.setattr(printer, "_ensure_chamber_light_async", nie)
    assert printer.camera_light(31, db=_DB(U1())) == {"success": False, "reason": "not_supported"}


# ── Steuerung: Bambu-Macros nur mit Bambu-Drucker ───────────────────────────
@pytest.mark.parametrize("makro", sorted(control.BAMBU_PRINTER_MACROS))
def test_bambu_macro_ohne_bambu_gesperrt(makro):
    with pytest.raises(HTTPException) as e:
        asyncio.run(control.execute_macro(MacroExecutionRequest(macro_name=makro), _DB(None)))
    assert e.value.status_code == 409 and "Snapmaker U1" in e.value.detail


def test_bambu_macro_mit_bambu_wie_bisher(monkeypatch):
    def weiter(db, bewegt=False):
        raise HTTPException(418, "bis zum Arm gekommen")
    monkeypatch.setattr(control, "_klipper", weiter)
    with pytest.raises(HTTPException) as e:
        asyncio.run(control.execute_macro(
            MacroExecutionRequest(macro_name="EJECT_FROM_BAMBULAB_X_ONE_C"), _DB(X1C())))
    assert e.value.status_code == 418


def test_arm_macros_ohne_bambu_frei(monkeypatch):
    def weiter(db, bewegt=False):
        raise HTTPException(418, "bis zum Arm gekommen")
    monkeypatch.setattr(control, "_klipper", weiter)
    with pytest.raises(HTTPException) as e:
        asyncio.run(control.execute_macro(MacroExecutionRequest(macro_name="OTTOEJECT_HOME"), _DB(None)))
    assert e.value.status_code == 418


# ── Verbindungstest: feste, übersetzbare Meldungen ──────────────────────────
def test_verbindungstest_meldungen(monkeypatch):
    async def info(device, path, params=None, timeout=5.0):
        return {"state": "shutdown", "hostname": "u1"}
    monkeypatch.setattr(mp, "_get", info)
    r = asyncio.run(mp.test(U1()))
    assert r["message"] == "Moonraker erreichbar, Klipper nicht bereit" and r["klippy_state"] == "shutdown"

    async def weg(device, path, params=None, timeout=5.0):
        raise httpx.ConnectError("weg")
    monkeypatch.setattr(mp, "_get", weg)
    r = asyncio.run(mp.test(U1()))
    assert r == {"success": False, "message": "Moonraker nicht erreichbar", "error": "ConnectError"}
