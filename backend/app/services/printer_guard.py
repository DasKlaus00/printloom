"""Ist der Drucker frei? EIN frischer Zustand für Sicherheitsentscheidungen.

bambu_manager.last_status() liefert, was gerade im Cache liegt: auch einen leeren
oder einen von vor einer Stunde (Verbindung weg, Drucker aus). Bis v1.1.43 ließ ein
leerer Status Kalibrierung und AMS-Befehle durch, und ein alter „FINISH" galt als
frei, obwohl der Drucker längst wieder druckte. Hier gilt: Nur ein Telegramm, das
höchstens max_age_s alt ist, zählt; sonst ist der Zustand unbekannt, und unbekannt
ist nicht frei.

Synchron (wartet kurz auf den Vollreport): aus async-Code über
run_in_executor(bambu_manager.executor, …) aufrufen.
"""
from __future__ import annotations

import time
from typing import Optional

from app.services import bambu_manager

# Zustände, in denen der Drucker arbeitet oder gleich arbeitet. PAUSE gehört dazu:
# Der Druckkopf steht über dem Teil, das Bett ist nicht frei.
BUSY_STATES = ("RUNNING", "PREPARE", "SLICING", "PAUSE")
UNKNOWN = "Druckerstatus unbekannt — ist der Drucker erreichbar? Ohne frischen Status keine Befehle"


def live_state(device, max_age_s: float = 30.0, wait_s: float = 4.0) -> Optional[str]:
    """gcode_state des Druckers, wenn der Status höchstens max_age_s alt ist, sonst None."""
    if not bambu_manager.ensure(device):
        return None
    bambu_manager.request_pushall(device)
    deadline = time.monotonic() + wait_s
    while True:
        age = bambu_manager.status_age(device)
        if age is not None and age <= max_age_s:
            break
        if time.monotonic() >= deadline:
            return None
        time.sleep(0.3)
    raw = bambu_manager.last_status(device) or {}
    state = (raw.get("print") or {}).get("gcode_state")
    return str(state).upper() if state else None


def busy_reason(state: Optional[str], allow_pause: bool = False) -> Optional[str]:
    """None = frei, sonst der Grund. allow_pause: Filamentwechsel in der Pause ist
    erlaubt (dafür gibt es die Pause)."""
    if not state:
        return UNKNOWN
    s = state.upper()
    if s == "PAUSE" and allow_pause:
        return None
    if s in BUSY_STATES:
        return f"Drucker ist belegt ({s}) — erst nach dem Druck"
    return None
