from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pathlib import Path

from app.routers import config, queue, files, devices, control, printer, calibration, rack_manager, system, autofarm, project, profiles, filaments, push, folders
from app.db.database import init_db
import logging

# INFO statt DEBUG: DEBUG ließ uvicorn + alle Bibliotheken (MQTT/HTTP/FTP) sehr
# viel protokollieren — unnötige CPU-/IO-Last und ein endlos wachsendes Log. Die
# App-eigenen Meldungen laufen über logger.info und bleiben damit sichtbar.
logging.basicConfig(level=logging.INFO)
logging.getLogger("app").setLevel(logging.INFO)
# Gesprächige Drittanbieter-Logger zusätzlich dämpfen (Zugriffslog, HTTP, MQTT).
for _noisy in ("uvicorn.access", "httpx", "httpcore", "paho", "paho.mqtt", "watchfiles"):
    logging.getLogger(_noisy).setLevel(logging.WARNING)

# Initialize database
init_db()


app = FastAPI(title="Printloom - 3D Print Farm Controller", version="4.1.1")

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(config.router,        prefix="/api/config",       tags=["Configuration"])
app.include_router(devices.router,       prefix="/api/devices",       tags=["Devices"])
app.include_router(files.router,         prefix="/api/files",         tags=["File Management"])
app.include_router(queue.router,         prefix="/api/queue",         tags=["Print Queue"])
app.include_router(control.router,       prefix="/api/control",       tags=["Control"])
app.include_router(printer.router,       prefix="/api/printer",       tags=["Printer"])
app.include_router(calibration.router,   prefix="/api/calibration",   tags=["Calibration"])
app.include_router(rack_manager.router,  prefix="/api/rack-manager",  tags=["Rack Manager"])
app.include_router(system.router,        prefix="/api/system",        tags=["System"])
app.include_router(autofarm.router,      prefix="/api/autofarm",      tags=["AutoFarm"])
app.include_router(project.router,       prefix="/api/project",        tags=["Project"])
app.include_router(profiles.router,      prefix="/api/profiles",       tags=["Profiles"])
app.include_router(filaments.router,     prefix="/api/filaments",       tags=["Filaments"])
app.include_router(push.router,          prefix="/api/push",            tags=["Web-Push"])
app.include_router(folders.router,       prefix="/api/folders",         tags=["Folders"])


@app.get("/api/health")
async def health_check():
    return {"status": "healthy"}

# Serve static frontend files
frontend_path = Path("/app/frontend/dist")

if frontend_path.exists():
    # Mount static assets (JS, CSS, images)
    app.mount("/assets", StaticFiles(directory=frontend_path / "assets"), name="assets")

    # Serve index.html for root
    @app.get("/", response_class=HTMLResponse)
    async def serve_root():
        return FileResponse(frontend_path / "index.html")

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
        # …otherwise serve the SPA for client-side routing.
        return FileResponse(frontend_path / "index.html")
else:
    @app.get("/")
    async def root():
        return {"message": "Printloom API Server running. Frontend not available in development mode."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
