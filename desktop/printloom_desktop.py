"""Printloom Desktop — native Windows/macOS-Hülle.

Startet das FastAPI-Backend (uvicorn) in-process auf 127.0.0.1, legt ein
Tray-Icon an und öffnet auf Klick den Standard-Browser mit der Printloom-Oberfläche.
Es ist dieselbe App wie in Docker — nur lokal verpackt. Datenordner, Frontend und
ffmpeg werden zentral über ``app.paths`` aufgelöst (nativ = %APPDATA%/Printloom).

Design:
* **Single-Instance**: eine Lock-Socket auf 127.0.0.1. Läuft schon eine Instanz,
  öffnet der zweite Start nur den Browser und beendet sich.
* **In-process uvicorn**: kein Subprozess → einfach zu bündeln und sauber zu beenden.
* **Tray-Menü**: Öffnen · Autostart · Neu starten · Beenden.
"""
from __future__ import annotations

import logging
import os
import socket
import sys
import threading
import time
import webbrowser
from pathlib import Path


def _ensure_std_streams() -> None:
    """In der fensterlosen EXE (PyInstaller console=False) sind sys.stdout/stderr
    None. uvicorns Log-Formatter (sys.stdout.isatty()) und jeder StreamHandler
    stürzen dann ab. Deshalb VOR dem ersten Logging auf eine Logdatei umlenken."""
    if sys.stdout is not None and sys.stderr is not None:
        return
    base = Path(os.environ.get("APPDATA") or (Path.home() / "AppData" / "Roaming")) / "Printloom"
    try:
        base.mkdir(parents=True, exist_ok=True)
        f = open(base / "desktop.log", "a", encoding="utf-8", buffering=1)
    except Exception:
        f = open(os.devnull, "w")
    if sys.stdout is None:
        sys.stdout = f
    if sys.stderr is None:
        sys.stderr = f


_ensure_std_streams()

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("printloom.desktop")

HOST = "127.0.0.1"
PREFERRED_PORT = 8756
LOCK_PORT = 8755          # reine Single-Instance-Sperre (kein HTTP)
APP_TITLE = "Printloom"


# ── Backend importierbar machen (Dev: ../backend; frozen: im Bundle) ──────────
def _ensure_backend_on_path() -> None:
    if getattr(sys, "frozen", False):
        return  # PyInstaller hat das app-Paket eingebunden
    here = Path(__file__).resolve().parent
    backend = (here.parent / "backend").resolve()
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))


# ── Single-Instance-Lock ──────────────────────────────────────────────────────
def _acquire_lock() -> socket.socket | None:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
        s.bind((HOST, LOCK_PORT))
        s.listen(1)
        return s
    except OSError:
        s.close()
        return None


# ── App-URL zwischen Instanzen teilen ─────────────────────────────────────────
def _url_file() -> Path:
    from app import paths
    return paths.DATA_ROOT / "desktop.url"


def _write_url(url: str) -> None:
    try:
        f = _url_file()
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(url, encoding="utf-8")
    except Exception:
        pass


def _read_url() -> str:
    try:
        return _url_file().read_text(encoding="utf-8").strip()
    except Exception:
        return f"http://{HOST}:{PREFERRED_PORT}"


def _pick_port() -> int:
    for port in (PREFERRED_PORT, 0):
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        try:
            s.bind((HOST, port))
            chosen = s.getsockname()[1]
            s.close()
            return chosen
        except OSError:
            s.close()
    return PREFERRED_PORT


# ── uvicorn in-process ────────────────────────────────────────────────────────
class _Server:
    def __init__(self, port: int):
        self.port = port
        self._server = None
        self._thread = None

    def start(self) -> None:
        import uvicorn
        os.environ.setdefault("PRINTLOOM_HOST", HOST)
        os.environ.setdefault("PRINTLOOM_PORT", str(self.port))
        from app.main import app
        # access_log=False: NICHT jede HTTP-Anfrage in die desktop.log schreiben
        # (sonst wächst sie endlos). log_config=None: uvicorns eigene dictConfig
        # NICHT anwenden — sonst überschreibt sie die in app.main gesetzten
        # Log-Level (uvicorn.access etc.) und den Stream-Fix.
        config = uvicorn.Config(
            app, host=HOST, port=self.port,
            log_level="warning", access_log=False, log_config=None,
        )
        self._server = uvicorn.Server(config)
        self._thread = threading.Thread(target=self._server.run, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._server is not None:
            self._server.should_exit = True

    def wait_healthy(self, timeout: float = 30.0) -> bool:
        import urllib.request
        url = f"http://{HOST}:{self.port}/api/health"
        deadline = time.time() + timeout
        while time.time() < deadline:
            try:
                with urllib.request.urlopen(url, timeout=1.5) as r:
                    if r.status == 200:
                        return True
            except Exception:
                time.sleep(0.4)
        return False


# ── Tray-Icon ─────────────────────────────────────────────────────────────────
def _tray_image():
    """Icon laden (gebündeltes icon.png) oder programmatisch erzeugen."""
    from PIL import Image, ImageDraw
    for cand in (_bundled("icon.png"), _bundled("icon.ico")):
        if cand and Path(cand).is_file():
            try:
                return Image.open(cand)
            except Exception:
                pass
    # Fallback: schlichtes Icon (blauer Kreis mit „P").
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 60, 60), fill=(37, 99, 235, 255))
    d.text((23, 18), "P", fill=(255, 255, 255, 255))
    return img


def _bundled(name: str) -> str | None:
    base = getattr(sys, "_MEIPASS", None)
    if base:
        return str(Path(base) / name)
    return str(Path(__file__).resolve().parent / name)


def main() -> int:
    _ensure_backend_on_path()

    lock = _acquire_lock()
    if lock is None:
        # Es läuft bereits eine Instanz → nur Browser öffnen und beenden.
        url = _read_url()
        log.info("Printloom läuft bereits — öffne %s", url)
        webbrowser.open(url)
        return 0

    port = _pick_port()
    url = f"http://{HOST}:{port}"
    _write_url(url)

    server = _Server(port)
    log.info("Starte Printloom-Backend auf %s …", url)
    server.start()
    if not server.wait_healthy():
        log.error("Backend wurde nicht rechtzeitig gesund — trotzdem Tray anzeigen.")

    # Erststart: Browser automatisch öffnen (per PRINTLOOM_NO_BROWSER unterdrückbar,
    # z. B. für automatisierte Tests).
    if not os.getenv("PRINTLOOM_NO_BROWSER"):
        webbrowser.open(url)

    import pystray
    import autostart

    def on_open(icon, item):
        webbrowser.open(url)

    def on_toggle_autostart(icon, item):
        autostart.toggle()

    def is_autostart(item):
        return autostart.is_enabled()

    def on_restart(icon, item):
        icon.stop()
        server.stop()
        time.sleep(0.5)
        os.execv(sys.executable, [sys.executable] + sys.argv)

    def on_quit(icon, item):
        icon.stop()
        server.stop()

    menu = pystray.Menu(
        pystray.MenuItem("Printloom öffnen", on_open, default=True),
        pystray.MenuItem("Automatisch starten", on_toggle_autostart, checked=is_autostart),
        pystray.MenuItem("Neu starten", on_restart),
        pystray.MenuItem("Beenden", on_quit),
    )
    icon = pystray.Icon(APP_TITLE, _tray_image(), APP_TITLE, menu)
    icon.run()  # blockiert bis „Beenden"

    server.stop()
    try:
        lock.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
