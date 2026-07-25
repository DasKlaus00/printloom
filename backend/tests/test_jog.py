"""Einmess-Jog: der Arm darf beim Justieren NIE aus der Achse fahren.

Der Assistent verfährt in kleinen Schritten, während der Nutzer hinsieht. Genau
dabei tippt man sich schnell aus dem Bereich — und ein von Klipper mitten in der
Bewegung abgelehnter Move ist beim Einmessen besonders unangenehm (Arm steht
irgendwo, Position unklar). Deshalb wird JEDER Schritt vorher gerechnet und
geprüft, statt ihn blind zu senden."""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import control  # noqa: E402


class FakeKlipper:
    device_type = None
    ip_address = "127.0.0.1"
    port = 7125


class FakeQuery:
    def __init__(self, result):
        self._r = result

    def filter(self, *a, **kw):
        return self

    def first(self):
        return self._r


class FakeDB:
    def __init__(self, device=FakeKlipper()):
        self._d = device

    def query(self, *a, **kw):
        return FakeQuery(self._d)


SENT = []


def _fake_httpx(position=(100.0, 100.0, 100.0), homed="xyz"):
    """Moonraker-Ersatz: liefert eine Ist-Position und merkt sich gesendete Scripts."""
    class Resp:
        status_code = 200
        text = ""

        def json(self):
            return {"result": {"status": {"toolhead": {
                "position": list(position) + [0.0], "homed_axes": homed}}}}

    class Client:
        def __init__(self, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, **kw):
            return Resp()

        async def post(self, url, json=None, **kw):
            SENT.append((json or {}).get("script", ""))
            return Resp()

    class Mod:
        AsyncClient = Client
        Timeout = control.httpx.Timeout
        ReadTimeout = control.httpx.ReadTimeout

    return Mod


@pytest.fixture(autouse=True)
def _clean(monkeypatch, tmp_path):
    SENT.clear()
    monkeypatch.setattr(control, "GEOMETRY_PATH", str(tmp_path / "geom.json"))
    yield


def _jog(**body):
    return asyncio.run(control.jog_ottoeject(body, db=FakeDB()))


def _limits(monkeypatch, limits):
    """Geometrie mit gesetzten Achsgrenzen unterschieben."""
    monkeypatch.setattr(control, "_load_geometry",
                        lambda: control._motion.merge_defaults({"machine_limits": limits}))


# ── Eingaben ─────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("body", [
    {"axis": "q", "delta": 1}, {"axis": "", "delta": 1},
    {"axis": "x", "delta": "abc"}, {"axis": "x", "delta": 0},
])
def test_unsinnige_eingabe_wird_abgelehnt(body):
    with pytest.raises(HTTPException):
        _jog(**body)


def test_grosser_einzelschritt_wird_abgelehnt():
    """Beim Einmessen justiert man in Millimetern — 500 mm auf einen Schlag ist
    immer ein Tippfehler."""
    with pytest.raises(HTTPException) as e:
        _jog(axis="x", delta=500)
    assert "100" in str(e.value.detail)


# ── Achsgrenzen ──────────────────────────────────────────────────────────────
def test_unter_null_wird_abgelehnt(monkeypatch):
    monkeypatch.setattr(control, "httpx", _fake_httpx(position=(3.0, 100.0, 100.0)))
    with pytest.raises(HTTPException) as e:
        _jog(axis="x", delta=-10)
    assert "Endschalter" in str(e.value.detail)
    assert SENT == []          # nichts gesendet


def test_ueber_der_achsgrenze_wird_abgelehnt(monkeypatch):
    monkeypatch.setattr(control, "httpx", _fake_httpx(position=(480.0, 100.0, 100.0)))
    _limits(monkeypatch, {"x": 485, "y": 340, "z": 365})
    with pytest.raises(HTTPException) as e:
        _jog(axis="x", delta=10)
    assert "485" in str(e.value.detail)
    assert SENT == []


def test_ohne_bekannte_grenze_nur_untergrenze(monkeypatch):
    """Grenzen unbekannt → nach oben wird nicht blockiert (verlängerte Schiene)."""
    monkeypatch.setattr(control, "httpx", _fake_httpx(position=(900.0, 100.0, 100.0)))
    r = _jog(axis="x", delta=10)
    assert r["to"] == 910.0 and SENT


def test_nicht_referenzierte_achse(monkeypatch):
    monkeypatch.setattr(control, "httpx", _fake_httpx(homed="xy"))
    with pytest.raises(HTTPException) as e:
        _jog(axis="z", delta=1)
    assert "referenziert" in str(e.value.detail)


# ── Gesendeter G-code ────────────────────────────────────────────────────────
def test_faehrt_absolut_nicht_relativ(monkeypatch):
    """G91 würde nach einem Fehlschlag auf einer unbekannten Ist-Position
    aufsetzen — deshalb immer G90 + Zielkoordinate."""
    monkeypatch.setattr(control, "httpx", _fake_httpx(position=(100.0, 200.0, 50.0)))
    r = _jog(axis="y", delta=-0.5)
    assert r["from"] == 200.0 and r["to"] == 199.5
    assert len(SENT) == 1
    assert SENT[0].startswith("G90")
    assert "Y199.5" in SENT[0]
    assert "G91" not in SENT[0]


def test_vorschub_wird_begrenzt(monkeypatch):
    monkeypatch.setattr(control, "httpx", _fake_httpx())
    _jog(axis="x", delta=1, feed=99999)
    assert "F6000" in SENT[0]
    SENT.clear()
    _jog(axis="x", delta=1, feed=1)
    assert "F60" in SENT[0]


def test_ohne_ottoeject_klare_meldung():
    with pytest.raises(HTTPException) as e:
        asyncio.run(control.jog_ottoeject({"axis": "x", "delta": 1}, db=FakeDB(None)))
    assert "OTTOeject" in str(e.value.detail)
