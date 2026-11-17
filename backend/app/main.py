import html
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse

from app.routers import (files, devices, control, printer, rack_manager, system, autofarm,
                         project, profiles, filaments, push, folders, online, slicer)
from app.db.database import init_db
from app import paths
from app.services import request_guard

# Datenordner (db/, uploads/) früh sicherstellen — nativ liegen sie im
# Nutzerverzeichnis, in Docker unter /app (siehe app.paths).
paths.ensure_dirs()

# INFO statt DEBUG: DEBUG ließ uvicorn + alle Bibliotheken (MQTT/HTTP/FTP) sehr
# viel protokollieren — unnötige CPU-/IO-Last und ein endlos wachsendes Log. Die
# App-eigenen Meldungen laufen über logger.info und bleiben damit sichtbar.
logging.basicConfig(level=logging.INFO)
logging.getLogger("app").setLevel(logging.INFO)
# Gesprächige Drittanbieter-Logger zusätzlich dämpfen (Zugriffslog, HTTP, MQTT).
for _noisy in ("uvicorn.access", "httpx", "httpcore", "paho", "paho.mqtt", "watchfiles"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Kamera-Default festlegen BEVOR init_db() die Datenbank anlegt: nur eine echte
# Neuinstallation (keine printloom.db) bekommt den neuen Default „Kamera aus";
# bestehende Installationen werden auf „aktiv" eingefroren (kein Funktionsverlust).
from app.services import appsettings as _appsettings
_appsettings.init_camera_default()

# Initialize database
init_db()


@asynccontextmanager
async def _lifespan(_app: FastAPI):
    # Bauraumlüfter-Guard: hält bei aktivierter Geräte-Option die Bauraumlüftung aus
    # (nutzt die persistente MQTT-Verbindung, ~5-s-Takt). Idempotent.
    try:
        from app.services import chamber_fan_guard
        chamber_fan_guard.start()
    except Exception as e:
        logging.getLogger(__name__).warning(f"chamber_fan_guard start failed: {e}")
    yield


# Kein CORS-Middleware: Die Oberfläche kommt vom selben Server (im Dev über den
# Vite-Proxy), braucht also keine Freigabe für fremde Herkunft. Bis v1.1.34 stand
# hier allow_origins=["*"] MIT allow_credentials — Starlette spiegelt dann bei
# Anfragen mit Cookie die Herkunft zurück. Hinter einer Anmeldung (authentik) hätte
# damit jede fremde Webseite im Browser des angemeldeten Nutzers die API lesen
# dürfen, das Backup mit allen Zugangsdaten eingeschlossen.
app = FastAPI(title="Printloom - 3D Print Farm Controller", lifespan=_lifespan)


# Ohne CORS kann eine fremde Seite nichts LESEN — schreiben aber schon: ein
# Formular, das sich selbst abschickt, braucht keine Freigabe. Bis v1.1.38 hätte
# so jede Webseite, die man im Heimnetz (oder angemeldet hinter authentik) öffnet,
# ein Update samt Neustart auslösen, ein Backup einspielen oder den Arm bewegen
# können. v1.1.39 sperrte das über `Sec-Fetch-Site` — den Kopf schicken Browser aber
# nur an https- und localhost-Adressen, über http://<IP> fehlt er. Seit v1.1.42
# prüft der Wächter deshalb zusätzlich die Adresse (gegen DNS-Rebinding) und die
# Herkunft (Origin); die Regeln stehen in app/services/request_guard.py. Aufrufe
# ohne Browser (Home Assistant, curl, Skripte) schicken weder Sec-Fetch-Site noch
# Origin und bleiben erlaubt, solange sie eine Heimnetz-Adresse benutzen.
# Reines ASGI statt @app.middleware: BaseHTTPMiddleware hat bei langlaufenden
# Streams (Kamera) bekannte Macken beim Verbindungsende.
FOREIGN_ORIGIN = request_guard.FOREIGN_ORIGIN
_log = logging.getLogger("app.request_guard")
# Jede abgelehnte Adresse nur einmal ins Log, und höchstens so viele: Eine Seite,
# die wild Namen durchprobiert, soll das Log nicht füllen.
_logged_hosts: set = set()
_LOG_HOSTS_MAX = 50


def _unknown_host_page(host: str) -> HTMLResponse:
    h = html.escape(host or "?")
    body = f"""<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Printloom</title>
<style>body{{font:16px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem}}
code{{background:#eee;padding:0 .25rem;border-radius:.2rem}}</style></head><body>
<h1>Adresse nicht freigegeben</h1>
<p>Printloom wurde über <code>{h}</code> aufgerufen. Diesen Namen kennt Printloom nicht,
deshalb ist die Anfrage gesperrt. So kann keine fremde Webseite Printloom über einen
umgeleiteten Namen steuern (DNS-Rebinding).</p>
<p>Öffne Printloom über die IP-Adresse, oder trage den Namen beim Start ein:
<code>PRINTLOOM_ALLOWED_HOSTS={h}</code> (mehrere mit Komma, <code>*.beispiel.de</code>
für alle Unternamen). In Docker gehört die Zeile unter <code>environment:</code> in die
docker-compose.yml.</p>
<hr><p lang="en"><b>Address not allowed.</b> Printloom was opened as <code>{h}</code>,
which it does not know. Open it by IP address, or start it with
<code>PRINTLOOM_ALLOWED_HOSTS={h}</code>.</p></body></html>"""
    return HTMLResponse(body, status_code=403)


class _NoForeignWrites:
    def __init__(self, app):
        self.inner = app

    async def __call__(self, scope, receive, send):
        kind = scope["type"]
        if kind not in ("http", "websocket"):
            await self.inner(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1")
                   for k, v in (scope.get("headers") or [])}
        reason = request_guard.decide(kind, scope.get("method"), headers)
        if reason:
            host = headers.get("host", "")
            if (reason == request_guard.UNKNOWN_HOST and host not in _logged_hosts
                    and len(_logged_hosts) < _LOG_HOSTS_MAX):
                _logged_hosts.add(host)
                _log.warning("Anfrage an unbekannte Adresse %r abgelehnt. Ist das die eigene "
                             "Adresse, gehört sie in PRINTLOOM_ALLOWED_HOSTS.", host)
            if kind == "websocket":
                # Erst websocket.connect annehmen, dann ablehnen (HTTP 403 beim Handshake).
                await receive()
                await send({"type": "websocket.close", "code": 1008})
            elif reason == request_guard.UNKNOWN_HOST and not scope.get("path", "").startswith("/api"):
                await _unknown_host_page(host)(scope, receive, send)
            else:
                await JSONResponse(status_code=403, content={"detail": reason})(scope, receive, send)
            return

        if kind == "websocket":
            await self.inner(scope, receive, send)
            return

        # Gegen das Einbetten in fremde Seiten: Köpfe an jede Antwort hängen, auch an
        # Kamera-Streams (dort stören sie nicht).
        extra = request_guard.frame_headers()

        async def send_with_frame_headers(message):
            if message["type"] == "http.response.start":
                message = {**message, "headers": [*message.get("headers", []), *extra]}
            await send(message)

        await self.inner(scope, receive, send_with_frame_headers)


app.add_middleware(_NoForeignWrites)

# Include routers
app.include_router(devices.router,       prefix="/api/devices",       tags=["Devices"])
app.include_router(files.router,         prefix="/api/files",         tags=["File Management"])
app.include_router(control.router,       prefix="/api/control",       tags=["Control"])
app.include_router(printer.router,       prefix="/api/printer",       tags=["Printer"])
app.include_router(rack_manager.router,  prefix="/api/rack-manager",  tags=["Rack Manager"])
app.include_router(system.router,        prefix="/api/system",        tags=["System"])
app.include_router(autofarm.router,      prefix="/api/autofarm",      tags=["AutoFarm"])
app.include_router(project.router,       prefix="/api/project",        tags=["Project"])
app.include_router(profiles.router,      prefix="/api/profiles",       tags=["Profiles"])
app.include_router(filaments.router,     prefix="/api/filaments",       tags=["Filaments"])
app.include_router(push.router,          prefix="/api/push",            tags=["Web-Push"])
app.include_router(folders.router,       prefix="/api/folders",         tags=["Folders"])
app.include_router(online.router,        prefix="/api/online",          tags=["Online-Dienste"])
app.include_router(slicer.router,        prefix="/api/slicer",          tags=["OrcaSlicer-Plugin"])


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

# Serve static frontend files (zentral aufgelöst: Docker=/app/frontend/dist,
# nativ=Bundle, Dev=frontend/dist)
frontend_path = paths.frontend_dir()

if frontend_path.exists():
    # Vite hängt an jeden Asset-Namen einen Hash über den INHALT (index-a1b2c3.js).
    # Ändert sich der Inhalt, ändert sich der Name — dieselbe Datei kann sich also
    # nie ändern und darf beliebig lange im Browser liegen bleiben. Spart bei jedem
    # Seitenaufruf einen Schwung Anfragen.
    class _ImmutableAssets(StaticFiles):
        async def get_response(self, path, scope):
            resp = await super().get_response(path, scope)
            if resp.status_code == 200:
                resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
            return resp

    app.mount("/assets", _ImmutableAssets(directory=frontend_path / "assets"), name="assets")

    # Die index.html dagegen NIE zwischenspeichern: In ihr stehen die gehashten
    # Asset-Namen. Liefert der Browser nach einem Update eine alte index.html aus
    # dem Cache, lädt er weiter das ALTE Frontend, während der Server schon die
    # neue Version meldet — die App lädt dann in einer Schleife immer wieder neu
    # („Update-Loop"). Der Verzicht auf den Cache kostet einen kleinen Request,
    # verhindert aber genau das.
    _NO_STORE = {"Cache-Control": "no-store, must-revalidate"}

    def _index() -> FileResponse:
        return FileResponse(frontend_path / "index.html", headers=_NO_STORE)

    # Serve index.html for root
    @app.get("/", response_class=HTMLResponse)
    async def serve_root():
        return _index()

    # Root-level static files (sw.js, manifest.webmanifest, icons, favicons) that
    # Vite emits into dist/ but outside /assets. These MUST be served with their
    # real content so the browser gets the correct MIME type — otherwise the SPA
    # fallback returns index.html (text/html) and the service worker registration
    # fails on iOS with "sw.js load failed" (unsupported MIME type).
    _MEDIA_OVERRIDES = {".webmanifest": "application/manifest+json"}

    def _serve_root_file(path: str):
        name = path.lstrip("/")
        # Only single-segment filenames — block any path traversal.
        if not name or "/" in name or ".." in name:
            return None
        target = frontend_path / name
        if target.is_file():
            ext = target.suffix.lower()
            media = _MEDIA_OVERRIDES.get(ext)
            return FileResponse(target, media_type=media) if media else FileResponse(target)
        return None

    # Custom 404 handler to serve real root files or the SPA for unknown routes.
    from starlette.exceptions import HTTPException as StarletteHTTPException

    @app.exception_handler(404)
    async def custom_404_handler(request: Request, exc: StarletteHTTPException):
        # For API routes, return JSON error
        if request.url.path.startswith("/api/"):
            return JSONResponse(status_code=404, content={"detail": "Not Found"})
        # Serve a real root-level static file (sw.js, manifest, icons) if it exists…
        served = _serve_root_file(request.url.path)
        if served is not None:
            return served
        # …otherwise serve the SPA for client-side routing (ebenfalls ohne Cache,
        # es ist dieselbe index.html wie oben).
        return _index()
else:
    @app.get("/")
    async def root():
        return {"message": "Printloom API Server running. Frontend not available in development mode."}

if __name__ == "__main__":
    import os
    import uvicorn
    # Nativ bindet die Desktop-Hülle an 127.0.0.1; Docker weiter an 0.0.0.0.
    host = os.getenv("PRINTLOOM_HOST", "0.0.0.0")
    port = int(os.getenv("PRINTLOOM_PORT", "8000"))
    uvicorn.run(app, host=host, port=port)
