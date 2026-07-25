"""Online-Dienste (Opt-in) — Hinweise, Sprachpakete, Bibliothek.

Alle Endpoints hier sind harmlos, solange der Nutzer nichts freigeschaltet hat:
ohne Zustimmung + Schalter geht KEIN externer Request raus (siehe services/online.py).
Der Abruf läuft absichtlich über das Backend, damit der Browser nie selbst mit einem
fremden Host spricht.

Bibliotheks-Inhalte werden NICHT automatisch angewendet: `/library/item` liefert den
geprüften Inhalt zurück, die UI zeigt ihn als Vorschau, und erst ein bewusster Klick
schickt ihn an die bestehenden Import-Endpoints (/system/lang/import,
/profiles/import, /autofarm/sequences). Sequenzen bewegen Hardware — hier wird
nichts hinter dem Rücken des Nutzers übernommen.
"""
import logging

from fastapi import APIRouter, HTTPException

from app.services import online

router = APIRouter()
logger = logging.getLogger(__name__)

NOTICES_PATH = "api/v1/notices.json"
LIBRARY_PATH = "api/v1/library/index.json"


def _current_version() -> str:
    try:
        from app.routers.system import _get_current_version
        return _get_current_version()
    except Exception:
        return ""


@router.get("/settings")
async def get_settings():
    """Aktuelle Opt-in-Einstellungen + Zielserver (für den Warnhinweis in der UI)."""
    cfg = online.read_settings()
    return {**cfg, "features": list(online.FEATURES)}


@router.post("/settings")
async def set_settings(body: dict):
    """Zustimmung/Schalter setzen. Zustimmung zurückziehen schaltet alles aus."""
    if not isinstance(body, dict):
        raise HTTPException(400, "Ungültiger Body")
    cfg = online.write_settings(body)
    return {"success": True, **cfg}


@router.get("/notices")
async def get_notices(refresh: bool = False):
    """Bekannte Probleme & Hinweise — gefiltert auf die laufende Version.
    Ohne Freigabe: nur ein evtl. vorhandener Cache-Stand, kein Netzverkehr."""
    res = await online.fetch(NOTICES_PATH, "notices", force=refresh)
    version = _current_version()
    notices = online.clean_notices(res.get("data") or {}, version) if res.get("data") else []
    return {
        "notices": notices,
        "version": version,
        "fetched_at": res.get("fetched_at"),
        "from_cache": res.get("from_cache"),
        "disabled": res.get("disabled"),
        "error": res.get("error"),
    }


@router.get("/library")
async def get_library(refresh: bool = False, kind: str = None):
    """Katalog der Sprachpakete / Profile / Sequenzen (nur Index, keine Inhalte)."""
    res = await online.fetch(LIBRARY_PATH, "library", force=refresh)
    items = online.clean_library(res.get("data") or {}) if res.get("data") else []
    if kind:
        items = [i for i in items if i["kind"] == kind]
    return {
        "items": items,
        "fetched_at": res.get("fetched_at"),
        "from_cache": res.get("from_cache"),
        "disabled": res.get("disabled"),
        "error": res.get("error"),
    }


@router.get("/library/item")
async def get_library_item(id: str, refresh: bool = False):
    """Inhalt EINES Bibliotheks-Eintrags, geprüft — für die Vorschau.
    Angewendet wird erst über die bestehenden Import-Endpoints."""
    if not online.enabled("library"):
        raise HTTPException(403, "Bibliothek ist nicht freigeschaltet (System → Online-Dienste)")
    idx = await online.fetch(LIBRARY_PATH, "library")
    items = online.clean_library(idx.get("data") or {}) if idx.get("data") else []
    entry = next((i for i in items if i["id"] == id), None)
    if not entry:
        raise HTTPException(404, "Eintrag nicht im Katalog")

    res = await online.fetch(f"api/v1/library/{entry['path']}", "library", force=refresh)
    if not res.get("data"):
        raise HTTPException(502, f"Inhalt nicht abrufbar: {res.get('error') or 'unbekannt'}")
    try:
        content = online.clean_library_item(entry["kind"], res["data"])
    except ValueError as e:
        raise HTTPException(422, f"Inhalt passt nicht zur Art „{entry['kind']}\": {e}")
    return {"item": entry, "content": content, "fetched_at": res.get("fetched_at")}


@router.post("/cache/clear")
async def clear_cache():
    """Zwischengespeicherte Online-Daten löschen (Datenschutz / Fehlersuche)."""
    online.clear_cache()
    return {"success": True}
