"""Marketplace proxy
==================
The browser talks only to this local backend; the backend forwards to the
configured marketplace server (``server_url``) with the stored ``om4d_`` bearer
token. Benefits: the token never reaches the browser, and there are no CORS
constraints on the external server.

The external server (built separately, see the Printloom marketplace prompt)
exposes Discord-OAuth2 login + token management in its own web dashboard; here
we only consume its REST API:
  GET    /api/me
  GET    /api/profiles            (paginated, ?search=&page=)
  GET    /api/profiles/{id}
  POST   /api/profiles            ({name, description, data})
  PUT    /api/profiles/{id}
  DELETE /api/profiles/{id}
"""
from typing import Optional
import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import appsettings

router = APIRouter()

_TIMEOUT = 12.0


def _conn() -> tuple[str, str]:
    mp = appsettings.read_marketplace()
    base, token = mp["server_url"], mp["token"]
    if not base:
        raise HTTPException(400, "Kein Marktplatz-Server konfiguriert")
    if not token:
        raise HTTPException(401, "Kein Marktplatz-Token gesetzt")
    return base, token


async def _forward(method: str, path: str, *, json=None, params=None, auth: bool = True):
    """Forward a request to the marketplace server, return parsed JSON.
    Raises HTTPException mirroring the upstream status on error."""
    mp = appsettings.read_marketplace()
    base = mp["server_url"]
    if not base:
        raise HTTPException(400, "Kein Marktplatz-Server konfiguriert")
    headers = {}
    if auth:
        if not mp["token"]:
            raise HTTPException(401, "Kein Marktplatz-Token gesetzt")
        headers["Authorization"] = f"Bearer {mp['token']}"
    url = f"{base}{path}"
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.request(method, url, json=json, params=params, headers=headers)
    except Exception as e:
        raise HTTPException(502, f"Marktplatz nicht erreichbar: {e}")
    if r.status_code == 401:
        raise HTTPException(401, "Token ungültig oder abgelaufen")
    if r.status_code == 403:
        raise HTTPException(403, "Keine Berechtigung (nur eigene Inhalte)")
    if r.status_code >= 400:
        detail = r.text[:300]
        try:
            detail = r.json().get("detail", detail)
        except Exception:
            pass
        raise HTTPException(r.status_code, f"Marktplatz-Fehler: {detail}")
    try:
        return r.json()
    except Exception:
        return {}


class UploadPayload(BaseModel):
    name: str
    description: str = ""
    data: dict           # the full om4d-profile bundle


@router.get("/me")
async def me():
    """Verify the configured token; returns the marketplace user."""
    return await _forward("GET", "/api/me")


@router.get("/profiles")
async def list_profiles(search: Optional[str] = None, page: int = 1):
    """Public listing — no token required (auth=False), but we still send it if set."""
    mp = appsettings.read_marketplace()
    return await _forward("GET", "/api/profiles",
                          params={"search": search or "", "page": page},
                          auth=bool(mp["token"]))


@router.get("/profiles/{profile_id}")
async def get_profile(profile_id: str):
    mp = appsettings.read_marketplace()
    return await _forward("GET", f"/api/profiles/{profile_id}", auth=bool(mp["token"]))


@router.post("/profiles")
async def upload_profile(payload: UploadPayload):
    _conn()  # require token
    return await _forward("POST", "/api/profiles", json=payload.model_dump())


@router.put("/profiles/{profile_id}")
async def update_profile(profile_id: str, payload: UploadPayload):
    _conn()
    return await _forward("PUT", f"/api/profiles/{profile_id}", json=payload.model_dump())


@router.delete("/profiles/{profile_id}")
async def delete_profile(profile_id: str):
    _conn()
    return await _forward("DELETE", f"/api/profiles/{profile_id}")
