import enum
from datetime import datetime, timezone

from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Enum as SQLEnum
from sqlalchemy.orm import declarative_base

Base = declarative_base()


def _utcnow() -> datetime:
    """Jetzt in UTC, ohne Zeitzonen-Angabe — so stehen alle Zeitstempel in der
    Datenbank (die Schemas kennzeichnen sie beim Ausliefern als UTC).
    Ersetzt `datetime.utcnow`, das Python als veraltet markiert hat."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


class PrinterType(str, enum.Enum):
    BAMBU_LAB = "bambu_lab"
    KLIPPER = "klipper"
    OTTO = "otto"


# Ältere Installationen haben noch die Tabellen rack_configuration, rack_slots,
# print_jobs und queue — Reste eines frühen Entwurfs, den der Regal-Zustand
# (rack_slots.json) und die Farm-Warteschlange (farm_queue.json) abgelöst haben.
# Sie bleiben in der Datenbank liegen (schadet nicht), werden aber nicht mehr angelegt.


class Device(Base):
    __tablename__ = "devices"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True)
    device_type = Column(SQLEnum(PrinterType))
    # Drucker-Modell als ID aus app/services/printer_models.py (z. B. "x1c", "p1s").
    # Bestimmt Kamera-Protokoll und Fähigkeiten (AMS/Tür/Kalibrierung) — vorher musste
    # das geraten werden (Port-Probe / Seriennummer). Leer = unbekannt → weiter raten.
    model = Column(String(64), nullable=True)
    ip_address = Column(String(255))
    port = Column(Integer)
    serial_number = Column(String(255), nullable=True)
    access_code = Column(String(255), nullable=True)
    mqtt_port = Column(Integer, default=8883)
    use_tls = Column(Boolean, default=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
    # False = gesperrt durch den Notaus (bis „Betrieb fortsetzen").
    is_active = Column(Boolean, default=True)


class Folder(Base):
    __tablename__ = "folders"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255))
    parent_id = Column(Integer, nullable=True, index=True)  # self-referencing tree
    created_at = Column(DateTime, default=_utcnow)


class UploadedFile(Base):
    __tablename__ = "uploaded_files"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String(255), unique=True, index=True)
    original_filename = Column(String(255))
    file_type = Column(String(10))  # .3mf, .stl, .gcode
    file_path = Column(String(512))
    file_size = Column(Integer)
    uploaded_at = Column(DateTime, default=_utcnow)
    # ── Teile-Management (Phase 1) ──────────────────────────────
    folder_id   = Column(Integer, nullable=True, index=True)   # None = Wurzel
    part_number = Column(String(120), nullable=True, index=True)
    tags        = Column(String(512), nullable=True)           # kommagetrennt
    material    = Column(String(80),  nullable=True)
    color       = Column(String(32),  nullable=True)           # Hex (#RRGGBB) oder Name


class SystemConfig(Base):
    __tablename__ = "system_config"

    id = Column(Integer, primary_key=True, index=True)
    key = Column(String(255), unique=True, index=True)
    value = Column(Text)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
