"""Geteilter Kamera-Frame-Hub (ein Frame-Produzent pro Drucker, viele Zuschauer).

Vorher steckte diese Logik fest im X1C-RTSPS-Modul (rtsp_camera). Seit P1S/A1 ihre
Kamera über ein ANDERES Protokoll (Port 6000, siehe bambu_camera) liefern, ist der
Hub hier herausgezogen und protokoll-unabhängig: RTSPS (ffmpeg) und Port-6000 (TLS-
Socket) stellen jeweils nur einen `Producer` bereit, der Rest — Referenzzählung,
Fan-out an alle Zuschauer, Leerlauf-Stopp, Snapshot aus dem laufenden Stream — ist
für beide identisch.

WICHTIG (Ressourcen + Stabilität): Sowohl der RTSPS-Transcode (~0,5-1 CPU-Kern je
ffmpeg) als auch der Port-6000-Stream erlauben nur EINEN Client pro Drucker. Deshalb
läuft pro Drucker genau EIN Hub: ein Leser-Thread liest die JPEG-Frames, alle
Zuschauer (Streams UND Snapshots) bekommen dieselben Frames verteilt. Der Hub stoppt
~5 s nachdem der letzte Zuschauer weg ist.
"""
import threading
import time
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Iterator, Optional

logger = logging.getLogger(__name__)

_IDLE_STOP_S = 5.0          # Hub stoppt so viele Sekunden nach dem letzten Zuschauer
_FRAME_TIMEOUT_S = 15.0     # kein neues Frame so lange → Stream gilt als abgerissen

# Eigener kleiner Pool für blockierende Kamera-Arbeit (Snapshots bis 15 s) — hält
# den Default-Executor und den MQTT/FTP-Pool (bambu_manager) frei. Von beiden
# Kamera-Backends geteilt (re-exportiert).
executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="camera")


class Producer:
    """Frame-Quelle eines Hubs. Unterklassen verbinden sich mit der Kamera und
    schieben JPEG-Frames. Die Threading-/Lebenszyklus-Logik liegt im Hub — der
    Producer implementiert nur Verbinden, Lesen, Aufräumen.

    open()  – Verbindung/Prozess aufbauen; wirft ConnectionError bei hartem Fehler.
              Muss schnell zurückkehren; auf das ERSTE Frame wartet der Hub selbst.
    read(on_frame) – blockierende Leseschleife; ruft on_frame(jpeg_bytes) je Frame;
              gibt on_frame False zurück → beenden. Normal zurückkehren bei Stream-Ende.
    close() – idempotentes Aufräumen (Prozess killen / Socket schließen).
    error_detail() – bester Fehlertext, nachdem read() endete (z. B. ffmpeg-stderr).
    """
    default_error = "Kamera lieferte kein Bild"

    def open(self) -> None:
        raise NotImplementedError

    def read(self, on_frame) -> None:
        raise NotImplementedError

    def close(self) -> None:
        pass

    def error_detail(self) -> str:
        return ""


class FrameHub:
    def __init__(self, key, producer: Producer):
        self.key = key
        self.producer = producer
        self.cond = threading.Condition()
        self.frame: Optional[bytes] = None
        self.frame_id = 0
        self.error: Optional[str] = None
        self.dead = False
        self.refs = 0
        self.idle_since: Optional[float] = None

    # -- Lebenszyklus -----------------------------------------------------
    def start(self, first_frame_timeout: float) -> None:
        """Producer öffnen + Leser-Thread starten und auf das ERSTE Frame warten
        (oder ConnectionError mit dem echten Fehler werfen)."""
        self.producer.open()   # kann ConnectionError mit echtem Grund werfen
        threading.Thread(target=self._reader, daemon=True,
                         name=f"cam-hub-{self.key}").start()
        with self.cond:
            self.cond.wait_for(lambda: self.frame_id > 0 or self.dead,
                               timeout=first_frame_timeout)
            if self.frame_id > 0:
                return
            # Kein Frame → aufräumen und den echten Grund melden.
            self.dead = True
        self._teardown()
        raise ConnectionError(self.error or self.producer.default_error)

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
            self.producer.read(on_frame)
            err_txt = self.producer.error_detail()
        except Exception as e:
            err_txt = str(e)
        finally:
            with self.cond:
                if not self.dead:
                    lines = err_txt.splitlines() if err_txt else []
                    self.error = lines[-1] if lines else "Stream beendet"
                self.dead = True
                self.cond.notify_all()
            self._teardown()
            _drop_hub(self)

    def _teardown(self) -> None:
        try:
            self.producer.close()
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
        # Fallback-Stopp, falls der Producer keine Frames mehr liefert (der
        # Reader-Check oben greift nur pro Frame): nach der Gnadenfrist hart prüfen.
        threading.Timer(_IDLE_STOP_S + 0.5, self._stop_if_idle).start()

    def _stop_if_idle(self) -> None:
        with self.cond:
            if self.refs > 0 or self.dead or self.idle_since is None:
                return
            if time.monotonic() - self.idle_since < _IDLE_STOP_S:
                return
            self.dead = True
            self.cond.notify_all()
        self._teardown()
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
        zweiten Kamera-Zugriff, der den einzigen Client-Slot stehlen würde."""
        with self.cond:
            if self.frame is not None and not self.dead:
                return self.frame
            self.cond.wait_for(lambda: self.frame_id > 0 or self.dead,
                               timeout=max_age_frames_timeout)
            return self.frame if not self.dead else None


# ── Registry (ein Hub je key = (backend, ip, code)) ──────────────────────────
_hubs: dict = {}
_hubs_lock = threading.Lock()


def _drop_hub(hub: "FrameHub") -> None:
    with _hubs_lock:
        if _hubs.get(hub.key) is hub:
            del _hubs[hub.key]


def get_hub(key, make_producer, first_frame_timeout: float) -> FrameHub:
    """Laufenden Hub für `key` liefern oder einen neuen starten. `make_producer`
    ist ein Callable ohne Argumente, das den (billigen) Producer erzeugt."""
    with _hubs_lock:
        hub = _hubs.get(key)
        if hub is not None and not hub.dead:
            return hub
        hub = FrameHub(key, make_producer())
        _hubs[key] = hub
    try:
        hub.start(first_frame_timeout)
    except Exception:
        _drop_hub(hub)
        raise
    return hub


def find_hub(key) -> Optional[FrameHub]:
    """Laufenden Hub für `key` zurückgeben (für Snapshots), ohne einen zu starten."""
    with _hubs_lock:
        hub = _hubs.get(key)
        return hub if (hub is not None and not hub.dead) else None


def stop_all() -> None:
    """ALLE laufenden Kamera-Hubs SOFORT beenden (z. B. wenn die Kamera global
    deaktiviert wird): Producer killen, Zuschauer-Iteratoren enden — nicht erst
    auf den Leerlauf-Stopp warten. Deckt beide Backends ab (ein Registry)."""
    with _hubs_lock:
        hubs = list(_hubs.values())
    for hub in hubs:
        try:
            with hub.cond:
                hub.dead = True
                if not hub.error:
                    hub.error = "Kamera deaktiviert"
                hub.cond.notify_all()
            hub._teardown()
            _drop_hub(hub)
        except Exception:
            pass
