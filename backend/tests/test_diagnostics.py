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
    r = _redact(DATA)
    assert r["nested"]["port"] == 7125
    assert r["camera_type"] == "rtsp"
    assert r["nested"]["deep"][1]["name"] == "ok"


def test_das_netz_bleibt_erkennbar_das_geraet_nicht():
    """Bei „nicht erreichbar" muss man sehen, ob Printloom im selben Netz sucht
    (192.168.1.x) oder im Docker-Netz (172.17.0.x) — welches Gerät, verrät es nicht."""
    assert _redact(DATA)["ip_address"] == "192.168.1.x"
    assert _redact({"log": ["Klipper 10.0.0.7 antwortet nicht"]})["log"] == \
        ["Klipper 10.0.0.x antwortet nicht"]


def test_rechnernamen_und_zugangsdaten_in_urls_verschwinden():
    r = _redact({"ha_url": "http://wohnzimmer-nas.fritz.box:8123/api",
                 "webcam_url": "rtsp://admin:geheim@192.168.1.60/stream"})
    assert r["ha_url"] == "http://<host>:8123/api"
    assert "geheim" not in r["webcam_url"] and "admin" not in r["webcam_url"]
    assert r["webcam_url"] == "rtsp://192.168.1.x/stream"


def test_leeres_geheimnis_bleibt_leer():
    """„" maskieren würde vortäuschen, es sei etwas gesetzt."""
    assert _redact(DATA)["empty_token"] == ""


def test_original_wird_nicht_veraendert():
    _redact(DATA)
    assert DATA["access_code"] == "12345678"


def test_tiefe_verschachtelung_crasht_nicht():
    assert isinstance(_redact({"a": {"b": {"c": {"token": "x"}}}}), dict)
