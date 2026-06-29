import asyncio
import logging
import json
import os
import re
import threading
import time
import zipfile
import httpx
from datetime import datetime
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse, StreamingResponse, Response
from sqlalchemy.orm import Session
from app.db.database import get_db, SessionLocal
from app.models.models import Device, PrinterType, UploadedFile
from app.services.bambu_mqtt import BambuLabMQTT
from app.services.bambu_ftp import BambuFTP
from app.services import storage, bambu_camera, rtsp_camera


def _make_print_name(original: str) -> str:
    base, _, ext = original.rpartition('.')
    safe_base = re.sub(r'[^a-zA-Z0-9_-]', '_', base)[:60]
    return f"{safe_base}.{ext}" if ext else safe_base


def _list_plates(file_path: str) -> list:
    """Return the sorted plate numbers found inside a .3mf ZIP, e.g. [1, 2, 3]."""
    try:
        with zipfile.ZipFile(file_path, 'r') as zf:
            nums = sorted(
                int(re.search(r'plate_(\d+)', n).group(1))
                for n in zf.namelist()
                if re.match(r'Metadata/plate_\d+\.gcode$', n, re.IGNORECASE)
            )
            return nums
    except Exception:
        return []


def _get_plate_gcode_param(file_path: str, plate: int | None = None) -> str:
    """
    Detect which plate's gcode is inside a .3mf ZIP.
    Returns e.g. 'Metadata/plate_1.gcode' or 'Metadata/plate_2.gcode'.
    If `plate` is given and present in the file, that plate is used; otherwise the
    lowest-numbered plate. Defaults to plate_1 if nothing found.
    """
    plates = _list_plates(file_path)
    if plate is not None and plate in plates:
        return f"Metadata/plate_{plate}.gcode"
    if plates:
        return f"Metadata/plate_{plates[0]}.gcode"
    return "Metadata/plate_1.gcode"


def _extract_filament_type(filepath: str, file_type: str) -> str | None:
    """Extract required filament type string from .gcode header comments or .3mf metadata."""
    try:
        if file_type == '.gcode':
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                for i, line in enumerate(f):
                    if i > 300: break
                    line = line.strip()
                    if not line.startswith(';'):
                        continue
                    m = re.match(r';\s*filament_type\s*=\s*(.+)', line, re.IGNORECASE)
                    if m:
                        val = m.group(1).strip().split(';')[0].strip()
                        if val:
                            return val
        elif file_type == '.3mf':
            with zipfile.ZipFile(filepath, 'r') as z:
                names = z.namelist()
                # Try project_settings.config (JSON): "filament_type": ["PLA", ...]
                cfg = next((n for n in names if 'project_settings' in n), None)
                if cfg:
                    with z.open(cfg) as f:
                        text = f.read().decode('utf-8', errors='ignore')
                    m = re.search(r'"filament_type"\s*:\s*\[\s*"([^"]+)"', text)
                    if m:
                        return m.group(1)
                # Fallback: read embedded gcode header
                gcode = next((n for n in names if n.endswith('.gcode')), None)
                if gcode:
                    with z.open(gcode) as f:
                        for i, line in enumerate(f):
                            if i > 300: break
                            line = line.decode('utf-8', errors='ignore').strip()
                            if not line.startswith(';'):
                                continue
                            m = re.match(r';\s*filament_type\s*=\s*(.+)', line, re.IGNORECASE)
                            if m:
                                val = m.group(1).strip().split(';')[0].strip()
                                if val:
                                    return val
    except Exception as e:
        logger.warning(f"filament type extraction failed: {e}")
    return None


def _match_ams_slot(ams_raw: dict, required_type: str) -> Optional[int]:
    """Find best matching AMS slot for required filament type. Returns global slot ID (0-15) or None."""
    if not required_type or not ams_raw:
        return None
    req_upper = required_type.upper().strip()
    req_base  = req_upper.split()[0]   # "PLA Matte" → "PLA"

    # Log all slots for diagnostics
    for unit in (ams_raw.get('ams') or []):
        unit_id = int(unit.get('id', 0))
        for tray in (unit.get('tray') or []):
            tid = int(tray.get('id', 0))
            gid = unit_id * 4 + tid
            ttype = tray.get('tray_type', '') or tray.get('tray_sub_brands', '') or tray.get('tray_id_name', '')
            logger.info(f"  AMS slot {gid}: type='{tray.get('tray_type','')}' brand='{tray.get('tray_sub_brands','')}' color={tray.get('tray_color','')}")

    for unit in (ams_raw.get('ams') or []):
        unit_id = int(unit.get('id', 0))
        for tray in (unit.get('tray') or []):
            # Skip empty/depleted slots
            remain = tray.get('remain', -1)
            if remain is not None and int(remain) <= 0:
                continue
            # Use tray_type first, fall back to sub_brands / tray_id_name
            slot_type = (tray.get('tray_type', '') or
                         tray.get('tray_sub_brands', '') or
                         tray.get('tray_id_name', '')).upper().strip()
            if not slot_type:
                continue
            slot_base = slot_type.split()[0]
            if req_base == slot_base or req_base in slot_type or slot_base in req_upper:
                tray_id   = int(tray.get('id', 0))
                global_id = unit_id * 4 + tray_id
                logger.info(f"AMS auto-match: '{required_type}' → '{slot_type}' global slot {global_id}")
                return global_id

    logger.warning(f"AMS auto-match: no slot found for '{required_type}' (req_base='{req_base}')")
    return None


def _read_filament_info(filepath: str, file_type: str, plate: int | None = None) -> tuple:
    """
    Read the filament types and colors a print actually USES.

    Wichtig bei Multi-Material-Projekten: der G-Code-Header listet ALLE im Projekt
    angelegten Filamente (z. B. PLA;PETG;PLA;PLA), auch wenn eine Platte nur eines
    davon druckt. Würden wir alle erzwingen, verlangt das AMS-Matching Filamente,
    die gar nicht gebraucht werden → falsches „Manuelle AMS-Zuordnung".
    Deshalb zuerst slice_info.config lesen: dort stehen PRO PLATTE nur die wirklich
    benutzten Filamente mit type+color. Erst als Fallback der G-Code-Header.
    Returns (types: list[str], colors: list[str]), same length.
    """
    types, colors = [], []

    def _scan(lines):
        nonlocal types, colors
        for line in lines:
            line = line.strip() if isinstance(line, str) else line.decode('utf-8', errors='ignore').strip()
            if not line.startswith(';'):
                continue
            m = re.match(r';\s*filament_type\s*=\s*(.+)', line, re.IGNORECASE)
            if m:
                types = [t.strip() for t in m.group(1).split(';') if t.strip()]
            m = re.match(r';\s*filament_colour\s*=\s*(.+)', line, re.IGNORECASE)
            if m:
                colors = [c.strip() for c in m.group(1).split(';') if c.strip()]

    def _from_slice_info(z):
        """Pro-Platte tatsächlich benutzte Filamente aus slice_info.config → (types, colors) oder None."""
        try:
            name = next((n for n in z.namelist() if n.lower().endswith('slice_info.config')), None)
            if not name:
                return None
            import xml.etree.ElementTree as ET
            root = ET.fromstring(z.read(name).decode('utf-8', errors='ignore'))
            plates = list(root.iter('plate'))
            if not plates:
                return None
            chosen = None
            if plate is not None:
                for pl in plates:
                    idx = next((m.get('value') for m in pl.findall('metadata') if m.get('key') == 'index'), None)
                    if idx and str(idx).strip() == str(plate).strip():
                        chosen = pl
                        break
            if chosen is None:
                chosen = plates[0]
            ts, cs = [], []
            for fil in chosen.findall('filament'):
                t = (fil.get('type') or '').strip()
                c = (fil.get('color') or '').strip()
                if t or c:
                    ts.append(t)
                    cs.append(c)
            return (ts, cs) if (ts or cs) else None
        except Exception as e:
            logger.warning(f"slice_info filament parse failed: {e}")
            return None

    try:
        if file_type == '.3mf':
            with zipfile.ZipFile(filepath, 'r') as z:
                si = _from_slice_info(z)
                if si:
                    types, colors = si
                else:
                    gp = next((n for n in z.namelist() if n.endswith('.gcode')), None)
                    if gp:
                        with z.open(gp) as f:
                            _scan(f.readlines()[:400])
        else:
            with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                _scan(f.readlines()[:400])
    except Exception as e:
        logger.warning(f"filament info read failed: {e}")

    n = max(len(types), len(colors), 1)
    types  += [''] * (n - len(types))
    colors += [''] * (n - len(colors))
    logger.info(f"Filament info (plate={plate}): types={types} colors={colors}")
    return types, colors


def _color_dist(hex1: str, hex2: str) -> float:
    """Euclidean RGB distance (0=identical)."""
    def _p(h):
        h = h.lstrip('#').upper()
        if len(h) >= 8: h = h[:6]
        try:   return int(h[0:2],16), int(h[2:4],16), int(h[4:6],16)
        except: return 128, 128, 128
    r1,g1,b1 = _p(hex1);  r2,g2,b2 = _p(hex2)
    return ((r1-r2)**2 + (g1-g2)**2 + (b1-b2)**2) ** 0.5


AMS_COLOR_THRESHOLD   = 80  # keep in sync with frontend amsUtils.js — Grenze „noch akzeptabel"
EXACT_COLOR_THRESHOLD = 40  # darunter gilt die Farbe als „exakt dieselbe"


def _tray_remain(tray: dict) -> int:
    """Filament left as a 0–100 percentage; -1 when unknown (third-party spools)."""
    try:
        return int(tray.get('remain', -1))
    except (TypeError, ValueError):
        return -1


def _color_tier(d: float) -> int:
    """0 = exakte Farbe, 1 = ähnlich (Ersatz), 2 = weit weg (Notnagel)."""
    if d <= EXACT_COLOR_THRESHOLD:
        return 0
    if d <= AMS_COLOR_THRESHOLD:
        return 1
    return 2


def _pick_slot(candidates: list, fcolor_clean: str) -> dict:
    """Pick the best tray among same-material candidates.

    Drei Farbstufen mit klarer Priorität:
      0) EXAKTE Farbe (RGB-Distanz ≤ EXACT_COLOR_THRESHOLD),
      1) ähnliche Farbe (≤ AMS_COLOR_THRESHOLD) — nur als Ersatz,
      2) weit entfernt — Notnagel.
    Eine **exakte** Farbe schlägt IMMER eine nur ähnliche, selbst wenn die ähnliche
    Spule leerer ist. Erst INNERHALB derselben Stufe wird die leerste passende Spule
    zuerst aufgebraucht (`remain`; -1/unbekannt = „voll" → zuletzt). Bei Stufe 2 zählt
    die nächste Farbe. Damit gewinnt z. B. „Dark Red" nicht mehr gegen ein ebenfalls
    geladenes „Dark Red", nur weil „Latte Brown" zufällig farbnah und leerer ist.
    """
    def _rem(s):
        r = s.get('remain', -1)
        return r if isinstance(r, int) and r >= 0 else 101  # unknown → last
    def _key(s):
        d = _color_dist(fcolor_clean, s['color']) if (fcolor_clean and s['color']) else 0.0
        tier = _color_tier(d)
        # exakt/ähnlich: leerste Spule zuerst; weit weg: nächste Farbe zuerst
        return (tier, _rem(s) if tier < 2 else 0, d, s['gid'])
    return min(candidates, key=_key)


def _match_ams_live(types: list, colors: list, ams_raw: dict) -> list:
    """
    For each filament (type + color), find the best AMS slot from live printer status.
    Match priority: 1) filament type  2) color proximity.
    Returns ams_mapping list (0-indexed, one entry per filament).
    """
    slots = []
    for unit in (ams_raw.get('ams') or []):
        uid = int(unit.get('id', 0))
        for tray in (unit.get('tray') or []):
            stype  = (tray.get('tray_type','') or tray.get('tray_sub_brands','') or '').upper().strip()
            # A tray is loaded when it carries a material type. `remain` is the percentage
            # left and is -1 when unknown (third-party spools w/o RFID) — NOT a sign of empty.
            if not stype:
                continue
            tid    = int(tray.get('id', 0))
            gid    = uid * 4 + tid
            scolor = (tray.get('tray_color','') or '').upper().lstrip('#')
            slots.append({'gid': gid, 'type': stype, 'type_base': stype.split()[0] if stype else '',
                          'color': scolor, 'remain': _tray_remain(tray)})
            logger.info(f"  AMS slot {gid}: {stype} #{scolor[:6]} remain={_tray_remain(tray)}")

    if not slots:
        logger.warning("No AMS slots — sequential fallback")
        return list(range(len(types)))

    mapping = []
    for i, (ftype, fcolor) in enumerate(zip(types, colors)):
        fbase  = ftype.upper().strip().split()[0] if ftype else ''
        fcolor_clean = fcolor.lstrip('#').upper()

        # NUR gleiches Material — NIEMALS materialübergreifend ausweichen.
        # (PETG darf nie mit PLA gedruckt werden → ruinierter Druck/Düse.)
        candidates = [s for s in slots if fbase and (
            fbase == s['type_base'] or fbase in s['type'] or
            (s['type_base'] and s['type_base'] in ftype.upper())
        )]
        if not candidates:
            # Kein passendes Material geladen → NICHT raten. Sequenzieller Default;
            # die Farm pausiert ohnehin via _ams_match_confident ("kein passendes Material").
            logger.warning(f"  Filament {i}: {ftype} #{fcolor_clean[:6]} → KEIN passendes Material im AMS — kein Cross-Material-Mapping")
            mapping.append(i)
            continue
        best = _pick_slot(candidates, fcolor_clean)
        logger.info(f"  Filament {i}: {ftype} #{fcolor_clean[:6]} → slot {best['gid']} ({best['type']} #{best['color'][:6]} remain={best.get('remain')})")
        mapping.append(best['gid'])

    return mapping


def _ams_slots_from_raw(ams_raw: dict) -> list:
    """Flatten live AMS status into [{gid,type,type_base,color}], skipping empty trays."""
    slots = []
    for unit in (ams_raw.get('ams') or []):
        uid = int(unit.get('id', 0))
        for tray in (unit.get('tray') or []):
            stype  = (tray.get('tray_type', '') or tray.get('tray_sub_brands', '') or '').upper().strip()
            # Loaded = has a material type. `remain` (-1 = unknown) does NOT mean empty.
            if not stype:
                continue
            tid    = int(tray.get('id', 0))
            scolor = (tray.get('tray_color', '') or '').upper().lstrip('#')
            slots.append({'gid': uid * 4 + tid, 'type': stype,
                          'type_base': stype.split()[0] if stype else '', 'color': scolor,
                          'remain': _tray_remain(tray)})
    return slots


def _ams_match_confident(types: list, colors: list, ams_raw: dict, exact_only: bool = False) -> tuple:
    """Check whether every required filament has a usable AMS match.

    A filament is matched as long as a loaded tray with the same material exists;
    among those, the closest colour is picked automatically (so slicing "Dark Blue"
    prints with the Dark-Blue tray no matter which slot it sits in). Colour never
    blocks. Returns (mapping, missing) where `missing` only contains filaments with
    NO matching material at all, or where the AMS could not be read — those still
    require manual AMS assignment.

    `exact_only` (1.4): wenn True, gilt ein nur farbähnlicher Treffer (Distanz >
    EXACT_COLOR_THRESHOLD) NICHT als ausreichend → kommt in `missing` („keine exakte
    Farbe"), damit die Farm pausiert statt eine Ersatzfarbe zu drucken.
    """
    slots = _ams_slots_from_raw(ams_raw)
    mapping, missing = [], []
    for i, (ftype, fcolor) in enumerate(zip(types, colors)):
        fbase = ftype.upper().strip().split()[0] if ftype else ''
        fcolor_clean = fcolor.lstrip('#').upper()

        if not slots:
            missing.append({"index": i, "type": ftype, "color": fcolor,
                            "reason": "AMS nicht lesbar"})
            mapping.append(0)
            continue

        candidates = [s for s in slots if fbase and (
            fbase == s['type_base'] or fbase in s['type'] or
            (s['type_base'] and s['type_base'] in ftype.upper())
        )]
        if not candidates:
            missing.append({"index": i, "type": ftype, "color": fcolor,
                            "reason": "kein passendes Material im AMS"})
            mapping.append(slots[0]['gid'])
            continue

        best = _pick_slot(candidates, fcolor_clean)
        if exact_only and fcolor_clean and best.get('color') and \
                _color_dist(fcolor_clean, best['color']) > EXACT_COLOR_THRESHOLD:
            missing.append({"index": i, "type": ftype, "color": fcolor,
                            "reason": "keine exakte Farbe geladen"})
        mapping.append(best['gid'])
    return mapping, missing


def _read_ams_mapping_from_gcode_header(filepath: str) -> list:
    """Read ams_mapping comment written by Bambu Studio into .gcode header."""
    try:
        with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
            for i, line in enumerate(f):
                if i > 300:
                    break
                m = re.match(r';\s*ams_mapping\s*=\s*(.+)', line.strip(), re.IGNORECASE)
                if m:
                    vals = [int(x.strip()) for x in re.split(r'[\s;,]+', m.group(1).strip()) if x.strip().lstrip('-').isdigit()]
                    real = [v for v in vals if 0 <= v < 200]
                    if real:
                        logger.info(f"ams_mapping from gcode header: {real}")
                        return real
    except Exception as e:
        logger.warning(f"gcode header ams_mapping read failed: {e}")
    return [0]


def _get_ams_mapping(filepath: str, file_type: str, ams_slot_override: int = None, diag: list = None) -> list:
    """
    Determine the correct ams_mapping for the MQTT project_file command.
    - Reads the mapping the file was sliced with (respects multi-color)
    - If ams_slot_override is set, replaces all slots with that value
    - Never returns empty list (minimum [0])
    """
    def _d(msg):
        if diag is not None:
            diag.append(msg)

    if file_type == '.3mf':
        mapping = _extract_ams_mapping(filepath, diag=diag)
    else:
        mapping = _read_ams_mapping_from_gcode_header(filepath)
        _d(f"G-Code-Datei → ams_mapping aus Header: {mapping}")

    if not mapping:
        mapping = [0]
        _d("Mapping leer nach Extraktion → Fallback [0]")

    if ams_slot_override is not None:
        mapping = [ams_slot_override] * len(mapping)
        _d(f"⚙ Slot-Override gesetzt: alle Filamente → Slot {ams_slot_override} → Mapping {mapping}")
        logger.info(f"AMS slot override {ams_slot_override} → ams_mapping={mapping}")
    else:
        _d("Kein Slot-Override — Mapping direkt aus Datei")

    labels = ',  '.join(f"Filament {i} → A{m+1}" for i, m in enumerate(mapping))
    _d(f"► Finales Mapping: {mapping}   ({labels})")
    logger.info(f"Final ams_mapping: {mapping} (filaments: {len(mapping)})")
    return mapping


def _extract_ams_mapping(filepath: str, diag: list = None) -> list:
    """
    Read AMS slot mapping from .3mf (0-indexed: 0=A1, 1=A2, 2=A3, 3=A4).
    Tries multiple locations in order of reliability.
    """
    def _clean(vals):
        return [int(v) for v in vals if 0 <= int(v) < 200]

    def _d(msg):
        if diag is not None:
            diag.append(msg)

    try:
        with zipfile.ZipFile(filepath, 'r') as z:
            names = z.namelist()

            # 1. filament_sequence.json
            seq_path = next((n for n in names if n.endswith('filament_sequence.json')), None)
            if seq_path:
                data = json.loads(z.open(seq_path).read().decode('utf-8', errors='ignore'))
                found = False
                for plate in data.values():
                    for key in ('optimal_assignment', 'mapping', 'filament_maps'):
                        val = plate.get(key)
                        if val and isinstance(val, list):
                            clean = _clean(val)
                            if clean:
                                _d(f"Quelle 1 — filament_sequence.json [{key}]: {clean}  ✓ verwendet")
                                logger.info(f"AMS mapping from filament_sequence.json[{key}]: {clean}")
                                return clean
                            found = True
                if not found:
                    _d("Quelle 1 — filament_sequence.json: kein Mapping-Key gefunden")
            else:
                _d("Quelle 1 — filament_sequence.json: NICHT im ZIP")

            # 2. slice_info.config
            info_path = next((n for n in names if n.endswith('slice_info.config')), None)
            if info_path:
                text = z.open(info_path).read().decode('utf-8', errors='ignore')
                m = re.search(r'key="filament_maps"\s+value="([^"]+)"', text)
                if m:
                    raw = [max(0, int(x) - 1) for x in m.group(1).split()]
                    clean = _clean(raw)
                    if clean:
                        _d(f"Quelle 2 — slice_info.config [filament_maps]: roh \"{m.group(1)}\" → {clean}  ✓ verwendet")
                        logger.info(f"AMS mapping from slice_info.config: {clean}")
                        return clean
                    _d(f"Quelle 2 — slice_info.config [filament_maps]: roh \"{m.group(1)}\" → leer nach Filterung")
                else:
                    _d("Quelle 2 — slice_info.config: kein filament_maps Key")
            else:
                _d("Quelle 2 — slice_info.config: NICHT im ZIP")

            # 3. Gcode header
            gcode_path = next((n for n in names if n.endswith('.gcode')), None)
            if gcode_path:
                ams_found = False
                with z.open(gcode_path) as gf:
                    for i, raw_line in enumerate(gf):
                        if i > 400:
                            break
                        line = raw_line.decode('utf-8', errors='ignore').strip()
                        if not line.startswith(';'):
                            continue
                        m2 = re.match(r';\s*ams_mapping\s*=\s*(.+)', line, re.IGNORECASE)
                        if m2:
                            parts = re.split(r'[\s;,]+', m2.group(1).strip())
                            vals = [int(p) for p in parts if p.lstrip('-').isdigit()]
                            clean = _clean(vals)
                            if clean:
                                _d(f"Quelle 3 — G-Code-Header [ams_mapping]: \"{m2.group(1).strip()}\" → {clean}  ✓ verwendet")
                                logger.info(f"AMS mapping from embedded gcode header: {clean}")
                                return clean
                            ams_found = True
                        m3 = re.match(r';\s*filament_colour\s*=\s*(.+)', line, re.IGNORECASE)
                        if m3:
                            count = len(m3.group(1).strip().split(';'))
                            if count > 1:
                                sequential = list(range(count))
                                _d(f"Quelle 3 — G-Code-Header [filament_colour]: {count} Filamente → sequenziell {sequential}  ✓ verwendet")
                                logger.info(f"AMS mapping: {count} filaments detected → sequential {sequential}")
                                return sequential
                if not ams_found:
                    _d("Quelle 3 — G-Code-Header: kein ams_mapping gefunden")
            else:
                _d("Quelle 3 — G-Code-Header: NICHT im ZIP")

    except Exception as e:
        _d(f"FEHLER beim Lesen der Mapping-Quellen: {e}")
        logger.warning(f"AMS mapping extraction failed: {e}")

    _d("Alle Quellen erschöpft → Fallback [0] (A1)")
    logger.info("AMS mapping not found — defaulting to [0]")
    return [0]

router = APIRouter()
logger = logging.getLogger(__name__)

# ── AMS Send-Diagnostics ─────────────────────────────────────────────────────
SEND_DIAG_PATH = "/app/db/send_diagnostics.json"
_diag_sessions: list = []


def _diag_load():
    global _diag_sessions
    try:
        if os.path.exists(SEND_DIAG_PATH):
            with open(SEND_DIAG_PATH) as f:
                _diag_sessions = json.load(f)
    except Exception:
        _diag_sessions = []

def _diag_save():
    try:
        storage.write_json(SEND_DIAG_PATH, _diag_sessions)
    except Exception:
        pass

def _diag_begin(filename: str, file_id: int) -> dict:
    sess = {
        "ts":      datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "file":    filename,
        "file_id": file_id,
        "steps":   [],
        "result":  "running",
    }
    _diag_sessions.insert(0, sess)
    while len(_diag_sessions) > 30:
        _diag_sessions.pop()
    return sess

def _diag_add(sess: dict, title: str, lines: list, ok: bool = True):
    sess["steps"].append({"title": title, "lines": lines, "ok": ok})
    _diag_save()

def _diag_finish(sess: dict, result: str):
    sess["result"] = result
    _diag_save()

_diag_load()

HISTORY_PATH = "/app/db/print_history.json"

def _append_history(entry: dict):
    try:
        history = storage.read_json(HISTORY_PATH, [])
        history.insert(0, entry)
        history = history[:200]  # keep last 200
        storage.write_json(HISTORY_PATH, history)
    except Exception as e:
        logger.warning(f"print history write failed: {e}")

@router.get("/history")
def get_history():
    if not os.path.exists(HISTORY_PATH):
        return {"items": []}
    try:
        with open(HISTORY_PATH) as f:
            return {"items": json.load(f)}
    except:
        return {"items": []}


# ── Snapshots ────────────────────────────────────────────────────────────────

SNAP_DIR = Path("/app/uploads/snapshots")

def _device_settings(db: Session, device_id: int) -> dict:
    from app.models.models import SystemConfig
    row = db.query(SystemConfig).filter(SystemConfig.key == f"device_settings_{device_id}").first()
    if row:
        try:
            import json as _j
            return _j.loads(row.value) or {}
        except Exception:
            pass
    return {}


def _get_webcam_url(db: Session, device_id: int) -> str:
    return _device_settings(db, device_id).get("webcam_url", "")


def _camera_enabled(db: Session, device_id: int) -> bool:
    """Camera on/off toggle. Absent = enabled, so a freshly added printer shows it."""
    return _device_settings(db, device_id).get("camera_enabled", True) is not False


async def capture_snapshot(device_id: int) -> Optional[str]:
    """Best-effort webcam grab for the AutoFarm loop. Uses the configured webcam_url
    if set, otherwise the printer's built-in X1C camera (port 6000). Returns the saved
    filename or None if unavailable. Never raises."""
    db = SessionLocal()
    try:
        if not _camera_enabled(db, device_id):
            return None  # Kamera per Toggle aus → keine (auto.) Snapshots
        webcam_url = _get_webcam_url(db, device_id)
        device = db.query(Device).filter(Device.id == device_id).first()
        ip, code = (device.ip_address, device.access_code) if device else (None, None)
        if device:
            # Force-load the attributes the MQTT client needs before the session
            # closes (the instance is detached afterwards → DetachedInstanceError).
            _ = (device.serial_number, device.use_tls, device.mqtt_port, device.id)
            db.expunge(device)
    finally:
        db.close()
    try:
        SNAP_DIR.mkdir(parents=True, exist_ok=True)
        if webcam_url:
            import httpx as _httpx
            async with _httpx.AsyncClient(timeout=8.0) as client:
                r = await client.get(webcam_url, follow_redirects=True)
                r.raise_for_status()
                img_bytes = r.content
        elif ip and code:
            loop = asyncio.get_event_loop()
            if device:
                _ensure_chamber_light_async(device)
            img_bytes = await loop.run_in_executor(None, rtsp_camera.single_frame, ip, code)
        else:
            return None
        if not img_bytes:
            return None
        fname = f"snap_{device_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.jpg"
        (SNAP_DIR / fname).write_bytes(img_bytes)
        return fname
    except Exception as e:
        logger.warning(f"capture_snapshot failed: {e}")
        return None


def _ensure_chamber_light(device, on: bool = True) -> None:
    """Best-effort: switch the X1C chamber LED on so the camera isn't black.
    Quick connect → ledctrl → disconnect. Never raises."""
    try:
        mqtt_client = BambuLabMQTT(device)
        if mqtt_client.connect(wait_timeout=5.0):
            mqtt_client.set_chamber_light(on)
        mqtt_client.disconnect()
    except Exception as e:
        logger.warning(f"chamber light toggle failed for device {device.id}: {e}")


def _ensure_chamber_light_async(device, on: bool = True) -> None:
    """Fire-and-forget light toggle so it never delays the camera stream/first frame."""
    threading.Thread(target=_ensure_chamber_light, args=(device, on), daemon=True).start()


@router.get("/camera/{device_id}")
def camera_stream(device_id: int, db: Session = Depends(get_db)):
    """Live MJPEG stream from the printer's built-in X1C camera via its RTSPS stream
    (ffmpeg-transcoded). Served as multipart/x-mixed-replace so a plain <img> tag
    shows live video — no Home Assistant, just the printer IP + access code."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(404, "Gerät nicht gefunden")
    ip, code = device.ip_address, device.access_code
    boundary = "ottoframe"

    # Turn the chamber light on (non-blocking, so it can't delay the first frame).
    _ensure_chamber_light_async(device)

    # Pull the FIRST frame synchronously so connection/auth/LAN-liveview failures
    # surface as a real HTTP 502 (→ the <img> onError fires and the UI shows the
    # actual reason). Otherwise StreamingResponse would already be committed and a
    # failed camera would just stream nothing → a silent black box with no error.
    frame_iter = rtsp_camera.frames(ip, code)
    try:
        first = next(frame_iter)
    except StopIteration:
        raise HTTPException(502, "Kamera lieferte kein Bild (LAN-Modus Liveview am Drucker aktiv?)")
    except Exception as e:
        logger.warning(f"camera_stream first-frame failed for device {device_id}: {e}")
        raise HTTPException(502, f"X1C-Kamera nicht erreichbar: {e}")

    def _part(img: bytes) -> bytes:
        return (b"--" + boundary.encode() + b"\r\n"
                b"Content-Type: image/jpeg\r\n"
                b"Content-Length: " + str(len(img)).encode() + b"\r\n\r\n"
                + img + b"\r\n")

    def gen():
        try:
            yield _part(first)
            for img in frame_iter:
                yield _part(img)
        except Exception as e:
            logger.warning(f"camera_stream ended for device {device_id}: {e}")
        finally:
            frame_iter.close()

    return StreamingResponse(
        gen(), media_type=f"multipart/x-mixed-replace; boundary={boundary}"
    )


@router.get("/camera/{device_id}/frame")
def camera_frame(device_id: int, db: Session = Depends(get_db)):
    """Single JPEG frame from the built-in X1C camera (for snapshots / fallback)."""
    device = db.query(Device).filter(Device.id == device_id).first()
    if not device:
        raise HTTPException(404, "Gerät nicht gefunden")
    _ensure_chamber_light_async(device)
    try:
        img = rtsp_camera.single_frame(device.ip_address, device.access_code)
    except Exception as e:
        raise HTTPException(502, f"Kamera nicht erreichbar: {e}")
    if not img:
        raise HTTPException(502, "Kein Kamerabild empfangen")
    return Response(content=img, media_type="image/jpeg")


# ── Home-Assistant-Kamera-Proxy ───────────────────────────────────────────────
# Auf neuerer X1C-Firmware (≥01.11) lehnt der Drucker die einfache Port-6000-
# Kamera-Auth ab (er antwortet mit ff ff ff ff). Home Assistant (ha-bambulab) holt
# das Bild über Bambus proprietäre Methode und ist damit der "eine Client". Wir
# greifen den Stream von HA ab: HA bleibt alleiniger Kamera-Client, App + HA + App
# können gleichzeitig zusehen. Das HA-Token bleibt serverseitig (geht nie an den
# Browser); der Browser sieht nur diese same-origin-Proxy-URL.

def _get_ha_cam_cfg(db: Session, device_id: int):
    """(ha_url, token, entity) aus den Geräte-Einstellungen oder None."""
    from app.models.models import SystemConfig
    row = db.query(SystemConfig).filter(SystemConfig.key == f"device_settings_{device_id}").first()
    if not row:
        return None
    try:
        s = json.loads(row.value)
    except Exception:
        return None
    ha_url = (s.get("ha_url") or "").rstrip("/")
    token  = s.get("ha_token") or ""
    entity = s.get("ha_camera") or ""
    if ha_url and token and entity:
        return ha_url, token, entity
    return None


@router.get("/ha-camera/{device_id}")
async def ha_camera_stream(device_id: int, db: Session = Depends(get_db)):
    """Live-MJPEG der X1C-Kamera, durchgereicht von Home Assistant.
    Reicht HAs camera_proxy_stream (multipart/x-mixed-replace) 1:1 an den Browser
    weiter; das HA-Token bleibt serverseitig."""
    cfg = _get_ha_cam_cfg(db, device_id)
    if not cfg:
        raise HTTPException(400, "Home-Assistant-Kamera nicht konfiguriert (URL/Token/Entity fehlt)")
    ha_url, token, entity = cfg
    upstream = f"{ha_url}/api/camera_proxy_stream/{entity}"
    headers = {"Authorization": f"Bearer {token}"}
    # read=None → der MJPEG-Stream läuft unbegrenzt, nur Connect bekommt ein Timeout.
    client = httpx.AsyncClient(timeout=httpx.Timeout(10.0, read=None), follow_redirects=True)
    try:
        req = client.build_request("GET", upstream, headers=headers)
        resp = await client.send(req, stream=True)
    except Exception as e:
        await client.aclose()
        raise HTTPException(502, f"Home Assistant nicht erreichbar: {e}")
    if resp.status_code != 200:
        await resp.aclose()
        await client.aclose()
        hint = "Token ungültig?" if resp.status_code == 401 else \
               "Entity-ID falsch?" if resp.status_code == 404 else ""
        raise HTTPException(502, f"HA-Kamera HTTP {resp.status_code} {hint}".strip())
    ctype = resp.headers.get("content-type", "multipart/x-mixed-replace; boundary=frame")

    async def gen():
        try:
            async for chunk in resp.aiter_raw():
                yield chunk
        except Exception as e:
            logger.info(f"HA-Kamera-Stream beendet (device {device_id}): {e}")
        finally:
            await resp.aclose()
            await client.aclose()

    return StreamingResponse(gen(), media_type=ctype)


@router.get("/ha-camera/{device_id}/frame")
async def ha_camera_frame(device_id: int, db: Session = Depends(get_db)):
    """Einzelbild der X1C-Kamera über Home Assistant (Snapshot/Fallback)."""
    cfg = _get_ha_cam_cfg(db, device_id)
    if not cfg:
        raise HTTPException(400, "Home-Assistant-Kamera nicht konfiguriert")
    ha_url, token, entity = cfg
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            r = await client.get(f"{ha_url}/api/camera_proxy/{entity}",
                                 headers={"Authorization": f"Bearer {token}"})
    except Exception as e:
        raise HTTPException(502, f"Home Assistant nicht erreichbar: {e}")
    if r.status_code != 200:
        raise HTTPException(502, f"HA-Kamera HTTP {r.status_code}")
    return Response(content=r.content, media_type=r.headers.get("content-type", "image/jpeg"))


@router.get("/ha-camera/{device_id}/test")
async def ha_camera_test(device_id: int, db: Session = Depends(get_db)):
    """Schneller Verbindungstest für die Konfigurations-UI → {ok, detail}."""
    cfg = _get_ha_cam_cfg(db, device_id)
    if not cfg:
        return {"ok": False, "detail": "Nicht konfiguriert — URL, Token und Entity-ID nötig."}
    ha_url, token, entity = cfg
    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            r = await client.get(f"{ha_url}/api/camera_proxy/{entity}",
                                 headers={"Authorization": f"Bearer {token}"})
    except Exception as e:
        return {"ok": False, "detail": f"HA nicht erreichbar: {e}"}
    if r.status_code == 200 and r.content[:3] == b"\xff\xd8\xff":
        return {"ok": True, "detail": f"Bild empfangen ({len(r.content)} Bytes) ✓"}
    if r.status_code == 401:
        return {"ok": False, "detail": "401 — Token ungültig oder abgelaufen."}
    if r.status_code == 404:
        return {"ok": False, "detail": "404 — Entity-ID nicht gefunden."}
    if r.status_code == 200:
        return {"ok": False, "detail": "Antwort ist kein JPEG — Kamera in HA aktiv?"}
    return {"ok": False, "detail": f"HA-Kamera HTTP {r.status_code}"}


@router.post("/snapshot/{device_id}")
async def take_snapshot(device_id: int, db: Session = Depends(get_db)):
    """Aktuellen Webcam-Frame speichern."""
    webcam_url = _get_webcam_url(db, device_id)
    if not webcam_url:
        raise HTTPException(status_code=400, detail="Keine Webcam-URL für dieses Gerät konfiguriert")
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    import httpx as _httpx
    try:
        async with _httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(webcam_url, follow_redirects=True)
            r.raise_for_status()
            img_bytes = r.content
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Webcam nicht erreichbar: {e}")
    ts = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    fname = f"snap_{device_id}_{ts}.jpg"
    (SNAP_DIR / fname).write_bytes(img_bytes)
    return {"filename": fname, "url": f"/api/printer/snapshots/{fname}", "timestamp": ts}


@router.get("/snapshots")
def list_snapshots():
    """Letzte 20 gespeicherte Snapshots auflisten."""
    if not SNAP_DIR.exists():
        return []
    snaps = sorted(SNAP_DIR.glob("snap_*.jpg"), key=lambda x: x.stat().st_mtime, reverse=True)
    return [
        {"filename": s.name, "url": f"/api/printer/snapshots/{s.name}"}
        for s in snaps[:20]
    ]


@router.get("/snapshots/{filename}")
def serve_snapshot(filename: str):
    """Einzelnen Snapshot als Bild zurückgeben."""
    f = SNAP_DIR / filename
    if not f.exists() or not f.name.startswith("snap_"):
        raise HTTPException(status_code=404, detail="Snapshot nicht gefunden")
    return FileResponse(str(f), media_type="image/jpeg")


def _get_bambu_device(device_id: int, db: Session) -> Device:
    device = db.query(Device).filter(
        Device.id == device_id,
        Device.device_type == PrinterType.BAMBU_LAB
    ).first()
    if not device:
        raise HTTPException(status_code=404, detail="Bambu Lab Gerät nicht gefunden")
    return device


@router.get("/plates/{file_id}")
async def list_file_plates(file_id: int, db: Session = Depends(get_db)):
    """List the plate numbers inside a multi-plate .3mf (empty for single/.gcode)."""
    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type != ".3mf" or not os.path.exists(file.file_path):
        return {"plates": []}
    return {"plates": _list_plates(file.file_path)}


@router.post("/send/{device_id}/{file_id}")
async def send_file_to_printer(device_id: int, file_id: int, use_ams: bool = True, ams_slot: Optional[int] = None, db: Session = Depends(get_db)):
    """Datei per FTPS auf den Drucker laden und Druck per MQTT starten."""
    device = _get_bambu_device(device_id, db)

    file = db.query(UploadedFile).filter(UploadedFile.id == file_id).first()
    if not file:
        raise HTTPException(status_code=404, detail="Datei nicht gefunden")
    if file.file_type not in (".3mf", ".gcode"):
        raise HTTPException(status_code=400, detail="Nur .3mf und .gcode Dateien können gesendet werden")

    # ── Diagnose-Session starten ─────────────────────────────────
    sess = _diag_begin(file.original_filename, file_id)
    _diag_add(sess, "Datei & Einstellungen", [
        f"Datei:        {file.original_filename}",
        f"Typ:          {file.file_type}",
        f"Größe:        {round(file.file_size / 1024, 1)} KB",
        f"Drucker:      {device.name}  ({device.ip_address})",
        f"AMS aktiv:    {use_ams}",
        f"Slot-Override:{f'  A{ams_slot+1} (Index {ams_slot})' if ams_slot is not None else '  keiner'}",
    ])

    # ── Alle konfigurierten AMS-Slots lesen ─────────────────────
    slot_lines = []
    used_lines = []
    if file.file_type == '.3mf':
        try:
            with zipfile.ZipFile(file.file_path, 'r') as z:
                names_z = z.namelist()

                cfg = next((n for n in names_z if 'project_settings' in n.lower()), None)
                if cfg:
                    import xml.etree.ElementTree as _ET
                    with z.open(cfg) as fc:
                        ps = json.load(fc)
                    types    = ps.get('filament_type', [])
                    colors   = ps.get('filament_colour', [])
                    profiles = ps.get('filament_settings_id', [])
                    n_temps  = ps.get('nozzle_temperature', [])
                    for i in range(max(len(types), len(colors), 1)):
                        slot_lines.append(
                            f"  A{i+1}:  {types[i] if i < len(types) else '?':<8}"
                            f"  {(profiles[i] if i < len(profiles) else ''):<24}"
                            f"  {(colors[i] if i < len(colors) else ''):<10}"
                            f"  {(n_temps[i]+'°' if i < len(n_temps) else '')}"
                        )
                else:
                    slot_lines.append("project_settings.config nicht im ZIP")

                si = next((n for n in names_z if 'slice_info' in n.lower()), None)
                if si:
                    import xml.etree.ElementTree as _ET2
                    with z.open(si) as fs:
                        root = _ET2.parse(fs).getroot()
                    found_used = False
                    for fil in root.iter("filament"):
                        a = fil.attrib
                        fid = a.get("id", "?")
                        used_lines.append(
                            f"  id={fid} → A{fid}:  {a.get('type',''):<8}"
                            f"  {a.get('color',''):<10}"
                            f"  {a.get('used_m','?')}m  {a.get('used_g','?')}g"
                            f"  ← tatsächlich gedruckt"
                        )
                        found_used = True
                    if not found_used:
                        used_lines.append("Keine <filament>-Einträge in slice_info.config")
                else:
                    used_lines.append("slice_info.config nicht im ZIP")
        except Exception as e:
            slot_lines.append(f"FEHLER: {e}")
    else:
        slot_lines.append("(G-Code-Datei — keine project_settings verfügbar)")
        used_lines.append("(G-Code-Datei — keine slice_info verfügbar)")

    _diag_add(sess, "Konfigurierte AMS-Slots  (project_settings.config)", slot_lines)
    _diag_add(sess, "Tatsächlich gedruckte Filamente  (slice_info.config)", used_lines)

    loop = asyncio.get_event_loop()
    print_name = _make_print_name(file.original_filename)

    # ── MQTT verbinden ───────────────────────────────────────────
    mqtt_client = BambuLabMQTT(device)
    connected = await loop.run_in_executor(None, lambda: mqtt_client.connect(wait_timeout=5.0))
    if not connected:
        _diag_add(sess, "MQTT-Verbindung", ["Verbindung FEHLGESCHLAGEN"], ok=False)
        _diag_finish(sess, "error")
        raise HTTPException(status_code=502, detail="MQTT-Verbindung zum Drucker fehlgeschlagen")
    _diag_add(sess, "MQTT-Verbindung", ["OK"])

    # ── AMS-Mapping bestimmen ────────────────────────────────────
    diag_mapping: list = []
    if use_ams:
        ams_mapping = _get_ams_mapping(file.file_path, file.file_type, ams_slot_override=ams_slot, diag=diag_mapping)
    else:
        ams_mapping = []
        diag_mapping.append("AMS deaktiviert (use_ams=False) — kein Mapping gesendet")
    _diag_add(sess, "AMS-Mapping bestimmen", diag_mapping)

    # ── FTP-Upload ───────────────────────────────────────────────
    ftp = BambuFTP(device.ip_address, device.access_code)
    upload_ok = await loop.run_in_executor(None, ftp.upload_file, file.file_path, print_name)
    if not upload_ok:
        mqtt_client.disconnect()
        _diag_add(sess, "FTP-Upload", [f"Dateiname: {print_name}", "FEHLGESCHLAGEN"], ok=False)
        _diag_finish(sess, "error")
        raise HTTPException(status_code=502, detail="FTP-Upload zum Drucker fehlgeschlagen")
    _diag_add(sess, "FTP-Upload", [f"Dateiname: {print_name}", "OK"])

    # ── Druckstart ───────────────────────────────────────────────
    await asyncio.sleep(3)
    plate_param = _get_plate_gcode_param(file.file_path) if file.file_type == '.3mf' else ""
    print_ok = await loop.run_in_executor(None, lambda: mqtt_client.start_print(print_name, use_ams=use_ams, ams_mapping=ams_mapping, plate_param=plate_param))
    await asyncio.sleep(2)
    mqtt_client.disconnect()

    _diag_add(sess, "MQTT-Befehl  project_file", [
        f"Dateiname:   {print_name}",
        f"ams_mapping: {ams_mapping}",
        f"use_ams:     {use_ams}",
        f"plate_param: {plate_param}",
        f"Ergebnis:    {'OK' if print_ok else 'FEHLGESCHLAGEN'}",
    ], ok=print_ok)
    _diag_finish(sess, "ok" if print_ok else "error")

    if not print_ok:
        raise HTTPException(status_code=502, detail="Druckstart fehlgeschlagen (project_file)")

    return {
        "success": True,
        "message": f"'{file.original_filename}' gestartet (AMS: {ams_mapping})",
        "device":      device.name,
        "file":        file.original_filename,
        "method":      "project_file",
        "ams_mapping": ams_mapping,
    }


@router.post("/gcode/{device_id}")
async def send_gcode(device_id: int, gcode: str, db: Session = Depends(get_db)):
    """Direkte GCode-Zeilen an den Drucker senden (kein Datei-Upload nötig)."""
    device = _get_bambu_device(device_id, db)
    loop = asyncio.get_event_loop()

    mqtt_client = BambuLabMQTT(device)
    connected = await loop.run_in_executor(None, lambda: mqtt_client.connect(wait_timeout=5.0))
    if not connected:
        raise HTTPException(status_code=502, detail="MQTT-Verbindung zum Drucker fehlgeschlagen")

    ok = await loop.run_in_executor(None, lambda: mqtt_client.send_gcode(gcode))
    await asyncio.sleep(2)
    response = mqtt_client.get_last_message()
    mqtt_client.disconnect()

    if not ok:
        raise HTTPException(status_code=502, detail="GCode konnte nicht gesendet werden")

    return {"success": True, "gcode": gcode, "printer_response": response}


# ── Live-Status-Cache aus dem Auto-Farm ──────────────────────────────────────
# Während die Farm druckt, hält sie EINE persistente MQTT-Verbindung und liest
# den Druckerstatus ohnehin laufend (autofarm._wait_print). Diese Funktion füttert
# das letzte Roh-Telegramm hier ein, sodass /status es ohne EIGENE (konkurrierende)
# MQTT-Verbindung ausliefern kann. Der X1C erlaubt nur wenige Verbindungen — so
# entfällt das 15-s-Poll-Connect der Steuerung, solange die Farm läuft.
_LIVE: dict = {"t": 0.0, "raw": None, "dev": None}
_LIVE_TTL = 35.0   # s — etwas über dem Standard-Poll (20 s) der Farm


def publish_live_status(raw: dict, device_id=None):
    """Vom Auto-Farm bei jedem Poll aufgerufen: letztes Drucker-Telegramm cachen."""
    if raw:
        _LIVE["t"] = time.monotonic()
        _LIVE["raw"] = raw
        _LIVE["dev"] = device_id


def _status_from_raw(raw: dict) -> dict:
    """Baut die /status-Antwort aus einem Roh-Telegramm (ohne MQTT/History)."""
    p = raw.get("print", {}) if raw else {}
    gcode_state = p.get("gcode_state", "IDLE")
    ams_units = []
    ams_data  = p.get("ams", {})
    tray_now  = 255
    if isinstance(ams_data, dict):
        try:
            tray_now = int(str(ams_data.get("tray_now", "255")))
        except (ValueError, TypeError):
            tray_now = 255
        for unit in (ams_data.get("ams") or []):
            slots = []
            for tray in (unit.get("tray") or []):
                slots.append({
                    "id":     int(tray.get("id", 0)),
                    "type":   tray.get("tray_type", ""),
                    "color":  tray.get("tray_color", ""),
                    "brand":  tray.get("tray_sub_brands") or tray.get("tray_id_name", ""),
                    "remain": tray.get("remain", -1),
                })
            ams_units.append({
                "id":       int(unit.get("id", 0)),
                "temp":     unit.get("temp", 0),
                "humidity": unit.get("humidity", 0),
                "slots":    slots,
            })
    return {
        "online":       True,
        "status":       gcode_state.lower(),
        "gcode_state":  gcode_state,
        "is_printing":  gcode_state == "RUNNING",
        "progress":     p.get("mc_percent", 0),
        "nozzle_temp":        p.get("nozzle_temper",        0),
        "nozzle_target_temp": p.get("nozzle_target_temper", 0),
        "bed_temp":           p.get("bed_temper",           0),
        "bed_target_temp":    p.get("bed_target_temper",    0),
        "remaining_min":      p.get("mc_remaining_time",    0),
        "subtask_name":       p.get("subtask_name",         ""),
        "ams_units":    ams_units,
        "tray_active":  tray_now,
        "raw": raw,
    }


@router.get("/status/{device_id}")
async def get_printer_status(device_id: int, db: Session = Depends(get_db)):
    """Druckerstatus. Solange die Farm druckt, aus deren persistenter Verbindung
    (live, ohne eigene MQTT-Verbindung); sonst frisch per MQTT abfragen."""
    device = _get_bambu_device(device_id, db)

    # Live-Daten aus dem Auto-Farm verwenden, wenn frisch und für DIESEN Drucker
    # (dev=None = unbekannt → akzeptieren) → keine zweite MQTT-Verbindung.
    if (_LIVE["raw"] is not None and (time.monotonic() - _LIVE["t"]) < _LIVE_TTL
            and _LIVE.get("dev") in (None, device_id)):
        resp = _status_from_raw(_LIVE["raw"])
        resp["source"] = "farm"
        return resp

    loop = asyncio.get_event_loop()
    mqtt_client = BambuLabMQTT(device)

    connected = await loop.run_in_executor(None, lambda: mqtt_client.connect(wait_timeout=5.0))
    if not connected:
        return {"status": "offline", "message": "Keine Verbindung zum Drucker", "online": False}

    await loop.run_in_executor(None, mqtt_client.request_status)
    await asyncio.sleep(1.5)

    raw = mqtt_client.get_last_message()
    mqtt_client.disconnect()

    p = raw.get("print", {}) if raw else {}
    gcode_state = p.get("gcode_state", "IDLE")

    # Log FINISH/FAILED events to print history
    if gcode_state in ("FINISH", "FAILED"):
        _append_history({
            "ts":         datetime.utcnow().isoformat(),
            "device":     device.name,
            "device_id":  device_id,
            "state":      gcode_state,
            "file":       p.get("subtask_name", ""),
            "progress":   p.get("mc_percent", 0),
            "layer":      p.get("layer_num", 0),
            "total_layers": p.get("total_layer_num", 0),
        })

    return _status_from_raw(raw)


@router.get("/send-diagnostics")
async def get_send_diagnostics():
    """Letzte Sende-Diagnose-Sessions zurückgeben."""
    return {"sessions": _diag_sessions}


@router.delete("/send-diagnostics")
async def clear_send_diagnostics():
    """Diagnose-Log zurücksetzen."""
    global _diag_sessions
    _diag_sessions = []
    _diag_save()
    return {"success": True}
