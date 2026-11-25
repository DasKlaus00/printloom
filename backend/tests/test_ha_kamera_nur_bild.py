"""Die HA-Kamera reicht nur Kamerabilder durch (seit v1.1.88).

Bis v1.1.87 ging der Content-Type der eingetragenen Home-Assistant-Adresse 1:1 an den
Browser. Lieferte sie HTML, lief das als Seite auf Printloom selbst — in der Website-Demo
sogar auf derselben Adresse wie der Admin-Bereich der Website.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
import httpx  # noqa: E402
from fastapi import HTTPException  # noqa: E402

from app.routers import printer  # noqa: E402


class _DB:
    def close(self):
        pass


def _mit_gegenstelle(monkeypatch, content_type: str, body: bytes = b"x"):
    def handler(request: httpx.Request) -> httpx.Response:
        assert request.headers["authorization"] == "Bearer geheim"
        return httpx.Response(200, headers={"content-type": content_type}, content=body)
    echter = httpx.AsyncClient
    monkeypatch.setattr(printer.httpx, "AsyncClient",
                        lambda **kw: echter(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(printer, "_get_ha_cam_cfg",
                        lambda db, did: ("http://ha.example:8123", "geheim", "camera.x1c"))


def test_html_wird_nicht_durchgereicht(monkeypatch):
    _mit_gegenstelle(monkeypatch, "text/html; charset=utf-8", b"<script>alert(1)</script>")
    with pytest.raises(HTTPException) as e:
        asyncio.run(printer.ha_camera_stream(1, db=_DB()))
    assert e.value.status_code == 502 and "kein Kamerabild" in e.value.detail


@pytest.mark.parametrize("ctype", ["application/javascript", "image/svg+xml", "text/plain", ""])
def test_auch_kein_skript_svg_oder_text(monkeypatch, ctype):
    _mit_gegenstelle(monkeypatch, ctype)
    if not ctype:
        # Ohne Angabe nimmt Printloom MJPEG an (wie bisher) — das ist ein Bildtyp.
        r = asyncio.run(printer.ha_camera_stream(1, db=_DB()))
        assert r.media_type.startswith("multipart/x-mixed-replace")
        return
    with pytest.raises(HTTPException):
        asyncio.run(printer.ha_camera_stream(1, db=_DB()))


def test_mjpeg_geht_durch_mit_sandbox_und_nosniff(monkeypatch):
    _mit_gegenstelle(monkeypatch, "multipart/x-mixed-replace; boundary=frame")
    r = asyncio.run(printer.ha_camera_stream(1, db=_DB()))
    assert r.media_type == "multipart/x-mixed-replace; boundary=frame"
    assert r.headers["x-content-type-options"] == "nosniff"
    assert "sandbox" in r.headers["content-security-policy"]


def test_nosniff_an_jeder_antwort():
    from fastapi.testclient import TestClient
    from app.main import app
    r = TestClient(app).get("/api/health")
    assert r.headers.get("x-content-type-options") == "nosniff"
    assert "frame-ancestors" in r.headers.get("content-security-policy", "")
