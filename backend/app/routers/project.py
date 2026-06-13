"""
Project Manager
===============
Stores print projects (file + quantity combos) in /app/db/project.json.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import List

from app.services import storage

router = APIRouter()
PROJECT_PATH = "/app/db/project.json"


def _load() -> dict:
    return storage.read_json(PROJECT_PATH, {"name": "Mein Projekt", "items": []})


def _save(data: dict):
    storage.write_json(PROJECT_PATH, data)


class ProjectItem(BaseModel):
    id: str
    file_id: int
    file_name: str
    quantity: int = 1
    status: str = "printable"   # "draft" | "printable"


class ProjectPayload(BaseModel):
    name: str = "Mein Projekt"
    items: List[ProjectItem] = []


@router.get("/")
def get_project():
    return _load()


@router.put("/")
def save_project(payload: ProjectPayload):
    _save(payload.model_dump())
    return {"success": True}
