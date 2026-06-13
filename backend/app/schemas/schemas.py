from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum

class PrinterType(str, Enum):
    BAMBU_LAB = "bambu_lab"
    KLIPPER = "klipper"
    OTTO = "otto"

class SlotStatus(str, Enum):
    FREE = "free"
    OCCUPIED = "occupied"
    PRINTING = "printing"

class PrintStatus(str, Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    STARTING = "starting"
    PRINTING = "printing"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"

# Device Schemas
class DeviceCreate(BaseModel):
    name: str
    device_type: PrinterType
    ip_address: str
    port: int
    serial_number: Optional[str] = None
    access_code: Optional[str] = None
    mqtt_port: int = 8883
    use_tls: bool = True

class DeviceUpdate(BaseModel):
    name: Optional[str] = None
    ip_address: Optional[str] = None
    port: Optional[int] = None
    serial_number: Optional[str] = None
    access_code: Optional[str] = None
    mqtt_port: Optional[int] = None
    use_tls: Optional[bool] = None
    is_active: Optional[bool] = None

class DeviceResponse(BaseModel):
    id: int
    name: str
    device_type: PrinterType
    ip_address: str
    port: int
    serial_number: Optional[str]
    mqtt_port: int
    use_tls: bool
    is_active: bool
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Rack Configuration Schemas
class RackSlotResponse(BaseModel):
    id: int
    slot_number: int
    status: SlotStatus
    current_job_id: Optional[int]
    updated_at: datetime

    class Config:
        from_attributes = True

class RackConfigUpdate(BaseModel):
    num_slots: int = Field(ge=1, le=6)

class RackConfigResponse(BaseModel):
    id: int
    num_slots: int
    slots: List[RackSlotResponse]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# File Schemas
class FileUploadResponse(BaseModel):
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

    class Config:
        from_attributes = True

class FileListResponse(BaseModel):
    files: List[FileUploadResponse]
    total: int

# ── Folders / Teile-Management ──────────────────────────────────
class FolderResponse(BaseModel):
    id: int
    name: str
    parent_id: Optional[int] = None
    created_at: datetime

    class Config:
        from_attributes = True

class FolderCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None

class FolderUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None

class FileMetaUpdate(BaseModel):
    folder_id: Optional[int] = None
    part_number: Optional[str] = None
    tags: Optional[str] = None
    material: Optional[str] = None
    color: Optional[str] = None
    original_filename: Optional[str] = None

# Print Job Schemas
class PrintJobCreate(BaseModel):
    file_id: int
    assigned_slot: Optional[int] = None
    printer_id: Optional[int] = None

class PrintJobResponse(BaseModel):
    id: int
    file_id: int
    assigned_slot: Optional[int]
    status: PrintStatus
    printer_id: Optional[int]
    progress: float
    current_layer: int
    total_layers: Optional[int]
    estimated_time_remaining: Optional[int]
    error_message: Optional[str]
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

# Queue Schemas
class QueueItemResponse(BaseModel):
    id: int
    job_id: int
    position: int
    status: PrintStatus
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True

class QueueResponse(BaseModel):
    items: List[QueueItemResponse]
    total: int

# Macro Control Schemas
class MacroExecutionRequest(BaseModel):
    macro_name: str
    parameters: Optional[dict] = None

class MacroExecutionResponse(BaseModel):
    success: bool
    macro_name: str
    message: str
    timestamp: datetime

# Dashboard Schemas
class DashboardResponse(BaseModel):
    rack_status: RackConfigResponse
    active_jobs: List[PrintJobResponse]
    queue_status: QueueResponse
    devices_status: List[DeviceResponse]
    system_health: dict
