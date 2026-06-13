import httpx
import logging
from typing import Optional, List
from app.models.models import Device

logger = logging.getLogger(__name__)

class MoonrakerAPI:
    def __init__(self, device: Device):
        self.device = device
        self.base_url = f"http://{device.ip_address}:{device.port}"
        self.session = None
    
    async def execute_macro(self, macro_name: str) -> bool:
        """Execute a Klipper macro"""
        try:
            url = f"{self.base_url}/printer/gcode/script"
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.post(
                    url,
                    json={"script": macro_name}
                )
            
            if response.status_code == 200:
                logger.info(f"Executed macro: {macro_name}")
                return True
            else:
                logger.error(f"Macro execution failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error executing macro {macro_name}: {str(e)}")
            return False
    
    async def get_printer_info(self) -> Optional[dict]:
        """Get printer information and status"""
        try:
            url = f"{self.base_url}/printer/info"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to get printer info: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error getting printer info: {str(e)}")
            return None
    
    async def get_object_status(self, objects: List[str]) -> Optional[dict]:
        """Get status of specific objects"""
        try:
            url = f"{self.base_url}/printer/objects/query"
            params = {"objects": ",".join(objects)}
            
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url, params=params)
            
            if response.status_code == 200:
                return response.json()
            else:
                logger.error(f"Failed to get object status: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error getting object status: {str(e)}")
            return None
    
    async def list_available_macros(self) -> Optional[List[str]]:
        """List all available macros in Klipper"""
        try:
            url = f"{self.base_url}/printer/gcode/help"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
            
            if response.status_code == 200:
                data = response.json()
                return list(data.get("gcode", {}).keys())
            else:
                logger.error(f"Failed to get macros list: {response.text}")
                return None
        except Exception as e:
            logger.error(f"Error getting macros list: {str(e)}")
            return None
    
    async def emergency_stop(self) -> bool:
        """Trigger emergency stop"""
        try:
            url = f"{self.base_url}/printer/emergency_stop"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(url)
            
            if response.status_code == 200:
                logger.info("Emergency stop triggered")
                return True
            else:
                logger.error(f"Emergency stop failed: {response.text}")
                return False
        except Exception as e:
            logger.error(f"Error triggering emergency stop: {str(e)}")
            return False
    
    async def is_connected(self) -> bool:
        """Check if Moonraker API is accessible"""
        try:
            url = f"{self.base_url}/printer/info"
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(url)
            return response.status_code == 200
        except Exception:
            return False
