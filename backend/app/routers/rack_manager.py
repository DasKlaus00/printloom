"""Regalverwaltung: Regal-Konfiguration, Fach-Zustände, Magazin-Bestand.

Gespeichert wird über app/services/rack_store.py (gemeinsam mit der Farm, unter
einer Sperre). Fach-IDs sind „Regal-Fach", z. B. "2-5".
"""
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_db
from app.models.models import UploadedFile
from app.services import print_file, rack_logic, rack_store
from app.services.rack_logic import DEFAULT_SLOT_TOLERANCE_MM, DEFAULT_STACKED_PCT

router = APIRouter()
logger = logging.getLogger(__name__)

STATUSES = {
    "free":     {"label": "Leer",     "color": "gray"},
    "ready":    {"label": "Bereit",   "color": "green"},
    "printing": {"label": "Druckt",   "color": "blue"},
    "done":     {"label": "Fertig",   "color": "amber"},
    "locked":   {"label": "Gesperrt", "color": "red"},
}

# In diesen Zuständen liegt physisch eine Platte im Fach.
_PLATE_PRESENT = ("done", "printing", "occupied")


@router.get("/")
def get_all():
    data = rack_store.load()
    nr, spr = data["num_racks"], data["slots_per_rack"]
    mag_counts, mag_defs = data["magazine_counts"], data["magazine_defaults"]
    # Ohne Magazin zählen die MARKIERTEN Fächer als Bestand (nicht die Zähler) —
    # so zeigt das Badge in der Farm-Ansicht in beiden Aufbauten dasselbe: wie
    # viele leere Platten noch bereitliegen.
    no_mag = rack_logic.magazine_slot_of(data) <= 0
    empty_plates = [f"{r}-{s}" for r, s in rack_logic.marked_empty_plates(data)]
    return {
        "num_racks":          nr,
        "slots_per_rack":     spr,
        "num_slots":          nr * spr,
        "slot_height_mm":     data["slot_height_mm"],
        "slot_tolerance_mm":  data.get("slot_tolerance_mm", DEFAULT_SLOT_TOLERANCE_MM),
        "slot_stacked_pct":   data.get("slot_stacked_pct", DEFAULT_STACKED_PCT),
        "height_margin_pct":  data.get("height_margin_pct", 15.0),
        "stack_rack":         data.get("stack_rack", 1),
        "stack_slot":         data.get("stack_slot", rack_store.DEFAULT_MAGAZINE_SLOT),
        "magazine_slot":      data["magazine_slot"],
        "magazine_counts":    mag_counts,
        "magazine_count":     len(empty_plates) if no_mag else max(0, sum(mag_counts)),
        # Fest konfigurierte Sollwerte + deren Summe (Badge-Nenner „X / magazine_total").
        "magazine_defaults":  mag_defs,
        "magazine_total":     (nr * spr) if no_mag else max(0, sum(mag_defs)),
        # Ohne Magazin: welche Fächer halten eine leere Platte (Markierung des Nutzers).
        "empty_plates":       empty_plates,
        "max_plates":         data.get("max_plates", 4),
        "slots":              data["slots"],
        "statuses":           STATUSES,
    }


@router.put("/config")
def update_config(body: dict):
    with rack_store.edit() as data:
        rack_store.apply_config(data, body)
    return {
        "success":           True,
        "num_racks":         data["num_racks"],
        "slots_per_rack":    data["slots_per_rack"],
        "num_slots":         data["num_racks"] * data["slots_per_rack"],
        "slot_height_mm":    data["slot_height_mm"],
        "height_margin_pct": data.get("height_margin_pct", 15.0),
    }


@router.post("/magazine/refill")
def refill_magazine(body: dict = None):
    """Magazin-Bestand zurücksetzen, OHNE das Regal-Layout anzufassen.
    Ohne Body wird jedes Rack auf seinen fest konfigurierten Sollwert
    (`magazine_defaults`) zurückgesetzt — genau die „Ursprungszahl", die in den
    Einstellungen festgelegt wurde. Mit {"value": N} werden alle Racks auf N gesetzt."""
    body = body or {}
    with rack_store.edit() as data:
        nr = data["num_racks"]
        if body.get("value") is not None:
            counts = [max(0, int(body["value"]))] * nr
        else:
            counts = list(data["magazine_defaults"])
        data["magazine_counts"] = counts
    return {"success": True, "magazine_counts": counts, "magazine_count": sum(counts)}


@router.post("/magazine/take")
def take_from_magazine(body: dict = None):
    """Eine Platte aus dem Magazin EINES Regals entnehmen (Zähler −1). Wird vom
    Drucker-Tab nach einem manuellen „Aus Magazin holen" gerufen, damit der Bestand
    stimmt. Body: {"rack": N} (1-basiert)."""
    body = body or {}
    try:
        rack = int(body.get("rack", 1))
    except (TypeError, ValueError):
        rack = 1
    with rack_store.edit() as data:
        nr = data["num_racks"]
        if not (1 <= rack <= nr):
            raise HTTPException(400, f"Ungültiges Regal {rack} (1–{nr})")
        counts = data["magazine_counts"]
        if counts[rack - 1] <= 0:
            raise HTTPException(400, f"Magazin R{rack} ist leer")
        counts[rack - 1] -= 1
    return {"success": True, "rack": rack, "magazine_counts": counts,
            "magazine_count": sum(counts)}


def _refill_one(data: dict, slot_id: str):
    """Eine aus dem Regal genommene Platte wandert oben ins Magazin ihres Regals.
    AUFRUFEN, NACHDEM das Fach auf frei steht. Gedeckelt auf den Sollwert dieses
    Magazins minus der noch im Regal liegenden Platten — der Bestand kann nie über
    die „Ursprungszahl" steigen."""
    try:
        rack = int(str(slot_id).split("-")[0])
    except ValueError:
        rack = 1
    counts = data.get("magazine_counts") or []
    idx = rack - 1
    if not (0 <= idx < len(counts)):
        return
    defs = data.get("magazine_defaults") or []
    default = int(defs[idx]) if idx < len(defs) else rack_store.DEFAULT_MAGAZINE_DEFAULT
    occupied = sum(1 for k, s in (data.get("slots") or {}).items()
                   if k.split("-")[0] == str(rack) and s.get("status") in _PLATE_PRESENT)
    counts[idx] = min(max(0, default - occupied), int(counts[idx]) + 1)


@router.put("/slots/{slot_id}")
def update_slot(slot_id: str, body: dict):
    with rack_store.edit() as data:
        if slot_id not in data["slots"]:
            raise HTTPException(404, f"Slot {slot_id} nicht gefunden")
        slot = data["slots"][slot_id]
        old_status = slot.get("status")
        for field in ("status", "file_id", "file_name", "object_height_mm", "note"):
            if field in body:
                slot[field] = body[field]
        no_mag = rack_logic.magazine_slot_of(data) <= 0
        if "empty_plate" in body:
            # „Hier liegt eine leere Platte" — nur ohne Magazin sinnvoll, sonst käme der
            # Nachschub aus zwei Quellen. Ein Fach mit Druck drin kann keine leere Platte
            # halten, deshalb nur auf freien Fächern setzbar.
            want = bool(body["empty_plate"])
            if want and not no_mag:
                raise HTTPException(400, "Leerplatten-Markierung gibt es nur im Aufbau ohne "
                                         "Magazin (alle Fächer = Lagerfächer)")
            if want and slot.get("status", "free") != "free":
                raise HTTPException(400, f"Fach {slot_id} ist nicht frei — dort liegt keine "
                                         f"leere Platte")
            slot["empty_plate"] = want
        # Eine Platte aus dem Regal nehmen räumt das Fach ganz — sonst bleibt die alte
        # Objekthöhe stehen und erzeugt eine „Geister"-Platte über dem leeren Fach.
        if slot.get("status") == "free" and old_status in _PLATE_PRESENT:
            slot.update({"file_id": None, "file_name": None,
                         "object_height_mm": None, "note": ""})
            if no_mag:
                # Ohne Magazin bleibt die Platte im Regal: Druck abnehmen, dieselbe
                # Platte zurücklegen — das Fach hält wieder eine LEERE Platte.
                if "empty_plate" not in body:
                    slot["empty_plate"] = True
            else:
                _refill_one(data, slot_id)
        # Ein Fach, in dem etwas liegt/gedruckt wird, hält keine leere Platte mehr.
        if slot.get("status") in _PLATE_PRESENT or slot.get("status") == "locked":
            slot["empty_plate"] = False
    return {"success": True, "slot": slot}


@router.post("/slots/clear")
def clear_slots(body: dict = None):
    """Mehrere Fächer in EINEM Schritt räumen.
    Body: {"slot_ids": [...]} oder {"status": "done"} (Standard) für alle Fächer in
    diesem Zustand."""
    body = body or {}
    with rack_store.edit() as data:
        slots = data["slots"]
        ids = body.get("slot_ids")
        if ids is None:
            status = body.get("status", "done")
            ids = [k for k, s in slots.items() if s.get("status") == status]
        cleared = 0
        touched_racks = set()
        no_mag = rack_logic.magazine_slot_of(data) <= 0
        for k in ids:
            if k not in slots:
                continue
            prev = slots[k].get("status")
            slots[k].update({"status": "free", "file_id": None,
                             "file_name": None, "object_height_mm": None})
            cleared += 1
            if prev in _PLATE_PRESENT:
                if no_mag:
                    slots[k]["empty_plate"] = True   # Platte bleibt im Fach, jetzt leer
                else:
                    _refill_one(data, k)
                    touched_racks.add(k.split("-")[0])
        # Ist ein Regal nach dem Entnehmen KOMPLETT leer, steht sein Magazin exakt auf
        # der Sollzahl — „alle entnehmen" landet so verlässlich wieder dort.
        defs, counts = data["magazine_defaults"], data["magazine_counts"]
        for r in touched_racks:
            idx = int(r) - 1
            if not (0 <= idx < len(counts)) or idx >= len(defs):
                continue
            if not any(kk.split("-")[0] == r and ss.get("status") in _PLATE_PRESENT
                       for kk, ss in slots.items()):
                counts[idx] = int(defs[idx])
    return {"success": True, "cleared": cleared, "slots": slots}


@router.post("/analyze/{file_id}")
def analyze_file(file_id: int, plate: int | None = None, db: Session = Depends(get_db)):
    """Druckhöhe einer .gcode/.3mf (bei Multi-Plate: dieser Platte) für die Fachwahl."""
    f = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "Datei nicht gefunden")
    if f.file_type not in (".gcode", ".3mf"):
        raise HTTPException(400, "Nur .gcode und .3mf-Dateien können analysiert werden")
    if not os.path.exists(f.file_path):
        raise HTTPException(404, "Datei nicht auf Disk gefunden")
    result = print_file.object_height(f.file_path, f.file_type, plate,
                                      rack_store.load().get("height_margin_pct", 15.0))
    return {
        "success":            True,
        "file_id":            file_id,
        "file_name":          f.original_filename,
        "max_z_mm":           result["max_z_mm"],
        "layer_count":        result.get("layer_count", 0),
        "layer_height_mm":    result.get("layer_height_mm", 0.0),
        "computed_height_mm": result["computed_height_mm"],
        "source":             result.get("source", "unknown"),
    }
