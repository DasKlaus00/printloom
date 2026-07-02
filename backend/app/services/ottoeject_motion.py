"""OTTOeject-Bewegungen als G-code — zentral in Printloom.

Statt Klipper-Macros auf dem Gerät (slots.cfg / printer_calibration_variables.cfg)
kennt Printloom ALLE Koordinaten (Geometrie-Speicher) und erzeugt die kompletten
G-code-Sequenzen daraus. Nur OTTOEJECT_HOME bleibt ein Geräte-Macro (Homing/Endstops).

Die Bewegungsabläufe sind 1:1 aus den getesteten OTTOmat3D-Macros portiert
(ottoeject_macros.cfg): _GRAB_FROM_SLOT, _GRAB_FROM_SLOT_NOLIFT, _STORE_TO_SLOT,
_EJECT_FROM_PRINTER, _LOAD_ONTO_PRINTER, _OPEN_DOOR, _CLOSE_DOOR.

Skalierung (von rechts aufgebaut, Regal 1 bei x_unclamp, jedes weitere +rack_x_gap;
Drucker optional hinter dem letzten Regal):
    rack_x(rack)  = x_unclamp + (rack-1)*rack_x_gap + rack_x_trim[rack]
    z_flat(slot)  = first_z_flat + (slot-1)*(slot_gap+30) + rack_z_trim[rack]
    printer_x_off = (racks-1)*rack_x_gap   (nur wenn printer.x_scales_with_racks)
"""
from __future__ import annotations
import math
from copy import deepcopy

SLOT_Z_EXTRA = 30   # effektiver Z-Schritt = slot_gap + 30

DEFAULT_GEOMETRY = {
    "printer_id": "x1c",
    "printer_name": "Bambu Lab X1C",
    "enclosed": True,
    "racks": 1,
    "storage_slots": 6,      # Lager-Fächer (ohne Magazin)
    "magazine": True,        # oberstes Fach = Magazin (NOLIFT)
    "storage": {
        "x_unclamp": 43, "y_engage": 335, "first_z_flat": 7,
        "slot_gap": 25, "y_pullback_limit": 5, "rack_x_gap": 250,
    },
    "rack_x_trim": {},       # {"2": -1, ...} optionale Feinkorrektur pro Regal
    "rack_z_trim": {},
    "printer": {
        "eject": {"x": 442, "y": 319, "z": 21},
        "load":  {"x": 425, "y": 340, "z": 17.5},
        "door":  {"open":  {"x": 104, "y": 319, "z": 105, "d": 370},
                  "close": {"x": 103, "y": 322, "z": 105, "d": 375}},
        "x_scales_with_racks": False,  # Direkteingabe im Drucker-Tab: X = eingegebener Wert (kein Rack-Versatz)
    },
    "speed_factor": 100,     # M220-Vorschub in % (100 = normal, bis 500 schneller) für App-G-code
    "gcode_override": {},    # {op: "roher G-code"} — Feinjustage, überschreibt die berechnete Bewegung
}


# ── Helfer ──────────────────────────────────────────────────────────────────
def _n(v):
    """Zahl hübsch runden (Klipper mag keine langen Floats)."""
    r = round(float(v), 3)
    return int(r) if r == int(r) else r


def merge_defaults(g: dict | None) -> dict:
    """Gespeicherte Geometrie mit den Defaults auffüllen (fehlende Felder)."""
    out = deepcopy(DEFAULT_GEOMETRY)
    if not g:
        return out
    for k, v in g.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = {**out[k], **v}
            for kk, vv in v.items():
                if isinstance(vv, dict) and isinstance(out[k].get(kk), dict):
                    out[k][kk] = {**out[k][kk], **vv}
        else:
            out[k] = v
    return out


def magazine_slot(g: dict) -> int:
    return (int(g["storage_slots"]) + 1) if g.get("magazine") else 0


def _printer_x_off(g: dict) -> float:
    if g["printer"].get("x_scales_with_racks"):
        return (int(g["racks"]) - 1) * float(g["storage"]["rack_x_gap"])
    return 0.0


def slot_position(g: dict, rack: int, slot: int) -> tuple[float, float, float, float]:
    """(x_unclamp, y_engage, z_flat, y_pullback_limit) für ein Fach — inkl. Skalierung."""
    s = g["storage"]
    xt = float(g.get("rack_x_trim", {}).get(str(rack), 0) or 0)
    zt = float(g.get("rack_z_trim", {}).get(str(rack), 0) or 0)
    step = float(s["slot_gap"]) + SLOT_Z_EXTRA
    x = float(s["x_unclamp"]) + (int(rack) - 1) * float(s["rack_x_gap"]) + xt
    z = float(s["first_z_flat"]) + (int(slot) - 1) * step + zt
    return x, float(s["y_engage"]), z, float(s["y_pullback_limit"])


# ── Bewegungen (1:1 aus ottoeject_macros.cfg) ───────────────────────────────
def grab_from_rack(g: dict, rack: int, slot: int, nolift=None) -> list[str]:
    x_unclamp, y_engage, z_flat, y_pb = slot_position(g, rack, slot)
    if nolift is None:
        mag = magazine_slot(g)
        nolift = (mag > 0 and int(slot) == mag)
    x_mid = x_unclamp - 30
    L = [f"M117 Grab rack {rack} slot {slot}..."]
    if nolift:
        L += [
            f"G1 X{_n(x_unclamp)} Y280 Z{_n(z_flat)} F4000", "M400",
            f"G1 Y{_n(y_engage-35)} F4000", "M400",
            f"G1 Y{_n(y_engage-25)} F600", "M400",
            f"G1 Y{_n(y_engage)} F300", "M400",
            f"G1 X{_n(x_mid)} F800", "M400",
            "M117 Picking up new bed (no lift)...",
            "G1 Y250 F1000", "M400",
            f"G1 Y{_n(y_pb)} F2000", "M400",
        ]
    else:
        L += [
            f"G1 X{_n(x_unclamp)} Y280 F4000", "M400",
            f"G1 Z{_n(z_flat)} F1000", "M400",
            f"G1 Y{_n(y_engage-35)} F4000", "M400",
            f"G1 Y{_n(y_engage-25)} F600", "M400",
            f"G1 Y{_n(y_engage)} F300", "M400",
            f"G1 X{_n(x_mid)} F800", "M400",
            "M117 Picking up new bed...",
            f"G1 Z{_n(z_flat+25)} F600", "M400",
            f"G1 Y250 Z{_n(z_flat+20)} F1000", "M400",
            f"G1 Y{_n(y_pb)} F2000", "M400",
        ]
    return L


def store_to_rack(g: dict, rack: int, slot: int) -> list[str]:
    x_unclamp, y_engage, z_flat, y_pb = slot_position(g, rack, slot)
    x_mid = x_unclamp - 30
    return [
        f"M117 Store rack {rack} slot {slot}...",
        f"G1 X{_n(x_mid)} Y{_n(y_pb)} Z{_n(z_flat+35)} F4000", "M400",
        "G1 Y60 F2000", "M400",
        f"G1 Y{_n(y_engage-15)} Z{_n(z_flat+25)} F1000", "M400",
        f"G1 Y{_n(y_engage+2)} F500", "M400",
        f"G1 Z{_n(z_flat+10)} F300", "M400",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage+1)} F600", "M400",
        f"G1 Y{_n(y_engage)} F600",
        f"G1 X{_n(x_unclamp)} F800", "M400",
        "G1 Y300 F800",
        "G1 Y280 F3000", "M400",
    ]


def eject_from_printer(g: dict) -> list[str]:
    p = g["printer"]["eject"]
    off = _printer_x_off(g)
    x_unclamp = float(p["x"]) + off
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    x_mid = x_unclamp + 30
    return [
        f"M117 Removing build plate from {g.get('printer_name','printer')}...",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage-90)} F3000", "M400",
        f"G1 Y{_n(y_engage-80)} F3000", "M400",
        f"G1 X{_n(x_unclamp)} F3000", "M400",
        f"G1 Y{_n(y_engage-20)} F3000",
        f"G1 Y{_n(y_engage)} F600", "M400",
        f"G1 X{_n(x_unclamp+5)} F600", "M400",
        f"G1 X{_n(x_mid)} F2000", "M400",
        f"G1 Z{_n(z_flat+52)} F1000",
        f"G1 Y{_n(y_engage-100)} Z{_n(z_flat+49)} F3000",
        f"G1 Y{_n(y_engage-150)} Z{_n(z_flat+45)} F3000",
        f"G1 Y{_n(y_engage-200)} Z{_n(z_flat+35)} F3000",
        f"G1 Y{_n(y_engage-250)} Z{_n(z_flat+30)} F3000",
        f"G1 Y{_n(y_engage-300)} Z{_n(z_flat+15)} F3000",
        f"G1 Y{_n(y_pb)} Z30 F3000", "M400",
    ]


def load_onto_printer(g: dict) -> list[str]:
    p = g["printer"]["load"]
    off = _printer_x_off(g)
    x_unclamp = float(p["x"]) + off
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    x_mid = x_unclamp + 30
    return [
        f"M117 Moving build plate to {g.get('printer_name','printer')}...",
        f"G1 Z{_n(z_flat+55)} Y{_n(y_pb)} F1000", "M400",
        f"G1 X{_n(x_mid)} F3000", "M400",
        f"G1 Y50 Z{_n(z_flat+40)} F1000", "M400",
        f"G1 Y{_n(y_engage-20)} F3000", "M400",
        f"G1 Y{_n(y_engage+3)} F600",
        f"G1 Z{_n(z_flat)} Y{_n(y_engage+0.5)} F1500", "M400",
        f"G1 Y{_n(y_engage)} F600",
        f"G1 X{_n(x_unclamp+15)} F600",
        f"G1 X{_n(x_unclamp)} F1500", "M400",
        "G1 Y320 F1500",
        "G1 Y280 F4000", "M400",
    ]


def _door_arc_x(x_start, d, y_arc, y_start):
    inside = d * d - (y_arc - y_start) ** 2
    return (x_start + d) - int(math.sqrt(inside)) if inside > 0 else (x_start + d)


def open_door(g: dict) -> list[str]:
    door = (g["printer"].get("door") or {}).get("open")
    if not door:
        return ["M117 (no door macro)"]
    off = _printer_x_off(g)
    x_start = float(door["x"]) + off
    y_start, z_engage, d = float(door["y"]), float(door["z"]), float(door["d"])
    gantry_gap, y_limit, y_max = 35, 10, 372 + 35
    y_arc_temp = y_max - (d + gantry_gap)
    y_arc = (y_arc_temp + y_limit) if y_arc_temp > 10 else y_limit
    x_arc = _door_arc_x(x_start, d, y_arc, y_start)
    return [
        "M117 Opening door...",
        f"G1 Z{_n(z_engage-40)} F1000", "M400",
        f"G1 X{_n(x_start+5)} Y{_n(y_start-30)} F3000",
        f"G1 Y{_n(y_start+5)} F3000", "M400",
        f"G1 Z{_n(z_engage)} F1000", "M400",
        f"G1 X{_n(x_start)} Y{_n(y_start)} F500", "M400",
        f"G3 X{_n(x_arc)} Y{_n(y_arc)} I{_n(d)} J0 F3000", "M400",
        f"G1 X{_n(x_arc-12)} Y{_n(y_arc+15)} F500", "M400",
        f"G1 Z{_n(z_engage-40)} F500", "M400",
        f"G1 X{_n(x_arc-120)} Y{_n(y_arc+110)} F3000", "M400",
        f"G1 X{_n(x_arc-106)} Y{_n(y_arc+95)} F3000",
        f"G1 Z{_n(z_engage+15)} F1000",
        f"G1 X{_n(x_arc+145)} Y{_n(y_arc)} F1000", "M400",
        f"G1 X{_n(x_arc+110)} F300", "M400",
        f"G1 X{_n(x_arc-20)} F3000", "M400",
        "M117 Door opened",
    ]


def close_door(g: dict) -> list[str]:
    door = (g["printer"].get("door") or {}).get("close")
    if not door:
        return ["M117 (no door macro)"]
    off = _printer_x_off(g)
    x_start = float(door["x"]) + off
    y_start, z_engage, d = float(door["y"]), float(door["z"]), float(door["d"])
    gantry_gap, y_limit, y_max = 35, 10, 372 + 35
    y_arc = (y_max - (d + gantry_gap)) + y_limit
    x_arc = _door_arc_x(x_start, d, y_arc, y_start)
    return [
        "M117 Closing door...",
        f"G1 Z{_n(z_engage-40)} F1000", "M400",
        f"G1 X{_n(x_arc+120)} Y{_n(y_arc+27)} F3000", "M400",
        f"G1 X{_n(x_arc+175)} F1000", "M400",
        f"G1 Z{_n(z_engage)} F1000", "M400",
        f"G1 X{_n(x_arc+140)} Y{_n(y_arc+32)} F1000", "M400",
        f"G2 X{_n(x_start+23)} Y{_n(y_start-36)} I85 J{_n(d)} F3000", "M400",
        f"G1 X{_n(x_start+28)} Y{_n(y_start-48)} F800", "M400",
        f"G1 Z{_n(z_engage-40)} F1000", "M400",
        f"G1 X{_n(x_start+69)} Y{_n(y_start-245)} F3000", "M400",
        f"G1 Z{_n(z_engage)} F1000", "M400",
        f"G1 Y{_n(y_start-158)} F2000", "M400",
        f"G1 Y{_n(y_start-78)} X{_n(x_start+15)} F2000", "M400",
        f"G1 Y{_n(y_start-19)} F800", "M400",
        f"G1 Y{_n(y_start-60)} F3000", "M400",
        "M117 Door closed",
    ]


def approach_slot(g: dict, rack: int, slot: int) -> list[str]:
    """Nur vor das Fach fahren (zum Kalibrieren) — greift nicht."""
    x_unclamp, y_engage, z_flat, _ = slot_position(g, rack, slot)
    return [
        "G90",
        f"G1 X{_n(x_unclamp)} Y280 Z{_n(z_flat)} F3000",
    ]


def park() -> list[str]:
    return ["M117 Parking...", "G1 X10 Y280 Z10 F3000", "M400", "M84"]


# ── Dispatcher ──────────────────────────────────────────────────────────────
def _speed_prefix(g: dict) -> str:
    """M220-Vorschubfaktor (%) für den App-G-code. 100 = normal → kein Prefix."""
    try:
        f = int(g.get("speed_factor", 100) or 100)
    except (TypeError, ValueError):
        f = 100
    f = max(10, min(500, f))
    return f"M220 S{f}\n" if f != 100 else ""


def build_op(g: dict, op: str, rack: int = 1, slot: int = 1, nolift=None) -> str:
    g = merge_defaults(g)
    op = (op or "").lower()
    speed = _speed_prefix(g)
    # Eigener G-code (Feinjustage im Drucker-Tab) hat Vorrang — 1:1 senden.
    ov = (g.get("gcode_override") or {}).get(op)
    if isinstance(ov, str) and ov.strip():
        s = ov.replace("{rack}", str(int(rack))).replace("{slot}", str(int(slot))).strip()
        return speed + (s if s.rstrip().endswith("M400") else s + "\nM400")
    if op == "grab":
        lines = grab_from_rack(g, rack, slot, nolift)
    elif op == "store":
        lines = store_to_rack(g, rack, slot)
    elif op == "eject":
        lines = eject_from_printer(g)
    elif op == "load":
        lines = load_onto_printer(g)
    elif op in ("open_door", "opendoor"):
        lines = open_door(g)
    elif op in ("close_door", "closedoor"):
        lines = close_door(g)
    elif op == "approach":
        lines = approach_slot(g, rack, slot)
    elif op == "park":
        lines = park()
    elif op == "home":
        lines = ["OTTOEJECT_HOME"]
    else:
        raise ValueError(f"Unbekannte Operation: {op}")
    return speed + "\n".join(lines) + "\nM400"
