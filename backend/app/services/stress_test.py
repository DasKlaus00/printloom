"""Stresstest: die Magazine leerräumen, Platte für Platte in ein zufälliges Fach.

Sinn der Übung: Der Arm holt eine leere Platte aus Magazin 1, fährt damit
irgendwohin und legt sie ab — und das wieder und wieder, bis alle Magazine leer
sind. Die Ziele werden gewürfelt, also entstehen lauter unterschiedlich lange
Wege quer über die Schiene statt derselben Strecke im Kreis. Genau das prüft
Riemen, Endschalter, Wiederholgenauigkeit und die eingemessene Geometrie unter
Dauerlast — ohne einen einzigen Druck.

Der Magazin-Griff ist ein eigener: `grab_magazine` greift FLACH vom Stapel
(ohne Anheben), `grab` würde eine einzeln liegende Platte holen. Ohne Magazin
(Aufbau „alle Fächer sind Lagerfächer") gibt es keinen Stapel — dann sind die
markierten Leerplatten die Quelle, und die werden normal gegriffen.

WAS DANACH IST: Die Magazine sind leer und die Platten liegen verteilt in den
Fächern. Das ist kein Versehen, sondern das Ergebnis — zurückräumen ist Handarbeit.

Bewusst nicht angefasst: gesperrte Fächer (wer sperrt, hat einen Grund) und
Fächer, in denen ein Druck liegt.

Reine Rechen-Logik, keine FastAPI-Importe: der Plan lässt sich damit vollständig
prüfen, ohne dass sich etwas bewegt.
"""
from __future__ import annotations

import math
import random
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
    (Auswerfen, Einlegen, Anfahren). Für Entfernungen reicht die erste vorhandene;
    die drei liegen dicht beieinander."""
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
    """Regal mit dem größten X-Abstand zum Drucker (nur für die Anzeige)."""
    racks = _motion.rack_numbers(g)
    px = printer_x(g, printer)
    if px is None:
        return max(racks)

    def abstand(r: int) -> float:
        try:
            return abs(float(_motion.rack_x(g, r)) - px)
        except Exception:
            return 0.0

    return max(racks, key=lambda r: (abstand(r), r))


# ── Quelle: die Magazine ─────────────────────────────────────────────────────

def magazine_sources(data: dict) -> list:
    """Woher die leeren Platten kommen → [(rack, slot, aus_magazin)], je Platte ein
    Eintrag, Regal für Regal von unten: erst Magazin 1 leeren, dann 2, dann 3.

    MIT Magazin: der Zähler des Regals sagt, wie viele Platten im Stapel liegen —
    alle im selben Fach, alle mit dem flachen Magazin-Griff.
    OHNE Magazin: jede markierte Leerplatte einzeln, normal gegriffen. Sie liegen
    von oben nach unten gestapelt gedacht — genau in der Reihenfolge greift die
    Farm auch, sonst führe der Arm über eine noch liegende Platte."""
    mag = rack_logic.magazine_slot_of(data)
    out = []
    if mag > 0:
        for i, anzahl in enumerate(_counts(data)):
            for _ in range(anzahl):
                out.append((i + 1, mag, True))
        return out
    for r, s in rack_logic.marked_empty_plates(data):
        out.append((r, s, False))
    return out


def _counts(data: dict) -> list:
    out = []
    for c in (data or {}).get("magazine_counts") or []:
        try:
            out.append(max(0, int(c)))
        except (TypeError, ValueError):
            out.append(0)
    return out


# ── Ziel: irgendein freies Fach ──────────────────────────────────────────────

def free_slots(data: dict, g: dict) -> list:
    """Alle Fächer, in die eine leere Platte gelegt werden darf → [(rack, slot)].

    Nicht dabei: Magazin-Fächer (dort steht der Stapel), gesperrte Fächer, Fächer
    mit Inhalt und Fächer, in denen schon eine Leerplatte markiert ist."""
    mag = rack_logic.magazine_slot_of(data)
    slots = (data or {}).get("slots") or {}
    racks = set(_motion.rack_numbers(g))
    out = []
    for key, slot in slots.items():
        if not isinstance(slot, dict):
            continue
        try:
            r, s = (int(x) for x in str(key).split("-"))
        except (ValueError, TypeError):
            continue
        if r not in racks or (mag and s == mag):
            continue
        if slot.get("status", "free") not in ("free", "ready") or slot.get("empty_plate"):
            continue
        out.append((r, s))
    out.sort()
    return out


def plan(data: dict, g: dict, seed: Optional[int] = None, printer=None) -> dict:
    """Umzugsplan aufstellen, ohne etwas zu bewegen.

    → {moves, skipped, seconds, plate_count, free_count, farthest_rack}
    `moves` = [{from, to, from_magazine}] in Ausführungsreihenfolge.

    Die Ziele werden GEWÜRFELT — darum geht es ja: unterschiedlich lange Wege
    statt derselben Strecke im Kreis. Gewürfelt wird EINMAL beim Aufstellen des
    Plans, damit gefahren wird, was vorher angezeigt wurde."""
    data = data or {}
    slot_h = float(data.get("slot_height_mm") or 50)
    tol = float(data.get("slot_tolerance_mm") or rack_logic.DEFAULT_SLOT_TOLERANCE_MM)
    pct = rack_logic.stacked_pct_of(data)
    mag = rack_logic.magazine_slot_of(data)
    rnd = random.Random(seed)

    quellen = magazine_sources(data)
    frei = free_slots(data, g)
    rnd.shuffle(frei)

    # Mitgeführter Regal-Stand: eine gerade abgelegte Platte zählt für die nächste
    # Entscheidung schon als liegend. Sonst prüfte die Höhenlogik nur den
    # Ausgangszustand und könnte zwei Platten übereinander planen.
    sim = {k: dict(v) for k, v in (data.get("slots") or {}).items() if isinstance(v, dict)}
    moves, skipped = [], []

    for r, s, aus_magazin in quellen:
        ziel = None
        for i, (zr, zs) in enumerate(frei):
            # Ragt ein Druck aus einem tieferen Fach herein? Eine leere Platte ist
            # flach, aber sie muss trotzdem einfahren können.
            if rack_logic.is_blocked_from_below(zr, zs, sim, slot_h, tol, pct):
                continue
            ziel = frei.pop(i)
            break
        if ziel is None:
            skipped.append({"from": f"{r}-{s}", "reason": "kein freies Fach mehr"})
            continue
        zr, zs = ziel
        # Quelle nur ohne Magazin umbuchen — beim Stapel bleibt das Fach das Fach,
        # dort sinkt nur der Zähler.
        if not aus_magazin:
            sim[f"{r}-{s}"] = {"status": "free", "empty_plate": False, "object_height_mm": None}
        sim[f"{zr}-{zs}"] = {"status": "done", "empty_plate": not mag, "object_height_mm": None}
        moves.append({"from": f"{r}-{s}", "to": f"{zr}-{zs}",
                      "from_rack": r, "from_slot": s, "to_rack": zr, "to_slot": zs,
                      "from_magazine": aus_magazin})

    return {"moves": moves, "skipped": skipped,
            "plate_count": len(quellen), "free_count": len(free_slots(data, g)),
            "farthest_rack": farthest_rack(g, printer),
            "seconds": estimate_seconds(g, moves, printer)}


def estimate_seconds(g: dict, moves: list, printer=None) -> int:
    """Dauer hochrechnen — aus dem G-code, den der Test WIRKLICH fahren würde.

    Für jeden Umzug werden Griff und Ablage erzeugt und Strecke ÷ Vorschub
    aufsummiert; die Endposition wandert als Startposition in den nächsten Zug,
    damit der Weg ZWISCHEN Magazin und Ziel mitzählt — genau der ist hier der
    lange. Plus Zuschlag für Beschleunigen/Bremsen und Rüstzeit."""
    pos, total = {}, 0.0
    for m in moves or []:
        schritte = (("grab_magazine" if m.get("from_magazine") else "grab",
                     m["from_rack"], m["from_slot"]),
                    ("store", m["to_rack"], m["to_slot"]))
        for op, rack, slot in schritte:
            try:
                script = _motion.build_op(g, op, rack=rack, slot=slot,
                                          check=False, printer=printer)
            except Exception:
                continue
            secs, pos = script_seconds(script, pos)
            total += secs + OP_OVERHEAD_S
    return int(round(total * ACCEL_ALLOWANCE))
