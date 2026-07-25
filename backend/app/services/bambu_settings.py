"""Drucker-Einstellungen eines Bambu Lab Druckers über MQTT lesen & setzen.

Zweck: alles, was man sonst AM DRUCKER-DISPLAY einstellt, aus Printloom heraus
schalten — KI-/Kamera-Erkennung (Erste Schicht, Spaghetti, Bauplatten-Marker),
Druckgeschwindigkeit, Auto-Recovery, Kammerlicht und die große Kalibrierung.

Reine Funktionen (kein MQTT, kein I/O): `read_settings` liest den Zustand aus dem
letzten Push-Report, `build_command` baut das MQTT-Kommando. Das macht die Logik
testbar; das Senden übernimmt der Router über bambu_manager.publish_command.

Quelle des Zustands ist der pushall-Report:
    print.xcam.{first_layer_inspector, spaghetti_detector, buildplate_marker_detector,
               printing_monitor, allow_skip_parts, print_halt}
    print.spd_lvl                    1=Silent 2=Standard 3=Sport 4=Ludicrous
    print.auto_recovery_step_loss    Auto-Recovery bei Schrittverlust
    print.lights_report[]            [{node: "chamber_light", mode: "on"|"off"}]

HINWEIS: Bambu dokumentiert dieses MQTT-Protokoll nicht öffentlich; die Kommandos
folgen den in der Community (ha-bambulab) etablierten Formaten. Nicht jedes Modell
unterstützt jede Option — die Kalibrierung ist X1-spezifisch (P1/A1 kalibrieren über
eigene G-code-Makros).
"""
import time
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _seq() -> str:
    return str(int(time.time()))


# ── Kamera-/KI-Erkennung (xcam) ───────────────────────────────────────────────
# key → (Feld im Report, braucht print_halt-Flag)
XCAM_MODULES = {
    "first_layer_inspector":       True,    # Erste Schicht prüfen (kann anhalten)
    "spaghetti_detector":          True,    # Spaghetti-/Fehldruck-Erkennung
    "buildplate_marker_detector":  False,   # Bauplatten-Erkennung (Platten-Marker)
    "printing_monitor":            False,   # KI-Drucküberwachung
    "allow_skip_parts":            False,   # abgelöste Teile überspringen
}

SPEED_LEVELS = {1: "silent", 2: "standard", 3: "sport", 4: "ludicrous"}

# Kalibrierungs-Bausteine der X1-Serie → Bitmaske im `option`-Feld.
CALIBRATION_BITS = {
    "bed_leveling":             1 << 1,
    "vibration_compensation":   1 << 2,
    "motor_noise_cancellation": 1 << 3,
}


def _print_block(raw: dict) -> dict:
    return ((raw or {}).get("print") or {}) if isinstance(raw, dict) else {}


def _chamber_light_on(p: dict) -> Optional[bool]:
    for entry in (p.get("lights_report") or []):
        if entry.get("node") == "chamber_light":
            return str(entry.get("mode", "")).lower() == "on"
    return None


def read_settings(raw: dict) -> dict:
    """Aktuelle Einstellungen aus dem letzten Push-Report. Unbekannt → None
    (die UI zeigt dann „—" statt einen Zustand zu erfinden)."""
    p = _print_block(raw)
    xcam = p.get("xcam") or {}
    out = {k: (bool(xcam[k]) if k in xcam else None) for k in XCAM_MODULES}
    out["print_halt"] = bool(xcam["print_halt"]) if "print_halt" in xcam else None

    lvl = p.get("spd_lvl")
    try:
        lvl = int(lvl)
    except (TypeError, ValueError):
        lvl = None
    out["speed_level"] = lvl if lvl in SPEED_LEVELS else None
    out["speed_name"] = SPEED_LEVELS.get(out["speed_level"] or 0)

    ar = p.get("auto_recovery_step_loss")
    out["auto_recovery"] = bool(ar) if ar is not None else None
    out["chamber_light"] = _chamber_light_on(p)
    out["nozzle_diameter"] = p.get("nozzle_diameter")
    out["nozzle_type"] = p.get("nozzle_type")
    # Läuft gerade eine Kalibrierung? (X1 meldet den Fortschritt separat.)
    out["gcode_state"] = p.get("gcode_state")
    return out


def build_command(key: str, value) -> dict:
    """MQTT-Kommando für eine Einstellung. Wirft ValueError bei unbekanntem Key."""
    if key in XCAM_MODULES:
        cmd = {
            "xcam": {
                "sequence_id": _seq(),
                "command": "xcam_control_set",
                "module_name": key,
                "control": True,
                "enable": bool(value),
            }
        }
        # Module, die einen Druck anhalten können, erwarten das Flag mit.
        if XCAM_MODULES[key]:
            cmd["xcam"]["print_halt"] = bool(value)
        return cmd

    if key == "speed_level":
        lvl = int(value)
        if lvl not in SPEED_LEVELS:
            raise ValueError(f"speed_level muss 1–4 sein (war {value})")
        return {"print": {"sequence_id": _seq(), "command": "print_speed", "param": str(lvl)}}

    if key == "auto_recovery":
        return {"print": {"sequence_id": _seq(), "command": "print_option",
                          "auto_recovery": bool(value)}}

    if key == "chamber_light":
        return {"system": {"sequence_id": _seq(), "command": "ledctrl",
                           "led_node": "chamber_light",
                           "led_mode": "on" if value else "off",
                           "led_on_time": 500, "led_off_time": 500,
                           "loop_times": 0, "interval_time": 0}}

    raise ValueError(f"Unbekannte Einstellung: {key!r}")


def build_calibration(options: list) -> dict:
    """Kalibrierung der X1-Serie starten. `options` = Teilmenge von CALIBRATION_BITS.
    Volle Kalibrierung (alle drei) dauert ~16 Minuten."""
    bits = 0
    unknown = []
    for o in (options or []):
        if o in CALIBRATION_BITS:
            bits |= CALIBRATION_BITS[o]
        else:
            unknown.append(o)
    if unknown:
        raise ValueError(f"Unbekannte Kalibrier-Option(en): {', '.join(unknown)}")
    if not bits:
        raise ValueError("Mindestens eine Kalibrier-Option wählen")
    return {"print": {"sequence_id": _seq(), "command": "calibration", "option": bits}}
