"""Schutz an der HTTP-Grenze.

CORS: Bis v1.1.34 stand allow_origins=["*"] zusammen mit allow_credentials. Starlette
spiegelt dann bei Anfragen mit Cookie die Herkunft zurück — hinter einer Anmeldung
(z. B. authentik) hätte jede fremde Webseite im Browser des angemeldeten Nutzers die
API lesen dürfen, das Backup mit allen Zugangsdaten eingeschlossen. Die Oberfläche
kommt vom selben Server und braucht keine Freigabe.

Snapshots: nur Dateinamen, die Printloom selbst erzeugt.
"""
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import printer  # noqa: E402

client = TestClient(app)


def test_fremde_herkunft_bekommt_keine_freigabe():
    r = client.get("/api/health", headers={"Origin": "https://fremde-seite.example",
                                           "Cookie": "authentik_session=abc"})
    assert r.status_code == 200
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_vorabanfrage_einer_fremden_seite_wird_nicht_erlaubt():
    r = client.options("/api/system/backup", headers={
        "Origin": "https://fremde-seite.example",
        "Access-Control-Request-Method": "GET"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


@pytest.mark.parametrize("name", ["..%5C..%5Cdb%5Cprintloom.db", "printloom.db",
                                  "snap_1_x.jpg", "snap_..%5C..%5Csecret.jpg"])
def test_snapshot_nur_eigene_dateinamen(name):
    assert client.get(f"/api/printer/snapshots/{name}").status_code == 404


def test_eigener_snapshot_wird_ausgeliefert(tmp_path, monkeypatch):
    monkeypatch.setattr(printer, "SNAP_DIR", tmp_path)
    (tmp_path / "snap_3_20261011_120000.jpg").write_bytes(b"\xff\xd8\xff")
    r = client.get("/api/printer/snapshots/snap_3_20261011_120000.jpg")
    assert r.status_code == 200
    assert r.content == b"\xff\xd8\xff"


# ── Schreiben von fremder Herkunft (seit v1.1.39) ───────────────────────────────
# Ein Formular auf einer fremden Seite braucht keine CORS-Freigabe. Ohne diese
# Sperre löste ein leeres POST auf /api/system/update ein Update samt Neustart aus.

@pytest.mark.parametrize("site", ["cross-site", "same-site"])
def test_fremde_seite_darf_nicht_schreiben(site):
    r = client.post("/api/system/update", headers={"Sec-Fetch-Site": site})
    assert r.status_code == 403
    assert r.json()["detail"] == "FREMDE_HERKUNFT"


def test_fremde_seite_darf_weiter_lesen_was_ohnehin_oeffentlich_ist():
    # Lesen schützt die fehlende CORS-Freigabe; die Sperre gilt nur fürs Schreiben.
    assert client.get("/api/health", headers={"Sec-Fetch-Site": "cross-site"}).status_code == 200


@pytest.mark.parametrize("headers", [{"Sec-Fetch-Site": "same-origin"}, {}])
def test_eigene_oberflaeche_und_skripte_duerfen_schreiben(headers, tmp_path, monkeypatch):
    """Die eigene Oberfläche schickt same-origin, Home Assistant/curl gar nichts."""
    from app.routers import system
    monkeypatch.setattr(system, "_db_dir", lambda: tmp_path)
    r = client.put("/api/system/dashboard-layout?view=farm", json={"layout": []},
                   headers=headers)
    assert r.status_code == 200, r.text


def test_websocket_von_fremder_seite_wird_abgelehnt():
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/autofarm/ws",
                                      headers={"Sec-Fetch-Site": "cross-site"}):
            pass


# ── Fremde Adressen und fremde Herkunft über http (seit v1.1.42) ─────────────────
# Über http://<IP> schickt der Browser kein Sec-Fetch-Site. Davor half die Sperre
# oben also nur über https. Jetzt prüft der Wächter Host und Origin.

FARM = "192.168.1.5:8000"


@pytest.fixture
def ohne_freigaben(monkeypatch):
    monkeypatch.delenv("PRINTLOOM_ALLOWED_HOSTS", raising=False)
    monkeypatch.delenv("PRINTLOOM_FRAME_ANCESTORS", raising=False)


def test_fremder_host_wird_abgelehnt(ohne_freigaben):
    # DNS-Rebinding: Der Browser hält angreifer.example für dieselbe Herkunft.
    r = client.post("/api/system/update", headers={"Host": "angreifer.example:8000",
                                                   "Origin": "http://angreifer.example:8000"})
    assert r.status_code == 403
    assert r.json()["detail"] == "UNBEKANNTE_ADRESSE"
    assert client.get("/api/devices/", headers={"Host": "angreifer.example:8000"}).status_code == 403


def test_fremder_host_bekommt_eine_erklaerseite(ohne_freigaben):
    r = client.get("/", headers={"Host": "farm.example.de"})
    assert r.status_code == 403
    assert r.headers["content-type"].startswith("text/html")
    assert "PRINTLOOM_ALLOWED_HOSTS=farm.example.de" in r.text


@pytest.mark.parametrize("host", [FARM, "localhost:8000", "farm.lan", "drucker.fritz.box"])
def test_heimnetz_adressen_kommen_durch(host, ohne_freigaben):
    assert client.get("/api/health", headers={"Host": host}).status_code == 200


def test_name_aus_der_freigabe_kommt_durch(monkeypatch):
    monkeypatch.setenv("PRINTLOOM_ALLOWED_HOSTS", "farm.example.de")
    assert client.get("/api/health", headers={"Host": "farm.example.de"}).status_code == 200


def test_proxy_name_ueber_https_kommt_ohne_freigabe_durch(ohne_freigaben, tmp_path, monkeypatch):
    """Hinter authentik schickt der Browser Sec-Fetch-Site; so sperrt das Update
    niemanden aus, der vergessen hat, die Variable zu setzen."""
    from app.routers import system
    monkeypatch.setattr(system, "_db_dir", lambda: tmp_path)
    h = {"Host": "farm.example.de", "Sec-Fetch-Site": "same-origin", "Origin": "https://farm.example.de"}
    assert client.get("/api/health", headers=h).status_code == 200
    r = client.put("/api/system/dashboard-layout?view=farm", json={"layout": []}, headers=h)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("origin", ["https://fremd.example", "null", "http://192.168.1.50"])
def test_fremder_origin_ohne_sec_fetch_site(origin, ohne_freigaben):
    r = client.post("/api/system/update", headers={"Host": FARM, "Origin": origin})
    assert r.status_code == 403
    assert r.json()["detail"] == "FREMDE_HERKUNFT"


@pytest.mark.parametrize("headers", [{"Host": FARM, "Origin": f"http://{FARM}"}, {"Host": FARM}])
def test_eigene_herkunft_und_skripte_ueber_http_duerfen_schreiben(headers, tmp_path, monkeypatch,
                                                                  ohne_freigaben):
    from app.routers import system
    monkeypatch.setattr(system, "_db_dir", lambda: tmp_path)
    r = client.put("/api/system/dashboard-layout?view=farm", json={"layout": []}, headers=headers)
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("headers", [{"Origin": "https://fremd.example"},
                                     {"Host": "angreifer.example:8000"}])
def test_websocket_mit_fremder_herkunft_oder_adresse(headers, ohne_freigaben):
    from starlette.websockets import WebSocketDisconnect
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/api/autofarm/ws", headers=headers):
            pass


def test_einbetten_nur_von_eigener_seite(ohne_freigaben):
    r = client.get("/api/health")
    assert r.headers["content-security-policy"] == "frame-ancestors 'self'"
    assert r.headers["x-frame-options"] == "SAMEORIGIN"


def test_einbetten_mit_freigabe_fuer_home_assistant(monkeypatch):
    monkeypatch.setenv("PRINTLOOM_FRAME_ANCESTORS", "https://ha.example")
    r = client.get("/api/health")
    assert r.headers["content-security-policy"] == "frame-ancestors 'self' https://ha.example"
    assert "x-frame-options" not in {k.lower() for k in r.headers}
