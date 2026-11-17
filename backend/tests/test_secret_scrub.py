"""Keine Zugangsdaten in Log oder Fehlermeldung (seit v1.1.73).

Bis v1.1.72 standen das Tasmota-Passwort (httpx nennt bei raise_for_status die volle
URL samt Query) und der Access-Code des Druckers (ffmpeg nennt die RTSPS-URL) im Log
und in der Fehlermeldung an den Browser.
"""
import asyncio
import io
import logging

import httpx
import pytest

from app.services import power, rtsp_camera
from app.services.credentials import scrub

CODE = "12345678"
PASSWORT = "geheimes-pw"


# ── scrub ───────────────────────────────────────────────────────────────────

def test_zugangsdaten_in_einer_url_irgendwo_im_text():
    text = f"[tls] rtsps://bblp:{CODE}@192.0.2.10:322/streaming/live/1: Connection refused"
    out = scrub(text)
    assert CODE not in out
    assert "rtsps://***@192.0.2.10:322/streaming/live/1: Connection refused" in out


def test_geheime_parameter_ja_andere_nein():
    text = (f"Client error '401 Unauthorized' for url "
            f"'http://192.0.2.20/cm?cmnd=Status+10&user=admin&password={PASSWORT}'")
    out = scrub(text)
    assert PASSWORT not in out
    assert "password=***" in out
    assert "cmnd=Status+10" in out and "user=admin" in out


@pytest.mark.parametrize("text,geheim", [
    ("GET /api?token=abc123&x=1", "abc123"),
    ("access_code=99887766 abgelehnt", "99887766"),
    ("Authorization: Bearer eyJhbGciOi.xyz", "eyJhbGciOi.xyz"),
    ("rtsp://admin:pw@cam.local/stream", "admin:pw"),
])
def test_weitere_formen(text, geheim):
    assert geheim not in scrub(text)


def test_harmloses_bleibt_wie_es_ist():
    for text in ("Kamera nicht erreichbar", "rtsp://admin@cam.local/stream",
                 "Timeout nach 15 s", "x=1&y=2"):
        assert scrub(text) == text
    assert scrub(None) == ""
    assert scrub(ValueError(f"password={PASSWORT}")) == "password=***"


# ── Tasmota ─────────────────────────────────────────────────────────────────

@pytest.fixture
def tasmota_401(monkeypatch):
    def handler(request):
        return httpx.Response(401, text="Unauthorized")
    echt = httpx.AsyncClient
    monkeypatch.setattr(power.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))


def test_tasmota_fehler_ohne_passwort_im_log(tasmota_401, caplog):
    s = {"plug_type": "tasmota", "plug_url": "http://192.0.2.20", "plug_password": PASSWORT}
    caplog.set_level(logging.DEBUG, logger="app.services.power")
    assert asyncio.run(power.set_plug(s, True)) is False
    werte = asyncio.run(power.read_power(s))
    assert werte == {"watts": None, "energy_kwh": None, "on": None}
    assert "Tasmota HTTP 401" in caplog.text
    assert PASSWORT not in caplog.text


def test_log_filter_bereinigt_auch_fremde_meldungen_und_tracebacks(caplog):
    """httpx loggt jede Anfrage samt URL (in der App auf WARNING gedämpft). Der Filter
    an den Handlern ist die letzte Sicherung für solche Bibliotheksmeldungen."""
    from app.services.credentials import ScrubFilter, install_log_scrub
    log = logging.getLogger("test.fremd")
    caplog.set_level(logging.INFO, logger="test.fremd")
    install_log_scrub(logging.getLogger())
    caplog.handler.addFilter(ScrubFilter())
    log.warning("HTTP Request: GET http://192.0.2.20/cm?cmnd=Power&password=%s", PASSWORT)
    try:
        raise ConnectionError(f"rtsps://bblp:{CODE}@192.0.2.10:322/x refused")
    except ConnectionError:
        log.exception("Kamera")
    assert PASSWORT not in caplog.text and CODE not in caplog.text
    assert "password=***" in caplog.text and "rtsps://***@" in caplog.text


def test_die_app_haengt_den_filter_an():
    """main.py ruft install_log_scrub nach der Logging-Einrichtung auf."""
    from pathlib import Path
    src = (Path(__file__).resolve().parents[1] / "app" / "main.py").read_text(encoding="utf-8")
    assert "credentials.install_log_scrub()" in src
    assert src.index("logging.basicConfig") < src.index("credentials.install_log_scrub()")


# ── ffmpeg ──────────────────────────────────────────────────────────────────

class _FakeProc:
    def __init__(self, stderr: bytes):
        self.stdout = io.BytesIO(b"")          # kein Bild
        self.stderr = io.BytesIO(stderr)
        self.killed = self.waited = False

    def kill(self):
        self.killed = True

    def wait(self, timeout=None):
        self.waited = True
        return 1


@pytest.fixture
def ffmpeg_refused(monkeypatch):
    zeilen = (b"ffmpeg version 7.1\n"
              + f"[tls @ 0x1] rtsps://bblp:{CODE}@192.0.2.10:322/streaming/live/1: Connection refused\n".encode())
    procs = []

    def popen(*a, **kw):
        procs.append(_FakeProc(zeilen))
        return procs[-1]
    monkeypatch.setattr(rtsp_camera.subprocess, "Popen", popen)
    return procs


def test_stream_fehler_ohne_access_code(ffmpeg_refused):
    p = rtsp_camera._FfmpegProducer("192.0.2.10", CODE)
    p.open()
    p.read(lambda jpeg: None)
    detail = p.error_detail()
    p.close()
    assert "Connection refused" in detail
    assert CODE not in detail
    assert ffmpeg_refused[0].killed and ffmpeg_refused[0].waited


def test_einzelbild_fehler_ohne_access_code(ffmpeg_refused):
    with pytest.raises(ConnectionError) as e:
        rtsp_camera._single_frame_oneshot("192.0.2.10", CODE, read_timeout=2)
    assert "Connection refused" in str(e.value)
    assert CODE not in str(e.value)
    assert ffmpeg_refused[0].waited
