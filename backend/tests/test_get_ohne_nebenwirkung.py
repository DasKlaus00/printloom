"""GET-Anfragen ändern nichts und gehen nicht ins Internet.

Ein GET kann jede fremde Seite auslösen, schon mit <img src="…">, und der Wächter in
main.py sperrt fremde Seiten nur beim Schreiben. Bis v1.1.41 gingen per GET: die
Update-Prüfung im Internet trotz abgeschalteter Freigabe (force=1), ein Netzscan in
beliebige Netze, ein wachsender Crash-Cache für erfundene Plattenbreiten und das
Kammerlicht des Druckers.
"""
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.db.database import get_db  # noqa: E402
from app.main import app  # noqa: E402
from app.models.models import Base, Device, PrinterType  # noqa: E402
from app.routers import printer, system  # noqa: E402
from app.services import appsettings, device_settings, online  # noqa: E402

client = TestClient(app)


# ── Update-Prüfung ────────────────────────────────────────────────────────────

@pytest.fixture
def pruefungen(monkeypatch):
    """Zählt Prüfungen im Internet; die Online-Freigabe ist aus."""
    calls = []

    async def fake(current):
        calls.append(current)
        return {"current": current, "latest": "9.9.9", "update_available": True, "error": None}
    monkeypatch.setattr(system, "_check_stable", fake)
    monkeypatch.setattr(system, "_check_beta", fake)
    monkeypatch.setattr(system.paths, "RUNTIME", "docker")
    monkeypatch.setattr(online, "enabled", lambda feature: False)
    return calls


def test_get_version_mit_force_geht_nicht_ins_internet(pruefungen):
    r = client.get("/api/system/version", params={"force": 1})
    assert r.status_code == 200
    assert r.json()["online_disabled"] is True
    assert pruefungen == []


def test_pruefung_auf_knopfdruck_ist_ein_post(pruefungen):
    r = client.post("/api/system/version/check")
    assert r.status_code == 200
    assert r.json()["latest"] == "9.9.9"
    assert len(pruefungen) == 1


def test_eingeschaltete_pruefung_fragt_nicht_bei_jedem_get(pruefungen, monkeypatch):
    monkeypatch.setattr(online, "enabled", lambda feature: True)
    monkeypatch.setattr(system, "_VERSION_CACHE", {})
    for _ in range(3):
        assert client.get("/api/system/version").json()["latest"] == "9.9.9"
    assert len(pruefungen) == 1
    # Der Knopf fragt immer frisch.
    client.post("/api/system/version/check")
    assert len(pruefungen) == 2


# ── Netzscan ──────────────────────────────────────────────────────────────────

@pytest.fixture
def scans(monkeypatch):
    from app.services import discovery
    calls = []

    async def fake_discover(timeout=4.0, subnet=None):
        calls.append(subnet)
        return {"bambu": [], "klipper": []}
    monkeypatch.setattr(discovery, "discover", fake_discover)
    return calls


@pytest.mark.parametrize("subnet", ["evil.example", "8.8.8", "192.168.1.0/16", "300.1.1", "1.2.3.4"])
def test_netzscan_nur_private_netze(subnet, scans):
    r = client.post("/api/devices/discover", params={"subnet": subnet})
    assert r.status_code == 400
    assert scans == []


@pytest.mark.parametrize("subnet,expected", [("192.168.1", "192.168.1"), ("10.0.0.", "10.0.0"),
                                             (None, None)])
def test_netzscan_im_heimnetz(subnet, expected, scans):
    r = client.post("/api/devices/discover", params={"subnet": subnet} if subnet else {})
    assert r.status_code == 200, r.text
    assert scans == [expected]


# ── Crash-Cache ───────────────────────────────────────────────────────────────

def test_crash_check_nur_fuer_bekannte_plattenbreiten():
    assert client.get("/api/files/999999/crash-check", params={"x_max": 123.4}).status_code == 400
    # Bekannte Breite: weiter bis zur Dateisuche (die es nicht gibt).
    assert client.get("/api/files/999999/crash-check", params={"x_max": 256}).status_code == 404


# ── Kamera und Kammerlicht ────────────────────────────────────────────────────

@pytest.fixture
def drucker(monkeypatch):
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()
    d = Device(name="X1C", device_type=PrinterType.BAMBU_LAB, model="x1c", ip_address="10.0.0.5",
               port=990, serial_number="00M00A000000000", access_code="12345678")
    db.add(d)
    db.commit()

    def _get_db():
        s = Session()
        try:
            yield s
        finally:
            s.close()
    app.dependency_overrides[get_db] = _get_db
    light = []
    monkeypatch.setattr(printer, "_ensure_chamber_light_async", lambda dev, on=True: light.append(dev.id))
    monkeypatch.setattr(printer.camera, "single_frame", lambda dev, settings: b"\xff\xd8jpeg")
    monkeypatch.setattr(appsettings, "camera_disabled", lambda: False)
    yield {"db": db, "id": d.id, "light": light}
    app.dependency_overrides.pop(get_db, None)
    db.close()
    engine.dispose()


def test_kamerabild_schaltet_kein_licht(drucker):
    r = client.get(f"/api/printer/camera/{drucker['id']}/frame")
    assert r.status_code == 200
    assert drucker["light"] == []


def test_licht_schaltet_der_post_der_live_ansicht(drucker):
    r = client.post(f"/api/printer/camera/{drucker['id']}/light")
    assert r.status_code == 200 and r.json()["success"] is True
    assert drucker["light"] == [drucker["id"]]


def test_kamera_aus_fuer_diesen_drucker(drucker):
    device_settings.put(drucker["db"], drucker["id"], {"camera_enabled": False})
    assert client.get(f"/api/printer/camera/{drucker['id']}/frame").status_code == 503
    assert client.get(f"/api/printer/camera/{drucker['id']}").status_code == 503
    r = client.post(f"/api/printer/camera/{drucker['id']}/light")
    assert r.json() == {"success": False, "reason": "camera_off"}
    assert drucker["light"] == []


def test_crash_cache_waechst_nicht_ueber_erfundene_platten(tmp_path, monkeypatch):
    # Eine .gcode hat keine Platten; jede Nummer ist derselbe Scan.
    from app.routers import files as files_router
    gcode = tmp_path / "teil.gcode"
    gcode.write_text("G1 X5 Z40\n", encoding="utf-8")

    class Datei:
        id, file_type, file_path = 7, ".gcode", str(gcode)

    class Q:
        def filter(self, *a, **kw):
            return self

        def first(self):
            return Datei()

    class DB:
        def query(self, *a):
            return Q()
    monkeypatch.setattr(files_router, "_crash_cache_file", lambda: tmp_path / "crash_cache.json")
    monkeypatch.setattr(files_router, "_CRASH_CACHE", {})
    for plate in (None, 1, 2, 99, 12345):
        files_router.crash_check(7, plate=plate, x_max=256.0, db=DB())
    assert list(files_router._CRASH_CACHE) == [(7, None, 256.0)]


# ── Online-Dienste: „neu laden" nur per POST ─────────────────────────────────

@pytest.fixture
def abrufe(monkeypatch):
    calls = []

    async def fake_fetch(path, feature, *, force=False, **kw):
        calls.append((feature, force))
        return {"data": None, "fetched_at": None, "from_cache": True, "disabled": False, "error": None}
    monkeypatch.setattr(online, "fetch", fake_fetch)
    return calls


def test_get_mit_refresh_umgeht_den_cache_nicht(abrufe):
    client.get("/api/online/notices", params={"refresh": 1})
    client.get("/api/online/library", params={"refresh": 1})
    assert abrufe == [("notices", False), ("library", False)]


def test_neu_laden_ist_ein_post(abrufe):
    assert client.post("/api/online/notices/refresh").status_code == 200
    assert client.post("/api/online/library/refresh").status_code == 200
    assert abrufe == [("notices", True), ("library", True)]
