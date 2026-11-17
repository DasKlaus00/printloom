"""Schritt-Arten einer Farm-Sequenz — EINE Liste für alle, die sie kennen müssen.

Der Ablauf selbst steht in routers/autofarm.py (`_exec_step`), der Editor in
frontend/src/pages/SequenceEditor.jsx (`TYPE_META`). Ein Test hält alle drei
deckungsgleich.

Warum es diese Datei gibt: Der Profil-Import führte bis v1.1.34 eine eigene Liste,
die beim Dazukommen von `app_op`, `wait_homing` und `wait_cool` nicht mitgewachsen
war. Ein exportiertes und wieder eingespieltes Profil verlor damit genau diese
Schritte — also fast alle Bewegungen eines aktuellen Zyklus — ohne Meldung. Ebenso
fiel das Feld `nowait` weg, und das Homing im First Start wartete danach wieder.
"""

from typing import Optional

# Was der Ablauf ausführen kann. Die mit „alt" markierten bietet der Editor nicht
# mehr an; gespeicherte Sequenzen dürfen sie aber noch enthalten.
STEP_TYPES = frozenset({
    "macro", "app_op", "klipper_gcode", "gcode", "bambu_move",
    "send_homing_file", "wait_homing", "send_file", "wait_print", "wait_cool", "delay",
    # alt
    "wait_bambu_idle", "send_file_fixed", "wait_pause", "wait_print_failed", "clear_error",
})

# Felder, die ein Schritt tragen darf.
STEP_FIELDS = ("id", "type", "label", "value", "seconds", "z", "feed", "nowait",
               "parallel", "optional", "disabled", "prep", "condition")


def sanitize_step(step) -> Optional[dict]:
    """Nur bekannte Felder einer bekannten Art; None bei unbekannter Art oder keinem
    Objekt. Eine Stelle für Speichern (autofarm) und Profil-Import (profiles)."""
    if not isinstance(step, dict):
        return None
    t = step.get("type", "")
    if t not in STEP_TYPES:
        return None
    out = {k: step.get(k) for k in STEP_FIELDS if k in step}
    out["type"] = t
    if "value" in out and out["value"] is not None:
        out["value"] = str(out["value"])
    return out

# ── Vorziehen (⏱ „prep"): ~1 min vor Druckende, während der Drucker noch druckt ──
# Eine ERLAUBNIS-Liste statt einer Verbotsliste: Bis v1.1.45 durfte alles außer
# vier Arten vorgezogen werden. Ein ⏱ an „Auswerfen" fuhr so ~1 min vor Druckende in
# den laufenden Druck, ein ⏱ an „Bambu Position" verschwand still. Erlaubt ist nur,
# was den Drucker nicht berührt: warten, homen, parken, vor den Drucker fahren.
# Dieselben Listen stehen in frontend/src/services/sequenceRules.js (Test hält sie gleich).
PREP_APP_OPS = ("move_to_printer",)
PREP_MACROS = ("OTTOEJECT_HOME", "PARK_OTTOEJECT")
PREP_MACRO_PREFIXES = ("MOVE_TO_PRINTER",)


def prep_allowed(step: dict) -> bool:
    """Darf dieser Schritt vor dem Druckende laufen?"""
    t = step.get("type")
    v = str(step.get("value") or "").strip()
    if t == "delay":
        return True
    if t == "app_op":
        return v.lower() in PREP_APP_OPS
    if t == "macro":
        first = v.split()[0].upper() if v.split() else ""
        return first in PREP_MACROS or first.startswith(PREP_MACRO_PREFIXES)
    return False


# Abgeleitet, für ältere Aufrufer: Arten, die NIE vorgezogen werden.
PREP_FORBIDDEN = tuple(sorted(STEP_TYPES - {"delay", "app_op", "macro"}))

# Schritte, die den Arm bewegen. In einer ∥-Gruppe laufen sie nacheinander in
# Listenreihenfolge; nur Schritte für den Drucker laufen daneben (z. B. Datei senden
# ∥ Parken).
ARM_STEP_TYPES = ("macro", "app_op", "klipper_gcode")
