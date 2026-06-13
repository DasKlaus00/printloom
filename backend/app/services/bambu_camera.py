"""Bambu Lab X1/X1C built-in chamber camera (LAN).

The X1C camera is NOT an HTTP/MJPEG stream — Bambu Studio / Orca access it over a
proprietary TLS protocol on port 6000: connect, send an 80-byte auth packet
(username "bblp" + the printer's access code), then the printer streams a sequence
of JPEG frames, each prefixed by a 16-byte header whose first 4 bytes hold the JPEG
length (little-endian).

Requires "LAN-Mode Liveview" enabled on the printer. Blocking socket I/O — call the
generator from a sync context (FastAPI StreamingResponse iterates it in a threadpool).
"""
import socket
import ssl
import struct
import time
import logging
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

CAMERA_PORT = 6000
_MAX_FRAME = 8_000_000  # sanity cap (8 MB) to reject a desynced/garbage length


def _auth_packet(username: str, access_code: str) -> bytes:
    d = bytearray()
    d += struct.pack("<I", 0x40)      # magic
    d += struct.pack("<I", 0x3000)    # magic
    d += struct.pack("<I", 0x0)
    d += struct.pack("<I", 0x0)
    d += username.encode("ascii")[:32].ljust(32, b"\x00")
    d += access_code.encode("ascii")[:32].ljust(32, b"\x00")
    return bytes(d)


def _make_ctx() -> ssl.SSLContext:
    """TLS context for the X1C camera.

    The printer's camera endpoint uses a self-signed cert and a weak/legacy
    cipher suite. OpenSSL 3 (in the container) defaults to security level 2 and
    therefore offers only strong ciphers — the printer then has no common cipher
    and aborts with SSLV3_ALERT_HANDSHAKE_FAILURE. Dropping to SECLEVEL=0 (and
    allowing older TLS + legacy renegotiation) makes the handshake succeed.
    """
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    try:
        ctx.minimum_version = ssl.TLSVersion.TLSv1
    except (ValueError, AttributeError):
        pass
    for ciphers in ("DEFAULT@SECLEVEL=0", "ALL:@SECLEVEL=0", "ALL"):
        try:
            ctx.set_ciphers(ciphers)
            break
        except ssl.SSLError:
            continue
    ctx.options |= getattr(ssl, "OP_LEGACY_SERVER_CONNECT", 0)
    return ctx


def _connect(ip: str, access_code: str, timeout: float = 8.0) -> ssl.SSLSocket:
    ctx = _make_ctx()
    raw = socket.create_connection((ip, CAMERA_PORT), timeout=timeout)
    sock = ctx.wrap_socket(raw, server_hostname=ip)
    sock.sendall(_auth_packet("bblp", access_code))
    return sock


def _recv_exact(sock: ssl.SSLSocket, n: int) -> bytes:
    buf = bytearray()
    while len(buf) < n:
        chunk = sock.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("Kamera-Stream geschlossen")
        buf += chunk
    return bytes(buf)


def frames(ip: str, access_code: str, read_timeout: float = 15.0,
           max_frames: Optional[int] = None) -> Iterator[bytes]:
    """Yield JPEG frames from the chamber camera. Raises on connect/stream failure.

    Marker-based extraction: rather than trust the 16-byte binary frame header
    (whose layout varies between firmwares), we scan the byte stream for JPEG
    SOI (FF D8 FF) … EOI (FF D9) and emit whatever sits between them. The framing
    headers in between are simply discarded as "junk before the next SOI", so this
    works across firmware variants and resyncs automatically.
    """
    attempt = 0
    max_attempts = 1 if max_frames == 1 else 3
    while True:
        sock = _connect(ip, access_code)
        sock.settimeout(read_timeout)
        buf = bytearray()
        count = 0
        total = 0
        try:
            while True:
                chunk = sock.recv(65536)
                if not chunk:
                    raise ConnectionError("Kamera-Stream geschlossen")
                total += len(chunk)
                buf += chunk

                while True:
                    start = buf.find(b"\xff\xd8\xff")          # JPEG SOI
                    if start < 0:
                        # No frame start yet — keep only a small tail so framing
                        # headers / junk don't grow the buffer without bound.
                        if len(buf) > _MAX_FRAME:
                            del buf[:-2]
                        break
                    if start > 0:
                        del buf[:start]                        # drop header/junk before SOI
                    end = buf.find(b"\xff\xd9", 2)             # JPEG EOI
                    if end < 0:
                        if len(buf) > _MAX_FRAME:
                            raise ConnectionError("Frame zu groß / kein JPEG-Ende gefunden")
                        break                                  # need more data
                    jpeg = bytes(buf[:end + 2])
                    del buf[:end + 2]
                    yield jpeg
                    count += 1
                    if max_frames and count >= max_frames:
                        return

                # Data is flowing but nothing looks like a JPEG → auth/LAN issue.
                if count == 0 and total > 512_000:
                    raise ConnectionError(
                        "Kein JPEG empfangen — Access-Code falsch oder LAN-Modus Liveview aus")
        except (ConnectionError, OSError) as e:
            try:
                sock.close()
            except Exception:
                pass
            # The printer sometimes drops a fresh connection instantly because a
            # previous camera session hasn't been released yet. If we haven't seen
            # a single frame, give it a moment and reconnect before giving up.
            attempt += 1
            if count == 0 and attempt < max_attempts:
                logger.info(f"X1C-Kamera: Verbindung sofort geschlossen, Versuch {attempt+1}/{max_attempts}…")
                time.sleep(0.8)
                continue
            raise
        finally:
            try:
                sock.close()
            except Exception:
                pass
        return


def single_frame(ip: str, access_code: str) -> Optional[bytes]:
    """Grab one JPEG frame (for snapshots). Returns bytes or raises on failure."""
    for img in frames(ip, access_code, max_frames=1):
        return img
    return None
