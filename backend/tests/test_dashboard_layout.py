"""Dashboard-Layouts: Startseite und Auto-Farm sind getrennt.

Beide Ansichten sind frei konfigurierbar, haben aber verschiedene Panels. Lägen sie
in einer Datei, würde jedes Speichern auf der einen Seite die Anordnung der anderen
überschreiben — der Nutzer richtet sich ein Dashboard ein und findet das andere
zerlegt vor. Deshalb eine Datei je Ansicht, ausgewählt über `view`.
"""
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient          # noqa: E402

from app.main import app                           # noqa: E402
from app.routers import system                     # noqa: E402


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(system, "_db_dir", lambda: tmp_path)
    return TestClient(app)


FARM = {"layout": [{"i": "queue", "x": 1, "y": 2, "w": 6, "h": 8}], "hidden": ["camera"]}
HOME = {"layouts": {"lg": [{"i": "status", "x": 3, "y": 4, "w": 9, "h": 10}]},
        "hidden": ["timeline"]}


def get(client, view=None):
    r = client.get("/api/system/dashboard-layout", params={"view": view} if view else None)
    assert r.status_code == 200
    return r.json()


def put(client, body, view=None):
    r = client.put("/api/system/dashboard-layout", json=body,
                   params={"view": view} if view else None)
    assert r.status_code == 200, r.text


# ── Trennung ────────────────────────────────────────────────────────────────

def test_die_startseite_ueberschreibt_die_farm_nicht(client):
    put(client, FARM, "farm")
    put(client, HOME, "home")
    assert get(client, "farm")["layout"] == FARM["layout"]
    assert get(client, "farm")["hidden"] == ["camera"]


def test_die_farm_ueberschreibt_die_startseite_nicht(client):
    put(client, HOME, "home")
    put(client, FARM, "farm")
    assert get(client, "home")["layouts"] == HOME["layouts"]
    assert get(client, "home")["hidden"] == ["timeline"]


def test_zuruecksetzen_trifft_nur_die_eine_ansicht(client):
    put(client, FARM, "farm")
    put(client, HOME, "home")
    assert client.delete("/api/system/dashboard-layout",
                         params={"view": "home"}).status_code == 200
    assert get(client, "home") == {}
    assert get(client, "farm")["layout"] == FARM["layout"]


# ── Rückwärtskompatibilität ─────────────────────────────────────────────────

def test_ohne_angabe_gilt_die_farm_ansicht(client):
    """Ältere Clients senden kein `view` — sie müssen weiter die Farm treffen."""
    put(client, FARM)
    assert get(client, "farm")["layout"] == FARM["layout"]
    assert get(client)["layout"] == FARM["layout"]


# ── Robustheit ──────────────────────────────────────────────────────────────

def test_unbekannte_ansicht_wird_abgewiesen(client):
    """Nicht stillschweigend in der Farm-Datei landen — das wäre Datenverlust."""
    r = client.get("/api/system/dashboard-layout", params={"view": "quatsch"})
    assert r.status_code == 400


def test_kein_layout_gespeichert_ergibt_ein_leeres_objekt(client):
    """Leer = „nimm die Standard-Anordnung" (die Oberfläche entscheidet das)."""
    assert get(client, "home") == {}


def test_unbrauchbare_layouts_werden_nicht_uebernommen(client):
    """`layouts` muss ein Objekt je Bildschirmbreite sein; eine Liste wäre Müll und
    würde die Oberfläche auf nichts zurückwerfen — dann besser leer speichern."""
    put(client, {"layouts": [1, 2, 3], "hidden": []}, "home")
    assert get(client, "home")["layouts"] == {}


def test_beide_ansichten_liegen_im_backup(client):
    names = [name for _, name in system._backup_files()]
    assert "dashboard_layout" in names
    assert "dashboard_layout_home" in names
