from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text, Enum as SQLEnum
from sqlalchemy.ext.declarative import declarative_base
from datetime import datetime
import enum

Base = declarative_base()

class PrinterType(str, enum.Enum):
    BAMBU_LAB = "bambu_lab"
    KLIPPER = "klipper"
    OTTO = "otto"

class SlotStatus(str, enum.Enum):
    FREE = "free"
    OCCUPIED = "occupied"
    PRINTING = "printing"

class PrintStatus(str, enum.Enum):
    PENDING = "pending"
    UPLOADING = "uploading"
    STARTING = "starting"
    PRINTING = "printing"
    COMPLETED = "completed"
    FAILED = "failed"
    PAUSED = "paused"

class Device(Base):
    __tablename__ = "devices"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True)
    device_type = Column(SQLEnum(PrinterType))
    ip_address = Column(String(255))
    port = Column(Integer)
    serial_number = Column(String(255), nullable=True)
    access_code = Column(String(255), nullable=True)
    mqtt_port = Column(Integer, default=8883)
    use_tls = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    is_active = Column(Boolean, default=True)

class RackConfiguration(Base):
    __tablename__ = "rack_configuration"
    
    id = Column(Integer, primary_key=True, index=True)
    num_slots = Column(Integer, default=6)
    klipper_device_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class RackSlot(Base):
    __tablename__ = "rack_slots"
    
    id = Column(Integer, primary_key=True, index=True)
    rack_id = Column(Integer)
    slot_number = Column(Integer)
    status = Column(SQLEnum(SlotStatus), default=SlotStatus.FREE)
    current_job_id = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class Folder(Base):
    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    parent_id = Column(Integer, nullable=True, index=True)  # self-referencing tree
    created_at = Column(DateTime, default=datetime.utcnow)

class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), unique=True, index=True)
    original_filename = Column(String(255))
    file_type = Column(String(10))  # .3mf, .stl, .gcode
    file_path = Column(String(512))
    file_size = Column(Integer)
    uploaded_at = Column(DateTime, default=datetime.utcnow)
    # ── Teile-Management (Phase 1) ──────────────────────────────
    folder_id   = Column(Integer, nullable=True, index=True)   # None = Wurzel
    part_number = Column(String(120), nullable=True, index=True)
    tags        = Column(String(512), nullable=True)           # kommagetrennt
    material    = Column(String(80),  nullable=True)
    color       = Column(String(32),  nullable=True)           # Hex (#RRGGBB) oder Name

class PrintJob(Base):
    __tablename__ = "print_jobs"
    
    id = Column(Integer, primary_key=True, index=True)
    file_id = Column(Integer)
    assigned_slot = Column(Integer, nullable=True)
    status = Column(SQLEnum(PrintStatus), default=PrintStatus.PENDING)
    printer_id = Column(Integer, nullable=True)
    progress = Column(Float, default=0.0)  # 0-100
    current_layer = Column(Integer, default=0)
    total_layers = Column(Integer, nullable=True)
    estimated_time_remaining = Column(Integer, nullable=True)  # in seconds
    mqtt_message_id = Column(String(255), nullable=True)
    error_message = Column(Text, nullable=True)
    started_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class QueueItem(Base):
    __tablename__ = "queue"
    
    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(Integer, unique=True)
    position = Column(Integer)  # Priority/order
    status = Column(SQLEnum(PrintStatus), default=PrintStatus.PENDING)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class SystemConfig(Base):
    __tablename__ = "system_config"
    
    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, index=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
