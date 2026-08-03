"""Reine Fächer-/Höhen-Logik der Regal-Planung — bewusst OHNE FastAPI-Importe,
damit sie lokal (ohne volle Backend-Umgebung) getestet werden kann.

Zwei Höhen-Grenzen, und der Unterschied ist der ganze Punkt:

  FREIE DECKE (`tolerance_mm`)
    Über dem Objekt ist noch kein Fachboden belegt. Dann darf es um die Toleranz
    über die Oberkante seines obersten Fachs ragen, bevor ein weiteres Fach
    reserviert wird. Konfigurierbar über `slot_tolerance_mm`.

  PLATTE DARÜBER (`stacked_pct`, Standard 50 %)
    Im Fach darüber liegt bereits eine Platte — Magazin, markierte Leerplatte oder
    ein eingelagerter Druck. Dann gilt nur noch ein Bruchteil der Fachhöhe.
    Grund: Die Platte fährt NICHT waagerecht auf ihre Endhöhe ein, sondern kommt
    ~25 mm höher herein und wird abgesenkt (ottoeject_motion.store_to_rack). Beim
    Herausholen wird sie genauso angehoben. Ein Objekt braucht während der Fahrt
    also deutlich mehr Luft als im Ruhezustand. Solange von unten nach oben
    gefüllt wird, ist das Fach darüber in diesem Moment noch leer und der Hub hat
    Platz — deshalb fällt es dort nicht auf. Über dem Magazin (das nie leer ist)
    und unter einem schon belegten Fach fällt es sofort auf.

MUSS konzeptionell mit frontend/src/services/rackUtils.js übereinstimmen.
"""
import math

DEFAULT_SLOT_TOLERANCE_MM = 20.0
DEFAULT_STACKED_PCT = 50.0


def stacked_pct_of(data: dict) -> float:
    """Nutzbarer Anteil der Fachhöhe, wenn oben schon eine Platte liegt (%)."""
    try:
        v = float((data or {}).get("slot_stacked_pct", DEFAULT_STACKED_PCT))
    except (TypeError, ValueError):
        return DEFAULT_STACKED_PCT
    return max(0.0, min(100.0, v))


def slots_needed(height_mm: float, slot_h: float,
                 tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM) -> int:
    """Wie viele Regal-Fächer ein Objekt dieser Höhe belegt (inkl. Toleranz)."""
    if not height_mm or height_mm <= 0:
        return 1
    return max(1, math.ceil((height_mm - tolerance_mm) / (slot_h or 50)))


def height_limit(needed: int, slot_h: float, tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM,
                 plate_above: bool = False,
                 stacked_pct: float = DEFAULT_STACKED_PCT) -> float:
    """Höchstes Objekt, das in `needed` Fächer passt — je nachdem, was oben liegt."""
    sh = float(slot_h or 50)
    if plate_above:
        return (needed - 1) * sh + sh * max(0.0, min(100.0, stacked_pct)) / 100.0
    return needed * sh + tolerance_mm


def slot_has_plate(rack: int, slot: int, slots: dict, magazine_slot: int = 0,
                   taken=None) -> bool:
    """Liegt in diesem Fach physisch eine Platte?

    Das Magazin zählt IMMER als belegt — auch wenn der Zähler gerade 0 ist. Es wird
    von Hand nachgefüllt, und zwar jederzeit; eine Höhe, die nur bei leerem Magazin
    passt, wäre beim nächsten Auffüllen falsch, ohne dass es jemand merkt.
    """
    if magazine_slot and int(slot) == int(magazine_slot):
        return True
    key = f"{rack}-{slot}"
    if taken and key in taken:
        return True              # ein anderer Job legt dort gleich ab
    s = (slots or {}).get(key)
    if not isinstance(s, dict):
        return False             # kein solches Fach → offene Luft über dem Regal
    if s.get("empty_plate"):
        return True              # markierte Leerplatte (Aufbau ohne Magazin)
    return s.get("status", "free") not in ("free", "ready")


def fits_below(height_mm: float, needed: int, plate_above: bool, slot_h: float,
               tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM,
               stacked_pct: float = DEFAULT_STACKED_PCT) -> bool:
    return (height_mm or 0) <= height_limit(needed, slot_h, tolerance_mm,
                                            plate_above, stacked_pct)


def is_blocked_from_below(rack: int, slot_num: int, slots: dict, slot_h: float,
                          tolerance_mm: float = DEFAULT_SLOT_TOLERANCE_MM,
                          stacked_pct: float = DEFAULT_STACKED_PCT) -> bool:
    """True, wenn ein eingelagertes Objekt aus einem tieferen Fach in dieses ragt.

    Zwei Fälle: es reicht direkt herein (mehr Fächer als Abstand) — oder es endet
    genau darunter und ist zu hoch dafür, dass hier noch eine Platte einfahren
    kann (siehe Modulkopf: die Platte kommt erhöht herein)."""
    for s in range(slot_num - 1, 0, -1):
        obj_h = (slots.get(f"{rack}-{s}") or {}).get("object_height_mm") or 0
        if obj_h <= 0:
            continue
        gap = slot_num - s
        needed = slots_needed(obj_h, slot_h, tolerance_mm)
        if needed > gap:
            return True
        if needed == gap and not fits_below(obj_h, needed, True, slot_h,
                                            tolerance_mm, stacked_pct):
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
