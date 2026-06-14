"""X1C chamber camera via its RTSPS stream, transcoded by ffmpeg.

Newer X1C firmware (>=01.11) rejects the legacy port-6000 camera protocol
(see bambu_camera.py) but still exposes the chamber camera as RTSPS:

    rtsps://bblp:<access_code>@<ip>:322/streaming/live/1

Browsers can't play RTSPS, so the backend runs ffmpeg to pull it and emit MJPEG
(a sequence of JPEG frames) that a plain <img> / multipart response can show —
exactly what `ffplay -rtsp_transport tcp -i rtsps://…` does, but server-side.
ffmpeg holds the single RTSP client slot the printer allows and we fan its frames
out to all viewers.

Requires ffmpeg in the image and "LAN Mode Liveview" enabled on the printer.
The cert is self-signed; ffmpeg's rtsps client does not verify it by default.
"""
import subprocess
import threading
import logging
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

RTSP_PORT = 322
_MAX_FRAME = 8_000_000      # sanity cap (8 MB) for a single JPEG


def _url(ip: str, access_code: str) -> str:
    return f"rtsps://bblp:{access_code}@{ip}:{RTSP_PORT}/streaming/live/1"


def _cmd(ip: str, access_code: str, single: bool, fps: int = 10) -> list:
    # NOTE: no -rw_timeout / -stimeout here — those vary by ffmpeg build and the
    # RTSP demuxer rejects unknown ones ("Error opening input files: Option not
    # found"). A connect/first-frame timeout is enforced with a watchdog instead.
    cmd = [
        "ffmpeg", "-loglevel", "error", "-nostdin",
        "-rtsp_transport", "tcp",
        "-i", _url(ip, access_code),
        "-an",                                 # X1C stream has no audio
    ]
    cmd += ["-frames:v", "1"] if single else ["-r", str(fps)]
    cmd += ["-f", "mjpeg", "-q:v", "6", "pipe:1"]
    return cmd


def frames(ip: str, access_code: str, read_timeout: float = 15.0,
           max_frames: Optional[int] = None) -> Iterator[bytes]:
    """Yield JPEG frames from the X1C RTSPS stream via ffmpeg. Raises on failure.

    Same marker-based extraction as the legacy reader: scan the MJPEG byte stream
    for JPEG SOI (FF D8 FF) … EOI (FF D9) and emit whatever sits between them.
    """
    single = (max_frames == 1)
    proc = subprocess.Popen(
        _cmd(ip, access_code, single),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
    )
    # Watchdog: if ffmpeg produces no first frame within read_timeout (printer off /
    # unreachable / LAN-Liveview aus), kill it so the read() returns and we raise.
    got_first = threading.Event()
    def _watchdog():
        if not got_first.wait(read_timeout):
            try:
                proc.kill()
            except Exception:
                pass
    threading.Thread(target=_watchdog, daemon=True).start()
    buf = bytearray()
    count = 0
    try:
        while True:
            chunk = proc.stdout.read(65536)
            if not chunk:
                break
            buf += chunk
            while True:
                start = buf.find(b"\xff\xd8\xff")        # JPEG SOI
                if start < 0:
                    if len(buf) > _MAX_FRAME:
                        del buf[:-2]
                    break
                if start > 0:
                    del buf[:start]
                end = buf.find(b"\xff\xd9", 2)           # JPEG EOI
                if end < 0:
                    if len(buf) > _MAX_FRAME:
                        raise ConnectionError("Frame zu groß / kein JPEG-Ende gefunden")
                    break
                jpeg = bytes(buf[:end + 2])
                del buf[:end + 2]
                got_first.set()  # stop the connect watchdog
                yield jpeg
                count += 1
                if max_frames and count >= max_frames:
                    return
        if count == 0:
            err = b""
            try:
                err = proc.stderr.read() or b""
            except Exception:
                pass
            detail = err.decode("utf-8", "ignore").strip().splitlines()
            msg = detail[-1] if detail else ""
            raise ConnectionError(
                msg or "ffmpeg lieferte kein Bild — LAN-Modus Liveview am Drucker aktiv? Access-Code korrekt?")
    finally:
        got_first.set()  # release the watchdog thread
        for closer in (lambda: proc.kill(),
                       lambda: proc.stdout and proc.stdout.close(),
                       lambda: proc.stderr and proc.stderr.close()):
            try:
                closer()
            except Exception:
                pass


def single_frame(ip: str, access_code: str) -> Optional[bytes]:
    """Grab one JPEG frame (for snapshots). Returns bytes or raises on failure."""
    for img in frames(ip, access_code, max_frames=1):
        return img
    return None
