"""Job-Verteilung auf mehrere Drucker (Phase 4.5).

Reine Entscheidungslogik, bewusst ohne Zustand und ohne I/O — damit sie testbar
ist und man an einem Blick sieht, warum ein Job auf einem bestimmten Drucker
landet.

Grundsatz: EINDEUTIG vor CLEVER. Ein Job, dem der Nutzer einen Drucker zugewiesen
hat, läuft dort — auch wenn ein anderer früher frei wäre. Automatisch verteilt
wird nur, was keine Zuweisung hat.

Reihenfolge der Ausschlusskriterien (harte Gründe zuerst):
  1. Drucker ist im Layout abgeschaltet oder gar nicht angelegt
  2. Modell passt nicht (Objekt höher als der Bauraum)
  3. Kein freies Fach in den Regalen dieses Druckers
Danach entscheidet: wer ist frei, und bei Gleichstand der mit der kürzeren
Warteschlange.
"""
from __future__ import annotations


def _num(v, d=0.0) -> float:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return float(d)
    return f if f == f else float(d)


def eligible(printer: dict, job: dict) -> tuple:
    """(darf_er, grund) — warum ein Drucker für diesen Job (nicht) in Frage kommt."""
    if not printer.get("enabled", True):
        return False, "abgeschaltet"
    if printer.get("device_id") is None:
        return False, "kein Gerät zugeordnet"
    if not printer.get("online", True):
        return False, "nicht erreichbar"

    max_h = _num(printer.get("max_height_mm"), 0)
    obj_h = _num(job.get("objectHeight") or job.get("object_height_mm"), 0)
    if max_h and obj_h and obj_h > max_h:
        return False, f"Objekt {obj_h:.0f} mm passt nicht (max {max_h:.0f} mm)"

    if printer.get("free_slots") == 0:
        return False, "kein freies Fach in den zugehörigen Regalen"
    return True, ""


def pick_printer(printers: list, job: dict) -> tuple:
    """Besten Drucker für EINEN Job wählen → (printer_id|None, grund).

    `printers`: [{id, enabled, device_id, online, busy, queue_len, free_slots,
                  max_height_mm}]
    """
    fixed = job.get("printer") or job.get("printer_module")
    if fixed:
        for p in printers:
            if p.get("id") == fixed:
                ok, why = eligible(p, job)
                # Feste Zuweisung wird NICHT stillschweigend umgangen: passt sie
                # gerade nicht, wartet der Job lieber, als woanders zu landen.
                return (p["id"], "vom Nutzer zugewiesen") if ok else (None, f"zugewiesener Drucker: {why}")
        return None, "zugewiesener Drucker existiert nicht mehr"

    usable = []
    reasons = []
    for p in printers:
        ok, why = eligible(p, job)
        if ok:
            usable.append(p)
        else:
            reasons.append(f"{p.get('name') or p.get('id')}: {why}")
    if not usable:
        return None, "; ".join(reasons) or "kein Drucker verfügbar"

    # Frei vor beschäftigt, dann kürzeste Warteschlange, dann feste Reihenfolge
    # (id) — letzteres nur, damit die Wahl bei Gleichstand reproduzierbar ist.
    usable.sort(key=lambda p: (bool(p.get("busy")), int(p.get("queue_len") or 0), str(p.get("id"))))
    best = usable[0]
    why = "frei" if not best.get("busy") else f"kürzeste Warteschlange ({best.get('queue_len', 0)})"
    return best["id"], why


def distribute(printers: list, jobs: list) -> dict:
    """Ganze Warteschlange verteilen → {job_id: printer_id|None}.

    Zählt die vergebenen Jobs mit, damit nicht alles auf demselben freien Drucker
    landet: der erste Job macht ihn „beschäftigt", der zweite geht zum nächsten.
    """
    state = {p["id"]: dict(p) for p in printers}
    out = {}
    for job in jobs:
        pid, _ = pick_printer(list(state.values()), job)
        out[job.get("id")] = pid
        if pid and pid in state:
            state[pid]["busy"] = True
            state[pid]["queue_len"] = int(state[pid].get("queue_len") or 0) + 1
    return out


def explain(printers: list, job: dict) -> dict:
    """Für die UI: welcher Drucker, warum — und was gegen die anderen spricht."""
    pid, why = pick_printer(printers, job)
    return {
        "printer": pid,
        "reason": why,
        "candidates": [
            {"id": p.get("id"), "name": p.get("name"),
             "eligible": eligible(p, job)[0], "why": eligible(p, job)[1],
             "busy": bool(p.get("busy")), "queue_len": int(p.get("queue_len") or 0)}
            for p in printers
        ],
    }
