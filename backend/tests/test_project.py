"""Projekt-Store: Abhaken (done) + Frontend-Save bewahrt den backend-eigenen done-Zähler."""
import pytest

pytest.importorskip("fastapi")

from app.routers import project as proj  # noqa: E402
from app.services import storage          # noqa: E402


def _setup(tmp_path, monkeypatch, data):
    p = str(tmp_path / "project.json")
    storage.write_json(p, data)
    monkeypatch.setattr(proj, "PROJECT_PATH", p)


def test_mark_item_printed_increments_and_caps(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, {"projects": [
        {"id": "p1", "name": "A", "items": [
            {"id": "it1", "file_id": 1, "file_name": "x", "quantity": 2, "done": 0}]}]})
    proj.mark_item_printed("it1")
    assert proj._load()["projects"][0]["items"][0]["done"] == 1
    proj.mark_item_printed("it1")
    proj.mark_item_printed("it1")   # über quantity hinaus → gekappt
    assert proj._load()["projects"][0]["items"][0]["done"] == 2


def test_update_preserves_done(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, {"projects": [
        {"id": "p1", "name": "A", "items": [
            {"id": "it1", "file_id": 1, "file_name": "x", "quantity": 3, "done": 2}]}]})
    # Frontend schickt done=0 mit → Backend behält done=2, übernimmt Name/Menge.
    payload = proj.ProjectPayload(name="A2", items=[
        proj.ProjectItem(id="it1", file_id=1, file_name="x", quantity=5, done=0)])
    proj.update_project("p1", payload)
    data = proj._load()["projects"][0]
    assert data["name"] == "A2"
    assert data["items"][0]["done"] == 2 and data["items"][0]["quantity"] == 5


def test_migrate_legacy_single_project(tmp_path, monkeypatch):
    _setup(tmp_path, monkeypatch, {"name": "Alt", "items": [
        {"file_id": 1, "file_name": "x", "quantity": 2}]})
    data = proj._load()
    assert len(data["projects"]) == 1
    p = data["projects"][0]
    assert p["name"] == "Alt"
    assert p["items"][0]["quantity"] == 2 and p["items"][0]["done"] == 0 and p["items"][0]["id"]
