"""Farm-Layout: Drucker und Regale als Module auf einer X-Schiene.

Seit v1.1.8 hält das Layout KEINE eigenen X-Positionen mehr. Es gab sie doppelt —
im Drucker-Tab (Start-X + Versatz + Δ je Regal) und hier als Modul-Referenz —,
gepflegt wurden sie getrennt, und wer welchen Wert fährt, war von außen nicht zu
sehen. Jetzt leiten sich die Module aus der Geometrie ab (sync_from_geometry);
gespeichert wird nur, was es dort nicht gibt: Namen, welches Gerät an einem
Drucker-Modul hängt und welche Regale zu welchem Drucker gehören.

Eingestellt wird alles im Drucker-Tab. Diese Endpunkte liefern die abgeleitete
Sicht (Übersicht, Job-Verteilung) und nehmen nur noch die Zuordnungen entgegen.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.paths import db_path
from app.services import farm_layout, storage
from app.services import ottoeject_motion as _motion
from app.services import geometry_check as _geometry_check

router = APIRouter()
logger = logging.getLogger(__name__)

LAYOUT_PATH = db_path("farm_layout.json")
GEOMETRY_PATH = db_path("ottoeject_geometry.json")


def _geometry() -> dict:
    return _motion.merge_defaults(storage.read_json(GEOMETRY_PATH, None))


def _devices(db: Session = None) -> list:
    """Bambu-Geräte für die Drucker-Module. Ohne übergebene Session eine eigene
    öffnen: `load_layout` wird auch aus dem Farm-Zyklus gerufen (kein Request),
    und ohne Gerät bliebe das Drucker-Modul ohne device_id — dann fände die
    Job-Verteilung den Drucker nicht."""
    own = db is None
    if own:
        from app.db.database import SessionLocal
        db = SessionLocal()
    try:
        return [{"id": d.id, "name": d.name, "model": d.model}
                for d in db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB).all()]
    except Exception:
        return []
    finally:
        if own:
            db.close()


def load_layout(db: Session = None) -> dict:
    """Aktuelles Layout — IMMER frisch aus der Geometrie abgeleitet.

    Dadurch kann es gar nicht mehr von den Werten im Drucker-Tab abweichen. Aus
    der Datei kommen nur die Angaben, die es in der Geometrie nicht gibt (Namen,
    Geräte-Zuordnung, Regal → Drucker)."""
    stored = storage.read_json(LAYOUT_PATH, None)
    return farm_layout.sync_from_geometry(stored, _geometry(), _rack_cfg(), _devices(db))


def has_layout() -> bool:
    return bool(load_layout()["modules"])


def _save(layout: dict) -> dict:
    lay = farm_layout.clean(layout)
    storage.write_json(LAYOUT_PATH, lay)
    return lay


def _farm_running() -> bool:
    try:
        from app.routers import autofarm
        return bool(autofarm._farm.get("running"))
    except Exception:
        return False


def _rack_cfg() -> dict:
    try:
        from app.routers.rack_manager import _load as _rack_load
        return _rack_load() or {}
    except Exception:
        return {}


def _limits() -> dict:
    try:
        g = _motion.merge_defaults(storage.read_json(GEOMETRY_PATH, None))
        return _geometry_check.limits_from(g)
    except Exception:
        return {}


@router.get("/")
async def get_layout(db: Session = Depends(get_db)):
    """Abgeleitete Sicht auf die Farm. Die X-Werte stehen im Drucker-Tab."""
    lay = load_layout(db)
    return {
        "layout": lay,
        "configured": bool(lay["modules"]),
        "problems": farm_layout.check(lay, _limits()) if lay["modules"] else [],
        "farm_running": _farm_running(),
        "limits": _limits(),
        # Seit v1.1.8: X wird hier nicht mehr gepflegt (siehe Modulkopf).
        "derived": True,
    }


@router.post("/migrate")
async def migrate_layout(db: Session = Depends(get_db)):
    """Alt-Endpunkt: das Layout wird inzwischen immer abgeleitet. Bleibt als
    No-Op erhalten, damit ein noch offener alter Tab keinen Fehler zeigt."""
    return {"success": True, "layout": load_layout(db),
            "problems": farm_layout.check(load_layout(db), _limits())}


@router.put("/")
async def put_layout(body: dict, db: Session = Depends(get_db)):
    """Zuordnungen speichern (Namen, Gerät je Drucker-Modul, Regal → Drucker).

    X-Werte im Body werden bewusst IGNORIERT — sie kommen aus der Geometrie
    (Drucker-Tab). Zwei Quellen für dieselbe Zahl waren genau das Problem."""
    if _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout kann nicht geändert werden")
    # Nur die layout-eigenen Felder übernehmen, alles andere neu ableiten.
    lay = farm_layout.sync_from_geometry(body, _geometry(), _rack_cfg(), _devices(db))
    lay["locked"] = bool(body.get("locked", True))
    _save(lay)
    return {"success": True, "layout": lay,
            "problems": farm_layout.check(lay, _limits())}


@router.post("/lock")
async def set_lock(body: dict = None, db: Session = Depends(get_db)):
    """Sperre setzen/lösen. Entsperren geht nur, wenn die Farm steht."""
    body = body or {}
    lock = bool(body.get("locked", True))
    if not lock and _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout bleibt gesperrt")
    lay = load_layout(db)
    lay["locked"] = lock
    return {"success": True, "layout": _save(lay)}


@router.delete("/")
async def reset_layout(db: Session = Depends(get_db)):
    """Zuordnungen verwerfen → alles wieder direkt aus der Geometrie."""
    if _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout kann nicht zurückgesetzt werden")
    storage.write_json(LAYOUT_PATH, farm_layout.default_layout())
    return {"success": True, "layout": load_layout(db)}


@router.get("/printers")
async def layout_printers(db: Session = Depends(get_db)):
    """Drucker-Module mit ihrem Gerät — Grundlage für die Übersicht und die
    Job-Verteilung."""
    lay = load_layout(db)
    devices = {d.id: d for d in db.query(Device).filter(
        Device.device_type == PrinterType.BAMBU_LAB).all()}
    out = []
    for m in farm_layout.printers(lay):
        dev = devices.get(m.get("device_id"))
        out.append({
            "id": m["id"], "name": m["name"], "x_ref": m["x_ref"],
            "device_id": m.get("device_id"), "enabled": m.get("enabled", True),
            "model": m.get("model") or (dev.model if dev else ""),
            "device_name": dev.name if dev else None,
            "online": dev is not None and bool(dev.is_active),
            "racks": [r["id"] for r in farm_layout.racks_for_printer(lay, m["id"])],
        })
    return {"printers": out}
