"""Diagnose-Paket: Geheimnisse dürfen NIE mit rausgehen.

Das ZIP ist zum Verschicken an den Support gedacht. Access-Codes, Tokens und
Passwörter werden deshalb rekursiv ersetzt — auch tief in Listen und
Unter-Objekten, denn genau dort werden sie beim nächsten Ausbau übersehen."""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers.system import _redact  # noqa: E402

DATA = {
    "ip_address": "192.168.1.50",
    "access_code": "12345678",
    "ha_token": "eyJhbGciOi...",
    "nested": {"api_key": "sk-secret", "port": 7125,
               "deep": [{"password": "hunter2"}, {"name": "ok"}]},
    "empty_token": "",
    "camera_type": "rtsp",
}


def test_geheimnisse_werden_ersetzt():
    r = _redact(DATA)
    assert r["access_code"] != "12345678"
    assert r["ha_token"] != "eyJhbGciOi..."
    assert r["nested"]["api_key"] != "sk-secret"
    assert r["nested"]["deep"][0]["password"] != "hunter2"


def test_harmlose_felder_bleiben():
    """Ohne IP/Port ist die Diagnose wertlos — die dürfen bleiben."""
    r = _redact(DATA)
    assert r["ip_address"] == "192.168.1.50"
    assert r["nested"]["port"] == 7125
    assert r["camera_type"] == "rtsp"
    assert r["nested"]["deep"][1]["name"] == "ok"


def test_leeres_geheimnis_bleibt_leer():
    """„" maskieren würde vortäuschen, es sei etwas gesetzt."""
    assert _redact(DATA)["empty_token"] == ""


def test_original_wird_nicht_veraendert():
    _redact(DATA)
    assert DATA["access_code"] == "12345678"


def test_tiefe_verschachtelung_crasht_nicht():
    assert isinstance(_redact({"a": {"b": {"c": {"token": "x"}}}}), dict)
