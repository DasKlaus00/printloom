from datetime import datetime, timezone
from typing import Optional, List

from pydantic import BaseModel, ConfigDict, field_serializer

from app.models.models import PrinterType


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Zeitstempel als UTC KENNZEICHNEN, bevor er den Server verlässt.

    In der Datenbank stehen sie ohne Zeitzone, sind aber UTC. Ohne Kennzeichnung
    liest JavaScript `new Date("…T18:14:55")` als ORTSZEIT — die Anzeige lag damit um
    den UTC-Abstand daneben (im Sommer 2 Std.). Mit dem angehängten Offset stimmt
    sie, auch für alle bereits gespeicherten Einträge — die stehen ja schon in UTC da."""
    if dt is None:
        return None
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


# ── Geräte ───────────────────────────────────────────────────────────────────
class DeviceCreate(BaseModel):
    name: str
    device_type: PrinterType
    # Modell-ID aus printer_models (z. B. "x1c"); leer = unbekannt.
    model: Optional[str] = None
    ip_address: str
    port: int
    serial_number: Optional[str] = None
    access_code: Optional[str] = None
    mqtt_port: int = 8883
    use_tls: bool = True


class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    model: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    serial_number: Optional[str] = None
    access_code: Optional[str] = None
    mqtt_port: Optional[int] = None
    use_tls: Optional[bool] = None
    is_active: Optional[bool] = None


class DeviceResponse(BaseModel):
    """Ein Gerät — ohne Access-Code (der geht nie an den Browser)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    device_type: PrinterType
    model: Optional[str] = None
    ip_address: str
    port: int
    serial_number: Optional[str]
    mqtt_port: int
    use_tls: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    _utc = field_serializer("created_at", "updated_at")(_as_utc)


# ── Dateien ──────────────────────────────────────────────────────────────────
class FileUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    filename: str
    original_filename: str
    file_type: str
    file_size: int
    uploaded_at: datetime
    folder_id: Optional[int] = None
    part_number: Optional[str] = None
    tags: Optional[str] = None
    material: Optional[str] = None
    color: Optional[str] = None

    _utc = field_serializer("uploaded_at")(_as_utc)


class FileListResponse(BaseModel):
    files: List[FileUploadResponse]
    total: int


class FileMetaUpdate(BaseModel):
    folder_id: Optional[int] = None
    part_number: Optional[str] = None
    tags: Optional[str] = None
    material: Optional[str] = None
    color: Optional[str] = None
    original_filename: Optional[str] = None


# ── Ordner (Teile-Bibliothek) ────────────────────────────────────────────────
class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None


# ── Geräte-Makros (Steuerung) ────────────────────────────────────────────────
class MacroExecutionRequest(BaseModel):
    macro_name: str
    parameters: Optional[dict] = None


class MacroExecutionResponse(BaseModel):
    success: bool
    macro_name: str
    message: str
    timestamp: datetime
