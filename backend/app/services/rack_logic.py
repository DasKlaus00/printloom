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


# ── Woher kommt die nächste LEERE Platte? ────────────────────────────────────
# Zwei Aufbauten (Komponenten-Auswahl im Setup-Assistenten):
#
#   MIT MAGAZIN (magazine_slot z. B. 7)
#     Im obersten Fach liegt ein Stapel Leerplatten. Bestand je Regal = ein
#     ZÄHLER (`magazine_counts`) — einzelne Fächer spielen keine Rolle.
#
#   OHNE MAGAZIN (magazine_slot = 0, „alle Fächer = Lagerfächer")
#     Die leeren Platten liegen einzeln in normalen Fächern. Welches Fach eine
#     Platte hält, steht seit v1.0.163 am Fach selbst (`empty_plate: true`) —
#     der Nutzer markiert es in der Farm-Ansicht. Vorher wurde es aus dem
#     Zähler ERRATEN („Fächer 1..n sind belegt"), was nur stimmte, solange man
#     lückenlos von unten auffüllte. Der Zähler bleibt als Rückfall für
#     Bestände, die noch nicht migriert sind.
#
# Zwei Regeln, an denen die Mechanik hängt:
#   • Gegriffen wird von OBEN nach unten (höchstes markiertes Fach zuerst) —
#     sonst müsste der Arm über eine noch liegende Platte hinwegfahren.
#   • Ein markiertes Fach ist physisch BELEGT, obwohl sein Status „free" ist.
#     Es darf niemals Ablageziel werden, sonst landet ein fertiger Druck auf
#     einer liegenden Platte.

def magazine_slot_of(data: dict) -> int:
    """Konfiguriertes Magazin-Fach; 0 = KEIN Magazin."""
    try:
        return max(0, int((data or {}).get("magazine_slot", 7)))
    except (TypeError, ValueError):
        return 7


def _counts(data: dict) -> list:
    out = []
    for c in (data or {}).get("magazine_counts") or []:
        try:
            out.append(max(0, int(c)))
        except (TypeError, ValueError):
            out.append(0)
    return out


def uses_marks(data: dict) -> bool:
    """Sind die Fach-Markierungen maßgeblich (statt des alten Zählers)?

    Ja, sobald die Migration gelaufen ist (`empty_plates_migrated`) oder mindestens
    ein Fach markiert ist. WICHTIG: Es darf NICHT allein an „ist etwas markiert?"
    hängen — sonst würde nach dem Griff der letzten Platte wieder der Zähler gelten
    und Platten melden, die längst weg sind (die Farm griffe ins Leere).
    """
    if (data or {}).get("empty_plates_migrated"):
        return True
    return bool(marked_empty_plates(data))


def marked_empty_plates(data: dict) -> list:
    """Fächer mit markierter Leerplatte als [(rack, slot), …] — Regal aufsteigend,
    Fach ABSTEIGEND (oberstes zuerst = Greif-Reihenfolge)."""
    out = []
    for key, slot in ((data or {}).get("slots") or {}).items():
        if not isinstance(slot, dict) or not slot.get("empty_plate"):
            continue
        try:
            r, s = str(key).split("-")
            out.append((int(r), int(s)))
        except (ValueError, TypeError):
            continue
    out.sort(key=lambda rs: (rs[0], -rs[1]))
    return out


def empty_plate_count(data: dict) -> int:
    """Wie viele leere Platten liegen bereit? Mit Magazin die Summe der Zähler,
    ohne Magazin die Zahl der markierten Fächer (Rückfall: Zähler)."""
    if magazine_slot_of(data) > 0:
        return sum(_counts(data))
    if uses_marks(data):
        return len(marked_empty_plates(data))
    return sum(_counts(data))


def plate_source(data: dict) -> tuple:
    """→ (rack, slot, from_magazine) für den nächsten Griff einer LEEREN Platte."""
    mag = magazine_slot_of(data)
    counts = _counts(data)
    if mag > 0:
        for i, c in enumerate(counts):
            if c > 0:
                return i + 1, mag, True
        return 1, mag, True          # alle leer → R1 als neutraler Fallback

    if uses_marks(data):
        marked = marked_empty_plates(data)
        if marked:
            return marked[0][0], marked[0][1], False
        return 1, 1, False           # nichts markiert → Fach 1, nie Fach 0
    # Rückfall auf den Zähler (Bestand vor v1.0.163): Fach = Bestand, von oben.
    for i, c in enumerate(counts):
        if c > 0:
            return i + 1, max(1, c), False
    return 1, 1, False


def reserved_source_slots(data: dict) -> set:
    """Fächer, in denen (ohne Magazin) noch eine LEERE Platte liegt — nie Ablageziel."""
    if magazine_slot_of(data) > 0:
        return set()                 # mit Magazin sind alle normalen Fächer vergebbar
    if uses_marks(data):
        return {f"{r}-{s}" for r, s in marked_empty_plates(data)}
    reserved = set()                 # Rückfall: Zähler → Fächer 1..n
    for i, c in enumerate(_counts(data)):
        for s in range(1, c + 1):
            reserved.add(f"{i + 1}-{s}")
    return reserved


def free_slots_for_empty_plate(data: dict) -> list:
    """Fächer, in die eine leere Platte zurückgelegt werden KANN: nichts drin, nicht
    gesperrt, noch nicht markiert. Regal aufsteigend, Fach aufsteigend (unterstes
    zuerst — dort stapelt es sich nicht über eine liegende Platte)."""
    marked = {f"{r}-{s}" for r, s in marked_empty_plates(data)}
    out = []
    for key, slot in ((data or {}).get("slots") or {}).items():
        if key in marked or not isinstance(slot, dict):
            continue
        if slot.get("status", "free") != "free":
            continue
        try:
            r, s = str(key).split("-")
            out.append((int(r), int(s)))
        except (ValueError, TypeError):
            continue
    out.sort()
    return out
