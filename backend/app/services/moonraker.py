"""Moonraker (Klipper) — die beiden Befehle des Notaus.

Alle übrigen Zugriffe auf den OTTOeject laufen über routers/control.py bzw. den
Sequenz-Runner der Farm; hier steht nur, was der Notaus braucht und was ihn
deshalb nicht mit dem restlichen Ablauf verknoten soll.
"""
import logging

import httpx

from app.models.models import Device

logger = logging.getLogger(__name__)


class MoonrakerAPI:
    def __init__(self, device: Device):
        self.device = device
        self.base_url = f"http://{device.ip_address}:{device.port}"

    async def _post(self, path: str, timeout: float, what: str) -> bool:
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                response = await client.post(f"{self.base_url}{path}")
        except Exception as e:
            logger.error(f"{what}: {e}")
            return False
        if response.status_code == 200:
            logger.info(f"{what}: ok")
            return True
        logger.error(f"{what} failed: {response.text}")
        return False

    async def emergency_stop(self) -> bool:
        """M112 — Klipper schaltet die Motoren sofort ab."""
        return await self._post("/printer/emergency_stop", 5.0, "Emergency stop")

    async def firmware_restart(self) -> bool:
        """Klipper nach einem Notaus (M112) wieder hochfahren.

        Nach M112 steht Klipper im Zustand „shutdown" und nimmt keinen Befehl mehr an,
        bis die Firmware neu startet. Ohne diesen Schritt wäre „Betrieb fortsetzen"
        ein Knopf, nach dem trotzdem nichts fährt."""
        return await self._post("/printer/firmware_restart", 10.0, "Firmware restart")
