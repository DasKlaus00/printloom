from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.schemas.schemas import MacroExecutionRequest, MacroExecutionResponse
from datetime import datetime
import httpx

router = APIRouter()

# Macro names for Klipper
VALID_MACROS = {
    "GRAB_FROM_SLOT_1", "GRAB_FROM_SLOT_2", "GRAB_FROM_SLOT_3",
    "GRAB_FROM_SLOT_4", "GRAB_FROM_SLOT_5", "GRAB_FROM_SLOT_6",
    "STORE_TO_SLOT_1", "STORE_TO_SLOT_2", "STORE_TO_SLOT_3",
    "STORE_TO_SLOT_4", "STORE_TO_SLOT_5", "STORE_TO_SLOT_6",
    "OPEN_DOOR_BAMBU_X_ONE_C", "CLOSE_DOOR_BAMBU_X_ONE_C",
    "EJECT_FROM_BAMBULAB_X_ONE_C", "LOAD_ONTO_BAMBULAB_X_ONE_C",
    "OTTOEJECT_HOME", "PARK_OTTOEJECT", "TEST_STORAGE_RACK_CONFIGURATION"
}

@router.post("/macro", response_model=MacroExecutionResponse)
async def execute_macro(request: MacroExecutionRequest, db: Session = Depends(get_db)):
    """Execute a Klipper macro via Moonraker API"""
    
    # Validate macro name
    if request.macro_name not in VALID_MACROS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid macro. Valid macros: {', '.join(sorted(VALID_MACROS))}"
        )
    
    # Get Klipper device
    klipper_device = db.query(Device).filter(
        Device.device_type == PrinterType.KLIPPER
    ).first()
    
    if not klipper_device:
        raise HTTPException(
            status_code=400,
            detail="Klipper device not configured"
        )
    
    if not klipper_device.is_active:
        raise HTTPException(
            status_code=400,
            detail="Klipper device is not active"
        )
    
    try:
        # Execute macro via Moonraker API
        url = f"http://{klipper_device.ip_address}:{klipper_device.port}/printer/gcode/script"
        
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                url,
                json={"script": request.macro_name}
            )
        
        if response.status_code == 200:
            return MacroExecutionResponse(
                success=True,
                macro_name=request.macro_name,
                message="Macro executed successfully",
                timestamp=datetime.utcnow()
            )
        else:
            return MacroExecutionResponse(
                success=False,
                macro_name=request.macro_name,
                message=f"Macro execution failed: {response.text}",
                timestamp=datetime.utcnow()
            )
    
    except Exception as e:
        return MacroExecutionResponse(
            success=False,
            macro_name=request.macro_name,
            message=f"Error executing macro: {str(e)}",
            timestamp=datetime.utcnow()
        )

@router.get("/macros")
async def list_macros():
    """List available macros"""
    return {
        "macros": sorted(VALID_MACROS),
        "total": len(VALID_MACROS)
    }

@router.get("/macro/{macro_name}")
async def get_macro_info(macro_name: str):
    """Get information about a specific macro"""
    if macro_name not in VALID_MACROS:
        raise HTTPException(status_code=404, detail="Macro not found")
    
    macro_descriptions = {
        "GRAB_FROM_SLOT_1": "Grab part from slot 1",
        "GRAB_FROM_SLOT_2": "Grab part from slot 2",
        "GRAB_FROM_SLOT_3": "Grab part from slot 3",
        "GRAB_FROM_SLOT_4": "Grab part from slot 4",
        "GRAB_FROM_SLOT_5": "Grab part from slot 5",
        "GRAB_FROM_SLOT_6": "Grab part from slot 6",
        "STORE_TO_SLOT_1": "Store part to slot 1",
        "STORE_TO_SLOT_2": "Store part to slot 2",
        "STORE_TO_SLOT_3": "Store part to slot 3",
        "STORE_TO_SLOT_4": "Store part to slot 4",
        "STORE_TO_SLOT_5": "Store part to slot 5",
        "STORE_TO_SLOT_6": "Store part to slot 6",
        "OPEN_DOOR_BAMBU_X_ONE_C": "Open Bambu Lab X1C door",
        "CLOSE_DOOR_BAMBU_X_ONE_C": "Close Bambu Lab X1C door",
        "EJECT_FROM_BAMBULAB_X_ONE_C": "Eject plate from Bambu Lab X1C",
        "LOAD_ONTO_BAMBULAB_X_ONE_C": "Load plate onto Bambu Lab X1C",
        "OTTOEJECT_HOME": "Home OTTOeject system",
        "PARK_OTTOEJECT": "Park OTTOeject in safe position",
        "TEST_STORAGE_RACK_CONFIGURATION": "Test storage rack configuration"
    }
    
    return {
        "macro_name": macro_name,
        "description": macro_descriptions.get(macro_name, "No description available")
    }

@router.post("/emergency-stop")
async def emergency_stop(db: Session = Depends(get_db)):
    """Emergency stop all operations"""
    # Deactivate all devices
    devices = db.query(Device).all()
    for device in devices:
        device.is_active = False
        db.add(device)
    db.commit()
    
    return {
        "success": True,
        "message": "Emergency stop activated - all devices deactivated"
    }

@router.post("/resume")
async def resume_operations(db: Session = Depends(get_db)):
    """Resume operations after emergency stop"""
    # Reactivate all devices
    devices = db.query(Device).all()
    for device in devices:
        device.is_active = True
        db.add(device)
    db.commit()
    
    return {
        "success": True,
        "message": "Operations resumed"
    }

@router.post("/klipper/gcode")
async def send_klipper_gcode(request: dict, db: Session = Depends(get_db)):
    """Send raw GCode to Klipper via Moonraker (for Z movement, jog, etc.)."""
    gcode = request.get("gcode", "").strip()
    if not gcode:
        raise HTTPException(400, "Kein GCode angegeben")

    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            r = await client.post(url, json={"script": gcode})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return {"success": True, "gcode": gcode}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/position")
async def get_klipper_position(db: Session = Depends(get_db)):
    """Query current toolhead position from Moonraker."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/objects/query?toolhead"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json()
        th = data.get("result", {}).get("status", {}).get("toolhead", {})
        pos = th.get("position", [0, 0, 0, 0])
        return {
            "success": True,
            "x": round(pos[0], 2),
            "y": round(pos[1], 2),
            "z": round(pos[2], 2),
            "homed_axes": th.get("homed_axes", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/ottoeject/variables")
async def get_ottoeject_variables(db: Session = Depends(get_db)):
    """Read _GLOBAL_VARS from Klipper/Moonraker (storage calibration)."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = (
        f"http://{klipper.ip_address}:{klipper.port}"
        "/printer/objects/query?gcode_macro%20_GLOBAL_VARS"
    )
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker Fehler: {r.text}")
        data = r.json()
        variables = (
            data.get("result", {})
                .get("status", {})
                .get("gcode_macro _GLOBAL_VARS", {})
        )
        return {"success": True, "variables": variables}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


_ALLOWED_VARS = {
    "global_x_unclamp",
    "global_y_engage",
    "global_first_z_flat",
    "global_slot_gap",
    "global_y_pullback_limit",
}


@router.post("/ottoeject/variables")
async def set_ottoeject_variables(variables: dict, db: Session = Depends(get_db)):
    """Set _GLOBAL_VARS at runtime via SET_GCODE_VARIABLE (resets on Klipper restart)."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    lines = [
        f"SET_GCODE_VARIABLE MACRO=_GLOBAL_VARS VARIABLE={k} VALUE={float(v)}"
        for k, v in variables.items()
        if k in _ALLOWED_VARS
    ]
    if not lines:
        raise HTTPException(400, "Keine gültigen Variablen übergeben")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/gcode/script"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.post(url, json={"script": "\n".join(lines)})
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker Fehler: {r.text}")
        return {"success": True, "message": "Variablen aktualisiert", "applied": list(variables.keys())}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/info")
async def get_klipper_info(db: Session = Depends(get_db)):
    """Query Klipper firmware state via Moonraker /printer/info."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")

    url = f"http://{klipper.ip_address}:{klipper.port}/printer/info"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json().get("result", {})
        state = data.get("state", "unknown")
        return {
            "success": True,
            "state": state,
            "state_message": data.get("state_message", ""),
            "ready": state == "ready",
            "software_version": data.get("software_version", ""),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/configs")
async def list_klipper_configs(db: Session = Depends(get_db)):
    """List config files available in Moonraker's config root."""
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    url = f"http://{klipper.ip_address}:{klipper.port}/server/files/list?root=config"
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(url)
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        data = r.json().get("result", [])
        files = [
            {"filename": f["filename"], "size": f.get("size", 0), "modified": f.get("modified", 0)}
            for f in data if isinstance(f, dict) and f.get("filename", "").endswith(".cfg")
        ]
        return {"files": sorted(files, key=lambda x: x["filename"])}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/klipper/config/{filename:path}")
async def read_klipper_config(filename: str, db: Session = Depends(get_db)):
    """Read a single .cfg file from Moonraker's config root."""
    if not filename.endswith(".cfg"):
        raise HTTPException(400, "Nur .cfg Dateien erlaubt")
    klipper = db.query(Device).filter(Device.device_type == PrinterType.KLIPPER).first()
    if not klipper:
        raise HTTPException(400, "Klipper / OTTOeject nicht konfiguriert")
    url = f"http://{klipper.ip_address}:{klipper.port}/server/files/config/{filename}"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            r = await client.get(url)
        if r.status_code == 404:
            raise HTTPException(404, f"Datei '{filename}' nicht gefunden")
        if r.status_code != 200:
            raise HTTPException(502, f"Moonraker: {r.text}")
        return {"filename": filename, "content": r.text}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"Verbindung zu Moonraker fehlgeschlagen: {e}")


@router.get("/status")
async def get_control_status(db: Session = Depends(get_db)):
    """Get overall control system status"""
    devices = db.query(Device).all()
    active_devices = sum(1 for d in devices if d.is_active)
    
    return {
        "total_devices": len(devices),
        "active_devices": active_devices,
        "devices": [
            {
                "id": d.id,
                "name": d.name,
                "type": d.device_type.value,
                "is_active": d.is_active,
                "ip_address": d.ip_address
            }
            for d in devices
        ]
    }
