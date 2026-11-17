"""Adress- und Herkunftsprüfung (app/services/request_guard.py), ohne Server.

Die Fälle folgen den zwei Angriffen aus dem Browser: DNS-Rebinding (fremder Name im
Host-Kopf, über http) und Schreiben von einer fremden Seite (fremder Origin, über
http ohne Sec-Fetch-Site). Dazu die Fälle, die NICHT gesperrt werden dürfen: die
eigene Oberfläche über IP, Heimnetz-Namen, den Proxy-Namen über https, Skripte.
"""
import pytest

from app.services import request_guard as g

FARM = "192.168.1.5:8000"


@pytest.fixture(autouse=True)
def _ohne_freigaben(monkeypatch):
    monkeypatch.delenv("PRINTLOOM_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("PRINTLOOM_FRAME_ANCESTORS", raising=False)


@pytest.mark.parametrize("value,expected", [
    ("Farm.Lan:8000", ("farm.lan", 8000)),
    ("[::1]:8756", ("::1", 8756)),
    ("::1", ("::1", None)),
    ("printloom", ("printloom", None)),
    ("farm.lan.", ("farm.lan", None)),
    ("", ("", None)),
    (None, ("", None)),
])
def test_split_host(value, expected):
    assert g.split_host(value) == expected


@pytest.mark.parametrize("host", [
    FARM, "192.168.1.5", "127.0.0.1:8756", "localhost:8000", "[::1]:8756", "[fd00::5]:8000",
    "printloom:8000", "farm.local", "farm.lan:8000", "farm.home.arpa", "drucker.fritz.box:8000",
    "farm.internal", "testserver", None, "",
])
def test_heimnetz_adressen_sind_erlaubt(host):
    assert g.host_ok(host)


@pytest.mark.parametrize("host", ["angreifer.example:8000", "farm.example.de", "fritz.box.evil.com",
                                  "evil-fritz.box"])
def test_fremde_namen_sind_nicht_erlaubt(host):
    assert not g.host_ok(host)


def test_namen_aus_der_freigabe(monkeypatch):
    monkeypatch.setenv("PRINTLOOM_ALLOWED_HOSTS", " Farm.Example.de:443 , *.intern.example ")
    assert g.host_ok("farm.example.de")
    assert g.host_ok("a.intern.example:8000")
    assert g.host_ok("b.c.intern.example")
    assert not g.host_ok("intern.example.evil.com")
    assert not g.host_ok("example.de")


# ── decide(): die Regel des Wächters ─────────────────────────────────────────────

def _h(**kw):
    return {k.replace("_", "-"): v for k, v in kw.items()}


def test_rebinding_ueber_http_wird_gesperrt():
    # Die fremde Seite ist nach dem Umleiten „gleiche Herkunft": Origin == Host.
    h = _h(host="angreifer.example:8000", origin="http://angreifer.example:8000")
    assert g.decide("http", "GET", h) == g.UNKNOWN_HOST
    assert g.decide("http", "POST", h) == g.UNKNOWN_HOST
    assert g.decide("websocket", None, h) == g.UNKNOWN_HOST
    # Auch ein selbst gesetzter X-Forwarded-Host hilft dem Angreifer nicht.
    assert g.decide("http", "POST", {**h, "x-forwarded-host": FARM}) == g.UNKNOWN_HOST


def test_proxy_name_ueber_https_ist_erlaubt():
    """Hinter authentik (https) schickt der Browser Sec-Fetch-Site. Rebinding über https
    geht nicht, also sperrt der unbekannte Name hier niemanden aus."""
    assert g.decide("http", "GET", _h(host="farm.example.de", sec_fetch_site="none")) is None
    assert g.decide("http", "POST", _h(host="farm.example.de", sec_fetch_site="same-origin",
                                       origin="https://farm.example.de")) is None
    # WebSocket ohne Sec-Fetch-Site (nicht jeder Browser schickt ihn dort), aber mit
    # https-Origin unter genau diesem Namen.
    assert g.decide("websocket", None, _h(host="farm.example.de",
                                          origin="https://farm.example.de")) is None
    # Eine https-Herkunft unter einem ANDEREN Namen beweist nichts.
    assert g.decide("websocket", None, _h(host="farm.example.de",
                                          origin="https://evil.example")) == g.UNKNOWN_HOST


def test_programm_mit_eigenem_kopf_kommt_ueberall_durch():
    # OrcaSlicer-Plugin hinter authentik: Domain-Name, kein Browser, kein Origin.
    h = _h(host="farm.example.de", sec_printloom_client="orca/1.0.2")
    assert g.decide("http", "POST", h) is None
    assert g.decide("http", "GET", h) is None


def test_fremde_seite_ueber_https_darf_nicht_schreiben():
    for site in ("cross-site", "same-site", "unbekannt"):
        assert g.decide("http", "POST", _h(host="farm.example.de", sec_fetch_site=site)) == g.FOREIGN_ORIGIN
    # Lesen schützt die fehlende CORS-Freigabe.
    assert g.decide("http", "GET", _h(host=FARM, sec_fetch_site="cross-site")) is None


@pytest.mark.parametrize("origin", ["https://fremd.example", "null", "", "http://192.168.1.50",
                                    "http://192.168.1.5:9000", "file://", "ftp://192.168.1.5:8000"])
def test_fremde_herkunft_ueber_http_darf_nicht_schreiben(origin):
    assert g.decide("http", "POST", _h(host=FARM, origin=origin)) == g.FOREIGN_ORIGIN
    assert g.decide("websocket", None, _h(host=FARM, origin=origin)) == g.FOREIGN_ORIGIN


@pytest.mark.parametrize("headers", [
    {"host": FARM, "origin": "http://192.168.1.5:8000"},           # eigene Oberfläche über IP
    {"host": FARM},                                                 # curl, Home Assistant
    {"host": "localhost:8000", "origin": "http://localhost:3000"},  # Vite-Dev-Proxy
    {"host": "127.0.0.1:8756", "origin": "http://127.0.0.1:8756"},  # Windows-App
    {"host": "farm.lan", "origin": "http://farm.lan"},              # Proxy auf Port 80
    {"host": "farm.lan:8080", "origin": "http://farm.lan:8080"},    # nginx $http_host
    {"host": "printloom:8000", "origin": "http://farm.lan", "x-forwarded-host": "farm.lan"},
])
def test_eigene_oberflaeche_und_skripte_duerfen_schreiben(headers):
    assert g.decide("http", "POST", headers) is None
    assert g.decide("http", "DELETE", headers) is None


def test_proxy_der_den_host_umschreibt_reicht_keinen_fremden_namen_durch():
    """Apache ohne ProxyPreserveHost: Host = Container, X-Forwarded-Host = Name im Browser.
    Beim Rebinding steht dort der fremde Name (oder die Seite setzt ihn selbst)."""
    h = _h(host="printloom:8000", origin="http://angreifer.example", x_forwarded_host="angreifer.example")
    assert g.decide("http", "POST", h) == g.UNKNOWN_HOST
    assert g.decide("http", "GET", _h(host="printloom:8000", x_forwarded_host="angreifer.example")) == g.UNKNOWN_HOST
    # Mehrere Einträge: der erste zählt.
    assert g.decide("http", "GET", _h(host="printloom:8000",
                                      x_forwarded_host="angreifer.example, farm.lan")) == g.UNKNOWN_HOST


def test_https_herkunft_hilft_einem_formular_nicht():
    # https://angreifer.example schickt ein Formular an http://angreifer.example
    # (umgeleitet auf die Farm, Port 80): Herkunft und Name stimmen überein.
    h = _h(host="angreifer.example", origin="https://angreifer.example")
    assert g.decide("http", "POST", h) == g.UNKNOWN_HOST


def test_anderer_dienst_auf_derselben_adresse_ist_fremd():
    # Printloom auf Port 80 (Host ohne Port), Portainer auf :9000 derselben IP.
    assert g.decide("http", "POST", _h(host="192.168.1.5", origin="http://192.168.1.5:9000")) == g.FOREIGN_ORIGIN
    assert g.decide("http", "POST", _h(host="farm.lan", origin="http://farm.lan:8123")) == g.FOREIGN_ORIGIN


def test_wildcard_gilt_nur_fuer_die_adresse(monkeypatch):
    monkeypatch.setenv("PRINTLOOM_ALLOWED_HOSTS", "*.example.de, farm.example.de")
    # Die Adresse ist erlaubt …
    assert g.decide("http", "GET", _h(host="blog.example.de")) is None
    # … aber eine Seite unter *.example.de darf nicht an die Farm im Netz schreiben.
    assert g.decide("http", "POST", _h(host=FARM, origin="http://blog.example.de")) == g.FOREIGN_ORIGIN
    assert g.decide("http", "POST", _h(host="printloom:8000", origin="http://farm.example.de")) is None


def test_lokale_herkunft_nur_an_lokale_adresse():
    # Eine Seite auf localhost (anderes Programm am eigenen PC) darf nicht an die Farm
    # im Netz schreiben, nur an eine Printloom-Instanz auf demselben Rechner.
    assert g.decide("http", "POST", _h(host=FARM, origin="http://localhost:3000")) == g.FOREIGN_ORIGIN


def test_herkunft_aus_der_freigabe(monkeypatch):
    monkeypatch.setenv("PRINTLOOM_ALLOWED_HOSTS", "farm.example.de")
    # Plain-HTTP-Proxy, der den Host auf den Container umschreibt.
    assert g.decide("http", "POST", _h(host="printloom:8000", origin="http://farm.example.de")) is None


def test_einbett_koepfe_ohne_und_mit_freigabe(monkeypatch):
    assert dict(g.frame_headers()) == {b"content-security-policy": b"frame-ancestors 'self'",
                                       b"x-frame-options": b"SAMEORIGIN"}
    monkeypatch.setenv("PRINTLOOM_FRAME_ANCESTORS", "https://ha.example:8123, http://10.0.0.2:8123 'unsafe';x")
    h = dict(g.frame_headers())
    assert h[b"content-security-policy"] == b"frame-ancestors 'self' https://ha.example:8123 http://10.0.0.2:8123"
    assert b"x-frame-options" not in h
