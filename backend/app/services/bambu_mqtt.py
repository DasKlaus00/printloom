import paho.mqtt.client as mqtt
import json
import logging
import threading
import time
from typing import Callable, Optional
from app.models.models import Device

logger = logging.getLogger(__name__)


class BambuLabMQTT:
    def __init__(self, device: Device):
        self.device = device
        self.client = None
        self.connected = False
        self.callbacks = {}
        self.last_message = None
        self._connected_event = threading.Event()

    def set_callback(self, event: str, callback: Callable):
        self.callbacks[event] = callback

    def connect(self, wait_timeout: float = 5.0) -> bool:
        """Connect to Bambu Lab via MQTT. Blocks until connected or timeout."""
        try:
            self._connected_event.clear()
            self.client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION1)
            self.client.on_connect = self._on_connect
            self.client.on_message = self._on_message
            self.client.on_disconnect = self._on_disconnect

            if self.device.use_tls:
                self.client.tls_set(
                    ca_certs=None, certfile=None, keyfile=None,
                    cert_reqs=mqtt.ssl.CERT_NONE,
                    tls_version=mqtt.ssl.PROTOCOL_TLSv1_2,
                    ciphers=None
                )
                self.client.tls_insecure_set(True)

            self.client.username_pw_set("bblp", self.device.access_code)
            self.client.connect(self.device.ip_address, self.device.mqtt_port, keepalive=60)
            self.client.loop_start()

            if not self._connected_event.wait(timeout=wait_timeout):
                logger.error(f"MQTT connection timeout to {self.device.ip_address}")
                self.client.loop_stop()
                return False

            return self.connected

        except Exception as e:
            logger.error(f"Failed to connect to Bambu Lab: {e}")
            return False

    def disconnect(self):
        if self.client:
            self.client.loop_stop()
            self.client.disconnect()
            self.connected = False

    def subscribe(self):
        topic = f"device/{self.device.serial_number}/report"
        self.client.subscribe(topic)
        logger.info(f"Subscribed to {topic}")

    def publish_command(self, command: dict) -> bool:
        try:
            topic = f"device/{self.device.serial_number}/request"
            result = self.client.publish(topic, json.dumps(command), qos=1)
            result.wait_for_publish(timeout=5.0)
            logger.info(f"Published to {topic}: {command}")
            return True
        except Exception as e:
            logger.error(f"Failed to publish command: {e}")
            return False

    def start_print(self, remote_filename: str, use_ams: bool = True, ams_mapping: list = None, plate_param: str = None) -> bool:
        """
        Send project_file MQTT command to start a print from /cache/.
        plate_param: path inside the 3mf to the gcode, e.g. 'Metadata/plate_2.gcode'.
                     Auto-detected by _get_plate_gcode_param(); defaults to plate_1.
        ams_mapping: list of AMS slot indices (0=A1, 1=A2, …) per filament in the file.
                     Must have one entry per filament. Never send empty list for AMS prints.
        """
        is_3mf = remote_filename.lower().endswith(".3mf")
        if plate_param:
            param = plate_param
        else:
            param = "Metadata/plate_1.gcode" if is_3mf else ""

        # Ensure non-empty mapping for AMS prints
        if use_ams:
            mapping = ams_mapping if ams_mapping else [0]
        else:
            mapping = ams_mapping or []

        command = {
            "print": {
                "sequence_id": str(int(time.time())),
                "command": "project_file",
                "param": param,
                "file": remote_filename,
                "url": f"ftp:///cache/{remote_filename}",
                "md5": "",
                "profile_id": "0",
                "project_id": "0",
                "subtask_id": "0",
                "task_id": "0",
                "subtask_name": remote_filename,
                "bed_type": "auto",
                "timelapse": False,
                "bed_leveling": True,
                "flow_cali": False,
                "vibration_cali": False,
                "layer_inspect": False,
                "use_ams": use_ams,
                "ams_mapping": mapping,
            }
        }
        logger.info(f"start_print: use_ams={use_ams} ams_mapping={mapping} file={remote_filename}")
        return self.publish_command(command)

    def set_chamber_light(self, on: bool) -> bool:
        """Turn the X1C chamber LED on/off. Without it the camera image is black,
        because the chamber is dark — Bambu Studio/Orca switch the light on when the
        live view opens. Uses the `system.ledctrl` command."""
        command = {
            "system": {
                "sequence_id": str(int(time.time())),
                "command": "ledctrl",
                "led_node": "chamber_light",
                "led_mode": "on" if on else "off",
                "led_on_time": 500,
                "led_off_time": 500,
                "loop_times": 0,
                "interval_time": 0,
            }
        }
        return self.publish_command(command)

    def send_gcode(self, gcode: str) -> bool:
        """Send raw gcode lines directly to the printer (no auth required)."""
        command = {
            "print": {
                "sequence_id": str(int(time.time())),
                "command": "gcode_line",
                "param": gcode,
                "user_id": "0"
            }
        }
        return self.publish_command(command)

    def run_gcode_file(self, file_path: str, chunk_lines: int = 80) -> bool:
        """Send a .gcode file via gcode_line commands (bypasses firmware v2 signing)."""
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                lines = [
                    l.strip() for l in f
                    if l.strip() and not l.strip().startswith(";")
                ]
            if not lines:
                logger.warning(f"run_gcode_file: no executable lines in {file_path}")
                return False

            for i in range(0, len(lines), chunk_lines):
                chunk = "\n".join(lines[i : i + chunk_lines])
                ok = self.send_gcode(chunk)
                if not ok:
                    logger.error(f"run_gcode_file: chunk {i} failed")
                    return False
                if i + chunk_lines < len(lines):
                    time.sleep(0.15)

            logger.info(f"run_gcode_file: sent {len(lines)} lines from {file_path}")
            return True
        except Exception as e:
            logger.error(f"run_gcode_file failed: {e}")
            return False

    def _print_cmd(self, cmd: str) -> bool:
        """Sende einen einfachen Druck-Steuerbefehl (pause/resume/stop)."""
        return self.publish_command({
            "print": {"sequence_id": str(int(time.time())), "command": cmd}
        })

    def pause(self) -> bool:
        """Laufenden Druck pausieren (X1C fährt in die Pause-Position)."""
        return self._print_cmd("pause")

    def resume(self) -> bool:
        """Pausierten Druck fortsetzen."""
        return self._print_cmd("resume")

    def stop(self) -> bool:
        """Laufenden Druck abbrechen."""
        return self._print_cmd("stop")

    def clear_error(self) -> bool:
        """Send stop command to reset FAILED state back to IDLE."""
        return self._print_cmd("stop")

    def request_status(self) -> bool:
        """Request a full status push from the printer."""
        command = {
            "pushing": {
                "sequence_id": "0",
                "command": "pushall"
            }
        }
        return self.publish_command(command)

    def _on_connect(self, client, userdata, flags, rc):
        if rc == 0:
            self.connected = True
            logger.info(f"Bambu Lab MQTT connected to {self.device.ip_address}")
            self.subscribe()
        else:
            self.connected = False
            logger.error(f"Bambu Lab MQTT connection failed, rc={rc}")
        self._connected_event.set()

    def _on_disconnect(self, client, userdata, rc):
        self.connected = False
        if rc != 0:
            logger.warning(f"Unexpected MQTT disconnection: rc={rc}")

    def _on_message(self, client, userdata, msg):
        try:
            payload = json.loads(msg.payload.decode())
            self.last_message = payload
            if "print_progress" in self.callbacks:
                self.callbacks["print_progress"](payload)
            logger.debug(f"Received from Bambu Lab: {payload}")
        except Exception as e:
            logger.error(f"Error processing Bambu Lab message: {e}")

    def get_last_message(self) -> Optional[dict]:
        return self.last_message

    def is_printing(self) -> bool:
        if not self.last_message:
            return False
        state = self.last_message.get("print", {}).get("gcode_state", "")
        return state in ["RUNNING", "PAUSE"]

    def get_progress(self) -> dict:
        if not self.last_message:
            return {"progress": 0, "layer": 0, "total_layers": 0, "status": "unknown"}
        p = self.last_message.get("print", {})
        return {
            "progress": p.get("mc_percent", 0),
            "layer": p.get("layer_num", 0),
            "total_layers": p.get("total_layer_num", 0),
            "status": p.get("gcode_state", "unknown")
        }
