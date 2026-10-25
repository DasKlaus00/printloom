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
