import json
import os
import httpx
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.services import storage

router = APIRouter()
logger = logging.getLogger(__name__)

CONFIG_PATH = "/app/db/macro_configs.json"

# ── Default values from printer_calibration_variables.cfg ──────────────
DEFAULTS = {
    "open_door_x1c": {
        "label": "Tür öffnen — Bambu X1C",
        "internal_macro": "_OPEN_DOOR",
        "fields": {
            "door_x_start":       {"label": "X Start",          "value": 104,   "step": 0.5},
            "door_y_start":       {"label": "Y Start",          "value": 319,   "step": 0.5},
            "door_z_engage":      {"label": "Z Engage",         "value": 105,   "step": 0.5},
            "door_d_to_pin_dist": {"label": "Dist to Pin",      "value": 370,   "step": 1.0},
        }
    },
    "close_door_x1c": {
        "label": "Tür schließen — Bambu X1C",
        "internal_macro": "_CLOSE_DOOR",
        "fields": {
            "door_x_start":       {"label": "X Start",          "value": 103,   "step": 0.5},
            "door_y_start":       {"label": "Y Start",          "value": 322,   "step": 0.5},
            "door_z_engage":      {"label": "Z Engage",         "value": 105,   "step": 0.5},
            "door_d_to_pin_dist": {"label": "Dist to Pin",      "value": 375,   "step": 1.0},
        }
    },
    "eject_x1c": {
        "label": "Platte auswerfen — Bambu X1C",
        "internal_macro": "_EJECT_FROM_PRINTER",
        "fields": {
            "otto_x_unclamp": {"label": "X Unclamp", "value": 442,  "step": 0.5},
            "otto_y_engage":  {"label": "Y Engage",  "value": 319,  "step": 0.5},
            "otto_z_flat":    {"label": "Z Flat",    "value": 21,   "step": 0.5},
        }
    },
    "load_x1c": {
        "label": "Platte einlegen — Bambu X1C",
        "internal_macro": "_LOAD_ONTO_PRINTER",
        "fields": {
            "otto_x_unclamp": {"label": "X Unclamp", "value": 425,  "step": 0.5},
            "otto_y_engage":  {"label": "Y Engage",  "value": 340,  "step": 0.5},
            "otto_z_flat":    {"label": "Z Flat",    "value": 17.5, "step": 0.5},
        }
    },
}


def _load() -> dict:
    data = storage.read_json(CONFIG_PATH, None)
    if data is not None:
        return data
    return json.loads(json.dumps(DEFAULTS))  # deep copy


def _save(data: dict):
    try:
        storage.write_json(CONFIG_PATH, data)
    except Exception as e:
        logger.error(f"Could not save macro configs: {e}")


def _klipper(db: Session) -> Device:
    d = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not d:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    return d


# ── Endpoints ──────────────────────────────────────────────────────────

@router.get("/configs")
def get_configs():
    """Return all macro configs with current stored values."""
    return _load()


@router.put("/configs/{config_key}")
def update_config(config_key: str, updates: dict):
    """Update field values for one macro config. Body: {field_name: new_value, ...}"""
    data = _load()
    if config_key not in data:
        raise HTTPException(404, f"Config '{config_key}' nicht gefunden")
    for field_key, new_val in updates.items():
        if field_key in data[config_key]["fields"]:
            data[config_key]["fields"][field_key]["value"] = float(new_val)
    _save(data)
    return {"success": True, "config": data[config_key]}


@router.post("/run/{config_key}")
async def run_calibrated_macro(config_key: str, db: Session = Depends(get_db)):
    """Apply stored coordinates via SET_GCODE_VARIABLE, then call the internal macro."""
    data  = _load()
    if config_key not in data:
        raise HTTPException(404, f"Config '{config_key}' nicht gefunden")

    cfg    = data[config_key]
    macro  = cfg["internal_macro"]
    fields = cfg["fields"]
    klipper = _klipper(db)

    lines = [
        f"SET_GCODE_VARIABLE MACRO={macro} VARIABLE={fname} VALUE={fdata['value']}"
        for fname, fdata in fields.items()
    ]
    lines.append(macro)
    script = "\n".join(lines)
    logger.info(f"run_calibrated_macro [{config_key}]:\n{script}")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json={"script": script})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return {"success": True, "label": cfg["label"], "macro": macro}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.post("/run/{config_key}/with-values")
async def run_with_values(config_key: str, values: dict, db: Session = Depends(get_db)):
    """Run a macro with ad-hoc values (not saving). Body: {field_name: value, ...}"""
    data = _load()
    if config_key not in data:
        raise HTTPException(404, f"Config '{config_key}' nicht gefunden")

    cfg    = data[config_key]
    macro  = cfg["internal_macro"]
    klipper = _klipper(db)

    merged = {k: v["value"] for k, v in cfg["fields"].items()}
    merged.update({k: float(v) for k, v in values.items() if k in cfg["fields"]})

    lines = [f"SET_GCODE_VARIABLE MACRO={macro} VARIABLE={k} VALUE={v}" for k, v in merged.items()]
    lines.append(macro)

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json={"script": "\n".join(lines)})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return {"success": True, "label": cfg["label"]}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")
