"""
Project Manager
===============
Stores multiple print projects in /app/db/project.json.

Schema: { "projects": [ { "id", "name", "items": [ {id, file_id, file_name, quantity, done} ] } ] }

`done` (printed count per item) is BACKEND-OWNED: it is incremented by the farm via
mark_item_printed() when a tagged job finishes, and preserved across frontend saves.
"""
import time
import uuid
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services import storage
from app.paths import db_path

router = APIRouter()
PROJECT_PATH = db_path("project.json")


def _new_id(prefix: str) -> str:
    return f"{prefix}_{int(time.time() * 1000)}_{uuid.uuid4().hex[:6]}"


def _migrate(data: dict) -> dict:
    """Accept the legacy single-project shape {name, items} and wrap it into the
    multi-project schema."""
    if not isinstance(data, dict):
        return {"projects": []}
    if isinstance(data.get("projects"), list):
        return data
    # Legacy single project → one project
    if "items" in data or "name" in data:
        items = [{
            "id":        it.get("id") or _new_id("it"),
            "file_id":   it.get("file_id"),
            "file_name": it.get("file_name", ""),
            "quantity":  max(1, int(it.get("quantity", 1) or 1)),
            "done":      max(0, int(it.get("done", 0) or 0)),
        } for it in (data.get("items") or [])]
        return {"projects": [{
            "id":    _new_id("p"),
            "name":  data.get("name", "Mein Projekt"),
            "items": items,
        }]}
    return {"projects": []}


def _load() -> dict:
    return _migrate(storage.read_json(PROJECT_PATH, {"projects": []}))


def _save(data: dict):
    storage.write_json(PROJECT_PATH, data)


def mark_item_printed(item_id: str) -> None:
    """Increment `done` for the item with this id (searched across all projects),
    capped at its quantity. Called by the farm loop when a `proj:<itemId>` job
    finishes — works even when the Projekt tab is closed."""
    if not item_id:
        return
    data = _load()
    for proj in data.get("projects", []):
        for it in proj.get("items", []):
            if it.get("id") == item_id:
                q = max(1, int(it.get("quantity", 1) or 1))
                it["done"] = min(int(it.get("done", 0) or 0) + 1, q)
                _save(data)
                return


class ProjectItem(BaseModel):
    id: str
    file_id: int
    file_name: str
    quantity: int = 1
    done: int = 0          # vom Frontend ignoriert (backend-eigen)


class ProjectPayload(BaseModel):
    name: str = "Mein Projekt"
    items: List[ProjectItem] = []


class CreatePayload(BaseModel):
    name: str = "Neues Projekt"


@router.get("/")
def list_projects():
    return _load()


@router.post("/")
def create_project(payload: CreatePayload):
    data = _load()
    proj = {"id": _new_id("p"), "name": (payload.name or "Neues Projekt").strip() or "Neues Projekt", "items": []}
    data.setdefault("projects", []).append(proj)
    _save(data)
    return proj


@router.put("/{pid}")
def update_project(pid: str, payload: ProjectPayload):
    data = _load()
    proj = next((p for p in data.get("projects", []) if p.get("id") == pid), None)
    if not proj:
        raise HTTPException(404, "Projekt nicht gefunden")
    # `done` ist backend-eigen → bestehende Werte je Item-id behalten (eingehende ignorieren).
    done_by_id = {it.get("id"): int(it.get("done", 0) or 0) for it in proj.get("items", [])}
    proj["name"] = payload.name
    proj["items"] = []
    for it in payload.items:
        q = max(1, int(it.quantity or 1))
        proj["items"].append({
            "id":        it.id,
            "file_id":   it.file_id,
            "file_name": it.file_name,
            "quantity":  q,
            "done":      min(done_by_id.get(it.id, 0), q),
        })
    _save(data)
    return proj


@router.delete("/{pid}")
def delete_project(pid: str):
    data = _load()
    before = len(data.get("projects", []))
    data["projects"] = [p for p in data.get("projects", []) if p.get("id") != pid]
    _save(data)
    return {"success": True, "removed": before - len(data["projects"])}


@router.post("/{pid}/reset")
def reset_progress(pid: str):
    data = _load()
    proj = next((p for p in data.get("projects", []) if p.get("id") == pid), None)
    if not proj:
        raise HTTPException(404, "Projekt nicht gefunden")
    for it in proj.get("items", []):
        it["done"] = 0
    _save(data)
    return {"success": True}
