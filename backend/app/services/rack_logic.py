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


def tolerance_of(data: dict) -> float:
    """Konfigurierte Fächer-Toleranz (mm) aus der Regal-Config; Default 20."""
    try:
        return float((data or {}).get("slot_tolerance_mm", DEFAULT_SLOT_TOLERANCE_MM))
    except (TypeError, ValueError):
        return DEFAULT_SLOT_TOLERANCE_MM


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


def storable(height_mm: float, data: dict) -> dict:
    """Passt ein Objekt dieser Höhe überhaupt in EIN Regal? → {ok, slots_needed,
    max_height_mm}.

    Was maximal geht: alle Fächer eines Regals voll ausgenutzt — über dem obersten
    liegt aber das Magazin (falls vorhanden), dort gilt nur der Stapel-Anteil. Die
    Farm pausiert bei einem höheren Objekt („im Drucker lassen"); das OrcaSlicer-
    Plugin warnt schon beim Slicen. Beide fragen hier, damit sie gleich urteilen."""
    if is_compact(data):
        return compact_storable(height_mm, data)
    slot_h = float((data or {}).get("slot_height_mm", 50) or 50)
    spr = int((data or {}).get("slots_per_rack", 6) or 6)
    tol = tolerance_of(data)
    max_h = height_limit(spr, slot_h, tol,
                         plate_above=magazine_slot_of(data) > 0,
                         stacked_pct=stacked_pct_of(data))
    needed = slots_needed(height_mm, slot_h, tol)
    return {"ok": needed <= spr and (height_mm or 0) <= max_h,
            "slots_needed": needed, "max_height_mm": round(max_h, 1)}


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
    if is_compact(data):
        src = compact_plate_source(data)
        return (src[0], src[1], False) if src else (1, 1, False)
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


# ── Kompakt-Regal (seit v1.1.80) ─────────────────────────────────────────────
# Dichte Halterung (~16 mm von Fach zu Fach, ~24 Fächer je Regal), KEIN Magazin.
# Abläufe nach Alex (18.11.2026):
#
#   LEERE PLATTEN liegen im LETZTEN Regal (bei drei Regalen Regal 3), von unten
#     eingelegt; reicht es nicht, geht es im Regal davor weiter (compact_fill_order).
#     Gegriffen wird immer die OBERSTE leere Platte des höchsten Regals: Der Magnet
#     hebt die Platte zum Herausziehen an, darüber muss also frei sein.
#   FERTIGE DRUCKE füllen Regal 1 von OBEN nach unten, danach Regal 2, …
#     Abgelegt wird waagerecht (Vorderkante an den Regaleingang, auf Fachhöhe
#     hineinschieben). Ein Druck braucht deshalb nur seine Höhe plus eine kleine
#     Zugabe (compact_clearance_mm: Plattenstärke, Hub beim Tragen, Luft) — nicht
#     mehr den Einfahr-Hub des alten Ablaufs (siehe Modulkopf).
#   Es wird nur ANGEHÄNGT: Ein neuer Druck kommt direkt unter den untersten im Regal,
#     mit Platz für seine eigene Höhe darüber. Lücken werden nicht nachgefüllt: Beim
#     Ablegen senkt sich der Magnet unter die Fachhöhe, darunter muss frei sein.
#   Über dem obersten Fach ist es offen oder zu (compact_top_open). Offen: Der
#     erste Druck eines Regals darf beliebig hoch sein. Zu: Er muss in die Fächer passen.
#
# Ein Druck im Fach s mit der Höhe h reicht bis unter Fach s + span(h),
# span = ceil((h + Zugabe) / Fachabstand).

COMPACT = "compact"
DEFAULT_COMPACT_PITCH_MM = 16.0
DEFAULT_COMPACT_CLEARANCE_MM = 8.0


def is_compact(data) -> bool:
    return str((data or {}).get("rack_type") or "").strip().lower() == COMPACT


def compact_pitch(data) -> float:
    """Abstand von Fach zu Fach (mm). Beim Kompakt-Regal steht er in slot_height_mm —
    eine Zahl für Fachwahl und Anzeige; die Bewegung rechnet mit slot_gap + 30 in der
    Geometrie, beide schreibt die Einrichtung aus derselben Eingabe."""
    try:
        v = float((data or {}).get("slot_height_mm") or DEFAULT_COMPACT_PITCH_MM)
    except (TypeError, ValueError):
        return DEFAULT_COMPACT_PITCH_MM
    return v if v > 0 else DEFAULT_COMPACT_PITCH_MM


def compact_clearance(data) -> float:
    """Zugabe über dem Druck (mm): Plattenstärke + Hub beim Tragen + Luft."""
    try:
        v = float((data or {}).get("compact_clearance_mm", DEFAULT_COMPACT_CLEARANCE_MM))
    except (TypeError, ValueError):
        return DEFAULT_COMPACT_CLEARANCE_MM
    return max(0.0, v)


def compact_top_open(data) -> bool:
    """Ist über dem obersten Fach frei? Ohne Angabe: NEIN (unbekannt ist nicht offen)."""
    return bool((data or {}).get("compact_top_open", False))


def compact_span(height_mm, data) -> int:
    """Wie viele Fächer ein Druck nach oben belegt, sein eigenes mitgezählt."""
    try:
        h = float(height_mm or 0)
    except (TypeError, ValueError):
        h = 0.0
    if h <= 0:
        return 1
    # Runden vor dem Aufrunden: (24 + 8) / 16 darf nicht als 2,0000001 → 3 enden.
    return max(1, math.ceil(round((h + compact_clearance(data)) / compact_pitch(data), 6)))


def _compact_state(data: dict, rack: int, slot: int, taken) -> str:
    """'free' | 'empty' (leere Platte) | 'stored' (Druck, reserviert oder gesperrt)."""
    key = f"{rack}-{slot}"
    if taken and key in taken:
        return "stored"
    s = ((data or {}).get("slots") or {}).get(key)
    if not isinstance(s, dict):
        return "free"
    if s.get("empty_plate"):
        return "empty"
    if s.get("status", "free") not in ("free", "ready"):
        return "stored"          # auch „Gesperrt": Höhe unbekannt, nie überbauen
    return "free"


def _compact_target(data: dict, rack: int, span: int, taken) -> int | None:
    """Ablagefach in EINEM Regal oder None. Siehe Abschnittskopf."""
    spr = int((data or {}).get("slots_per_rack", 24) or 24)
    states = {s: _compact_state(data, rack, s, taken) for s in range(1, spr + 1)}
    stored = [s for s, st in states.items() if st == "stored"]
    if stored:
        s = min(stored) - span                # direkt unter den untersten Druck
    elif compact_top_open(data):
        s = spr                               # oben offen: oberstes Fach, beliebig hoch
    else:
        s = spr - span + 1                    # oben zu: muss in die Fächer passen
    if s < 1:
        return None
    # Der eigene Druck braucht s … s+span−1 (soweit es diese Fächer gibt).
    if any(states[t] != "free" for t in range(s, min(spr, s + span - 1) + 1)):
        return None
    # Darunter liegen höchstens noch leere Platten (Drucke liegen bei reinem Anhängen
    # alle darüber). Zwischen Druck und leerer Platte bleibt ein Fach frei: Der Magnet
    # senkt sich beim Ablegen unter die Fachhöhe, und die leere Platte muss sich
    # später noch zum Greifen anheben lassen.
    below = [t for t in range(1, s) if states[t] != "free"]
    if below and s - max(below) < 2:
        return None
    return s


def compact_store_slot(data: dict, height_mm, taken=None) -> str | None:
    """Ablagefach für einen fertigen Druck: Regal 1 zuerst, von oben nach unten."""
    span = compact_span(height_mm, data)
    nr = int((data or {}).get("num_racks", 3) or 3)
    for r in range(1, nr + 1):
        s = _compact_target(data, r, span, taken or set())
        if s:
            return f"{r}-{s}"
    return None


def compact_storable(height_mm, data: dict) -> dict:
    """Passt ein Druck dieser Höhe in ein Kompakt-Regal? Oben offen: immer (er liegt
    dann im obersten Fach eines leeren Regals) — max_height_mm ist dann None."""
    span = compact_span(height_mm, data)
    if compact_top_open(data):
        return {"ok": True, "slots_needed": span, "max_height_mm": None}
    spr = int((data or {}).get("slots_per_rack", 24) or 24)
    max_h = spr * compact_pitch(data) - compact_clearance(data)
    return {"ok": float(height_mm or 0) <= max_h, "slots_needed": span,
            "max_height_mm": round(max_h, 1)}


def compact_plate_source(data: dict) -> tuple | None:
    """Nächste LEERE Platte: oberste des höchsten Regals, das noch welche hat."""
    marks = marked_empty_plates(data)
    if not marks:
        return None
    return sorted(marks, key=lambda rs: (-rs[0], -rs[1]))[0]


def compact_fill_order(data: dict) -> list:
    """Wo leere Platten eingelegt werden, in dieser Reihenfolge: letztes Regal von
    unten nach oben, dann das Regal davor (bei 24 Fächern und 18 Platten:
    Regal 3, Fächer 1–18)."""
    nr = int((data or {}).get("num_racks", 3) or 3)
    spr = int((data or {}).get("slots_per_rack", 24) or 24)
    return [(r, s) for r in range(nr, 0, -1) for s in range(1, spr + 1)]
