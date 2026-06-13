"""Folder tree for the parts library (Phase 1 — Teile-Management).

Folders are a self-referencing tree (`parent_id`). Files reference a folder via
`UploadedFile.folder_id` (NULL = root). Deleting a folder never loses data — its
files and subfolders are moved up to the deleted folder's parent.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Folder, UploadedFile
from app.schemas.schemas import FolderCreate, FolderUpdate

router = APIRouter()


def _get_folder(db: Session, folder_id):
    if folder_id is None:
        return None
    return db.query(Folder).filter(Folder.id == folder_id).first()


def _descendant_ids(db: Session, folder_id: int) -> set:
    """All folder ids below `folder_id` (inclusive) — used to prevent cycles."""
    out = {folder_id}
    frontier = [folder_id]
    while frontier:
        children = db.query(Folder.id).filter(Folder.parent_id.in_(frontier)).all()
        new = [c.id for c in children if c.id not in out]
        out.update(new)
        frontier = new
    return out


@router.get("/")
def list_folders(db: Session = Depends(get_db)):
    """Flat list of all folders with per-folder counts (frontend builds the tree)."""
    folders = db.query(Folder).all()
    # Count files per folder
    file_counts = {}
    for (fid,) in db.query(UploadedFile.folder_id).filter(UploadedFile.folder_id.isnot(None)).all():
        file_counts[fid] = file_counts.get(fid, 0) + 1
    sub_counts = {}
    for (pid,) in db.query(Folder.parent_id).filter(Folder.parent_id.isnot(None)).all():
        sub_counts[pid] = sub_counts.get(pid, 0) + 1

    return [
        {
            "id": f.id,
            "name": f.name,
            "parent_id": f.parent_id,
            "created_at": f.created_at,
            "file_count": file_counts.get(f.id, 0),
            "subfolder_count": sub_counts.get(f.id, 0),
        }
        for f in folders
    ]


@router.post("/")
def create_folder(body: FolderCreate, db: Session = Depends(get_db)):
    name = (body.name or "").strip()
    if not name:
        raise HTTPException(400, "Ordnername fehlt")
    if body.parent_id is not None and not _get_folder(db,body.parent_id):
        raise HTTPException(404, "Übergeordneter Ordner nicht gefunden")
    folder = Folder(name=name, parent_id=body.parent_id)
    db.add(folder)
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id,
            "created_at": folder.created_at, "file_count": 0, "subfolder_count": 0}


@router.patch("/{folder_id}")
def update_folder(folder_id: int, body: FolderUpdate, db: Session = Depends(get_db)):
    folder = _get_folder(db,folder_id)
    if not folder:
        raise HTTPException(404, "Ordner nicht gefunden")
    data = body.model_dump(exclude_unset=True)
    if "name" in data:
        nm = (data["name"] or "").strip()
        if not nm:
            raise HTTPException(400, "Ordnername fehlt")
        folder.name = nm
    if "parent_id" in data:
        new_parent = data["parent_id"]
        if new_parent is not None:
            if new_parent in _descendant_ids(db, folder_id):
                raise HTTPException(400, "Ordner kann nicht in sich selbst verschoben werden")
            if not _get_folder(db,new_parent):
                raise HTTPException(404, "Zielordner nicht gefunden")
        folder.parent_id = new_parent
    db.commit()
    db.refresh(folder)
    return {"id": folder.id, "name": folder.name, "parent_id": folder.parent_id,
            "created_at": folder.created_at}


@router.delete("/{folder_id}")
def delete_folder(folder_id: int, db: Session = Depends(get_db)):
    folder = _get_folder(db,folder_id)
    if not folder:
        raise HTTPException(404, "Ordner nicht gefunden")
    parent = folder.parent_id
    # Move contained files and subfolders up to the parent — never orphan/lose data.
    db.query(UploadedFile).filter(UploadedFile.folder_id == folder_id).update(
        {UploadedFile.folder_id: parent}, synchronize_session=False)
    db.query(Folder).filter(Folder.parent_id == folder_id).update(
        {Folder.parent_id: parent}, synchronize_session=False)
    db.delete(folder)
    db.commit()
    return {"success": True, "moved_to": parent}
