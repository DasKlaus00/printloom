"""X1C chamber camera via its RTSPS stream, transcoded by ffmpeg.

Newer X1C firmware (>=01.11) rejects the legacy port-6000 camera protocol
(see bambu_camera.py) but still exposes the chamber camera as RTSPS:

    rtsps://bblp:<access_code>@<ip>:322/streaming/live/1

Browsers can't play RTSPS, so the backend runs ffmpeg to pull it and emit MJPEG
(a sequence of JPEG frames) that a plain <img> / multipart response can show.

WICHTIG (Ressourcen + Stabilität): Der MJPEG-Transcode kostet ~0,5-1 CPU-Kern pro
ffmpeg, und der X1C erlaubt nur EINEN RTSP-Client. Deshalb läuft hier pro Drucker
genau EIN geteilter ffmpeg (Hub): ein Leser-Thread parst die JPEG-Frames, alle
Zuschauer (Streams UND Snapshots) bekommen dieselben Frames verteilt. Früher
startete jeder Zuschauer einen eigenen ffmpeg → mehrere Kerne Dauerlast und
gegenseitiges Rauswerfen am einzigen RTSP-Slot (Reconnect-Sturm). Der Hub stoppt
~5 s nachdem der letzte Zuschauer weg ist.

Requires ffmpeg in the image and "LAN Mode Liveview" enabled on the printer.
The cert is self-signed; ffmpeg's rtsps client does not verify it by default.
"""
import subprocess
import threading
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator, Optional

from app.paths import resolve_ffmpeg

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
_IDLE_STOP_S = 5.0          # Hub stoppt so viele Sekunden nach dem letzten Zuschauer
_FRAME_TIMEOUT_S = 15.0     # kein neues Frame so lange → Stream gilt als abgerissen

# Eigener kleiner Pool für blockierende Kamera-Arbeit (Snapshots bis 15 s) — hält
# den Default-Executor und den MQTT/FTP-Pool (bambu_manager) frei.
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="camera")


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


# ── Geteilter Stream-Hub (ein ffmpeg pro Drucker) ────────────────────────────
class _Hub:
    def __init__(self, ip: str, access_code: str):
        self.ip, self.code = ip, access_code
        self.cond = threading.Condition()
        self.frame: Optional[bytes] = None
        self.frame_id = 0
        self.error: Optional[str] = None
        self.dead = False
        self.refs = 0
        self.idle_since: Optional[float] = None
        self.proc: Optional[subprocess.Popen] = None

    # -- Lebenszyklus -----------------------------------------------------
    def start(self, first_frame_timeout: float) -> None:
        """ffmpeg + Leser-Thread starten und auf das ERSTE Frame warten (oder
        ConnectionError mit dem echten ffmpeg-Fehler werfen)."""
        self.proc = subprocess.Popen(
            _cmd(self.ip, self.code, single=False),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0,
            **_no_window_kwargs(),
        )
        threading.Thread(target=self._reader, daemon=True,
                         name=f"cam-hub-{self.ip}").start()
        with self.cond:
            self.cond.wait_for(lambda: self.frame_id > 0 or self.dead,
                               timeout=first_frame_timeout)
            if self.frame_id > 0:
                return
            # Kein Frame → aufräumen und den echten Grund melden.
            self.dead = True
        self._kill()
        raise ConnectionError(
            self.error
            or "ffmpeg lieferte kein Bild — LAN-Modus Liveview am Drucker aktiv? Access-Code korrekt?")

    def _reader(self) -> None:
        err_txt = ""
        try:
            def on_frame(jpeg: bytes):
                with self.cond:
                    if self.dead:
                        return False
                    self.frame = jpeg
                    self.frame_id += 1
                    self.cond.notify_all()
                    # Niemand schaut mehr und Gnadenfrist vorbei → selbst beenden.
                    if self.refs == 0 and self.idle_since is not None \
                            and time.monotonic() - self.idle_since > _IDLE_STOP_S:
                        self.dead = True
                        return False
                return True
            _iter_jpeg(self.proc.stdout, on_frame)
            try:
                err_txt = (self.proc.stderr.read() or b"").decode("utf-8", "ignore").strip()
            except Exception:
                pass
        except Exception as e:
            err_txt = str(e)
        finally:
            with self.cond:
                if not self.dead:
                    lines = err_txt.splitlines()
                    self.error = lines[-1] if lines else "Stream beendet"
                self.dead = True
                self.cond.notify_all()
            self._kill()
            _drop_hub(self)

    def _kill(self) -> None:
        for closer in (lambda: self.proc.kill(),
                       lambda: self.proc.stdout and self.proc.stdout.close(),
                       lambda: self.proc.stderr and self.proc.stderr.close()):
            try:
                closer()
            except Exception:
                pass

    # -- Zuschauer ----------------------------------------------------------
    def acquire(self) -> None:
        with self.cond:
            self.refs += 1
            self.idle_since = None

    def release(self) -> None:
        with self.cond:
            self.refs -= 1
            if self.refs <= 0:
                self.refs = 0
                self.idle_since = time.monotonic()
        # Fallback-Stopp, falls ffmpeg keine Frames mehr liefert (der Reader-Check
        # oben greift nur pro Frame): nach der Gnadenfrist hart prüfen.
        threading.Timer(_IDLE_STOP_S + 0.5, self._stop_if_idle).start()

    def _stop_if_idle(self) -> None:
        with self.cond:
            if self.refs > 0 or self.dead or self.idle_since is None:
                return
            if time.monotonic() - self.idle_since < _IDLE_STOP_S:
                return
            self.dead = True
            self.cond.notify_all()
        self._kill()
        _drop_hub(self)

    def frames_iter(self) -> Iterator[bytes]:
        """Frames ab jetzt liefern; Ende/Fehler des Hubs beendet den Iterator mit
        ConnectionError (der Browser/<img> verbindet dann neu)."""
        self.acquire()
        last_id = 0
        try:
            while True:
                with self.cond:
                    self.cond.wait_for(lambda: self.frame_id > last_id or self.dead,
                                       timeout=_FRAME_TIMEOUT_S)
                    if self.frame_id > last_id:
                        last_id = self.frame_id     # slow-consumer: Frames überspringen ist ok
                        jpeg = self.frame
                    elif self.dead:
                        raise ConnectionError(self.error or "Kamera-Stream beendet")
                    else:
                        raise ConnectionError("Kamera-Stream eingefroren (kein Frame)")
                yield jpeg
        finally:
            self.release()

    def latest_frame(self, max_age_frames_timeout: float = 3.0) -> Optional[bytes]:
        """Aktuelles Frame des laufenden Hubs (für Snapshots) — vermeidet einen
        zweiten RTSP-Zugriff, der den einzigen Slot des X1C stehlen würde."""
        with self.cond:
            if self.frame is not None and not self.dead:
                return self.frame
            self.cond.wait_for(lambda: self.frame_id > 0 or self.dead,
                               timeout=max_age_frames_timeout)
            return self.frame if not self.dead else None


_hubs: dict = {}
_hubs_lock = threading.Lock()


def _drop_hub(hub: "_Hub") -> None:
    with _hubs_lock:
        if _hubs.get((hub.ip, hub.code)) is hub:
            del _hubs[(hub.ip, hub.code)]


def _get_hub(ip: str, access_code: str, first_frame_timeout: float) -> _Hub:
    with _hubs_lock:
        hub = _hubs.get((ip, access_code))
        if hub is not None and not hub.dead:
            return hub
        hub = _Hub(ip, access_code)
        _hubs[(ip, access_code)] = hub
    try:
        hub.start(first_frame_timeout)
    except Exception:
        _drop_hub(hub)
        raise
    return hub


def stream(ip: str, access_code: str, read_timeout: float = 15.0) -> Iterator[bytes]:
    """JPEG-Frames für einen Live-Zuschauer — über den geteilten Hub (EIN ffmpeg
    pro Drucker, egal wie viele Zuschauer). Wirft ConnectionError, wenn die Kamera
    nicht erreichbar ist (echter ffmpeg-Fehlertext)."""
    return _get_hub(ip, access_code, read_timeout).frames_iter()


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
        raise ConnectionError(
            (detail[-1] if detail else "")
            or "ffmpeg lieferte kein Bild — LAN-Modus Liveview am Drucker aktiv? Access-Code korrekt?")
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
    with _hubs_lock:
        hub = _hubs.get((ip, access_code))
    if hub is not None and not hub.dead:
        img = hub.latest_frame()
        if img:
            return img
    return _single_frame_oneshot(ip, access_code)
