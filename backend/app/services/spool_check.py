"""Spulen-Check: Reicht das Filament im AMS für diesen Druck?

Bambu meldet je Fach `remain` (Prozent; -1 = unbekannt, Spule ohne RFID) und
`tray_weight` (Gramm einer vollen Spule). Zusammen ergibt das die Restmenge. Welches
Fach ein Filament bekommt, entscheidet ams_match — dieselbe Wahl, die die Farm beim
Druckstart trifft. Der Check sagt also, was beim Drucken wirklich passieren würde.

Unbekannt bleibt unbekannt: fehlt die Restmenge oder der Verbrauch, heißt das
Ergebnis „unknown", nie „ok".
"""
from __future__ import annotations

from typing import Optional

from app.services import ams_match

# Reihenfolge = Schwere: das Schlimmste bestimmt den Gesamtzustand.
_SEVERITY = ("ok", "unknown", "short", "no_material")


def tray_label(gid: int) -> str:
    """Fach-Name wie am Drucker und in der Oberfläche: AMS 1 → A1–A4, AMS 2 → B1–B4."""
    gid = int(gid)
    return f"{chr(ord('A') + gid // 4)}{gid % 4 + 1}"


def _trays(ams_raw: dict) -> dict:
    out = {}
    for unit in ((ams_raw or {}).get("ams") or []):
        try:
            uid = int(unit.get("id", 0))
        except (TypeError, ValueError):
            continue
        for tray in (unit.get("tray") or []):
            try:
                out[uid * 4 + int(tray.get("id", 0))] = tray
            except (TypeError, ValueError):
                continue
    return out


def left_grams(tray: dict) -> Optional[float]:
    """Restmenge in Gramm, None wenn das AMS es nicht weiß."""
    remain = ams_match.tray_remain(tray or {})
    try:
        weight = float((tray or {}).get("tray_weight") or 0)
    except (TypeError, ValueError):
        weight = 0.0
    if remain < 0 or weight <= 0:
        return None
    return round(weight * remain / 100.0, 1)


def check(usage: list, ams_raw: dict, exact_only: bool = False) -> dict:
    """usage = print_file.filament_usage(...) → {state, items}.

    state: ok · unknown (Verbrauch oder Restmenge fehlt) · short (eine Spule reicht
    nicht) · no_material (kein passendes Material im AMS — die Farm würde pausieren).
    Ein Eintrag je benutztem Fach; teilen sich zwei Filamente ein Fach, zählt die Summe."""
    if not usage:
        return {"state": "unknown", "reason": "usage", "items": []}
    trays = _trays(ams_raw)
    if not trays:
        return {"state": "unknown", "reason": "ams", "items": [
            {"tray": None, "label": "", "type": u["type"], "color": u["color"],
             "need_g": u["grams"], "left_g": None, "remain_pct": None,
             "status": "unknown", "filaments": [u["slot"]]} for u in usage]}

    types = [u["type"] for u in usage]
    colors = [u["color"] for u in usage]
    mapping, missing = ams_match.match_confident(types, colors, ams_raw, exact_only)
    missing_idx = {m["index"] for m in missing}

    items, by_tray = [], {}
    for i, u in enumerate(usage):
        if i in missing_idx:
            items.append({"tray": None, "label": "", "type": u["type"], "color": u["color"],
                          "need_g": u["grams"], "left_g": None, "remain_pct": None,
                          "status": "no_material", "filaments": [u["slot"]]})
            continue
        gid = mapping[i]
        entry = by_tray.setdefault(gid, {"need": 0.0, "need_known": True, "slots": []})
        if u["grams"] is None:
            entry["need_known"] = False
        else:
            entry["need"] += u["grams"]
        entry["slots"].append(u["slot"])

    for gid, entry in by_tray.items():
        tray = trays.get(gid) or {}
        left = left_grams(tray)
        need = round(entry["need"], 1) if entry["need_known"] else None
        if need is None or left is None:
            status = "unknown"
        elif need > left:
            status = "short"
        else:
            status = "ok"
        remain = ams_match.tray_remain(tray)
        items.append({"tray": gid, "label": tray_label(gid),
                      "type": (tray.get("tray_type") or "").strip(),
                      "color": (tray.get("tray_color") or "").upper().lstrip("#")[:6],
                      "need_g": need, "left_g": left,
                      "remain_pct": remain if remain >= 0 else None,
                      "status": status, "filaments": entry["slots"]})

    state = max((it["status"] for it in items), key=_SEVERITY.index, default="unknown")
    return {"state": state, "items": items}
