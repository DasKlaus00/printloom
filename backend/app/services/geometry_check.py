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


def _fmt(template: str, params) -> str:
    out = template
    for i, p in enumerate(params):
        out = out.replace("{%d}" % i, str(p))
    return out


def problem(code: str, severity: str, template: str, params=(), **extra) -> dict:
    """Eine Meldung als VORLAGE + WERTE, nicht als fertiger Satz.

    Das Backend kennt die eingestellte Sprache nicht — die steht im Browser. Ein
    hier zusammengebauter deutscher Satz bliebe deshalb in jeder Sprache deutsch.
    Also wandert die Vorlage (mit {0}, {1} …) samt Werten mit; die Oberfläche
    übersetzt sie über dieselbe tr()-Tabelle wie ihre eigenen Texte.
    `message` bleibt der fertige deutsche Satz — für Logs und ältere Clients.
    Werte, die selbst Text sind (z. B. ein Operations-Name), sind ebenfalls
    Übersetzungs-Schlüssel; die Oberfläche schickt sie noch einmal durch tr().
    """
    params = list(params)
    return {"code": code, "severity": severity, "template": template,
            "params": params, "message": _fmt(template, params), **extra}


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

    out = []
    ctx = dict(ctx)
    pname = ctx.pop("printer_name", None)
    for (axis, kind), val in sorted(worst.items()):
        A = axis.upper()
        # Der Ort („Regal 2 Fach 5: ‚Auswerfen'") steckt als Werte in der Vorlage,
        # nicht als vorgefertigter Textbaustein — sonst bliebe er unübersetzbar.
        label = _OP_LABELS.get(ctx.get("op"), ctx.get("op") or "Bewegung")
        in_slot = bool(ctx.get("slot"))
        # Bei mehreren Druckern muss dabeistehen, WELCHER gemeint ist — sonst sucht
        # man den Fehler am falschen Gerät.
        head = ([ctx.get("rack", 1), ctx["slot"], label] if in_slot
                else [label, pname] if pname else [label])
        if kind == "below_zero":
            tpl = ("Regal {0} Fach {1}: „{2}“ fährt auf {3} {4} mm — unter den Endschalter "
                   "(0 mm). Klipper würde die Bewegung mitten im Ablauf abbrechen."
                   if in_slot else
                   "„{0}“ ({1}) fährt auf {2} {3} mm — unter den Endschalter (0 mm). "
                   "Klipper würde die Bewegung mitten im Ablauf abbrechen."
                   if pname else
                   "„{0}“ fährt auf {1} {2} mm — unter den Endschalter (0 mm). "
                   "Klipper würde die Bewegung mitten im Ablauf abbrechen.")
            out.append(problem("axis_below_zero", "error", tpl,
                               head + [A, f"{val:g}"],
                               axis=axis, value=val, limit=0.0, **ctx))
        else:
            lim = limits[axis]
            tpl = ("Regal {0} Fach {1}: „{2}“ fährt auf {3} {4} mm — über die Achsgrenze "
                   "{5} {6} mm. Klipper würde die Bewegung abbrechen."
                   if in_slot else
                   "„{0}“ ({1}) fährt auf {2} {3} mm — über die Achsgrenze {4} {5} mm. "
                   "Klipper würde die Bewegung abbrechen."
                   if pname else
                   "„{0}“ fährt auf {1} {2} mm — über die Achsgrenze {3} {4} mm. "
                   "Klipper würde die Bewegung abbrechen.")
            out.append(problem("axis_above_limit", "error", tpl,
                               head + [A, f"{val:g}", A, f"{lim:g}"],
                               axis=axis, value=val, limit=lim, **ctx))
    return out


# ── Einzelne Operation (Gate vor dem Senden) ─────────────────────────────────
def check_script(script, g: dict, op: str, rack: int = 1, slot: int = 1, printer=None) -> list:
    """Fertigen G-code gegen die Achsgrenzen prüfen → Liste von Problemen (leer = ok).
    Das ist der Einstieg für das Gate in build_op (dort liegt der G-code schon vor)."""
    ctx = {"op": op}
    if op in _SLOT_OPS:
        ctx.update({"rack": int(rack or 1), "slot": int(slot or 1)})
    elif motion.canon_op(op) in motion.PRINTER_OPS:
        pl = motion.printer_list(g)
        if len(pl) > 1:      # bei einem Drucker wäre der Name nur Lärm
            pb = motion.printer_block(g, printer)
            ctx.update({"printer": pb["id"], "printer_name": pb["name"]})
    return _axis_problems(script, limits_from(g), ctx)


def check_op(g: dict, op: str, rack: int = 1, slot: int = 1, nolift=None,
             printer=None) -> list:
    """Nur die Achsgrenzen EINER Operation prüfen → Liste von Problemen (leer = ok).
    Wird von build_op benutzt, deshalb hier bewusst ohne Struktur-Prüfung: schnell
    und ohne Rekursion."""
    try:
        script = motion.build_op(g, op, rack=rack, slot=slot, nolift=nolift,
                                 check=False, printer=printer)
    except ValueError:
        return []       # unbekannte Op o. Ä. — meldet build_op selbst
    return check_script(script, g, op, rack, slot, printer)


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
    multi = racks > 1

    if racks < 1:
        out.append(problem("no_racks", "error",
                           "Regalzahl ist kleiner als 1 — mindestens ein Regal wird gebraucht."))
    if slots < 1:
        out.append(problem("no_slots", "error", "Fächer pro Regal ist kleiner als 1."))

    # Werte JE REGAL prüfen: seit v1.1.9 darf jedes Regal eigene Höhen und Abstände
    # haben, also reicht ein Blick auf die gemeinsamen Werte nicht mehr.
    y_pull = _f(s.get("y_pullback_limit"))
    seen_x = {}
    for r in range(1, max(1, racks) + 1):
        try:
            rb = motion.rack_block(g, r)
        except (KeyError, TypeError, ValueError):
            continue
        step = rb["slot_gap"] + motion.SLOT_Z_EXTRA
        if step <= 0:
            out.append(problem(
                "no_slot_step", "error",
                ("Regal {2}: Fach-Abstand ergibt keinen Schritt nach oben ({0} mm) — alle "
                 "Fächer lägen auf derselben Höhe. Gemessener Abstand von Fach zu Fach muss "
                 "über {1} mm liegen."
                 if multi else
                 "Fach-Abstand ergibt keinen Schritt nach oben ({0} mm) — alle Fächer "
                 "lägen auf derselben Höhe. Gemessener Abstand von Fach zu Fach muss "
                 "über {1} mm liegen."),
                [f"{step:g}", motion.SLOT_Z_EXTRA] + ([r] if multi else []), rack=r))
        if rb["y_engage"] <= y_pull:
            out.append(problem(
                "y_engage_behind_pullback", "error",
                ("Regal {2}: Greif-Y ({0} mm) liegt nicht vor der Rückzugsposition ({1} mm) — "
                 "der Arm würde beim Greifen nach hinten statt nach vorn fahren."
                 if multi else
                 "Greif-Y ({0} mm) liegt nicht vor der Rückzugsposition ({1} mm) — der "
                 "Arm würde beim Greifen nach hinten statt nach vorn fahren."),
                [f"{rb['y_engage']:g}", f"{y_pull:g}"] + ([r] if multi else []), rack=r))
        key = round(rb["x"], 2)
        if key in seen_x:
            out.append(problem(
                "no_rack_gap", "error",
                "Regal {0} und Regal {1} stehen beide bei X {2} mm — zwei Regale können "
                "nicht an derselben Stelle stehen.",
                [seen_x[key], r, f"{key:g}"], rack=r))
        else:
            seen_x[key] = r
    mag = motion.magazine_slot(g)
    if slots and mag > slots + 1:
        out.append(problem("magazine_above_rack", "warning",
                           "Magazin-Fach {0} liegt über dem letzten Fach ({1} Lagerfächer + 1) — "
                           "prüfe die Regal-Konfiguration.",
                           [mag, slots]))
    push = _f(g.get("clamp_push_mm"), 30)
    # Der Magnet-Greifer fährt beim Greifen und Ablegen NICHT mehr in X — der
    # Andruck-Weg gilt dort nur noch für Auswurf/Einlegen am Drucker. Ohne diese
    # Unterscheidung meldete die Prüfung „Regal steht zu dicht am Endschalter" für
    # eine Bewegung, die es gar nicht mehr gibt.
    magnet = motion.gripper_motion(g) == "magnet"
    if push < 0:
        out.append(problem("negative_clamp_push", "warning",
                           "Klemm-Andruck ist negativ — der Arm drückt dann in die falsche "
                           "Richtung. 0 = ohne Andruck."))
    elif push == 0:
        # Der Andruck IST der Griff: Greifen/Ablegen fahren nach dem Eintauchen um
        # diesen Weg in X, damit der Greifer in die Halterung der Platte einhakt
        # (siehe grab_from_rack: „G1 X{x_unclamp − push}"). Bei 0 zielt diese Zeile
        # auf die Position, an der der Arm schon steht — sie bewegt nichts. Der Arm
        # fährt dann vor, hebt an und kommt LEER zurück, ohne Fehlermeldung.
        # Nur melden, wenn die gebaute Bewegung überhaupt benutzt wird (mit eigenem
        # G-code für alle vier Griff-Operationen ist der Wert bedeutungslos).
        rack_ops = () if magnet else ("grab", "store")
        built_in = [o for o in rack_ops + ("eject", "place")
                    if not str(motion.op_override(g, o) or "").strip()]
        if built_in:
            out.append(problem(
                "no_clamp_push", "warning",
                "Andruck-Weg ist 0 — dann fährt der Arm beim Greifen und Ablegen nicht in "
                "die Halterung, der Greifer hakt nicht ein und die Platte bleibt liegen "
                "(der Arm kommt leer zurück). Original: 30 mm."))

    # Andruck-Weg braucht PLATZ. Greifen/Ablegen fahren um diesen Weg Richtung
    # Endschalter (−), Auswerfen/Einlegen vom Endschalter weg (+). Steht ein Regal
    # zu dicht am Nullpunkt, ist die Griff-Bewegung unmöglich — die Achsprüfung
    # meldet dann zwar „X −25 mm", sagt aber nicht WARUM. Diese Meldung schon:
    # sie nennt den nötigen Mindestabstand. Genau das war der Fall, in dem
    # „Anfahren" ging (keine Andruck-Bewegung) und „Greifen" nicht.
    if push > 0:
        limits = limits_from(g)
        # Regale nur beim KLEMM-Greifer prüfen: nur er fährt dort in X.
        for r in (() if magnet else range(1, max(1, racks) + 1)):
            try:
                rx = motion.rack_x(g, r)
            except (KeyError, TypeError, ValueError):
                continue
            if rx - push < 0:
                out.append(problem(
                    "rack_too_close_to_home", "error",
                    "Regal {0} steht bei X {1} mm — zu dicht am Endschalter. Beim Greifen "
                    "und Ablegen fährt der Arm um den Andruck-Weg ({2} mm) weiter Richtung "
                    "Null und käme auf X {3} mm. Das Regal braucht mindestens {2} mm "
                    "Abstand zum Endschalter (X 0); „Anfahren“ geht trotzdem, weil es "
                    "diese Bewegung nicht macht.",
                    [r, f"{rx:g}", f"{push:g}", f"{rx - push:g}"]))
        for pb in motion.printer_list(g):
            px = _f((pb.get("eject") or {}).get("x"))
            if limits.get("x") and px + push > limits["x"]:
                out.append(problem(
                    "printer_too_close_to_limit", "error",
                    "„{0}“ steht bei X {1} mm — beim Auswerfen und Einlegen fährt der Arm "
                    "um den Andruck-Weg ({2} mm) weiter und käme auf X {3} mm, über die "
                    "Achsgrenze X {4} mm.",
                    [pb["name"], f"{px:g}", f"{push:g}", f"{px + push:g}", f"{limits['x']:g}"],
                    printer=pb["id"]))

    # Zwei Drucker an derselben Stelle — fast immer ein vergessener zweiter Block.
    seen = {}
    for pb in motion.printer_list(g):
        key = round(_f((pb.get("eject") or {}).get("x")), 2)
        if key in seen:
            out.append(problem(
                "printers_same_x", "error",
                "„{0}“ und „{1}“ stehen beide bei X {2} mm — zwei Drucker können nicht an "
                "derselben Stelle stehen.",
                [seen[key], pb["name"], f"{key:g}"], printer=pb["id"]))
        else:
            seen[key] = pb["name"]
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

    printers = [p["id"] for p in motion.printer_list(g)]
    for op in _CHECK_OPS:
        if op in _SLOT_OPS:
            for rack in range(1, racks + 1):
                for slot in _test_slots(op, slots, mag):
                    problems += check_op(g, op, rack=rack, slot=slot)
        elif motion.canon_op(op) in motion.PRINTER_OPS:
            # Drucker-Operationen für JEDEN Drucker prüfen — sonst bliebe ein
            # falsch eingemessener zweiter Drucker unbemerkt.
            for pid in printers:
                problems += check_op(g, op, printer=pid)
        else:
            problems += check_op(g, op)
        if len(problems) > max_problems * 4:
            break       # Notbremse: bei völlig kaputter Geometrie nicht endlos sammeln

    problems = _dedupe(problems)[:max_problems]
    known = limits_known(limits)
    if not known:
        missing = ", ".join(a.upper() for a in AXES if not limits.get(a))
        problems.append(problem(
            "limits_unknown", "warning",
            "Achsgrenzen unbekannt ({0}) — es wird nur geprüft, ob eine Bewegung unter 0 mm "
            "fährt. Einmal „Grenzen vom Gerät holen“, dann warnt Printloom auch, wenn eine "
            "Position über die Achse hinausgeht.",
            [missing]))
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
        key = (p.get("code"), p.get("axis"), p.get("op"), p.get("printer"))
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
