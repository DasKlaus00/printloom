"""Plausibilitätsprüfung der OTTOeject-Geometrie — VOR der Bewegung, nicht mittendrin.

Warum: Die Geometrie (Drucker-Tab) nahm bisher jede Zahl an. Ein Tippfehler wie
X 4250 statt 425 fällt erst auf, wenn der Arm schon fährt: Klipper lehnt die
Bewegung dann mit „Move out of range" ab — MITTEN im Ablauf, womöglich mit einer
Platte im Greifer und einer Farm, die weiterlaufen will. Genau das verhindert
diese Prüfung: sie erzeugt den G-code aller Operationen (über alle Regale/Fächer),
liest JEDE Zielkoordinate heraus und meldet, was außerhalb der Achsen liegt.

Zwei Schweregrade:
  errors    Die Bewegung würde sicher abbrechen → wird gar nicht erst gesendet.
            • Koordinate unter 0 (der Endschalter ist immer 0 — gilt für JEDEN
              Aufbau, deshalb hart)
            • Koordinate über einer BEKANNTEN Achsgrenze (`machine_limits`,
              idealerweise per „Grenzen vom Gerät holen" von Klipper geholt)
            • strukturell unmögliche Werte (kein Fach-Schritt nach oben usw.)
  warnings  Auffällig, aber nicht beweisbar falsch → nur Hinweis. Darunter der
            Hinweis, dass die Achsgrenzen noch nicht bekannt sind: nach OBEN wird
            dann bewusst NICHT geprüft. Wer seine X-Schiene verlängert hat,
            arbeitet legitim jenseits des Standardaufbaus, und die mitgelieferte
            Klipper-Konfiguration muss nicht zu jedem Gerät passen — gegen geratene
            Zahlen zu warnen wäre nur Lärm. Einmal „Grenzen vom Gerät holen", und
            die Prüfung arbeitet mit den echten Werten.

Bewusst nicht geprüft: ob eine Position mechanisch sinnvoll ist (ein Y-Wert kann
innerhalb der Achse liegen und trotzdem ins Regal fahren). Das kann nur der
Nutzer einmessen — deshalb gibt es die Test-Knöpfe pro Position.
"""
from __future__ import annotations

import re

from app.services import ottoeject_motion as motion

AXES = ("x", "y", "z")

# Standard-OTTOeject: position_max aus der ausgelieferten Klipper-Konfiguration
# („Ottoeject config/config/printer.cfg"). NUR ein Vorschlag für die Eingabefelder —
# nie Prüfmaßstab: die X-Schiene wird je Aufbau verlängert, und ob diese Werte zum
# Gerät des Nutzers passen, weiß nur das Gerät selbst (siehe limits_from_toolhead).
STANDARD_LIMITS = {"x": 485.0, "y": 340.0, "z": 365.0}

_MOVE_RE = re.compile(r"^\s*G[0-3]\b", re.IGNORECASE)
_COORD_RE = re.compile(r"\b([XYZ])\s*(-?\d+(?:\.\d+)?)", re.IGNORECASE)

_OP_LABELS = {o["key"]: o["label_de"] for o in motion.APP_OPS}
_OP_LABELS.update({"approach": "Fach anfahren", "park": "Parken", "home": "Referenzfahrt",
                   "load": "Einlegen", "move": "Vor Drucker fahren"})

# Operationen, die ein Fach brauchen (werden für mehrere Regale/Fächer geprüft).
_SLOT_OPS = {o["key"] for o in motion.APP_OPS if o["rack_slot"]} | {"approach"}

# Beim Rundum-Check genau EINMAL je echter Operation — ohne die Alias-Namen
# („load"/„move"), die denselben G-code erzeugen, und ohne „home" (Geräte-Macro).
_CHECK_OPS = tuple(o["key"] for o in motion.APP_OPS) + ("approach", "park")


class GeometryError(ValueError):
    """Geometrie würde die Achse verlassen — Bewegung wird nicht gesendet.
    `problems` enthält die Einzelmeldungen (siehe `check_op`)."""

    def __init__(self, problems: list):
        self.problems = problems or []
        super().__init__(" · ".join(p["message"] for p in self.problems[:3])
                         or "Geometrie außerhalb der Achsgrenzen")


# ── Achsgrenzen ──────────────────────────────────────────────────────────────
def limits_from(g: dict) -> dict:
    """Gespeicherte Achsgrenzen: {"x": mm|None, …}. None = unbekannt (nicht 0!) —
    dann wird nach oben nur gewarnt, nie blockiert."""
    raw = (g or {}).get("machine_limits")
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for a in AXES:
        try:
            v = float(raw.get(a))
        except (TypeError, ValueError):
            v = 0.0
        out[a] = v if v > 0 else None
    return out


def limits_known(limits: dict) -> bool:
    return all(limits.get(a) for a in AXES)


# ── G-code lesen ─────────────────────────────────────────────────────────────
def script_coords(script) -> list:
    """Alle Zielkoordinaten eines G-code-Blocks: [(achse, wert), …].

    Nur Bewegungsbefehle (G0–G3). Bei Bögen (G2/G3) werden Start-/Zielpunkt
    geprüft, nicht der Bogenverlauf — I/J sind relative Mittelpunkte, kein Ziel.
    """
    lines = script if isinstance(script, list) else str(script or "").splitlines()
    out = []
    for line in lines:
        if not _MOVE_RE.match(line or ""):
            continue
        for axis, val in _COORD_RE.findall(line):
            try:
                out.append((axis.lower(), float(val)))
            except ValueError:
                continue
    return out


def _axis_problems(script, limits: dict, ctx: dict) -> list:
    """Koordinaten eines Scripts gegen die Achsgrenzen prüfen. Pro Achse und Richtung
    nur EINE Meldung — mit dem schlimmsten Wert, sonst wären es hunderte."""
    worst = {}      # (achse, art) -> wert
    for axis, val in script_coords(script):
        known = limits.get(axis)
        if val < 0:
            kind = "below_zero"
        elif known is not None and val > known:
            kind = "above_limit"
        else:
            # Ohne bekannte Achsgrenze wird nach oben NICHT geprüft (siehe Modulkopf).
            continue
        key = (axis, kind)
        prev = worst.get(key)
        if prev is None or (val < prev if kind == "below_zero" else val > prev):
            worst[key] = val

    where = _where(ctx)
    out = []
    for (axis, kind), val in sorted(worst.items()):
        A = axis.upper()
        if kind == "below_zero":
            out.append({
                "code": "axis_below_zero", "severity": "error", "axis": axis, "value": val,
                "limit": 0.0, **ctx,
                "message": f"{where} fährt auf {A} {val:g} mm — unter den Endschalter (0 mm). "
                           f"Klipper würde die Bewegung mitten im Ablauf abbrechen.",
            })
        else:
            lim = limits[axis]
            out.append({
                "code": "axis_above_limit", "severity": "error", "axis": axis, "value": val,
                "limit": lim, **ctx,
                "message": f"{where} fährt auf {A} {val:g} mm — über die Achsgrenze "
                           f"{A} {lim:g} mm. Klipper würde die Bewegung abbrechen.",
            })
    return out


def _where(ctx: dict) -> str:
    label = _OP_LABELS.get(ctx.get("op"), ctx.get("op") or "Bewegung")
    if ctx.get("slot"):
        return f"Regal {ctx.get('rack', 1)} Fach {ctx['slot']}: „{label}\""
    return f"„{label}\""


# ── Einzelne Operation (Gate vor dem Senden) ─────────────────────────────────
def check_script(script, g: dict, op: str, rack: int = 1, slot: int = 1) -> list:
    """Fertigen G-code gegen die Achsgrenzen prüfen → Liste von Problemen (leer = ok).
    Das ist der Einstieg für das Gate in build_op (dort liegt der G-code schon vor)."""
    ctx = {"op": op}
    if op in _SLOT_OPS:
        ctx.update({"rack": int(rack or 1), "slot": int(slot or 1)})
    return _axis_problems(script, limits_from(g), ctx)


def check_op(g: dict, op: str, rack: int = 1, slot: int = 1, nolift=None) -> list:
    """Nur die Achsgrenzen EINER Operation prüfen → Liste von Problemen (leer = ok).
    Wird von build_op benutzt, deshalb hier bewusst ohne Struktur-Prüfung: schnell
    und ohne Rekursion."""
    try:
        script = motion.build_op(g, op, rack=rack, slot=slot, nolift=nolift, check=False)
    except ValueError:
        return []       # unbekannte Op o. Ä. — meldet build_op selbst
    return check_script(script, g, op, rack, slot)


# ── Ganze Geometrie (Speichern / Anzeige) ────────────────────────────────────
def _structure_problems(g: dict) -> list:
    """Werte, die für sich schon unmöglich sind — unabhängig von den Achsgrenzen."""
    out = []
    s = g.get("storage") or {}

    def _f(v, d=0.0):
        try:
            return float(v)
        except (TypeError, ValueError):
            return d

    racks = int(_f(g.get("racks"), 1) or 1)
    slots = int(_f(g.get("storage_slots"), 0))
    step = _f(s.get("slot_gap")) + motion.SLOT_Z_EXTRA
    gap = _f(s.get("rack_x_gap"))

    if racks < 1:
        out.append({"code": "no_racks", "severity": "error",
                    "message": "Regalzahl ist kleiner als 1 — mindestens ein Regal wird gebraucht."})
    if slots < 1:
        out.append({"code": "no_slots", "severity": "error",
                    "message": "Fächer pro Regal ist kleiner als 1."})
    if step <= 0:
        out.append({"code": "no_slot_step", "severity": "error",
                    "message": f"Fach-Abstand ergibt keinen Schritt nach oben "
                               f"({step:g} mm) — alle Fächer lägen auf derselben Höhe. "
                               f"Gemessener Abstand von Fach zu Fach muss über "
                               f"{motion.SLOT_Z_EXTRA} mm liegen."})
    if racks > 1 and gap <= 0:
        out.append({"code": "no_rack_gap", "severity": "error",
                    "message": "Regal-Abstand ist 0 — bei mehreren Regalen lägen alle "
                               "an derselben X-Position."})
    y_engage, y_pull = _f(s.get("y_engage")), _f(s.get("y_pullback_limit"))
    if y_engage <= y_pull:
        out.append({"code": "y_engage_behind_pullback", "severity": "error",
                    "message": f"Greif-Y ({y_engage:g} mm) liegt nicht vor der "
                               f"Rückzugsposition ({y_pull:g} mm) — der Arm würde beim "
                               f"Greifen nach hinten statt nach vorn fahren."})
    mag = motion.magazine_slot(g)
    if slots and mag > slots + 1:
        out.append({"code": "magazine_above_rack", "severity": "warning",
                    "message": f"Magazin-Fach {mag} liegt über dem letzten Fach "
                               f"({slots} Lagerfächer + 1) — prüfe die Regal-Konfiguration."})
    if _f(g.get("clamp_push_mm"), 30) < 0:
        out.append({"code": "negative_clamp_push", "severity": "warning",
                    "message": "Klemm-Andruck ist negativ — der Arm drückt dann in die "
                               "falsche Richtung. 0 = ohne Andruck."})
    return out


def check_geometry(g: dict, *, max_problems: int = 40) -> dict:
    """Ganze Geometrie prüfen: Struktur + alle Operationen über alle Regale und die
    Randfächer (erstes, letztes, Magazin — dort liegen die Extremwerte).

    → {ok, errors, warnings, limits, limits_known}
    """
    g = motion.merge_defaults(g or {})
    limits = limits_from(g)
    problems = _structure_problems(g)

    racks = max(1, min(20, int(_int(g.get("racks"), 1))))
    slots = max(1, min(40, int(_int(g.get("storage_slots"), 6))))
    mag = motion.magazine_slot(g)

    for op in _CHECK_OPS:
        if op in _SLOT_OPS:
            for rack in range(1, racks + 1):
                for slot in _test_slots(op, slots, mag):
                    problems += check_op(g, op, rack=rack, slot=slot)
        else:
            problems += check_op(g, op)
        if len(problems) > max_problems * 4:
            break       # Notbremse: bei völlig kaputter Geometrie nicht endlos sammeln

    problems = _dedupe(problems)[:max_problems]
    known = limits_known(limits)
    if not known:
        missing = ", ".join(a.upper() for a in AXES if not limits.get(a))
        problems.append({
            "code": "limits_unknown", "severity": "warning",
            "message": f"Achsgrenzen unbekannt ({missing}) — es wird nur geprüft, ob eine "
                       f"Bewegung unter 0 mm fährt. Einmal „Grenzen vom Gerät holen\", dann "
                       f"warnt Printloom auch, wenn eine Position über die Achse hinausgeht.",
        })
    errors = [p for p in problems if p.get("severity") == "error"]
    warnings = [p for p in problems if p.get("severity") != "error"]
    return {"ok": not errors, "errors": errors, "warnings": warnings,
            "limits": limits, "limits_known": known,
            "standard": dict(STANDARD_LIMITS)}


def _test_slots(op: str, slots: int, mag: int) -> list:
    """Welche Fächer eine Op wirklich anfährt — dort liegen die Extremwerte.
    Nur erstes und letztes Fach (Z-Extreme) plus, wo passend, das Magazin.
    Wichtig: „Platte ablegen" NIE für das Magazin-Fach prüfen — das Magazin ist
    reine Quelle für Leerplatten, es wird nie etwas hineingelegt. Sonst käme eine
    Fehlmeldung für eine Bewegung, die es im Betrieb gar nicht gibt."""
    if op == "grab_magazine":
        return [mag if mag > 0 else slots]
    base = sorted({1, max(1, slots)})
    if op == "store":
        return base
    return sorted(set(base) | ({mag} if mag > 0 else set()))


def _int(v, d=0):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return d


def _dedupe(problems: list) -> list:
    """Dieselbe Ursache über viele Regale/Fächer → EINE Meldung (die mit dem
    schlimmsten Wert). Sonst wäre die Anzeige bei 10 Regalen unlesbar."""
    best = {}
    order = []
    for p in problems:
        key = (p.get("code"), p.get("axis"), p.get("op"))
        cur = best.get(key)
        if cur is None:
            best[key] = p
            order.append(key)
            continue
        a, b = abs(p.get("value") or 0), abs(cur.get("value") or 0)
        if a > b:
            best[key] = p
    errors_first = sorted(order, key=lambda k: 0 if best[k].get("severity") == "error" else 1)
    return [best[k] for k in errors_first]


# ── Achsgrenzen vom Gerät ────────────────────────────────────────────────────
def limits_from_toolhead(toolhead: dict) -> dict:
    """Klipper-Antwort (`printer.objects.query` → toolhead) in unsere Grenzen
    übersetzen: axis_maximum = [x, y, z, e]."""
    axis_max = (toolhead or {}).get("axis_maximum")
    if not isinstance(axis_max, (list, tuple)) or len(axis_max) < 3:
        return {}
    out = {}
    for i, a in enumerate(AXES):
        try:
            v = float(axis_max[i])
        except (TypeError, ValueError):
            continue
        if v > 0:
            out[a] = round(v, 3)
    return out
