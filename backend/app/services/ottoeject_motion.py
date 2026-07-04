"""OTTOeject-Bewegungen als G-code — zentral in Printloom.

Statt Klipper-Macros auf dem Gerät (slots.cfg / printer_calibration_variables.cfg)
kennt Printloom ALLE Koordinaten (Geometrie-Speicher) und erzeugt die kompletten
G-code-Sequenzen daraus. Nur OTTOEJECT_HOME bleibt ein Geräte-Macro (Homing/Endstops).

Die Bewegungsabläufe sind 1:1 aus den getesteten OTTOmat3D-Macros portiert
(ottoeject_macros.cfg): _GRAB_FROM_SLOT, _GRAB_FROM_SLOT_NOLIFT, _STORE_TO_SLOT,
_EJECT_FROM_PRINTER, _LOAD_ONTO_PRINTER, _OPEN_DOOR, _CLOSE_DOOR.

Skalierung: Home ist ganz RECHTS (fester Anker), der Drucker sitzt LINKS und wandert
mit der Regalzahl mit. R1 = Regal DIREKT am Drucker (druckerseitiges Ende), Rn = Regal
am Home-Anker (x_unclamp). Zusatzregale werden Richtung Drucker eingefügt; gefüllt wird
R1→Rn = vom Drucker weg nach rechts (im Bild links→rechts):
    rack_x(rack)  = x_unclamp + (racks-rack)*rack_x_gap + rack_x_trim[rack]
    z_flat(slot)  = first_z_flat + (slot-1)*(slot_gap+30) + rack_z_trim[rack]
    printer_x_off = (racks-1)*rack_x_gap   (Drucker wandert mit; Home rechts ist fest)
"""
from __future__ import annotations
import math
import re
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
    },
    "speed_factor": 100,     # globaler M220-Vorschub in % (100 = normal, bis 500 schneller) — Fallback
    "speed_factors": {},     # {op: %} — Vorschub PRO Operation (überschreibt speed_factor); für schnellen, feinjustierten Wechsel
    "gcode_override": {},    # {op: "roher G-code"} — Feinjustage, überschreibt die berechnete Bewegung
    # Magazin-Durchbiegung: die flach gestapelten Platten hängen durch — der Stapel
    # liegt pro Platte ~1 mm tiefer. Beim Greifen aus dem Magazin wird Z um
    # (Plattenzahl × magazine_sag_mm) ABGESENKT: 6 Platten → −6 mm, 4 → −4 mm.
    # Plattenzahl je Regal kommt live aus der Rack-Konfiguration (magazine_counts).
    "magazine_sag_mm": 1.0,
}


# Kanonische Liste der App-Operationen — genutzt vom Drucker-Tab, dem Sequenz-Schritt
# „app_op" (frei in Sequenzen nutzbar) und dem /app-ops-Endpoint. `rack_slot` = ob die
# Op ein Fach/Regal braucht (grab/store). Reihenfolge = Wechselablauf.
APP_OPS = [
    {"key": "open_door",       "label_de": "Tür öffnen",         "label_en": "Open door",       "rack_slot": False},
    {"key": "close_door",      "label_de": "Tür schließen",      "label_en": "Close door",      "rack_slot": False},
    {"key": "move_to_printer", "label_de": "Vor Drucker fahren", "label_en": "Move to printer", "rack_slot": False},
    {"key": "eject",           "label_de": "Auswerfen",          "label_en": "Eject plate",     "rack_slot": False},
    {"key": "place",           "label_de": "Einlegen",           "label_en": "Place plate",     "rack_slot": False},
    {"key": "grab",            "label_de": "Platte holen",       "label_en": "Grab from rack",  "rack_slot": True},
    {"key": "grab_magazine",   "label_de": "Aus Magazin holen",  "label_en": "Grab from magazine", "rack_slot": True},
    {"key": "store",           "label_de": "Platte ablegen",     "label_en": "Store to rack",   "rack_slot": True},
]
APP_OP_KEYS = {o["key"] for o in APP_OPS}


# ── Helfer ──────────────────────────────────────────────────────────────────
def _num(v, d=0.0):
    """Robuste Float-Konvertierung: None/NaN/leer/ungültig → Default. Verhindert 500,
    wenn ein Eingabefeld im Drucker-Tab leer/halbfertig ist (JSON null / NaN)."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(d)
    return f if f == f else float(d)   # NaN (f != f) → Default


def _n(v):
    """Zahl hübsch runden (Klipper mag keine langen Floats)."""
    r = round(_num(v), 3)
    return int(r) if r == int(r) else r


# Zahlenfelder der Geometrie (Pfade relativ zu DEFAULT_GEOMETRY) für die Sanitisierung.
def _sanitize_geometry(g: dict) -> dict:
    """Alle Zahlenfelder robust machen (None/NaN/leer → Default), damit ein
    halbfertiges Eingabefeld keine 500 auslöst."""
    d = DEFAULT_GEOMETRY
    for k in ("racks", "storage_slots", "magazine_slot", "speed_factor"):
        if g.get(k) is not None:
            g[k] = _num(g.get(k), d.get(k, 0))
    sf = g.get("speed_factors")
    if isinstance(sf, dict):
        g["speed_factors"] = {k: _num(v, 100) for k, v in sf.items() if v is not None}
    s = g.setdefault("storage", {})
    for k, dv in d["storage"].items():
        s[k] = _num(s.get(k), dv)
    p = g.setdefault("printer", {})
    for key in ("eject", "load"):
        node = p.setdefault(key, {})
        for k, dv in d["printer"][key].items():
            node[k] = _num(node.get(k), dv)
    door = p.get("door")
    if isinstance(door, dict):
        for kind in ("open", "close"):
            node = door.get(kind)
            if isinstance(node, dict):
                for k, dv in d["printer"]["door"][kind].items():
                    node[k] = _num(node.get(k), dv)
    return g


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
    ms = g.get("magazine_slot")
    if ms:
        return int(ms)
    return (int(g["storage_slots"]) + 1) if g.get("magazine") else 0


def apply_rack_config(g: dict, rack_cfg: dict | None) -> dict:
    """Regalzahl / Fächer / Magazin-Fach aus der GLOBALEN Rack-Konfiguration übernehmen
    (Configuration → Rack Configuration) — eine Quelle. Physische mm (x_unclamp,
    rack_x_gap, first_z_flat, slot_gap …) bleiben in der Geometrie."""
    if not rack_cfg:
        return g
    if rack_cfg.get("num_racks"):
        g["racks"] = int(rack_cfg["num_racks"])
    if rack_cfg.get("slots_per_rack"):
        g["storage_slots"] = int(rack_cfg["slots_per_rack"])
    ms = rack_cfg.get("magazine_slot")
    if ms:
        g["magazine_slot"] = int(ms)
        g["magazine"] = True
    # Platten pro Magazin (je Regal) — für die Z-Absenkung beim Magazin-Griff
    # (Durchbiegung, siehe magazine_z_offset). Rack Manager pflegt die Zähler.
    counts = rack_cfg.get("magazine_counts")
    if isinstance(counts, list):
        try:
            g["magazine_counts"] = [max(0, int(c)) for c in counts]
        except (TypeError, ValueError):
            pass
    return g


# Regal-Nr. in GERÄTE-Macro-Aufrufen (RACK=…) spiegeln: Printloom zählt seit v1.0.103
# R1 = Regal DIREKT am Drucker, die Klipper-Macros auf dem OTTOeject (slots.cfg vom
# alten Konfigurator) zählen Regal 1 = am Homing-Punkt (ganz rechts) — genau andersherum.
# Deshalb wird JEDE RACK=-Angabe erst beim Senden ans Gerät übersetzt:
# Geräte-Nr. = Regalzahl − Nr. + 1 (3 Regale: R1→3, R2→2, R3→1; 1 Regal = unverändert).
# Anzeige, Logs, Fach-Buchhaltung und Printloom-eigener G-code bleiben in
# Printloom-Zählung — Nummern außerhalb 1…Regalzahl werden nicht angefasst.
_RACK_PARAM_RE = re.compile(r"\bRACK=(\d+)", re.IGNORECASE)


def mirror_rack_params(script: str, racks) -> str:
    try:
        nr = int(racks or 1)
    except (TypeError, ValueError):
        return script
    if nr <= 1 or not script or "rack=" not in script.lower():
        return script

    def _sub(m):
        r = int(m.group(1))
        return f"RACK={nr - r + 1}" if 1 <= r <= nr else m.group(0)

    return _RACK_PARAM_RE.sub(_sub, script)


def magazine_z_offset(g: dict, rack: int) -> float:
    """Z-Absenkung beim Greifen aus dem Magazin: die flach gestapelten Platten biegen
    sich durch, der Stapel liegt pro Platte ~magazine_sag_mm tiefer. 6 Platten → −6 mm,
    4 → −4 mm (bei 1 mm/Platte). Zähler je Regal aus magazine_counts; ohne Zähler 0."""
    try:
        counts = g.get("magazine_counts") or []
        cnt = max(0, int(counts[int(rack) - 1]))
    except (TypeError, ValueError, IndexError):
        return 0.0
    sag = _num(g.get("magazine_sag_mm"), 1.0)
    return -cnt * sag


def _printer_x_off(g: dict) -> float:
    # Drucker sitzt am druckerseitigen Ende (vor R1) und WANDERT mit der Regalzahl mit,
    # weil der Home-Anker rechts fest ist → eject/load/Tür-X += (Regale−1)·rack_x_gap.
    # Regalzahl kommt global aus der Rack-Konfiguration (apply_rack_config). Wer den Drucker
    # fix stehen hat, nutzt den eigenen G-code (gcode_override, wird absolut gesendet).
    return (int(g.get("racks", 1)) - 1) * float(g["storage"]["rack_x_gap"])


def slot_position(g: dict, rack: int, slot: int) -> tuple[float, float, float, float]:
    """(x_unclamp, y_engage, z_flat, y_pullback_limit) für ein Fach — inkl. Skalierung."""
    s = g["storage"]
    nr = int(g.get("racks", 1) or 1)
    xt = float(g.get("rack_x_trim", {}).get(str(rack), 0) or 0)
    zt = float(g.get("rack_z_trim", {}).get(str(rack), 0) or 0)
    step = float(s["slot_gap"]) + SLOT_Z_EXTRA
    # R1 = Regal DIREKT am Drucker (druckerseitiges Ende = x_unclamp + (racks-1)*gap),
    # Rn = Regal am Home-Anker (x_unclamp, ganz rechts). So füllt die Farm R1→Rn vom
    # Drucker weg nach rechts. Home fest, Drucker wandert mit (siehe _printer_x_off).
    # Bei nur 1 Regal identisch zu früher (rack=1=nr → Offset 0 → x_unclamp).
    x = float(s["x_unclamp"]) + (nr - int(rack)) * float(s["rack_x_gap"]) + xt
    z = float(s["first_z_flat"]) + (int(slot) - 1) * step + zt
    return x, float(s["y_engage"]), z, float(s["y_pullback_limit"])


# ── Bewegungen (1:1 aus ottoeject_macros.cfg) ───────────────────────────────
def grab_from_rack(g: dict, rack: int, slot: int, nolift=None) -> list[str]:
    x_unclamp, y_engage, z_flat, y_pb = slot_position(g, rack, slot)
    mag = magazine_slot(g)
    if nolift is None:
        nolift = (mag > 0 and int(slot) == mag)
    # Magazin-Griff: Stapel hängt durch → Z pro Platte im Magazin absenken
    # (6 Platten → −6 mm). Gilt NUR für das Magazin-Fach, nie für normale Fächer.
    if mag > 0 and int(slot) == mag:
        z_flat += magazine_z_offset(g, rack)
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


def move_to_printer(g: dict) -> list[str]:
    """Nur VOR den Drucker fahren (sichere Anfahrt) — greift/wirft nicht.
    Eigene Operation für einen schnellen, feinjustierbaren Wechsel: erst hierher fahren,
    dann eject bzw. place mit eigener Geschwindigkeit. Bezugspunkt ist die eject-Position
    (Drucker sitzt hinter dem letzten Regal → +printer_x_off)."""
    p = g["printer"]["eject"]
    off = _printer_x_off(g)
    x = float(p["x"]) + off
    y_engage, z_flat = float(p["y"]), float(p["z"])
    y_pb = float(g["storage"]["y_pullback_limit"])
    return [
        f"M117 Moving to {g.get('printer_name','printer')}...",
        f"G1 Z{_n(z_flat)} Y{_n(y_pb)} F3000", "M400",   # sichere Höhe, zurückziehen
        f"G1 X{_n(x)} F3000", "M400",                     # auf Drucker-X ausrichten
        f"G1 Y{_n(y_engage-90)} F3000", "M400",           # vor die Druckerfront
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
def _speed_prefix(g: dict, op: str | None = None) -> str:
    """M220-Vorschubfaktor (%) für den App-G-code. Reihenfolge: speed_factors[op] →
    globaler speed_factor → 100. 100 = normal → kein Prefix."""
    val = None
    if op:
        sf = g.get("speed_factors")
        if isinstance(sf, dict):
            val = sf.get(op)
    if val is None:
        val = g.get("speed_factor", 100)
    try:
        f = int(val or 100)
    except (TypeError, ValueError):
        f = 100
    f = max(10, min(500, f))
    return f"M220 S{f}\n" if f != 100 else ""


def build_op(g: dict, op: str, rack: int = 1, slot: int = 1, nolift=None) -> str:
    g = _sanitize_geometry(merge_defaults(g))
    op = (op or "").lower()
    if op == "speed":   # nur den globalen Vorschubfaktor live setzen
        s = _speed_prefix(g)
        return (s or "M220 S100\n").rstrip() + "\nM400"
    speed = _speed_prefix(g, op)   # Vorschub PRO Operation (Fallback global)
    # Eigener G-code (Feinjustage im Drucker-Tab) hat Vorrang — 1:1 senden.
    ov = (g.get("gcode_override") or {}).get(op)
    if isinstance(ov, str) and ov.strip():
        # Platzhalter, damit EIN eigener G-code über alle Regale/Fächer skaliert — statt fixer
        # Koordinaten, die jedes Regal an denselben Punkt schicken. Werte aus der Kalibrierung
        # (x_unclamp/rack_x_gap/first_z_flat/slot_gap); R1 = druckerseitig (siehe slot_position):
        #   {rack_x}=X-Position des Regals · {slot_z}=Z-Höhe des Fachs · {mag_z}=Z des Magazin-
        #   fachs · {y_engage}/{y_pullback}=Y-Werte · {rack}/{slot}=Nummern.
        rx, ry, rz, ypb = slot_position(g, rack, slot)
        _mag = magazine_slot(g)
        # {mag_z} inkl. Durchbiegungs-Absenkung (pro Platte im Magazin, s. magazine_z_offset)
        magz = (slot_position(g, rack, _mag)[2] + magazine_z_offset(g, rack)) if _mag > 0 else rz
        s = ov
        for k, v in (
            ("{rack_x}", f"{rx:g}"), ("{slot_z}", f"{rz:g}"), ("{mag_z}", f"{magz:g}"),
            ("{y_engage}", f"{ry:g}"), ("{y_pullback}", f"{ypb:g}"),
            ("{rack}", str(int(rack))), ("{slot}", str(int(slot))),
        ):
            s = s.replace(k, v)
        s = s.strip()
        return speed + (s if s.rstrip().endswith("M400") else s + "\nM400")
    if op == "grab":
        lines = grab_from_rack(g, rack, slot, nolift)
    elif op in ("grab_magazine", "grab_mag"):
        # Frische Platte aus dem Magazin-Fach (global, z. B. 7) des Regals — IMMER NOLIFT
        # (die Platten liegen flach gestapelt, kein Anheben ins Fach nötig).
        mag = magazine_slot(g)
        lines = grab_from_rack(g, rack, mag if mag > 0 else slot, nolift=True)
    elif op == "store":
        lines = store_to_rack(g, rack, slot)
    elif op in ("move_to_printer", "move"):
        lines = move_to_printer(g)
    elif op == "eject":
        lines = eject_from_printer(g)
    elif op in ("place", "load"):   # place = neuer Name, load = Alias (Rückwärtskompat.)
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
