"""MQTT-Befehle gelten erst als gesendet, wenn paho die Zustellung bestätigt.

paho ≥ 2 kehrt aus wait_for_publish nach dem Zeitlimit ohne Fehler zurück. Bis
v1.1.43 meldete publish_command deshalb True, auch wenn der Drucker nichts bekam.
"""
import json

import pytest

pytest.importorskip("paho.mqtt.client")

from app.services import bambu_mqtt  # noqa: E402


class Geraet:
    id, serial_number, ip_address, access_code = 1, "00M00A000000000", "10.0.0.5", "12345678"


class Ergebnis:
    def __init__(self, rc=0, published=True):
        self.rc, self._published, self.gewartet, self.mid = rc, published, False, 5

    def wait_for_publish(self, timeout=None):
        self.gewartet = True

    def is_published(self):
        return self._published


class Paho:
    """Wie paho 2.x: Jede QoS-1-Nachricht landet in _out_messages, auch ohne Verbindung."""
    def __init__(self, ergebnis):
        import threading
        self.ergebnis, self.gesendet = ergebnis, []
        self._out_messages, self._out_message_mutex = {}, threading.Lock()

    def publish(self, topic, payload, qos=0):
        self.gesendet.append((topic, json.loads(payload)))
        self._out_messages[self.ergebnis.mid] = payload
        return self.ergebnis


def _client(ergebnis):
    c = bambu_mqtt.BambuLabMQTT(Geraet())
    c.client = Paho(ergebnis)
    return c


def test_bestaetigter_befehl_ist_gesendet():
    c = _client(Ergebnis())
    assert c.publish_command({"print": {"command": "pause"}}) is True
    assert c.client.gesendet[0][0] == "device/00M00A000000000/request"


def test_unbestaetigter_befehl_wird_zurueckgenommen():
    e = Ergebnis(published=False)
    c = _client(e)
    assert c.publish_command({"print": {"command": "pause"}}) is False
    assert e.gewartet
    # Sonst sendet paho ihn nach dem Reconnect doch noch.
    assert c.client._out_messages == {}


def test_befehl_ohne_verbindung_wird_zurueckgenommen():
    # rc 4 = MQTT_ERR_NO_CONN: paho behält die Nachricht trotzdem für später.
    e = Ergebnis(rc=4)
    c = _client(e)
    assert c.publish_command({"print": {"command": "pause"}}) is False
    assert not e.gewartet
    assert c.client._out_messages == {}


def test_bestaetigter_befehl_bleibt_pahos_sache():
    c = _client(Ergebnis())
    c.publish_command({"print": {"command": "pause"}})
    assert 5 in c.client._out_messages


def test_jedes_telegramm_setzt_den_zeitstempel():
    c = bambu_mqtt.BambuLabMQTT(Geraet())
    assert c.last_message_ts is None

    class Msg:
        payload = json.dumps({"print": {"gcode_state": "IDLE"}}).encode()
    c._on_message(None, None, Msg())
    assert c.last_message_ts is not None
    assert c.last_message["print"]["gcode_state"] == "IDLE"
