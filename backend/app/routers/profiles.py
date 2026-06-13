"""Printer profile endpoints — export/import config bundles + local library.

See app/services/profiles.py for the safety model (import never runs G-code).
"""
from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import profiles

router = APIRouter()


class Component(BaseModel):
    name: str = ""
    instructions: str = ""
    url: str = ""


class ExportMeta(BaseModel):
    name: str = "Mein Profil"
    printer_model: str = ""
    description: str = ""
    components: List[Component] = []


@router.post("/export")
async def export_profile(meta: ExportMeta):
    """Snapshot the current configuration into a shareable profile bundle."""
    return profiles.build_profile(
        name=meta.name,
        printer_model=meta.printer_model,
        description=meta.description,
        components=[c.model_dump() for c in meta.components],
    )


@router.post("/import")
async def import_profile(profile: dict):
    """Validate + apply a profile bundle to the live configuration."""
    if not isinstance(profile, dict) or "schema" not in profile:
        raise HTTPException(400, "Kein gültiges Profil (schema fehlt)")
    if profile.get("schema") != profiles.SCHEMA:
        raise HTTPException(400, f"Unbekanntes Profil-Schema: {profile.get('schema')}")
    applied = profiles.apply_profile(profile)
    if not any(applied.values()):
        raise HTTPException(400, "Profil enthielt keine anwendbaren Daten")
    return {"success": True, "applied": applied}


@router.get("/local")
async def get_local_profiles():
    return profiles.list_local()


@router.post("/local")
async def save_local_profile(profile: dict):
    if not isinstance(profile, dict) or not profile.get("name"):
        raise HTTPException(400, "Profil braucht einen Namen")
    return {"success": True, "profiles": profiles.save_local(profile)}


@router.delete("/local/{name}")
async def delete_local_profile(name: str):
    return {"success": True, "profiles": profiles.delete_local(name)}
