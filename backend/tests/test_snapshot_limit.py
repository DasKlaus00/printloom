"""Schnappschuss am Druckende: ein Bild, festes Limit, nur JPEG.

Bis v1.1.44 lud die Farm die ganze Antwort der Kamera-Adresse. Ein MJPEG-Stream
endet nie, und die Farm hing am Druckende fest (Auswurf wartete auf das Bild).
"""
import asyncio

import httpx

from app.routers import printer

JPEG = b"\xff\xd8\xff\xe0" + b"x" * 100 + b"\xff\xd9"


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_endloser_mjpeg_stream_liefert_das_erste_bild():
    async def endlos():
        teil = b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + JPEG + b"\r\n"
        while True:
            yield teil

    def handler(request):
        return httpx.Response(200, headers={"content-type": "multipart/x-mixed-replace; boundary=frame"},
                              content=endlos())

    async def lauf():
        async with _client(handler) as c:
            return await asyncio.wait_for(printer._fetch_webcam_jpeg("http://cam/stream", c), 5)
    assert asyncio.run(lauf()) == JPEG


def test_zu_grosses_bild_wird_verworfen(monkeypatch):
    monkeypatch.setattr(printer, "SNAP_MAX_BYTES", 1000)

    def handler(request):
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=JPEG + b"y" * 5000)

    async def lauf():
        async with _client(handler) as c:
            return await printer._fetch_webcam_jpeg("http://cam/snap.jpg", c)
    assert asyncio.run(lauf()) is None


def test_html_statt_bild_wird_verworfen():
    def handler(request):
        return httpx.Response(200, headers={"content-type": "text/html"}, content=b"<html>Login</html>")

    async def lauf():
        async with _client(handler) as c:
            return await printer._fetch_webcam_jpeg("http://cam/", c)
    assert asyncio.run(lauf()) is None


def test_einzelbild_kommt_durch():
    def handler(request):
        return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=JPEG)

    async def lauf():
        async with _client(handler) as c:
            return await printer._fetch_webcam_jpeg("http://cam/snap.jpg", c)
    assert asyncio.run(lauf()) == JPEG
