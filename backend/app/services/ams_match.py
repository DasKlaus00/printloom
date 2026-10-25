"""AMS-Abgleich: welches Fach im AMS passt zu welchem Filament der Datei?

Regeln (seit v1.0.115 unverändert, hier nur an einem Ort zusammengezogen):
  • Nur gleiches Material — NIEMALS materialübergreifend (PETG mit PLA drucken
    ruiniert Druck und Düse). Fehlt das Material, wird nicht geraten.
  • Unter den passenden Fächern: exakte Farbe vor ähnlicher vor weit entfernter;
    innerhalb derselben Stufe die leerste Spule zuerst.
  • `remain` -1 heißt „unbekannt" (Spule ohne RFID), NICHT leer.
  • Der Drucker erwartet die Zuordnung je Slicer-Slot (Filament 3 → [-1, -1, Fach]).

Bis v1.1.34 lag das im Drucker-Router; Farm und Bibliothek holten es sich von dort.
"""
from __future__ import annotations

import logging

from app.paths import db_path
from app.services import print_file, storage

logger = logging.getLogger(__name__)

AMS_COLOR_THRESHOLD = 80    # mit frontend amsUtils.js abstimmen — Grenze „noch akzeptabel"
EXACT_COLOR_THRESHOLD = 40  # darunter gilt die Farbe als „exakt dieselbe"

# Je Datei vom Nutzer im Datei-Browser festgelegte Fächer: {file_id: "gid,gid"}.
FILE_AMSMAP_PATH = db_path("file_ams_map.json")


def file_map(file_id) -> str:
    """Manuelle AMS-Zuordnung einer Datei ("" = automatisch)."""
    try:
        return str(storage.read_json(FILE_AMSMAP_PATH, {}).get(str(file_id), "") or "")
    except Exception:
        return ""


def save_file_map(file_id, ams_map: str) -> None:
    data = storage.read_json(FILE_AMSMAP_PATH, {})
    if (ams_map or "").strip():
        data[str(file_id)] = ams_map.strip()
    else:
        data.pop(str(file_id), None)
    storage.write_json(FILE_AMSMAP_PATH, data)


def color_dist(hex1: str, hex2: str) -> float:
    """Euklidischer RGB-Abstand (0 = identisch)."""
    def _p(h):
        h = (h or "").lstrip('#').upper()
        if len(h) >= 8:
            h = h[:6]
        try:
            return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        except ValueError:
            return 128, 128, 128
    r1, g1, b1 = _p(hex1)
    r2, g2, b2 = _p(hex2)
    return ((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2) ** 0.5


def tray_remain(tray: dict) -> int:
    """Restmenge in Prozent; -1 = unbekannt (Fremdspulen ohne RFID)."""
    try:
        return int(tray.get('remain', -1))
    except (TypeError, ValueError):
        return -1


def color_tier(d: float) -> int:
    """0 = exakte Farbe, 1 = ähnlich (Ersatz), 2 = weit weg (Notnagel)."""
    if d <= EXACT_COLOR_THRESHOLD:
        return 0
    if d <= AMS_COLOR_THRESHOLD:
        return 1
    return 2


def slots_from_raw(ams_raw: dict) -> list:
    """Live-AMS-Status → [{gid, type, type_base, color, remain}], ohne leere Fächer.
    Geladen ist ein Fach, wenn es einen Materialtyp trägt — `remain` -1 ist kein „leer"."""
    slots = []
    for unit in ((ams_raw or {}).get('ams') or []):
        uid = int(unit.get('id', 0))
        for tray in (unit.get('tray') or []):
            stype = (tray.get('tray_type', '') or tray.get('tray_sub_brands', '') or '').upper().strip()
            if not stype:
                continue
            slots.append({'gid': uid * 4 + int(tray.get('id', 0)), 'type': stype,
                          'type_base': stype.split()[0],
                          'color': (tray.get('tray_color', '') or '').upper().lstrip('#'),
                          'remain': tray_remain(tray)})
    return slots


def _candidates(slots: list, ftype: str) -> list:
    fbase = ftype.upper().strip().split()[0] if ftype else ''
    return [s for s in slots if fbase and (
        fbase == s['type_base'] or fbase in s['type'] or
        (s['type_base'] and s['type_base'] in ftype.upper()))]


def pick_slot(candidates: list, fcolor_clean: str) -> dict:
    """Bestes Fach unter gleichen Materialien.

    Drei Farbstufen mit klarer Priorität: exakt (≤ EXACT_COLOR_THRESHOLD), ähnlich
    (≤ AMS_COLOR_THRESHOLD), weit weg. Eine EXAKTE Farbe schlägt IMMER eine nur
    ähnliche, selbst wenn die ähnliche Spule leerer ist. Erst INNERHALB derselben
    Stufe wird die leerste passende Spule zuerst aufgebraucht (unbekannt = zuletzt).
    In Stufe 2 zählt die nächste Farbe.
    """
    def _rem(s):
        r = s.get('remain', -1)
        return r if isinstance(r, int) and r >= 0 else 101

    def _key(s):
        d = color_dist(fcolor_clean, s['color']) if (fcolor_clean and s['color']) else 0.0
        tier = color_tier(d)
        return (tier, _rem(s) if tier < 2 else 0, d, s['gid'])
    return min(candidates, key=_key)


def match_live(types: list, colors: list, ams_raw: dict) -> list:
    """Je Filament (Typ + Farbe) das beste Fach aus dem Live-Status → ams_mapping
    (0-basiert, ein Eintrag je Filament). Ohne passendes Material: Position i
    (die Farm pausiert dann ohnehin über match_confident)."""
    slots = slots_from_raw(ams_raw)
    for s in slots:
        logger.info(f"  AMS slot {s['gid']}: {s['type']} #{s['color'][:6]} remain={s['remain']}")
    if not slots:
        logger.warning("No AMS slots — sequential fallback")
        return list(range(len(types)))

    mapping = []
    for i, (ftype, fcolor) in enumerate(zip(types, colors)):
        fcolor_clean = fcolor.lstrip('#').upper()
        candidates = _candidates(slots, ftype)
        if not candidates:
            logger.warning(f"  Filament {i}: {ftype} #{fcolor_clean[:6]} → KEIN passendes Material "
                           f"im AMS — kein Cross-Material-Mapping")
            mapping.append(i)
            continue
        best = pick_slot(candidates, fcolor_clean)
        logger.info(f"  Filament {i}: {ftype} #{fcolor_clean[:6]} → slot {best['gid']} "
                    f"({best['type']} #{best['color'][:6]} remain={best.get('remain')})")
        mapping.append(best['gid'])
    return mapping


def match_confident(types: list, colors: list, ams_raw: dict, exact_only: bool = False) -> tuple:
    """Hat jedes Filament ein brauchbares Fach? → (mapping, missing).

    Passend ist ein Fach mit gleichem Material; die nächste Farbe wird automatisch
    gewählt, Farbe blockiert nie. `missing` enthält nur Filamente OHNE passendes
    Material — oder alle, wenn das AMS nicht lesbar ist.
    `exact_only`: ein nur farbähnlicher Treffer zählt NICHT („keine exakte Farbe"),
    damit die Farm pausiert statt eine Ersatzfarbe zu drucken.
    """
    slots = slots_from_raw(ams_raw)
    mapping, missing = [], []
    for i, (ftype, fcolor) in enumerate(zip(types, colors)):
        fcolor_clean = fcolor.lstrip('#').upper()
        if not slots:
            missing.append({"index": i, "type": ftype, "color": fcolor, "reason": "AMS nicht lesbar"})
            mapping.append(0)
            continue
        candidates = _candidates(slots, ftype)
        if not candidates:
            missing.append({"index": i, "type": ftype, "color": fcolor,
                            "reason": "kein passendes Material im AMS"})
            mapping.append(slots[0]['gid'])
            continue
        best = pick_slot(candidates, fcolor_clean)
        if exact_only and fcolor_clean and best.get('color') and \
                color_dist(fcolor_clean, best['color']) > EXACT_COLOR_THRESHOLD:
            missing.append({"index": i, "type": ftype, "color": fcolor,
                            "reason": "keine exakte Farbe geladen"})
        mapping.append(best['gid'])
    return mapping, missing


def material_base(t: str) -> str:
    return (t or "").upper().strip().split()[0] if t else ""


def material_mismatch(types: list, ams_map_str: str, ams_raw: dict) -> str:
    """Sicherheitsnetz für MANUELLE Zuordnungen: kreuzt eine davon das Material
    (Datei PETG → Fach PLA)? → Klartext der Konflikte, '' wenn alles passt."""
    slots = {s["gid"]: s for s in slots_from_raw(ams_raw)}
    gids = [int(x.strip()) for x in str(ams_map_str).split(",") if x.strip().lstrip("-").isdigit()]
    bad = []
    for i, ftype in enumerate(types):
        if i >= len(gids):
            continue
        slot = slots.get(gids[i])
        if not slot:
            bad.append(f"Slot {gids[i]} leer/unbekannt")
            continue
        fb, sb = material_base(ftype), material_base(slot.get("type"))
        if fb and sb and fb != sb and fb not in (slot.get("type") or "").upper() \
                and sb not in (ftype or "").upper():
            bad.append(f"{ftype}→{slot.get('type')}")
    return ", ".join(bad)


def parse_manual(ams_map_str: str) -> list:
    """„3,-1,0" → [3, -1, 0]; Unlesbares fällt weg."""
    return [int(x.strip()) for x in str(ams_map_str or "").split(",") if x.strip().lstrip("-").isdigit()]


def expand_to_slots(mapping: list, filepath: str, file_type: str, plate: int | None = None) -> list:
    """Zuordnung „ein Eintrag je BENUTZTEM Filament" auf die Slicer-Slot-Positionen
    heben, die der Drucker erwartet: druckt eine Datei nur mit Filament 3, heißt das
    Mapping [-1, -1, Fach] — [Fach] allein ordnete Filament 1 zu und ließe
    Filament 3 leer („AMS-Zuordnung passt nicht" am Drucker). Unbenutzte = -1."""
    ids = print_file.used_filament_slot_ids(filepath, file_type, plate)
    if not ids or len(ids) != len(mapping) or min(ids) < 1 or max(ids) > 64 \
            or len(set(ids)) != len(ids):
        return mapping
    if ids == list(range(1, len(ids) + 1)):
        return mapping           # Filamente 1..n → schon positionsrichtig
    full = [-1] * max(ids)
    for slot_id, tray in zip(ids, mapping):
        full[slot_id - 1] = tray
    logger.info(f"ams_mapping auf Slicer-Slots {ids} gehoben: {mapping} → {full}")
    return full
