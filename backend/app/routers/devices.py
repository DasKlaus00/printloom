import asyncio
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import Device, PrinterType
from app.schemas.schemas import DeviceCreate, DeviceUpdate, DeviceResponse
from app.services import bambu_manager
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


@router.get("/discover")
async def discover_devices(db: Session = Depends(get_db)):
    """Netzwerk nach Druckern durchsuchen: Bambu (SSDP, inkl. Seriennummer) +
    Klipper/Moonraker (Subnetz-Scan). Bereits angelegte Geräte werden markiert
    (`configured`), damit die UI keine Dubletten anbietet.

    Hinweis: In einem Docker-Bridge-Netz erreichen SSDP-Broadcasts den Container
    nicht — dann liefert der Bambu-Teil evtl. nur den Port-Scan-Fallback (ohne
    Seriennummer). Nativ / `network_mode: host` funktioniert die volle Erkennung."""
    from app.services import discovery
    result = await discovery.discover()
    known_ips = {d.ip_address for d in db.query(Device).all() if d.ip_address}
    for lst in (result.get("bambu", []), result.get("klipper", [])):
        for item in lst:
            item["configured"] = item.get("ip") in known_ips
    return result


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


# Felder, die als Geheimnis behandelt werden: nie an den Browser, beim Speichern
# bedeutet "" → behalten, null → löschen, "wert" → setzen. Statt des Werts geht
# nur ein <feld>_set Flag raus.
_SECRET_FIELDS = ("ha_token", "plug_password", "plug_token")


def _mask_secrets(settings: dict) -> dict:
    out = dict(settings)
    for f in _SECRET_FIELDS:
        if out.get(f):
            out[f] = ""
            out[f"{f}_set"] = True
    return out


@router.get("/{device_id}/settings")
async def get_device_settings(device_id: int, db: Session = Depends(get_db)):
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    return _mask_secrets(_get_device_settings(db, device_id))

@router.put("/{device_id}/settings")
async def update_device_settings(device_id: int, body: dict, db: Session = Depends(get_db)):
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    settings = _get_device_settings(db, device_id)
    body = dict(body)
    for f in _SECRET_FIELDS:
        body.pop(f"{f}_set", None)  # rein informativ, nie speichern
        # Geheimnis-Sonderfälle (Frontend bekommt den Wert nie zu sehen):
        #   null  → explizit LÖSCHEN · ""  → BEHALTEN · "wert" → setzen
        if f in body:
            if body[f] is None:
                settings.pop(f, None)
                body.pop(f)
            elif not body[f] and settings.get(f):
                body.pop(f)
    settings.update(body)
    _set_device_settings(db, device_id, settings)
    return _mask_secrets(settings)


# ── Smart-Plug: Live-Leistung lesen & schalten (Roadmap 3.1/3.2) ─────────────
@router.get("/{device_id}/power")
async def device_power(device_id: int, db: Session = Depends(get_db)):
    """Momentanleistung (W), Energiezähler (kWh) und Ein/Aus-Status der Steckdose."""
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    from app.services import power
    settings = _get_device_settings(db, device_id)
    if not power.plug_configured(settings):
        return {"configured": False, "watts": None, "energy_kwh": None, "on": None}
    data = await power.read_power(settings)
    return {"configured": True, **data}


@router.post("/{device_id}/power/switch")
async def device_power_switch(device_id: int, body: dict, db: Session = Depends(get_db)):
    if not db.query(Device).filter(Device.id == device_id).first():
        raise HTTPException(404, "Device not found")
    from app.services import power
    settings = _get_device_settings(db, device_id)
    if not power.plug_configured(settings):
        raise HTTPException(400, "Keine Steckdose konfiguriert")
    ok = await power.set_plug(settings, bool(body.get("on")))
    if not ok:
        raise HTTPException(502, "Steckdose nicht erreichbar")
    return {"success": True, "on": bool(body.get("on"))}

@router.post("/{device_id}/test")
async def test_device(device_id: int, db: Session = Depends(get_db)):
    """Echte Verbindung zum Gerät testen."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    loop = asyncio.get_event_loop()

    if device.device_type == PrinterType.BAMBU_LAB:
        # MQTT-Test über die persistente Verbindung (bambu_manager) — kein konkurrierender
        # Extra-Connect, der die dauerhafte Verbindung rauswerfen könnte.
        mqtt_ok = await loop.run_in_executor(bambu_manager.executor, bambu_manager.ensure, device)

        # FTP-Test
        ftp = BambuFTP(device.ip_address, device.access_code)
        ftp_ok, ftp_msg = await loop.run_in_executor(bambu_manager.executor, ftp.test_connection)

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
