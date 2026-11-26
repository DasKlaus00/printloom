"""Sprachwunsch an den Printloom-Server (seit v1.1.93).

Die einzige Stelle, an der Printloom etwas nach draußen SCHICKT. Geprüft wird, was
wirklich rausgeht: genau eine Anfrage, genau {code, version}, keine Cookies/Token,
nur https, keine Weiterleitung, gedrosselt — und dass die Antwort des Servers nie in
die Oberfläche gelangt.
"""
import asyncio
import json

import httpx
import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import online as online_router  # noqa: E402
from app.services import online  # noqa: E402


@pytest.fixture
def server(monkeypatch):
    """Fake-Printloom-Server; schreibt jede Anfrage mit."""
    seen = {"requests": [], "status": 201}

    def handler(req: httpx.Request):
        seen["requests"].append(req)
        return httpx.Response(seen["status"], json={"ok": True, "secret": "<script>"})

    echt = httpx.AsyncClient
    monkeypatch.setattr(online.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(online, "read_settings", lambda: {"server_url": "https://printloom.example"})
    online._lang_sent.clear()
    return seen


def send(code, version="1.1.93"):
    return asyncio.run(online.send_language_request(code, version))


def test_genau_eine_anfrage_mit_genau_code_und_version(server):
    assert send("FR") == {"ok": True, "reason": "sent"}
    [req] = server["requests"]
    assert req.method == "POST"
    assert str(req.url) == "https://printloom.example/api/v1/language-requests"
    assert json.loads(req.content) == {"code": "fr", "version": "1.1.93"}
    assert req.headers["content-type"] == "application/json"
    for h in ("cookie", "authorization", "origin"):
        assert h not in req.headers


def test_unsinn_wird_nicht_gesendet(server):
    for bad in ("<script>", "", "deutsch-sprache-lang", None):
        assert send(bad)["reason"] == "invalid"
    assert server["requests"] == []


def test_kaputte_version_bleibt_leer(server):
    send("es", version="1.1.93; rm -rf /")
    assert json.loads(server["requests"][0].content) == {"code": "es", "version": ""}


def test_nur_https(server, monkeypatch):
    monkeypatch.setattr(online, "read_settings", lambda: {"server_url": "http://printloom.example"})
    assert send("fr") == {"ok": False, "reason": "insecure"}
    assert server["requests"] == []


def test_gleiche_sprache_einmal_je_stunde_und_hoechstens_fuenf(server):
    assert send("fr")["reason"] == "sent"
    assert send("fr") == {"ok": True, "reason": "already_sent"}
    for code in ("es", "it", "pl", "ja"):
        assert send(code)["reason"] == "sent"
    assert send("nl") == {"ok": False, "reason": "rate"}
    assert len(server["requests"]) == 5


def test_serverantwort_bestimmt_nur_den_status(server):
    server["status"] = 429
    assert send("fr") == {"ok": False, "reason": "rate"}
    server["status"] = 500
    assert send("es") == {"ok": False, "reason": "server"}
    server["status"] = 302                      # Weiterleitung wird nicht verfolgt
    assert send("it") == {"ok": False, "reason": "server"}
    assert len(server["requests"]) == 3


def test_netzfehler(monkeypatch):
    def handler(req):
        raise httpx.ConnectError("weg")
    echt = httpx.AsyncClient
    monkeypatch.setattr(online.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    monkeypatch.setattr(online, "read_settings", lambda: {"server_url": "https://printloom.example"})
    online._lang_sent.clear()
    assert send("fr") == {"ok": False, "reason": "network"}


def test_endpunkt_feste_meldungen(server):
    r = asyncio.run(online_router.language_request(online_router.LanguageRequestIn(code="fr")))
    assert r == {"ok": True, "already_sent": False}
    server["status"] = 500
    with pytest.raises(HTTPException) as e:
        asyncio.run(online_router.language_request(online_router.LanguageRequestIn(code="es")))
    assert e.value.status_code == 502
    assert e.value.detail == "Printloom-Server hat die Anfrage nicht angenommen"   # nichts vom Server
    with pytest.raises(HTTPException) as e:
        asyncio.run(online_router.language_request(online_router.LanguageRequestIn(code="??")))
    assert e.value.status_code == 400


def test_langer_code_lehnt_das_modell_ab():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        online_router.LanguageRequestIn(code="x" * 21)
