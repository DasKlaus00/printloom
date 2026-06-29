from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.services import storage

router = APIRouter()

CUSTOM_PATH = "/app/db/filaments_custom.json"

# ── Bambu Lab built-in catalog ─────────────────────────────────────────────
BUILTIN_CATALOG = [
    # PLA Basic
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "White", "color_hex": "#FFFFFF", "article": "AC-P01A01"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P01A02"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Grey", "color_hex": "#808080", "article": "AC-P01A03"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Red", "color_hex": "#D32F2F", "article": "AC-P01A04"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Blue", "color_hex": "#1565C0", "article": "AC-P01A05"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Green", "color_hex": "#2E7D32", "article": "AC-P01A06"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Yellow", "color_hex": "#F9A825", "article": "AC-P01A07"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Orange", "color_hex": "#E65100", "article": "AC-P01A08"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Pink", "color_hex": "#F48FB1", "article": "AC-P01A09"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Purple", "color_hex": "#6A1B9A", "article": "AC-P01A10"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Brown", "color_hex": "#5D4037", "article": "AC-P01A11"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Beige", "color_hex": "#D7C5A8", "article": "AC-P01A12"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Jade White", "color_hex": "#E8F5E9", "article": "AC-P01A13"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Ivory", "color_hex": "#FFFFF0", "article": "AC-P01A14"},
    # PLA Matte
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Charcoal", "color_hex": "#36454F", "article": "AC-P01B01"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "White", "color_hex": "#F5F5F5", "article": "AC-P01B02"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Black", "color_hex": "#212121", "article": "AC-P01B03"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Red", "color_hex": "#C62828", "article": "AC-P01B04"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Blue", "color_hex": "#1E3A5F", "article": "AC-P01B05"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Sage Green", "color_hex": "#8FAF8E", "article": "AC-P01B06"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Desert Tan", "color_hex": "#C8A97E", "article": "AC-P01B07"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Lemon Yellow", "color_hex": "#F6EF78", "article": "AC-P01B08"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Lilac Purple", "color_hex": "#B39DDB", "article": "AC-P01B09"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Terracotta", "color_hex": "#BE5832", "article": "AC-P01B10"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Cream White", "color_hex": "#FFF8E7", "article": "AC-P01B11"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Misty Grey", "color_hex": "#B0BEC5", "article": "AC-P01B12"},
    # PLA Silk
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Gold", "color_hex": "#FFD700", "article": "AC-P01C01"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Silver", "color_hex": "#C0C0C0", "article": "AC-P01C02"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Copper", "color_hex": "#B87333", "article": "AC-P01C03"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Rose Gold", "color_hex": "#B76E79", "article": "AC-P01C04"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Bronze", "color_hex": "#CD7F32", "article": "AC-P01C05"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Champagne Gold", "color_hex": "#F7E7CE", "article": "AC-P01C06"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Silk Blue", "color_hex": "#5C85D6", "article": "AC-P01C07"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Silk Green", "color_hex": "#4CAF50", "article": "AC-P01C08"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Silk Red", "color_hex": "#E53935", "article": "AC-P01C09"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Silk Purple", "color_hex": "#8E24AA", "article": "AC-P01C10"},
    # PLA Sparkle / Galaxy
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Galaxy Black", "color_hex": "#1C1C2E", "article": "AC-P01D01"},
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Starry Blue", "color_hex": "#283593", "article": "AC-P01D02"},
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Purple Galaxy", "color_hex": "#4A148C", "article": "AC-P01D03"},
    # PLA Basic (additional)
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Teal",         "color_hex": "#00897B", "article": "AC-P01A15"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Cyan",         "color_hex": "#00BCD4", "article": "AC-P01A16"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Magenta",      "color_hex": "#AD1457", "article": "AC-P01A17"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Cobalt Blue",  "color_hex": "#1A237E", "article": "AC-P01A18"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Forest Green", "color_hex": "#1B5E20", "article": "AC-P01A19"},
    {"brand": "Bambu Lab", "material": "PLA Basic", "name": "Coral",        "color_hex": "#FF7043", "article": "AC-P01A20"},
    # PLA Matte (additional)
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Pink",         "color_hex": "#F48FB1", "article": "AC-P01B13"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Orange",       "color_hex": "#EF6C00", "article": "AC-P01B14"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Teal",         "color_hex": "#4DB6AC", "article": "AC-P01B15"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Deep Blue",    "color_hex": "#0D1B4B", "article": "AC-P01B16"},
    {"brand": "Bambu Lab", "material": "PLA Matte", "name": "Moss Green",   "color_hex": "#4A5240", "article": "AC-P01B17"},
    # PLA Silk (additional)
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Emerald Green", "color_hex": "#2ECC71", "article": "AC-P01C11"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Pearl White",   "color_hex": "#F8F4EC", "article": "AC-P01C12"},
    {"brand": "Bambu Lab", "material": "PLA Silk", "name": "Teal",          "color_hex": "#00897B", "article": "AC-P01C13"},
    # PLA Sparkle (additional)
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Red Galaxy",    "color_hex": "#7B1FA2", "article": "AC-P01D04"},
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Gold Galaxy",   "color_hex": "#4E3A0C", "article": "AC-P01D05"},
    {"brand": "Bambu Lab", "material": "PLA Sparkle", "name": "Green Galaxy",  "color_hex": "#1B4332", "article": "AC-P01D06"},
    # PLA Marble (additional)
    {"brand": "Bambu Lab", "material": "PLA Marble", "name": "Grey Marble",    "color_hex": "#9E9E9E", "article": "AC-P01E04"},
    {"brand": "Bambu Lab", "material": "PLA Marble", "name": "Pink Marble",    "color_hex": "#F3E5E8", "article": "AC-P01E05"},
    # PLA Luminous (Glow in Dark)
    {"brand": "Bambu Lab", "material": "PLA Luminous", "name": "Green",   "color_hex": "#CCFF66", "article": "AC-P01F01"},
    {"brand": "Bambu Lab", "material": "PLA Luminous", "name": "Blue",    "color_hex": "#99CCFF", "article": "AC-P01F02"},
    {"brand": "Bambu Lab", "material": "PLA Luminous", "name": "Yellow",  "color_hex": "#FFFF99", "article": "AC-P01F03"},
    # PLA Marble
    {"brand": "Bambu Lab", "material": "PLA Marble", "name": "White Marble", "color_hex": "#F0EDE6", "article": "AC-P01E01"},
    {"brand": "Bambu Lab", "material": "PLA Marble", "name": "Black Marble", "color_hex": "#2C2C2C", "article": "AC-P01E02"},
    {"brand": "Bambu Lab", "material": "PLA Marble", "name": "Green Marble", "color_hex": "#3E5B45", "article": "AC-P01E03"},
    # PETG Basic
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "White", "color_hex": "#F8F8F8", "article": "AC-P02A01"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P02A02"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Grey", "color_hex": "#9E9E9E", "article": "AC-P02A03"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Red", "color_hex": "#D32F2F", "article": "AC-P02A04"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Blue", "color_hex": "#1565C0", "article": "AC-P02A05"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Transparent", "color_hex": "#E0F7FA", "article": "AC-P02A06"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Green", "color_hex": "#388E3C", "article": "AC-P02A07"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Yellow", "color_hex": "#FDD835", "article": "AC-P02A08"},
    # PETG Basic (additional)
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Orange",          "color_hex": "#EF6C00", "article": "AC-P02A09"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Pink",            "color_hex": "#F48FB1", "article": "AC-P02A10"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Purple",          "color_hex": "#6A1B9A", "article": "AC-P02A11"},
    {"brand": "Bambu Lab", "material": "PETG Basic", "name": "Translucent Blue","color_hex": "#B3D9F5", "article": "AC-P02A12"},
    # PETG HF
    {"brand": "Bambu Lab", "material": "PETG HF", "name": "White", "color_hex": "#F8F8F8", "article": "AC-P02B01"},
    {"brand": "Bambu Lab", "material": "PETG HF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P02B02"},
    {"brand": "Bambu Lab", "material": "PETG HF", "name": "Blue",  "color_hex": "#1565C0", "article": "AC-P02B03"},
    {"brand": "Bambu Lab", "material": "PETG HF", "name": "Grey",  "color_hex": "#9E9E9E", "article": "AC-P02B04"},
    {"brand": "Bambu Lab", "material": "PETG HF", "name": "Red",   "color_hex": "#D32F2F", "article": "AC-P02B05"},
    # ABS
    {"brand": "Bambu Lab", "material": "ABS", "name": "White",  "color_hex": "#FAFAFA", "article": "AC-P03A01"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Black",  "color_hex": "#212121", "article": "AC-P03A02"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Grey",   "color_hex": "#757575", "article": "AC-P03A03"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Red",    "color_hex": "#C62828", "article": "AC-P03A04"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Blue",   "color_hex": "#1565C0", "article": "AC-P03A05"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Yellow", "color_hex": "#F9A825", "article": "AC-P03A06"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Orange", "color_hex": "#E65100", "article": "AC-P03A07"},
    {"brand": "Bambu Lab", "material": "ABS", "name": "Green",  "color_hex": "#2E7D32", "article": "AC-P03A08"},
    # ASA
    {"brand": "Bambu Lab", "material": "ASA", "name": "White",  "color_hex": "#FAFAFA", "article": "AC-P04A01"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Black",  "color_hex": "#212121", "article": "AC-P04A02"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Grey",   "color_hex": "#9E9E9E", "article": "AC-P04A03"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Red",    "color_hex": "#C62828", "article": "AC-P04A04"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Blue",   "color_hex": "#1565C0", "article": "AC-P04A05"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Green",  "color_hex": "#2E7D32", "article": "AC-P04A06"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Yellow", "color_hex": "#F9A825", "article": "AC-P04A07"},
    {"brand": "Bambu Lab", "material": "ASA", "name": "Orange", "color_hex": "#E65100", "article": "AC-P04A08"},
    # TPU
    {"brand": "Bambu Lab", "material": "TPU 95A HF", "name": "White", "color_hex": "#F5F5F5", "article": "AC-P05A01"},
    {"brand": "Bambu Lab", "material": "TPU 95A HF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P05A02"},
    {"brand": "Bambu Lab", "material": "TPU 95A HF", "name": "Red", "color_hex": "#D32F2F", "article": "AC-P05A03"},
    {"brand": "Bambu Lab", "material": "TPU 95A HF", "name": "Blue", "color_hex": "#1565C0", "article": "AC-P05A04"},
    {"brand": "Bambu Lab", "material": "TPU 90A", "name": "White", "color_hex": "#F5F5F5", "article": "AC-P05B01"},
    {"brand": "Bambu Lab", "material": "TPU 90A", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P05B02"},
    # Engineering
    {"brand": "Bambu Lab", "material": "PA6-CF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P06A01"},
    {"brand": "Bambu Lab", "material": "PA-CF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P07A01"},
    {"brand": "Bambu Lab", "material": "PPA-CF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P08A01"},
    {"brand": "Bambu Lab", "material": "PPA-GF", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P09A01"},
    {"brand": "Bambu Lab", "material": "PC", "name": "White", "color_hex": "#F0F0F0", "article": "AC-P10A01"},
    {"brand": "Bambu Lab", "material": "PC", "name": "Black", "color_hex": "#1A1A1A", "article": "AC-P10A02"},
    {"brand": "Bambu Lab", "material": "PC", "name": "Transparent", "color_hex": "#D6EAF8", "article": "AC-P10A03"},
    # Support materials
    {"brand": "Bambu Lab", "material": "Support W", "name": "White", "color_hex": "#F5F5F5", "article": "AC-P11A01"},
    {"brand": "Bambu Lab", "material": "Support PLA", "name": "White", "color_hex": "#F8F8F8", "article": "AC-P12A01"},
    {"brand": "Bambu Lab", "material": "HIPS", "name": "White", "color_hex": "#FAFAFA", "article": "AC-P13A01"},
    {"brand": "Bambu Lab", "material": "PVA", "name": "Natural", "color_hex": "#E8DCC8", "article": "AC-P14A01"},
]


class CustomFilament(BaseModel):
    brand: str
    material: str
    name: str
    color_hex: str
    article: Optional[str] = ""


def _load_custom() -> list:
    return storage.read_json(CUSTOM_PATH, default=[])


def _save_custom(data: list):
    storage.write_json(CUSTOM_PATH, data)


def _key(material, color) -> tuple:
    """Eindeutigkeit pro Material + Farbe (Hex, 6-stellig, Groß)."""
    return (str(material or "").strip().upper(),
            str(color or "").replace("#", "").upper()[:6])


@router.get("/")
def list_filaments():
    # Kein eingebauter Katalog mehr — die Bibliothek besteht NUR aus dem, was aus dem
    # aktiven AMS gelernt oder manuell hinzugefügt wurde.
    return {
        "builtin": [],
        "custom": _load_custom(),
    }


class LearnPayload(BaseModel):
    slots: list = []   # [{type, color}] aus dem aktiven AMS


@router.post("/learn")
def learn_filaments(payload: LearnPayload):
    """Aus dem aktiven AMS lernen: jede neue Material+Farbe-Kombination der Bibliothek
    hinzufügen. Gibt die NEU hinzugefügten zurück (für die Notification „… hinzugefügt")."""
    custom = _load_custom()
    seen = {_key(c.get("material"), c.get("color_hex")) for c in custom}
    added = []
    for s in (payload.slots or []):
        mat = (s.get("type") or "").strip()
        col = (s.get("color") or "").strip()
        if not mat:
            continue
        k = _key(mat, col)
        if k in seen:
            continue
        seen.add(k)
        hexv = col if col.startswith("#") else (f"#{col}" if col else "")
        entry = {"brand": "AMS", "material": mat, "name": "", "color_hex": hexv[:7],
                 "article": "", "source": "ams"}
        custom.append(entry)
        added.append(entry)
    if added:
        _save_custom(custom)
    return {"added": added, "count": len(custom)}


@router.delete("/custom")
def clear_custom():
    """Alle Filamente löschen (Bibliothek leeren) — wird danach neu aus dem AMS gelernt."""
    _save_custom([])
    return {"success": True}


@router.post("/custom")
def add_custom(f: CustomFilament):
    custom = _load_custom()
    entry = f.model_dump()
    custom.append(entry)
    _save_custom(custom)
    return {"index": len(custom) - 1, "filament": entry}


@router.put("/custom/{idx}")
def update_custom(idx: int, f: CustomFilament):
    custom = _load_custom()
    if idx < 0 or idx >= len(custom):
        raise HTTPException(status_code=404, detail="Not found")
    custom[idx] = f.model_dump()
    _save_custom(custom)
    return {"index": idx, "filament": custom[idx]}


@router.delete("/custom/{idx}")
def delete_custom(idx: int):
    custom = _load_custom()
    if idx < 0 or idx >= len(custom):
        raise HTTPException(status_code=404, detail="Not found")
    removed = custom.pop(idx)
    _save_custom(custom)
    return {"removed": removed}
