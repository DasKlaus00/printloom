"""X1-Serie: Kammer-Kamera über den RTSPS-Stream, per ffmpeg transkodiert.

Nur die X1-Serie (X1, X1C, X1E) stellt die eingebaute Kamera als RTSPS bereit:

    rtsps://bblp:<access_code>@<ip>:322/streaming/live/1

Browser können RTSPS nicht abspielen, deshalb zieht das Backend den Stream per
ffmpeg und gibt MJPEG (eine Folge von JPEG-Frames) aus, das ein einfaches
<img> / multipart-Response zeigen kann.

Der geteilte Frame-Hub (ein ffmpeg pro Drucker, Fan-out an alle Zuschauer, Leerlauf-
Stopp, Snapshot-aus-dem-Stream) steckt jetzt in camera_hub — hier bleibt nur der
ffmpeg-`Producer`. P1S/A1 nutzen ein anderes Protokoll (bambu_camera). Welche Kamera
ein Drucker hat, entscheidet camera.py.

Voraussetzung: ffmpeg im Image und „LAN-Modus Liveview" am Drucker aktiv. Das Zertifikat
ist selbstsigniert; ffmpegs rtsps-Client prüft es standardmäßig nicht.
"""
import subprocess
import threading
import logging
from typing import Iterator, Optional

from app.paths import resolve_ffmpeg
from app.services import camera_hub
from app.services.camera_hub import executor  # re-export: geteilter Kamera-Pool

logger = logging.getLogger(__name__)


def _ffmpeg_bin() -> str:
    """ffmpeg-Aufrufpfad: nativ die gebündelte Binärdatei, sonst PATH ("ffmpeg")."""
    return resolve_ffmpeg()


# In der fensterlosen Desktop-App (PyInstaller console=False) öffnet jeder
# ffmpeg-Subprozess sonst kurz ein Konsolenfenster — bei Kamera-Retries flackert
# es dauerhaft. CREATE_NO_WINDOW unterdrückt das (nur Windows; sonst leeres Dict).
def _no_window_kwargs() -> dict:
    import sys as _sys
    if _sys.platform == "win32":
        return {"creationflags": getattr(subprocess, "CREATE_NO_WINDOW", 0x08000000)}
    return {}

RTSP_PORT = 322
_MAX_FRAME = 8_000_000      # sanity cap (8 MB) for a single JPEG

_NO_IMAGE = ("ffmpeg lieferte kein Bild — LAN-Modus Liveview am Drucker aktiv? "
             "Access-Code korrekt?")


def _url(ip: str, access_code: str) -> str:
    return f"rtsps://bblp:{access_code}@{ip}:{RTSP_PORT}/streaming/live/1"


def _cmd(ip: str, access_code: str, single: bool, fps: int = 6) -> list:
    # NOTE: no -rw_timeout / -stimeout here — those vary by ffmpeg build and the
    # RTSP demuxer rejects unknown ones ("Error opening input files: Option not
    # found"). A connect/first-frame timeout is enforced with a watchdog instead.
    cmd = [
        _ffmpeg_bin(), "-loglevel", "error", "-nostdin",
        "-rtsp_transport", "tcp",
        "-i", _url(ip, access_code),
        "-an",                                 # X1C stream has no audio
    ]
    if single:
        cmd += ["-frames:v", "1"]              # Snapshot: ein Frame, volle Auflösung
    else:
        # Weniger fps + auf max. 1280 Breite herunterskalieren (nie hoch) → deutlich
        # weniger CPU beim MJPEG-Transcode (war 10 fps @ Vollauflösung).
        cmd += ["-r", str(fps), "-vf", "scale='min(1280,iw)':-2"]
    cmd += ["-f", "mjpeg", "-q:v", "6", "pipe:1"]
    return cmd


def _iter_jpeg(stdout, on_frame) -> int:
    """Read an MJPEG byte stream and call on_frame(jpeg) per complete JPEG.
    Same marker-based extraction as before: JPEG SOI (FF D8 FF) … EOI (FF D9).
    Returns the number of frames seen."""
    buf = bytearray()
    count = 0
    while True:
        chunk = stdout.read(65536)
        if not chunk:
            return count
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
            count += 1
            if on_frame(jpeg) is False:
                return count


# ── ffmpeg-Producer (X1-Serie, RTSPS) ────────────────────────────────────────
class _FfmpegProducer(camera_hub.Producer):
    default_error = _NO_IMAGE

    def __init__(self, ip: str, access_code: str):
        self.ip, self.code = ip, access_code
        self.proc: Optional[subprocess.Popen] = None
        self._err = ""

    def open(self) -> None:
        self.proc = subprocess.Popen(
            _cmd(self.ip, self.code, single=False),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
            **_no_window_kwargs(),
        )

    def read(self, on_frame) -> None:
        _iter_jpeg(self.proc.stdout, on_frame)
        try:
            self._err = (self.proc.stderr.read() or b"").decode("utf-8", "ignore").strip()
        except Exception:
            pass

    def close(self) -> None:
        if not self.proc:
            return
        for closer in (lambda: self.proc.kill(),
                       lambda: self.proc.stdout and self.proc.stdout.close(),
                       lambda: self.proc.stderr and self.proc.stderr.close()):
            try:
                closer()
            except Exception:
                pass

    def error_detail(self) -> str:
        return self._err


def _key(ip: str, access_code: str):
    return ("rtsp", ip, access_code)


def _raise_if_disabled() -> None:
    """Globaler Kamera-Aus-Schalter (System-Seite): auf schwachen Geräten (z. B.
    Raspberry Pi) frisst der RTSPS→MJPEG-Transcode alle Kerne — dann darf hier
    NIE ein ffmpeg starten."""
    from app.services import appsettings
    if appsettings.camera_disabled():
        raise ConnectionError(
            "Kamera in Printloom deaktiviert (System → Kamera) — Energiesparmodus")


def stop_all() -> None:
    """Alle laufenden Kamera-Hubs beenden (backend-übergreifend)."""
    camera_hub.stop_all()


def stream(ip: str, access_code: str, read_timeout: float = 15.0) -> Iterator[bytes]:
    """JPEG-Frames für einen Live-Zuschauer — über den geteilten Hub (EIN ffmpeg
    pro Drucker, egal wie viele Zuschauer). Wirft ConnectionError, wenn die Kamera
    nicht erreichbar ist (echter ffmpeg-Fehlertext)."""
    _raise_if_disabled()
    hub = camera_hub.get_hub(_key(ip, access_code),
                             lambda: _FfmpegProducer(ip, access_code), read_timeout)
    return hub.frames_iter()


def _single_frame_oneshot(ip: str, access_code: str,
                          read_timeout: float = 15.0) -> Optional[bytes]:
    """Ein Frame in voller Auflösung über einen kurzen eigenen ffmpeg (nur wenn
    KEIN Hub läuft — sonst würde er dem Hub den einzigen RTSP-Slot stehlen)."""
    proc = subprocess.Popen(
        _cmd(ip, access_code, single=True),
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
        **_no_window_kwargs(),
    )
    got_first = threading.Event()
    def _watchdog():
        if not got_first.wait(read_timeout):
            try:
                proc.kill()
            except Exception:
                pass
    threading.Thread(target=_watchdog, daemon=True).start()
    result: list = []
    try:
        def on_frame(jpeg: bytes):
            result.append(jpeg)
            got_first.set()
            return False
        _iter_jpeg(proc.stdout, on_frame)
        if result:
            return result[0]
        err = b""
        try:
            err = proc.stderr.read() or b""
        except Exception:
            pass
        detail = err.decode("utf-8", "ignore").strip().splitlines()
        raise ConnectionError((detail[-1] if detail else "") or _NO_IMAGE)
    finally:
        got_first.set()
        for closer in (lambda: proc.kill(),
                       lambda: proc.stdout and proc.stdout.close(),
                       lambda: proc.stderr and proc.stderr.close()):
            try:
                closer()
            except Exception:
                pass


def single_frame(ip: str, access_code: str) -> Optional[bytes]:
    """Ein JPEG-Frame (Snapshots). Läuft gerade ein Hub, wird dessen aktuelles
    Frame genommen (kein zweiter RTSP-Zugriff); sonst kurzer One-Shot-ffmpeg."""
    _raise_if_disabled()
    hub = camera_hub.find_hub(_key(ip, access_code))
    if hub is not None:
        img = hub.latest_frame()
        if img:
            return img
    return _single_frame_oneshot(ip, access_code)
