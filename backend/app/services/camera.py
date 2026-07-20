"""Backend-neutrale Kamera-Fassade: wählt je Drucker das richtige Protokoll.

  X1-Serie  (X1, X1C, X1E)          → RTSPS auf Port 322        (rtsp_camera)
  P1/A1     (P1P, P1S, A1, A1 mini) → Port-6000-JPEG-Protokoll  (bambu_camera)

Auswahl je Gerät, in dieser Reihenfolge:
  1. Explizite Geräte-Einstellung camera_type: "rtsp" | "bambu" | "none" | "auto".
  2. Laufzeit-Probe von TCP 322 (offen → rtsp, sonst → bambu), pro IP gecacht —
     nur die X1-Serie hat den RTSP-Port offen, das trennt zuverlässig unabhängig
     von der Seriennummer.
  3. Seriennummer-Präfix als Fallback, wenn keine IP zum Proben da ist.

Die eigentliche Stream-/Snapshot-Logik (geteilter Hub) liegt in den Backend-Modulen;
hier wird nur dispatcht. Der ffmpeg/Snapshot-Threadpool wird re-exportiert.
"""
import socket
import time
import logging

from app.services import rtsp_camera, bambu_camera
from app.services.camera_hub import executor  # noqa: F401  (re-export für Aufrufer)

logger = logging.getLogger(__name__)

RTSP = "rtsp"
BAMBU = "bambu"
NONE = "none"

# X1-Serie nutzt RTSP; alles andere von Bambu das Port-6000-Protokoll. Die
# Präfixe sind nur ein Fallback (siehe _probe) — die Port-Probe ist maßgeblich.
_X1_PREFIXES = ("00M", "00W", "03W")             # X1C, X1, X1E
_LEGACY_PREFIXES = ("01S", "01P", "030", "039")  # P1P, P1S, A1 mini, A1

_probe_cache: dict = {}     # ip -> (backend, monotonic_expiry)
_PROBE_TTL = 300.0
RTSP_PROBE_PORT = 322


def _probe(ip: str) -> str:
    """Ist TCP 322 offen → X1-Serie (RTSP), sonst P1/A1 (Port 6000). Gecacht."""
    now = time.monotonic()
    hit = _probe_cache.get(ip)
    if hit and hit[1] > now:
        return hit[0]
    backend = BAMBU
    try:
        with socket.create_connection((ip, RTSP_PROBE_PORT), timeout=1.5):
            backend = RTSP
    except Exception:
        backend = BAMBU
    _probe_cache[ip] = (backend, now + _PROBE_TTL)
    return backend


def resolve_backend(device, settings: dict = None) -> str:
    """Kamera-Backend für ein Gerät bestimmen: "rtsp" | "bambu" | "none"."""
    settings = settings or {}
    explicit = (settings.get("camera_type") or "").strip().lower()
    if explicit in (RTSP, BAMBU, NONE):
        return explicit
    ip = getattr(device, "ip_address", None)
    if ip:
        return _probe(ip)
    serial = (getattr(device, "serial_number", "") or "").upper()
    if serial:
        if any(serial.startswith(p) for p in _X1_PREFIXES):
            return RTSP
        if any(serial.startswith(p) for p in _LEGACY_PREFIXES):
            return BAMBU
    return RTSP


def _backend_module(backend: str):
    return bambu_camera if backend == BAMBU else rtsp_camera


def stream(device, settings: dict = None):
    """Live-JPEG-Frames für das passende Backend des Druckers. Wirft
    ConnectionError mit dem echten Grund, wenn nicht erreichbar/deaktiviert."""
    backend = resolve_backend(device, settings)
    if backend == NONE:
        raise ConnectionError("Kamera für diesen Drucker deaktiviert (Kamera-Typ: aus)")
    return _backend_module(backend).stream(device.ip_address, device.access_code)


def single_frame(device, settings: dict = None):
    """Ein JPEG-Frame (Snapshots) für das passende Backend. None bei „aus"."""
    backend = resolve_backend(device, settings)
    if backend == NONE:
        return None
    return _backend_module(backend).single_frame(device.ip_address, device.access_code)


def stop_all() -> None:
    """Alle laufenden Kamera-Hubs beenden (beide Backends, ein Registry)."""
    from app.services import camera_hub
    camera_hub.stop_all()
