import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.schemas.schemas import DeviceCreate, DeviceUpdate, DeviceResponse
from app.services.bambu_mqtt import BambuLabMQTT
from app.services.bambu_ftp import BambuFTP
from typing import List
import httpx

router = APIRouter()
logger = logging.getLogger(__name__)

# Webcam + per-device settings stored in SystemConfig as JSON
from app.models.models import SystemConfig
import json as _json

def _get_device_settings(db: Session, device_id: int) -> dict:
    row = db.query(SystemConfig).filter(SystemConfig.key == f"device_settings_{device_id}").first()
    if row:
        try: return _json.loads(row.value)
        except: pass
    return {"webcam_url": ""}

def _set_device_settings(db: Session, device_id: int, settings: dict):
    row = db.query(SystemConfig).filter(SystemConfig.key == f"device_settings_{device_id}").first()
    if row:
        row.value = _json.dumps(settings)
    else:
        row = SystemConfig(key=f"device_settings_{device_id}", value=_json.dumps(settings))
    db.add(row)
    db.commit()


@router.get("/", response_model=List[DeviceResponse])
async def list_devices(db: Session = Depends(get_db)):
    return db.query(Device).all()


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(device_id: int, db: Session = Depends(get_db)):
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    return device


@router.post("/", response_model=DeviceResponse)
async def create_device(device: DeviceCreate, db: Session = Depends(get_db)):
    existing = db.query(Device).filter(Device.name == device.name).first()
    if existing:
        raise HTTPException(status_code=400, detail="Device name already exists")
    db_device = Device(**device.dict())
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device


@router.put("/{device_id}", response_model=DeviceResponse)
async def update_device(device_id: int, device: DeviceUpdate, db: Session = Depends(get_db)):
    db_device = db.query(Device).filter(Device.id == device_id).first()
    if not db_device:
        raise HTTPException(status_code=404, detail="Device not found")
    for field, value in device.dict(exclude_unset=True).items():
        setattr(db_device, field, value)
    db.add(db_device)
    db.commit()
    db.refresh(db_device)
    return db_device


@router.delete("/{device_id}")
async def delete_device(device_id: int, db: Session = Depends(get_db)):
    db_device = db.query(Device).filter(Device.id == device_id).first()
    if not db_device:
        raise HTTPException(status_code=404, detail="Device not found")
    db.delete(db_device)
    db.commit()
    return {"message": "Device deleted successfully"}


@router.get("/{device_id}/settings")
async def get_device_settings(device_id: int, db: Session = Depends(get_db)):
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    settings = _get_device_settings(db, device_id)
    # HA-Token niemals an den Browser geben — nur signalisieren, ob eins gesetzt ist.
    if settings.get("ha_token"):
        settings = {**settings, "ha_token": "", "ha_token_set": True}
    return settings

@router.put("/{device_id}/settings")
async def update_device_settings(device_id: int, body: dict, db: Session = Depends(get_db)):
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    settings = _get_device_settings(db, device_id)
    body = dict(body)
    body.pop("ha_token_set", None)  # rein informativ, nie speichern
    # Leeres Token-Feld = "behalten" (Frontend zeigt das Token nie an).
    if "ha_token" in body and not body["ha_token"] and settings.get("ha_token"):
        body.pop("ha_token")
    settings.update(body)
    _set_device_settings(db, device_id, settings)
    # Antwort ebenfalls maskieren.
    if settings.get("ha_token"):
        settings = {**settings, "ha_token": "", "ha_token_set": True}
    return settings

@router.post("/{device_id}/test")
async def test_device(device_id: int, db: Session = Depends(get_db)):
    """Echte Verbindung zum Gerät testen."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    loop = asyncio.get_event_loop()

    if device.device_type == PrinterType.BAMBU_LAB:
        # MQTT-Test
        mqtt_client = BambuLabMQTT(device)
        mqtt_ok = await loop.run_in_executor(None, lambda: mqtt_client.connect(wait_timeout=5.0))
        if mqtt_ok:
            mqtt_client.disconnect()

        # FTP-Test
        ftp = BambuFTP(device.ip_address, device.access_code)
        ftp_ok, ftp_msg = await loop.run_in_executor(None, ftp.test_connection)

        success = mqtt_ok and ftp_ok
        return {
            "device_id": device_id,
            "success": success,
            "mqtt": {"connected": mqtt_ok},
            "ftp": {"connected": ftp_ok, "message": ftp_msg},
            "message": "Verbindung erfolgreich" if success else "Verbindung teilweise oder vollständig fehlgeschlagen"
        }

    elif device.device_type == PrinterType.KLIPPER:
        try:
            url = f"http://{device.ip_address}:{device.port}/printer/info"
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(url)
            ok = resp.status_code == 200
            return {
                "device_id": device_id,
                "success": ok,
                "message": "Klipper erreichbar" if ok else f"Klipper antwortet mit Status {resp.status_code}"
            }
        except Exception as e:
            return {
                "device_id": device_id,
                "success": False,
                "message": f"Klipper nicht erreichbar: {e}"
            }

    return {
        "device_id": device_id,
        "success": False,
        "message": "Kein Test für diesen Gerätetyp verfügbar"
    }
