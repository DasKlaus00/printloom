"""Reine Fächer-/Höhen-Logik der Regal-Planung — bewusst OHNE FastAPI-Importe,
damit sie lokal (ohne volle Backend-Umgebung) getestet werden kann.

Toleranz (`tolerance_mm`): ein Objekt darf so viele mm über die Oberkante seines
obersten Fachs ragen, bevor ein weiteres Fach reserviert wird. Konfigurierbar
über die Regal-Einstellung `slot_tolerance_mm`; Default = DEFAULT_SLOT_TOLERANCE_MM.
MUSS konzeptionell mit frontend/src/services/rackUtils.js übereinstimmen.
"""
import math

DEFAULT_SLOT_TOLERANCE_MM = 20.0


def slots_needed(height_mm: float, slot_h: float,
                 tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM) -> int:
    """Wie viele Regal-Fächer ein Objekt dieser Höhe belegt (inkl. Toleranz)."""
    if not height_mm or height_mm <= 0:
        return 1
    return max(1, math.ceil((height_mm - tolerance_mm) / (slot_h or 50)))


def is_blocked_from_below(rack: int, slot_num: int, slots: dict, slot_h: float,
                          tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM) -> bool:
    """True, wenn ein eingelagertes Objekt aus einem tieferen Fach in dieses ragt."""
    for s in range(slot_num - 1, 0, -1):
        obj_h = (slots.get(f"{rack}-{s}") or {}).get("object_height_mm") or 0
        if obj_h <= 0:
            continue
        if slots_needed(obj_h, slot_h, tolerance_mm) > (slot_num - s):
            return True
    return False
