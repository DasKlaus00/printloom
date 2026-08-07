"""Stresstest: alle liegenden Platten ins am weitesten entfernte Regal umlagern.

Sinn der Übung: die längsten Wege, die die Anlage fahren kann, viele Male am
Stück — Riemen, Endschalter, Wiederholgenauigkeit und die eingestellte Geometrie
unter Dauerlast prüfen, ohne einen einzigen Druck zu starten.

Bewusst NICHT angefasst:

  DAS MAGAZIN. Dort liegt ein STAPEL Platten in EINEM Fach, und er wird flach
  gegriffen (grab_magazine, ohne Anheben). Ein Stapel lässt sich nicht 1:1 auf
  einzelne Fächer verteilen, und das Magazin ist der Nachschub der Farm — ein
  Test darf ihn nicht auflösen.

  GESPERRTE FÄCHER. Wer ein Fach sperrt, hat einen Grund.

  PLATTEN, DIE SCHON IM ZIELREGAL LIEGEN. Sie innerhalb desselben Regals
  umzusetzen wäre der kürzeste denkbare Weg — für einen Stresstest wertlos, und
  es verbraucht nur die freien Fächer, die die anderen Platten brauchen.

Reine Rechen-Logik, keine FastAPI-Importe: der Plan lässt sich damit vollständig
prüfen, ohne dass sich etwas bewegt.
"""
from __future__ import annotations

import math
import re
from typing import Optional

from app.services import ottoeject_motion as _motion
from app.services import rack_logic

# Der Schätzwert unten rechnet Strecke ÷ Vorschub. Das unterstellt, dass jede
# Bewegung sofort auf voller Geschwindigkeit ist — echte Achsen beschleunigen und
# bremsen aber, und zwischen zwei G1 liegt Rechenzeit. Der Zuschlag holt das grob
# wieder rein; er ist bewusst eine Schätzung und keine Simulation der Klipper-
# Beschleunigung (die kennen wir hier nicht).
ACCEL_ALLOWANCE = 1.25

# Pro Griff/Ablage kommt Rüstzeit dazu, die in keinem G1 steht: Moonrakers
# Antwortweg, das M400-Abwarten, Klippers Planer.
OP_OVERHEAD_S = 2.0

_G_MOVE = re.compile(r"^G[01]\b", re.IGNORECASE)
_AXIS = re.compile(r"\b([XYZF])(-?\d+(?:\.\d+)?)", re.IGNORECASE)
_DWELL = re.compile(r"^G4\b.*?\b([PS])(\d+(?:\.\d+)?)", re.IGNORECASE)


def script_seconds(script: str, start: Optional[dict] = None) -> tuple[float, dict]:
    """Fahrzeit eines G-code-Abschnitts abschätzen → (Sekunden, Endposition).

    `start` = Position vor dem Abschnitt; unbekannte Achsen zählen für den ersten
    Zug nicht mit (wir wissen sonst nicht, woher der Arm kommt)."""
    pos = dict(start or {})
    feed = 3000.0
    total = 0.0
    for raw in (script or "").splitlines():
        line = raw.split(";", 1)[0].strip()
        if not line:
            continue
        dwell = _DWELL.match(line)
        if dwell:
            val = float(dwell.group(2))
            total += val / 1000.0 if dwell.group(1).upper() == "P" else val
            continue
        if not _G_MOVE.match(line):
            continue
        ziel = {}
        for achse, wert in _AXIS.findall(line):
            achse = achse.upper()
            if achse == "F":
                feed = max(1.0, float(wert))
            else:
                ziel[achse] = float(wert)
        strecke = 0.0
        for achse, wert in ziel.items():
            if achse in pos:
                strecke += (wert - pos[achse]) ** 2
            pos[achse] = wert
        if strecke > 0:
            total += math.sqrt(strecke) / feed * 60.0
    return total, pos


def printer_x(g: dict, printer=None) -> Optional[float]:
    """X-Position des Druckers auf der Schiene.

    Der Drucker hat kein einzelnes X-Feld — jede Operation bringt ihr eigenes mit
    (Auswerfen, Einlegen, Anfahren). Für „wie weit ist ein Regal weg" reicht die
    erste vorhandene; die drei liegen dicht beieinander."""
    try:
        block = _motion.printer_block(g, printer)
    except Exception:
        return None
    for op in ("eject", "load", "move"):
        teil = block.get(op)
        if isinstance(teil, dict) and teil.get("x") is not None:
            try:
                return float(teil["x"])
            except (TypeError, ValueError):
                continue
    return None


def farthest_rack(g: dict, printer=None) -> int:
    """Regal mit dem größten X-Abstand zum Drucker — dorthin geht der längste Weg.

    Bei nur einem Regal ist es dieses; der Test fährt dann kurze Wege, läuft aber."""
    racks = _motion.rack_numbers(g)
    px = printer_x(g, printer)
    if px is None:
        # Ohne bekannte Drucker-Position bleibt die Nummerierung: Regal 1 steht am
        # Drucker, das höchste am anderen Ende der Schiene.
        return max(racks)

    def abstand(r: int) -> float:
        try:
            return abs(float(_motion.rack_x(g, r)) - px)
        except Exception:
            return 0.0

    # Bei Gleichstand das höher nummerierte Regal — R1 steht per Definition am Drucker.
    return max(racks, key=lambda r: (abstand(r), r))


def plates_in_racks(data: dict, magazine_slot: int) -> list:
    """Platten, die physisch in NORMALEN Fächern liegen → [(rack, slot, höhe, art)].

    Zwei Arten: ein eingelagerter Druck (Status belegt, ggf. mit Objekthöhe) und
    eine markierte Leerplatte (Status „free", liegt aber trotzdem da)."""
    out = []
    for key, slot in ((data or {}).get("slots") or {}).items():
        if not isinstance(slot, dict):
            continue
        try:
            r, s = (int(x) for x in str(key).split("-"))
        except (ValueError, TypeError):
            continue
        if magazine_slot and s == magazine_slot:
            continue                                  # Stapel — siehe Modulkopf
        status = slot.get("status", "free")
        if status == "locked":
            continue
        if status not in ("free", "ready"):
            hoehe = slot.get("object_height_mm") or 0
            out.append((r, s, float(hoehe), "druck"))
        elif slot.get("empty_plate"):
            out.append((r, s, 0.0, "leerplatte"))
    # Von oben nach unten greifen: über einer liegenden Platte fährt der Arm nicht weg.
    out.sort(key=lambda t: (t[0], -t[1]))
    return out


def _free_targets(data: dict, rack: int, magazine_slot: int) -> list:
    """Freie Fächer des Zielregals, unterstes zuerst (dort stapelt sich nichts)."""
    slots = (data or {}).get("slots") or {}
    reserviert = rack_logic.reserved_source_slots(data)
    out = []
    for key, slot in slots.items():
        if not isinstance(slot, dict) or key in reserviert:
            continue
        try:
            r, s = (int(x) for x in str(key).split("-"))
        except (ValueError, TypeError):
            continue
        if r != rack or (magazine_slot and s == magazine_slot):
            continue
        if slot.get("status", "free") not in ("free", "ready") or slot.get("empty_plate"):
            continue
        out.append(s)
    out.sort()
    return out


def plan(data: dict, g: dict, target: Optional[int] = None, printer=None) -> dict:
    """Umzugsplan aufstellen, ohne etwas zu bewegen.

    → {target_rack, moves, skipped, seconds, plate_count}
    `moves` = [{from, to, height_mm, kind}] in Ausführungsreihenfolge.
    `skipped` = was warum liegen bleibt (im Klartext für die Oberfläche)."""
    data = data or {}
    mag = rack_logic.magazine_slot_of(data)
    slot_h = float(data.get("slot_height_mm") or 50)
    tol = float(data.get("slot_tolerance_mm") or rack_logic.DEFAULT_SLOT_TOLERANCE_MM)
    pct = rack_logic.stacked_pct_of(data)
    ziel = int(target) if target else farthest_rack(g, printer)

    kandidaten = plates_in_racks(data, mag)
    moves, skipped = [], []
    frei = set(_free_targets(data, ziel, mag))

    # Der Plan wird gegen einen MITGEFÜHRTEN Regal-Stand geprüft, nicht gegen den
    # Anfangszustand: jede vergebene Platte liegt für die nächste Entscheidung
    # schon da. Sonst sähe die Höhenprüfung nur den leeren Ausgangszustand und
    # könnte eine Platte über ein Teil setzen, das der Plan selbst dorthin legt.
    sim = {k: dict(v) for k, v in (data.get("slots") or {}).items() if isinstance(v, dict)}

    for r, s, hoehe, art in kandidaten:
        if r == ziel:
            skipped.append({"from": f"{r}-{s}", "reason": "liegt schon im Zielregal"})
            continue
        noetig = rack_logic.slots_needed(hoehe, slot_h, tol)
        platz = None
        for kandidat in sorted(frei):
            spanne = [kandidat + i for i in range(noetig)]
            if any(x not in frei for x in spanne):
                continue
            # Ragt ein Objekt aus einem tieferen Fach herein? Der Status allein sagt
            # das nicht — ein hohes Teil belegt mehrere Fachhöhen.
            if any(rack_logic.is_blocked_from_below(ziel, x, sim, slot_h, tol, pct)
                   for x in spanne):
                continue
            # Liegt über der Spanne schon eine Platte, gilt nur die verringerte
            # Nutzhöhe — die Platte fährt erhöht ein (siehe rack_logic).
            if not rack_logic.fits_below(
                    hoehe, noetig,
                    rack_logic.slot_has_plate(ziel, spanne[-1] + 1, sim, mag),
                    slot_h, tol, pct):
                continue
            platz = kandidat
            break
        if platz is None:
            skipped.append({"from": f"{r}-{s}",
                            "reason": f"kein passendes Fach mehr in Regal {ziel}"})
            continue

        # Buchung nachziehen: Quelle wird frei, Ziel ist belegt.
        sim[f"{r}-{s}"] = {"status": "free", "empty_plate": False, "object_height_mm": None}
        sim[f"{ziel}-{platz}"] = {
            "status": "free" if art == "leerplatte" else "done",
            "empty_plate": art == "leerplatte",
            "object_height_mm": hoehe or None,
        }
        frei -= {platz + i for i in range(noetig)}
        moves.append({"from": f"{r}-{s}", "to": f"{ziel}-{platz}",
                      "from_rack": r, "from_slot": s, "to_rack": ziel, "to_slot": platz,
                      "height_mm": hoehe, "kind": art})

    return {"target_rack": ziel, "moves": moves, "skipped": skipped,
            "plate_count": len(kandidaten),
            "seconds": estimate_seconds(g, moves, printer)}


def estimate_seconds(g: dict, moves: list, printer=None) -> int:
    """Dauer hochrechnen — aus dem G-code, den der Test WIRKLICH fahren würde.

    Für jeden Umzug werden Griff und Ablage erzeugt und Strecke ÷ Vorschub
    aufsummiert; die Endposition wandert als Startposition in den nächsten Zug,
    damit der Weg ZWISCHEN den Regalen mitzählt (genau der ist beim Stresstest
    der lange). Plus Zuschlag für Beschleunigen/Bremsen und Rüstzeit."""
    pos, total = {}, 0.0
    for m in moves or []:
        for op, rack, slot in (("grab", m["from_rack"], m["from_slot"]),
                               ("store", m["to_rack"], m["to_slot"])):
            try:
                script = _motion.build_op(g, op, rack=rack, slot=slot,
                                          check=False, printer=printer)
            except Exception:
                continue
            secs, pos = script_seconds(script, pos)
            total += secs + OP_OVERHEAD_S
    return int(round(total * ACCEL_ALLOWANCE))
