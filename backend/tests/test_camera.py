"""Kamera: Backend-Auswahl je Drucker + das P1/A1-Protokoll auf Port 6000.

Hintergrund: Die X1-Serie liefert RTSPS auf Port 322, P1/A1 sprechen ein eigenes
JPEG-Protokoll auf Port 6000 (80-Byte-Auth, 16-Byte-Kopf pro Bild). Wird das
falsche Backend gewählt, bleibt die Kameraansicht leer — deshalb hier die
Reihenfolge der Auswahl und das Parsen der Bildströme festgenagelt."""
import socket
import struct

import pytest

from app.services import bambu_camera as bc
from app.services import camera


class Dev:
    """Minimaler Geräte-Ersatz (nur die Felder, die camera.py liest)."""

    def __init__(self, ip=None, serial="", model=None):
        self.ip_address = ip
        self.serial_number = serial
        self.model = model


# ── Auth-Paket ───────────────────────────────────────────────────────────────
def test_auth_paket_ist_genau_80_byte():
    pkt = bc._auth_packet("12345678")
    assert len(pkt) == 80
    assert struct.unpack("<I", pkt[0:4])[0] == 0x40
    assert struct.unpack("<I", pkt[4:8])[0] == 0x3000


def test_auth_paket_felder_an_der_richtigen_stelle():
    pkt = bc._auth_packet("12345678")
    assert pkt[16:48] == b"bblp".ljust(32, b"\x00")
    assert pkt[48:80] == b"12345678".ljust(32, b"\x00")


def test_auth_paket_laeuft_nicht_ueber():
    """Zu langer Access-Code darf das Paket nicht sprengen (Drucker würde die
    Verbindung sonst ohne Erklärung schließen)."""
    assert len(bc._auth_packet("x" * 100)) == 80
    assert len(bc._auth_packet("")) == 80
    assert len(bc._auth_packet(None)) == 80


# ── Bildstrom lesen ──────────────────────────────────────────────────────────
class FakeSock:
    """recv() liefert absichtlich winzige Häppchen — echte Sockets tun das auch,
    und genau daran scheitern naive Parser."""

    def __init__(self, data: bytes, chunk=7):
        self.data, self.pos, self.chunk = data, 0, chunk

    def recv(self, n):
        n = min(n, self.chunk)
        out = self.data[self.pos:self.pos + n]
        self.pos += len(out)
        return out          # b"" = EOF


def _frame(jpeg: bytes) -> bytes:
    """Ein Port-6000-Datensatz: 16-Byte-Kopf (Länge in [0:4]) + JPEG."""
    return struct.pack("<I", len(jpeg)) + b"\x00" * 12 + jpeg


JPEG1 = b"\xff\xd8\xff\xe0" + b"A" * 50 + b"\xff\xd9"
JPEG2 = b"\xff\xd8\xff\xe0" + b"B" * 200 + b"\xff\xd9"


def test_read_exact_ueber_mehrere_chunks():
    assert bc._read_exact(FakeSock(b"HELLO WORLD", chunk=3), 11) == b"HELLO WORLD"


def test_read_exact_bei_eof_none():
    assert bc._read_exact(FakeSock(b"ab", chunk=3), 5) is None


def test_zwei_bilder_trotz_fragmentierung():
    got = []
    bc._read_frames(FakeSock(_frame(JPEG1) + _frame(JPEG2), chunk=7), got.append)
    assert got == [JPEG1, JPEG2]


def test_on_frame_false_stoppt():
    """So beendet der Hub den Producer, wenn kein Zuschauer mehr da ist."""
    got = []
    bc._read_frames(FakeSock(_frame(JPEG1) + _frame(JPEG2), chunk=64),
                    lambda j: got.append(j) or False)
    assert got == [JPEG1]


def test_ablehnung_durch_drucker():
    """Neuere X1C-Firmware antwortet auf Port 6000 mit 0xFFFFFFFF — das muss als
    klarer Fehler ankommen, nicht als leeres Bild."""
    with pytest.raises(ConnectionError) as e:
        bc._read_frames(FakeSock(b"\xff\xff\xff\xff" + b"\x00" * 12, chunk=64), lambda j: None)
    assert "6000" in str(e.value) or "lehnt" in str(e.value)


def test_unsinnige_bildgroesse_wird_abgelehnt():
    for size in (99_000_000, 0):
        with pytest.raises(ConnectionError):
            bc._read_frames(FakeSock(struct.pack("<I", size) + b"\x00" * 12, chunk=64),
                            lambda j: None)


def test_abgebrochener_stream_behaelt_ganze_bilder():
    """Drucker schließt mitten im Bild → die vollständigen Bilder bleiben, kein Crash."""
    data = _frame(JPEG1) + struct.pack("<I", len(JPEG2)) + b"\x00" * 12 + JPEG2[:10]
    got = []
    bc._read_frames(FakeSock(data, chunk=64), got.append)
    assert got == [JPEG1]


# ── Backend-Auswahl ──────────────────────────────────────────────────────────
def test_explizite_einstellung_gewinnt_immer():
    assert camera.resolve_backend(Dev(ip="1.2.3.4", serial="01P9", model="x1c"),
                                  {"camera_type": "bambu"}) == "bambu"
    assert camera.resolve_backend(Dev(ip="1.2.3.4", model="p1s"),
                                  {"camera_type": "rtsp"}) == "rtsp"
    assert camera.resolve_backend(Dev(ip="1.2.3.4"), {"camera_type": "none"}) == "none"
    assert camera.resolve_backend(Dev(ip="1.2.3.4"), {"camera_type": "BAMBU"}) == "bambu"


def test_unbekannter_camera_type_wird_ignoriert():
    assert camera.resolve_backend(Dev(serial="00M1"), {"camera_type": "weird"}) == "rtsp"


def test_modell_schlaegt_probe(monkeypatch):
    """Mit gespeichertem Modell darf KEIN Netz-Probe mehr laufen (das war der Grund
    für die Port-322-Probe) — und die Seriennummer darf nicht überstimmen."""
    def _boom(ip):
        raise AssertionError("darf nicht proben, Modell ist bekannt")

    monkeypatch.setattr(camera, "_probe", _boom)
    assert camera.resolve_backend(Dev(ip="1.2.3.4", serial="00M1", model="p1s")) == "bambu"
    assert camera.resolve_backend(Dev(ip="1.2.3.4", serial="01S1", model="x1c")) == "rtsp"


def test_unbekanntes_modell_probt_weiter(monkeypatch):
    monkeypatch.setattr(camera, "_probe", lambda ip: "bambu")
    for model in (None, "", "h2d", "other", "gibtsnicht"):
        assert camera.resolve_backend(Dev(ip="1.2.3.4", model=model)) == "bambu"


def test_seriennummer_als_letzter_ausweg():
    """Ohne IP kann nicht geprobt werden — dann entscheidet das Präfix."""
    assert camera.resolve_backend(Dev(serial="00M12345")) == "rtsp"
    assert camera.resolve_backend(Dev(serial="01P12345")) == "bambu"
    assert camera.resolve_backend(Dev(serial="03912345")) == "bambu"
    assert camera.resolve_backend(Dev(serial="ZZZ")) == "rtsp"


def test_probe_offener_port_ist_rtsp(monkeypatch):
    """Ein offener Port 322 = X1-Serie. Hier gegen einen echten lokalen Listener."""
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    srv.listen(1)
    monkeypatch.setattr(camera, "RTSP_PROBE_PORT", port)
    monkeypatch.setattr(camera, "_probe_cache", {})
    try:
        assert camera.resolve_backend(Dev(ip="127.0.0.1")) == "rtsp"
    finally:
        srv.close()


def test_probe_geschlossener_port_ist_bambu(monkeypatch):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.bind(("127.0.0.1", 0))
    port = srv.getsockname()[1]
    srv.close()                          # Port jetzt zu
    monkeypatch.setattr(camera, "RTSP_PROBE_PORT", port)
    cache = {}
    monkeypatch.setattr(camera, "_probe_cache", cache)
    assert camera.resolve_backend(Dev(ip="127.0.0.1")) == "bambu"
    assert "127.0.0.1" in cache          # Ergebnis wird gecacht (kein Probe-Sturm)
