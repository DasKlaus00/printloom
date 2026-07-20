"""P1/A1-Serie: Kammer-Kamera über das ältere Port-6000-JPEG-Protokoll.

Anders als die X1-Serie (RTSPS auf Port 322, siehe rtsp_camera) stellen P1P/P1S und
A1/A1 mini KEINEN RTSP-Stream bereit. Ihre eingebaute Kamera ist nur über Bambus
proprietäres „chamber image"-Protokoll erreichbar:

  1. TLS-Socket auf Port 6000 öffnen.
  2. 80-Byte-Auth senden: 16-Byte-Kopf + Benutzername „bblp" (32 B) + Access-Code (32 B).
  3. Der Drucker schiebt daraufhin JPEG-Frames — jedes mit einem 16-Byte-Kopf, dessen
     erste 4 Bytes die JPEG-Länge (little-endian) angeben; danach genau so viele Bytes.

Niedrige Bildrate (~1–wenige fps) — eine Folge von Standbildern, KEIN Video. Neuere
X1C-Firmware (≥01.11) LEHNT dieses Protokoll ab (antwortet ff ff ff ff) — deshalb geht
die X1-Serie über RTSPS. Für P1/A1 ist das der einzige lokale Weg. Voraussetzung:
„LAN-Modus" am Drucker aktiv.

Der geteilte Hub (ein Client pro Drucker, Fan-out, Leerlauf-Stopp, Snapshot) kommt aus
camera_hub — hier steckt nur der Socket-`Producer`.
"""
import socket
import ssl
import struct
import logging
from typing import Iterator, Optional

from app.services import camera_hub
from app.services.camera_hub import executor  # re-export: geteilter Kamera-Pool

logger = logging.getLogger(__name__)

BAMBU_CAM_PORT = 6000
_USERNAME = "bblp"
_MAX_FRAME = 8_000_000        # sanity cap (8 MB) für ein JPEG
_CONNECT_TIMEOUT = 6.0
_READ_TIMEOUT = 20.0          # so lange kein Byte → Stream gilt als tot

_NO_IMAGE = ("Keine Kamera-Antwort (Port 6000) — LAN-Modus am Drucker aktiv? "
             "Access-Code korrekt?")


def _auth_packet(access_code: str) -> bytes:
    """80-Byte-Auth: 16-Byte-Kopf + Benutzername (32 B, null-gepolstert) +
    Access-Code (32 B, null-gepolstert)."""
    d = bytearray()
    d += struct.pack("<I", 0x40)       # payload length
    d += struct.pack("<I", 0x3000)     # type
    d += struct.pack("<I", 0)
    d += struct.pack("<I", 0)
    d += _USERNAME.encode("ascii")[:32].ljust(32, b"\x00")
    d += (access_code or "").encode("ascii")[:32].ljust(32, b"\x00")
    return bytes(d)


def _ssl_ctx() -> ssl.SSLContext:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE     # Drucker-Zertifikat ist selbstsigniert
    return ctx


def _connect(ip: str, access_code: str, connect_timeout: float = _CONNECT_TIMEOUT):
    """TLS-Socket öffnen, Auth senden, verbundenen Socket zurückgeben."""
    raw = socket.create_connection((ip, BAMBU_CAM_PORT), timeout=connect_timeout)
    try:
        sock = _ssl_ctx().wrap_socket(raw, server_hostname=ip)
    except ssl.SSLError:
        # Manche Drucker brauchen ein niedrigeres Security-Level für ihren
        # schwachen Cipher/ihr Zertifikat — einmal so nachfassen.
        try:
            raw.close()
        except Exception:
            pass
        raw = socket.create_connection((ip, BAMBU_CAM_PORT), timeout=connect_timeout)
        ctx = _ssl_ctx()
        try:
            ctx.set_ciphers("DEFAULT:@SECLEVEL=0")
        except ssl.SSLError:
            pass
        sock = ctx.wrap_socket(raw, server_hostname=ip)
    sock.sendall(_auth_packet(access_code))
    return sock


def _read_exact(sock, n: int) -> Optional[bytes]:
    """Genau n Bytes lesen; None bei sauberem Verbindungsende."""
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return bytes(buf)


def _read_frames(sock, on_frame) -> None:
    """Port-6000-Frame-Schleife: 16-Byte-Kopf (Länge in Byte 0..3) + JPEG-Nutzlast.
    Ruft on_frame(jpeg) je Bild; on_frame False → beenden."""
    while True:
        header = _read_exact(sock, 16)
        if header is None:
            return
        size = struct.unpack("<I", header[0:4])[0]
        if size == 0xFFFFFFFF:
            raise ConnectionError(
                "Drucker lehnt die Port-6000-Kamera ab (neuere Firmware?) — "
                "bei X1C den RTSPS-Weg oder Home Assistant nutzen")
        if size == 0 or size > _MAX_FRAME:
            raise ConnectionError(f"Ungültige Bildgröße vom Drucker ({size} Bytes)")
        jpeg = _read_exact(sock, size)
        if jpeg is None:
            return
        if on_frame(jpeg) is False:
            return


# ── Socket-Producer (P1/A1, Port 6000) ───────────────────────────────────────
class _BambuProducer(camera_hub.Producer):
    default_error = _NO_IMAGE

    def __init__(self, ip: str, access_code: str):
        self.ip, self.code = ip, access_code
        self.sock = None
        self._err = ""

    def open(self) -> None:
        try:
            self.sock = _connect(self.ip, self.code)
            self.sock.settimeout(_READ_TIMEOUT)
        except Exception as e:
            raise ConnectionError(f"Port 6000 nicht erreichbar: {e}")

    def read(self, on_frame) -> None:
        try:
            _read_frames(self.sock, on_frame)
        except socket.timeout:
            self._err = "Zeitüberschreitung — kein Kamerabild vom Drucker"
        except ConnectionError as e:
            self._err = str(e)
            raise
        except OSError as e:
            self._err = str(e)

    def close(self) -> None:
        if self.sock is not None:
            try:
                self.sock.close()
            except Exception:
                pass

    def error_detail(self) -> str:
        return self._err


def _key(ip: str, access_code: str):
    return ("bambu", ip, access_code)


def _raise_if_disabled() -> None:
    from app.services import appsettings
    if appsettings.camera_disabled():
        raise ConnectionError(
            "Kamera in Printloom deaktiviert (System → Kamera) — Energiesparmodus")


def stop_all() -> None:
    camera_hub.stop_all()


def stream(ip: str, access_code: str, read_timeout: float = 15.0) -> Iterator[bytes]:
    """JPEG-Frames für einen Live-Zuschauer über den geteilten Hub (ein Socket
    pro Drucker). Wirft ConnectionError mit dem echten Grund, wenn nicht erreichbar."""
    _raise_if_disabled()
    hub = camera_hub.get_hub(_key(ip, access_code),
                             lambda: _BambuProducer(ip, access_code), read_timeout)
    return hub.frames_iter()


def single_frame(ip: str, access_code: str) -> Optional[bytes]:
    """Ein JPEG-Frame (Snapshots). Läuft ein Hub, dessen aktuelles Frame nehmen
    (kein zweiter Client); sonst kurz selbst verbinden, ein Frame lesen, schließen."""
    _raise_if_disabled()
    hub = camera_hub.find_hub(_key(ip, access_code))
    if hub is not None:
        img = hub.latest_frame()
        if img:
            return img
    prod = _BambuProducer(ip, access_code)
    prod.open()
    result: list = []
    try:
        def _grab(jpeg: bytes):
            result.append(jpeg)
            return False
        prod.read(_grab)
    finally:
        prod.close()
    if result:
        return result[0]
    raise ConnectionError(prod.error_detail() or _NO_IMAGE)
