"""Farm-Layout: Drucker und Regale als Module auf einer X-Schiene.

Die eigentliche Logik steht in app/services/farm_layout.py (rein, testbar). Hier
liegt nur das Speichern, die Sperre und die Migration aus der alten Formel.

Sperre (Phase 4.3): Falsche X-Werte fahren den Arm gegen die Mechanik. Das Layout
ist deshalb standardmäßig gesperrt, und bei LAUFENDER Farm lässt es sich weder
entsperren noch ändern — mitten im Zyklus die Positionen zu verschieben wäre der
sicherste Weg in einen Crash.
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


def load_layout() -> dict:
    """Gespeichertes Layout (leer, wenn noch keines eingerichtet wurde)."""
    return farm_layout.clean(storage.read_json(LAYOUT_PATH, None) or farm_layout.default_layout())


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
async def get_layout():
    lay = load_layout()
    return {
        "layout": lay,
        "configured": bool(lay["modules"]),
        "problems": farm_layout.check(lay, _limits()) if lay["modules"] else [],
        "farm_running": _farm_running(),
        "limits": _limits(),
    }


@router.post("/migrate")
async def migrate_layout(db: Session = Depends(get_db)):
    """Bestehende Ein-Drucker-Installation in ein gleichwertiges Layout überführen.

    Die X-Werte kommen aus genau der Formel, die bisher gerechnet wurde — die
    Positionen ändern sich also NICHT. Ohne diesen Schritt bleibt alles beim Alten.
    """
    if has_layout():
        raise HTTPException(400, "Layout existiert bereits — zum Neuaufbau erst zurücksetzen")
    geom = _motion.merge_defaults(storage.read_json(GEOMETRY_PATH, None))
    devices = [{"id": d.id, "name": d.name, "model": d.model}
               for d in db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB).all()]
    lay = _save(farm_layout.from_geometry(geom, _rack_cfg(), devices))
    logger.info("Farm-Layout aus der Formel-Geometrie erzeugt: %d Module", len(lay["modules"]))
    return {"success": True, "layout": lay, "problems": farm_layout.check(lay, _limits())}


@router.put("/")
async def put_layout(body: dict):
    """Layout speichern. Nur im entsperrten Zustand und nur bei stehender Farm."""
    if _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout kann nicht geändert werden")
    current = load_layout()
    if current["modules"] and current["locked"] and body.get("locked", True):
        raise HTTPException(409, "Layout ist gesperrt — erst entsperren")
    lay = _save({**body, "locked": bool(body.get("locked", True))})
    problems = farm_layout.check(lay, _limits())
    return {"success": True, "layout": lay, "problems": problems}


@router.post("/lock")
async def set_lock(body: dict = None):
    """Sperre setzen/lösen. Entsperren geht nur, wenn die Farm steht."""
    body = body or {}
    lock = bool(body.get("locked", True))
    if not lock and _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout bleibt gesperrt")
    lay = load_layout()
    lay["locked"] = lock
    return {"success": True, "layout": _save(lay)}


@router.delete("/")
async def reset_layout():
    """Layout verwerfen → Printloom rechnet wieder mit der alten Formel."""
    if _farm_running():
        raise HTTPException(409, "Farm läuft — das Layout kann nicht zurückgesetzt werden")
    storage.write_json(LAYOUT_PATH, farm_layout.default_layout())
    return {"success": True}


@router.get("/printers")
async def layout_printers(db: Session = Depends(get_db)):
    """Drucker-Module mit ihrem Gerät — Grundlage für die Übersicht und die
    Job-Verteilung."""
    lay = load_layout()
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
