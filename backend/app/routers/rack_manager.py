"""
Rack Manager
============
Stores rack layout (rows × cols) and slot status in /app/db/rack_slots.json.
Slot IDs are strings "1"…"rows*cols", numbered row-by-row left→right.
"""

import json
import os
import re
import zipfile
import logging
from xml.etree import ElementTree as ET
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import UploadedFile, RackConfiguration
from app.services import storage

router = APIRouter()
logger = logging.getLogger(__name__)

SLOTS_PATH = "/app/db/rack_slots.json"

DEFAULT_NUM_RACKS      = 3
DEFAULT_SLOTS_PER_RACK = 6
DEFAULT_SLOT_H         = 50
DEFAULT_MAGAZINE_SLOT  = 7

STATUSES = {
    "free":     {"label": "Leer",     "color": "gray"},
    "ready":    {"label": "Bereit",   "color": "green"},
    "printing": {"label": "Druckt",   "color": "blue"},
    "done":     {"label": "Fertig",   "color": "amber"},
    "locked":   {"label": "Gesperrt", "color": "red"},
}


def _default_slot():
    return {"status": "free", "file_id": None, "file_name": None,
            "object_height_mm": None, "note": ""}


def _default_data(num_racks=DEFAULT_NUM_RACKS, slots_per_rack=DEFAULT_SLOTS_PER_RACK):
    slots = {}
    for r in range(1, num_racks + 1):
        for s in range(1, slots_per_rack + 1):
            slots[f"{r}-{s}"] = _default_slot()
    return {
        "num_racks":        num_racks,
        "slots_per_rack":   slots_per_rack,
        "slot_height_mm":   DEFAULT_SLOT_H,
        "stack_rack":       1,
        "stack_slot":       DEFAULT_MAGAZINE_SLOT,
        "magazine_slot":    DEFAULT_MAGAZINE_SLOT,
        "magazine_counts":  [6] * num_racks,
        "max_plates":       4,
        "slots":            slots,
    }


def _load() -> dict:
    if os.path.exists(SLOTS_PATH):
        try:
            with open(SLOTS_PATH) as f:
                data = json.load(f)
            # Migrate old flat format (rows/cols) → new multi-rack format
            if "rows" in data and "num_racks" not in data:
                old_slots = data.get("slots", {})
                sp_rack   = int(data.get("cols", DEFAULT_SLOTS_PER_RACK))
                data["num_racks"]      = 1
                data["slots_per_rack"] = sp_rack
                new_slots = {}
                for s in range(1, sp_rack + 1):
                    new_slots[f"1-{s}"] = old_slots.get(str(s), _default_slot())
                data["slots"] = new_slots
                for key in ("rows", "cols"):
                    data.pop(key, None)
                _save(data)
                return data
            # Ensure all expected slots exist, trim orphans
            nr  = int(data.get("num_racks",      DEFAULT_NUM_RACKS))
            spr = int(data.get("slots_per_rack",  DEFAULT_SLOTS_PER_RACK))
            data["num_racks"]      = nr
            data["slots_per_rack"] = spr
            valid = {f"{r}-{s}" for r in range(1, nr+1) for s in range(1, spr+1)}
            for k in valid:
                data["slots"].setdefault(k, _default_slot())
            data["slots"] = {k: v for k, v in data["slots"].items() if k in valid}
            data.setdefault("max_plates", 4)
            data.pop("magazine_count", None)  # no longer stored, calculated dynamically
            data.setdefault("magazine_slot", DEFAULT_MAGAZINE_SLOT)
            # Initialize per-rack magazine counts; resize if num_racks changed
            if "magazine_counts" not in data:
                data["magazine_counts"] = [int(data.get("max_plates", 6))] * nr
            else:
                counts = [max(0, int(c)) for c in data["magazine_counts"]]
                if len(counts) < nr:
                    counts += [6] * (nr - len(counts))
                data["magazine_counts"] = counts[:nr]
            return data
        except Exception as e:
            logger.warning(f"rack_slots.json load failed: {e}")
    return _default_data()


def _save(data: dict):
    try:
        storage.write_json(SLOTS_PATH, data)
    except Exception as e:
        logger.error(f"rack_slots.json save failed: {e}")


def _num_slots(db: Session) -> int:
    if os.path.exists(SLOTS_PATH):
        try:
            with open(SLOTS_PATH) as f:
                d = json.load(f)
            return int(d.get("num_racks", DEFAULT_NUM_RACKS)) * int(d.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
        except Exception:
            pass
    rack = db.query(RackConfiguration).first()
    return rack.num_slots if rack else DEFAULT_NUM_RACKS * DEFAULT_SLOTS_PER_RACK


def _sync_db_slots(db: Session, num_slots: int):
    """Keep DB RackConfiguration.num_slots in sync."""
    try:
        rack = db.query(RackConfiguration).first()
        if rack:
            rack.num_slots = num_slots
            db.add(rack)
            db.commit()
    except Exception as e:
        logger.warning(f"DB sync failed: {e}")


# ── Height analysis ────────────────────────────────────────────────────

def _parse_gcode_header_height(header: str) -> dict:
    """
    Parse slicing metadata from a gcode header string.
    Returns max_z_mm, layer_count, layer_height_mm, source.
    """
    # Bambu Studio uses "max_z_height: X" with colon; PrusaSlicer uses "max_layer_z = X" with equals
    mz = re.search(r';\s*(?:max_layer_z|max_z_height)\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    lh = re.search(r';\s*layer_height\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    flh = re.search(r';\s*(?:initial_layer_height|first_layer_height)\s*[=:]\s*([\d.]+)', header, re.IGNORECASE)
    # Bambu uses "total layer number: N"; PrusaSlicer uses "total_layer_num = N"
    lc = re.search(r';\s*(?:total_layer_num|total layer number)\s*[=:]\s*(\d+)', header, re.IGNORECASE)

    layer_height = float(lh.group(1)) if lh else 0.0
    first_layer  = float(flh.group(1)) if flh else layer_height
    layer_count  = int(lc.group(1)) if lc else 0

    if mz:
        return {
            "max_z_mm":       round(float(mz.group(1)), 2),
            "layer_count":    layer_count,
            "layer_height_mm": layer_height,
            "source":         "gcode_max_layer_z",
        }
    if layer_height > 0 and layer_count > 0:
        # first_layer + (remaining layers × layer_height)
        height = round(first_layer + (layer_count - 1) * layer_height, 2)
        return {
            "max_z_mm":       height,
            "layer_count":    layer_count,
            "layer_height_mm": layer_height,
            "source":         "gcode_layer_calc",
        }
    return {}


def analyze_3mf_height(file_path: str) -> dict:
    """
    Extract print height from a .3mf (sliced Bambu/PrusaSlicer) file.

    Priority:
      1. Metadata/slice_info.config  — <metadata key="height"> or layer_height + top_layer
      2. Embedded *.gcode header     — max_layer_z / layer_height × total_layer_num
      3. Vertex Z scan               — max Z coordinate in the raw mesh (fallback)
    """
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            names = zf.namelist()

            # 1. slice_info.config
            si_path = next((n for n in names if n.lower().endswith('slice_info.config')), None)
            if si_path:
                try:
                    content = zf.open(si_path).read().decode('utf-8', errors='ignore')
                    h_m  = re.search(r'key="height"\s+value="([\d.]+)"', content)
                    lh_m = re.search(r'key="layer_height"\s+value="([\d.]+)"', content)
                    lc_m = re.search(r'key="top_layer"\s+value="(\d+)"', content)
                    if h_m:
                        return {
                            "max_z_mm":       round(float(h_m.group(1)), 2),
                            "layer_count":    int(lc_m.group(1)) if lc_m else 0,
                            "layer_height_mm": float(lh_m.group(1)) if lh_m else 0.0,
                            "source":         "slice_info_height",
                        }
                    if lh_m and lc_m:
                        lh = float(lh_m.group(1))
                        lc = int(lc_m.group(1))
                        return {
                            "max_z_mm":       round(lh * lc, 2),
                            "layer_count":    lc,
                            "layer_height_mm": lh,
                            "source":         "slice_info_calc",
                        }
                except Exception as e:
                    logger.debug(f"slice_info.config parse failed: {e}")

            # 2. Embedded gcode header (read first 64 KB) — use correct plate
            plate_gcodes = sorted(
                [n for n in names if re.match(r'Metadata/plate_\d+\.gcode$', n, re.IGNORECASE)],
                key=lambda n: int(re.search(r'plate_(\d+)', n).group(1))
            )
            gcode_path = plate_gcodes[0] if plate_gcodes else next(
                (n for n in names if n.lower().endswith('.gcode')), None
            )
            if gcode_path:
                try:
                    with zf.open(gcode_path) as gf:
                        header = gf.read(65536).decode('utf-8', errors='ignore')
                    result = _parse_gcode_header_height(header)
                    if result:
                        return result
                except Exception as e:
                    logger.debug(f"embedded gcode header parse failed: {e}")

            # 3. Vertex Z scan (raw mesh — no slicing info available)
            model_path = next((n for n in names if n.lower().endswith('.model')), None)
            if model_path:
                max_z = 0.0
                with zf.open(model_path) as f:
                    for _, elem in ET.iterparse(f, events=('start',)):
                        local = elem.tag.split('}')[-1] if '}' in elem.tag else elem.tag
                        if local == 'vertex':
                            z_str = elem.get('z')
                            if z_str:
                                try:
                                    z = float(z_str)
                                    if z > max_z:
                                        max_z = z
                                except ValueError:
                                    pass
                            elem.clear()
                return {"max_z_mm": round(max_z, 2), "layer_count": 0, "layer_height_mm": 0.0, "source": "vertex_scan"}

    except Exception as e:
        logger.error(f"analyze_3mf_height failed: {e}")

    return {"max_z_mm": 0.0, "layer_count": 0, "layer_height_mm": 0.0, "source": "failed"}


def analyze_gcode_height(file_path: str) -> dict:
    """
    Scan a .gcode file for the maximum print height.

    Priority:
      1. max_layer_z / MAXZ / HEIGHT comment — most reliable
      2. layer_height × total_layer_num calculation
      3. G0/G1 Z moves (stops before end-gcode markers)
    """
    comment_z    = 0.0
    move_z       = 0.0
    layer_count  = 0
    layer_height = 0.0
    first_layer  = 0.0
    in_end_gcode = False

    move_re = re.compile(r'^G[01]\s[^\n]*\bZ([\d.]+)', re.IGNORECASE)
    comment_patterns = [
        re.compile(r';\s*max_layer_z\s*[=:]\s*([\d.]+)',     re.IGNORECASE),
        re.compile(r';\s*maxz\s*[=:]\s*([\d.]+)',            re.IGNORECASE),
        re.compile(r';\s*object\s*height\s*[=:]\s*([\d.]+)', re.IGNORECASE),
        re.compile(r';\s*total\s*height\s*[=:]\s*([\d.]+)',  re.IGNORECASE),
        re.compile(r';\s*HEIGHT\s*[=:]\s*([\d.]+)',           re.IGNORECASE),
        re.compile(r';\s*print\s*height\s*[=:]\s*([\d.]+)',  re.IGNORECASE),
    ]
    layer_re   = re.compile(r';\s*(?:LAYER_COUNT|total_layer_num)\s*[=:]\s*(\d+)', re.IGNORECASE)
    lh_re      = re.compile(r';\s*layer_height\s*[=:]\s*([\d.]+)', re.IGNORECASE)
    flh_re     = re.compile(r';\s*(?:initial_layer_height|first_layer_height)\s*[=:]\s*([\d.]+)', re.IGNORECASE)
    end_gcode_re = re.compile(
        r';\s*(end[_\s]?(gcode|print|code)|custom\s+end\s+gcode|endgcode)',
        re.IGNORECASE
    )

    try:
        with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue

                if end_gcode_re.search(line):
                    in_end_gcode = True

                found = False
                for pat in comment_patterns:
                    mc = pat.search(line)
                    if mc:
                        z = float(mc.group(1))
                        if z > comment_z:
                            comment_z = z
                        found = True
                        break
                if found:
                    continue

                lm = layer_re.search(line)
                if lm:
                    layer_count = int(lm.group(1))
                    continue

                lhm = lh_re.search(line)
                if lhm and layer_height == 0.0:
                    layer_height = float(lhm.group(1))
                    continue

                flhm = flh_re.search(line)
                if flhm and first_layer == 0.0:
                    first_layer = float(flhm.group(1))
                    continue

                if not in_end_gcode:
                    m = move_re.match(line)
                    if m:
                        z = float(m.group(1))
                        if z > move_z:
                            move_z = z
    except Exception as e:
        logger.error(f"analyze_gcode_height failed: {e}")

    if comment_z > 0:
        return {"max_z_mm": round(comment_z, 2), "layer_count": layer_count,
                "layer_height_mm": layer_height, "source": "gcode_comment"}

    if layer_height > 0 and layer_count > 0:
        fl = first_layer if first_layer > 0 else layer_height
        calc_z = round(fl + (layer_count - 1) * layer_height, 2)
        return {"max_z_mm": calc_z, "layer_count": layer_count,
                "layer_height_mm": layer_height, "source": "gcode_layer_calc"}

    return {"max_z_mm": round(move_z, 2), "layer_count": layer_count,
            "layer_height_mm": layer_height, "source": "gcode_move_scan"}


RACKS_PATH = "/app/db/racks.json"


def _load_racks() -> list:
    if os.path.exists(RACKS_PATH):
        try:
            with open(RACKS_PATH) as f:
                return json.load(f)
        except Exception as e:
            logger.warning(f"racks.json load failed: {e}")
    # Default-Rack erzeugen
    default = [{"id": "default", "name": "Hauptregal", "rows": DEFAULT_ROWS,
                "cols": DEFAULT_COLS, "slot_height_mm": DEFAULT_SLOT_H, "color": "#3b82f6"}]
    _save_racks(default)
    return default


def _save_racks(racks: list):
    try:
        storage.write_json(RACKS_PATH, racks)
    except Exception as e:
        logger.error(f"racks.json save failed: {e}")


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("/")
def get_all(db: Session = Depends(get_db)):
    data = _load()
    nr  = data.get("num_racks",      DEFAULT_NUM_RACKS)
    spr = data.get("slots_per_rack",  DEFAULT_SLOTS_PER_RACK)
    max_plates = data.get("max_plates", 4)
    mag_counts = data.get("magazine_counts", [6] * nr)
    return {
        "num_racks":          nr,
        "slots_per_rack":     spr,
        "num_slots":          nr * spr,
        "slot_height_mm":     data["slot_height_mm"],
        "height_margin_pct":  data.get("height_margin_pct", 15.0),
        "stack_rack":         data.get("stack_rack", 1),
        "stack_slot":         data.get("stack_slot", DEFAULT_MAGAZINE_SLOT),
        "magazine_slot":      data.get("magazine_slot", DEFAULT_MAGAZINE_SLOT),
        "magazine_counts":    mag_counts,
        "magazine_count":     max(0, sum(mag_counts)),
        "max_plates":         max_plates,
        "slots":              data["slots"],
        "statuses":           STATUSES,
    }


@router.put("/config")
def update_config(body: dict, db: Session = Depends(get_db)):
    data = _load()
    if "num_racks" in body:
        data["num_racks"]      = max(1, min(10, int(body["num_racks"])))
    if "slots_per_rack" in body:
        data["slots_per_rack"] = max(1, min(20, int(body["slots_per_rack"])))
    if "slot_height_mm" in body:
        data["slot_height_mm"] = float(body["slot_height_mm"])
    if "stack_rack" in body:
        data["stack_rack"]     = max(1, int(body["stack_rack"]))
    if "stack_slot" in body:
        data["stack_slot"]     = max(1, int(body["stack_slot"]))
    if "max_plates" in body:
        data["max_plates"] = max(1, int(body["max_plates"]))
    if "magazine_slot" in body:
        data["magazine_slot"] = max(1, int(body["magazine_slot"]))
        data["stack_slot"]    = data["magazine_slot"]  # keep in sync
    if "magazine_counts" in body:
        counts = body["magazine_counts"]
        if isinstance(counts, list):
            data["magazine_counts"] = [max(0, int(c)) for c in counts]
    if "height_margin_pct" in body:
        data["height_margin_pct"] = max(0, min(100, float(body["height_margin_pct"])))
    nr  = int(data.get("num_racks",      DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack",  DEFAULT_SLOTS_PER_RACK))
    existing = data.get("slots", {})
    new_slots = {}
    for r in range(1, nr + 1):
        for s in range(1, spr + 1):
            k = f"{r}-{s}"
            new_slots[k] = existing.get(k, _default_slot())
    data["slots"] = new_slots
    _sync_db_slots(db, nr * spr)
    _save(data)
    return {
        "success":           True,
        "num_racks":         nr,
        "slots_per_rack":    spr,
        "num_slots":         nr * spr,
        "slot_height_mm":    data["slot_height_mm"],
        "height_margin_pct": data.get("height_margin_pct", 15.0),
    }


@router.post("/magazine/refill")
def refill_magazine(body: dict = None):
    """Refill every rack's magazine to full WITHOUT touching the rack layout.
    Body may include {"value": N} to set a specific count; otherwise each rack is
    refilled to `slots_per_rack` (the configured capacity)."""
    data = _load()
    nr  = int(data.get("num_racks",     DEFAULT_NUM_RACKS))
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    body = body or {}
    if body.get("value") is not None:
        target = max(0, int(body["value"]))
    else:
        target = spr
    data["magazine_counts"] = [target] * nr
    _save(data)
    return {
        "success":         True,
        "magazine_counts": data["magazine_counts"],
        "magazine_count":  target * nr,
        "per_rack":        target,
    }


_PLATE_PRESENT = ("done", "printing", "occupied")

def _refill_one(data: dict, slot_id: str):
    """A plate taken out of the rack goes back into that rack's magazine ('oben
    aufgefüllt'). Call this AFTER the slot has been set to free. Capped so that
    magazine + plates-still-in-this-rack never exceeds the rack capacity — i.e.
    with 2 plates in the rack the magazine tops out at capacity − 2."""
    try:
        rack = int(str(slot_id).split("-")[0])
    except Exception:
        rack = 1
    counts = data.get("magazine_counts") or []
    idx = rack - 1
    if not (0 <= idx < len(counts)):
        return
    spr = int(data.get("slots_per_rack", DEFAULT_SLOTS_PER_RACK))
    occupied = sum(1 for k, s in (data.get("slots") or {}).items()
                   if k.split("-")[0] == str(rack) and s.get("status") in _PLATE_PRESENT)
    cap = max(0, spr - occupied)
    counts[idx] = min(cap, int(counts[idx]) + 1)
    data["magazine_counts"] = counts


@router.put("/slots/{slot_id}")
def update_slot(slot_id: str, body: dict, db: Session = Depends(get_db)):
    data = _load()
    if slot_id not in data["slots"]:
        raise HTTPException(404, f"Slot {slot_id} nicht gefunden")
    slot = data["slots"][slot_id]
    old_status = slot.get("status")
    for field in ("status", "file_id", "file_name", "object_height_mm", "note"):
        if field in body:
            slot[field] = body[field]
    # Taking a plate out of the rack auto-refills the magazine and fully clears
    # the slot — sonst bleibt die alte Objekthöhe stehen und erzeugt im Regal
    # weiter eine „Ghost"-Platte über dem (jetzt leeren) Fach.
    if slot.get("status") == "free" and old_status in _PLATE_PRESENT:
        slot.update({"file_id": None, "file_name": None,
                     "object_height_mm": None, "note": ""})
        _refill_one(data, slot_id)
    _save(data)
    return {"success": True, "slot": slot}


@router.post("/slots/clear")
def clear_slots(body: dict = None):
    """Atomically clear multiple slots in ONE load-save (avoids the race that
    concurrent per-slot PUTs cause, where only some writes survive).
    Body: {"slot_ids": [...]} to clear specific slots, or {"status": "done"}
    (default) to clear every slot currently in that status."""
    data = _load()
    body = body or {}
    slots = data.get("slots", {})
    ids = body.get("slot_ids")
    if ids is None:
        status = body.get("status", "done")
        ids = [k for k, s in slots.items() if s.get("status") == status]
    cleared = 0
    for k in ids:
        if k in slots:
            prev = slots[k].get("status")
            slots[k].update({"status": "free", "file_id": None,
                             "file_name": None, "object_height_mm": None})
            cleared += 1
            if prev in _PLATE_PRESENT:
                _refill_one(data, k)   # taken-out plate → back into the magazine
    _save(data)
    return {"success": True, "cleared": cleared, "slots": slots}


@router.get("/racks")
def get_racks():
    """Gibt alle konfigurierten Racks zurück."""
    return _load_racks()


@router.post("/racks")
def create_rack(body: dict):
    """Legt ein neues Rack an."""
    from uuid import uuid4
    racks = _load_racks()
    new_rack = {
        "id":             str(uuid4())[:8],
        "name":           body.get("name", "Neues Regal"),
        "rows":           int(body.get("rows", DEFAULT_ROWS)),
        "cols":           int(body.get("cols", DEFAULT_COLS)),
        "slot_height_mm": float(body.get("slot_height_mm", DEFAULT_SLOT_H)),
        "color":          body.get("color", "#6366f1"),
    }
    racks.append(new_rack)
    _save_racks(racks)
    return new_rack


@router.delete("/racks/{rack_id}")
def delete_rack(rack_id: str):
    """Löscht ein Rack (default kann nicht gelöscht werden)."""
    if rack_id == "default":
        from fastapi import HTTPException as FE
        raise FE(400, "Das Standard-Rack kann nicht gelöscht werden")
    racks = _load_racks()
    new_list = [r for r in racks if r["id"] != rack_id]
    if len(new_list) == len(racks):
        from fastapi import HTTPException as FE
        raise FE(404, f"Rack {rack_id} nicht gefunden")
    _save_racks(new_list)
    return {"success": True}


@router.post("/analyze/{file_id}")
def analyze_file(file_id: int, db: Session = Depends(get_db)):
    """Parse a .gcode or .3mf file and return its maximum print height."""
    f = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not f:
        raise HTTPException(404, "Datei nicht gefunden")
    if f.file_type not in (".gcode", ".3mf"):
        raise HTTPException(400, "Nur .gcode und .3mf-Dateien können analysiert werden")
    if not os.path.exists(f.file_path):
        raise HTTPException(404, "Datei nicht auf Disk gefunden")

    if f.file_type == ".3mf":
        result = analyze_3mf_height(f.file_path)
    else:
        result = analyze_gcode_height(f.file_path)

    lc   = result.get("layer_count", 0)
    lh   = result.get("layer_height_mm", 0.0)
    mz   = result["max_z_mm"]
    cfg  = _load()
    margin = 1.0 + float(cfg.get("height_margin_pct", 15.0)) / 100.0
    if lc > 0 and lh > 0:
        computed = round(lc * lh * margin, 1)
    elif mz > 0:
        computed = round(mz * margin, 1)
    else:
        computed = 0.0

    return {
        "success":            True,
        "file_id":            file_id,
        "file_name":          f.original_filename,
        "max_z_mm":           mz,
        "layer_count":        lc,
        "layer_height_mm":    lh,
        "computed_height_mm": computed,
        "source":             result.get("source", "unknown"),
    }
