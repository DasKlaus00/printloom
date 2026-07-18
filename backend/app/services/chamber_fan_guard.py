"""Hält bei Bambu-Druckern mit aktivierter Option die Bauraumlüftung dauerhaft aus.

Wunsch: Bei bestimmten Bambu-Druckern (X1C mit Bauraumlüftung) soll der Bauraumlüfter
standardmäßig deaktiviert bleiben. Der Guard prüft im ~5-Sekunden-Takt über die
OHNEHIN bestehende persistente MQTT-Verbindung (bambu_manager), ob der Lüfter läuft,
und schaltet ihn per G-code aus, wenn er an ist.

Der Bauraumlüfter ist am X1C **P3** (im Status `print.big_fan2_speed`) — Ausschalten
mit `M106 P3 S0`. Aktiviert wird das pro Gerät über die Geräte-Einstellung
`chamber_fan_off` (Konfiguration → Geräte).

Nach dem Ausschalten gilt ein kurzer Cooldown, damit der Guard nicht gegen den
Status-Lag anspammt (der Drucker meldet die neue Lüfterdrehzahl erst mit Verzögerung).
"""
from __future__ import annotations
import asyncio
import json
import logging
import time
from types import SimpleNamespace

logger = logging.getLogger(__name__)

_CHAMBER_FAN_GCODE = "M106 P3 S0"     # P3 = Bauraumlüfter (big_fan2) am X1C
_INTERVAL_ACTIVE_S = 5.0              # Takt, wenn mind. ein Drucker die Option an hat
_INTERVAL_IDLE_S = 20.0              # Takt, wenn niemand die Option nutzt (spart Last)
_RESEND_COOLDOWN_S = 8.0             # nach dem Ausschalten kurz nicht erneut senden

_task: asyncio.Task | None = None
_last_off_sent: dict = {}            # device_id -> monotonic ts des letzten Aus-Befehls


def _fan_on(raw: dict) -> bool:
    """True, wenn der Bauraumlüfter laut Status-Cache läuft (Drehzahl > 0)."""
    try:
        val = ((raw or {}).get("print", {}) or {}).get("big_fan2_speed")
        if val is None:
            return False
        return int(float(str(val))) > 0
    except (TypeError, ValueError):
        return False


def _targets():
    """Bambu-Geräte (als lose Kopie), bei denen `chamber_fan_off` aktiv ist.
    Kopie via SimpleNamespace, damit wir die DB-Session sofort schließen können."""
    from app.db.database import SessionLocal
    from app.models.models import Device, PrinterType, SystemConfig
    out = []
    db = SessionLocal()
    try:
        bambus = db.query(Device).filter(Device.device_type == PrinterType.BAMBU_LAB).all()
        for d in bambus:
            row = db.query(SystemConfig).filter(
                SystemConfig.key == f"device_settings_{d.id}").first()
            settings = {}
            if row:
                try:
                    settings = json.loads(row.value)
                except Exception:
                    settings = {}
            if settings.get("chamber_fan_off"):
                out.append(SimpleNamespace(
                    id=d.id, serial_number=d.serial_number, ip_address=d.ip_address,
                    access_code=d.access_code, mqtt_port=d.mqtt_port or 8883,
                    port=d.port, use_tls=bool(d.use_tls),
                ))
    finally:
        db.close()
    return out


def _enforce_one(dev) -> None:
    """Blockierend (in Executor): Status lesen, bei laufendem Lüfter ausschalten."""
    from app.services import bambu_manager
    if not bambu_manager.ensure(dev):
        return   # Drucker offline/Backoff — Cache wäre veraltet, nichts tun
    raw = bambu_manager.last_status(dev)
    if not _fan_on(raw):
        return
    now = time.monotonic()
    if now - _last_off_sent.get(dev.id, 0.0) < _RESEND_COOLDOWN_S:
        return   # gerade erst ausgeschaltet — Status hinkt nach, nicht spammen
    if bambu_manager.send_gcode(dev, _CHAMBER_FAN_GCODE):
        _last_off_sent[dev.id] = now
        logger.info(f"Bauraumlüfter an Drucker {dev.id} war an → ausgeschaltet")


async def _loop():
    from app.services import bambu_manager
    loop = asyncio.get_event_loop()
    while True:
        interval = _INTERVAL_IDLE_S
        try:
            targets = await loop.run_in_executor(None, _targets)
            if targets:
                interval = _INTERVAL_ACTIVE_S
                for dev in targets:
                    await loop.run_in_executor(bambu_manager.executor, _enforce_one, dev)
        except Exception as e:
            logger.debug(f"chamber_fan_guard loop error: {e}")
        await asyncio.sleep(interval)


def start() -> None:
    """Einmal beim App-Start aufrufen (main.py startup). Idempotent."""
    global _task
    if _task is not None and not _task.done():
        return
    _task = asyncio.create_task(_loop())
    logger.info("chamber_fan_guard gestartet")
