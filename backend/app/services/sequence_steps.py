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

# Diese Arten bleiben IMMER im normalen Ablauf, auch wenn `prep` gesetzt ist:
# `wait_print` vorzuziehen hieße mitten im Druck auswerfen, `send_file` muss an
# seiner Stelle laufen, `wait_homing` wartete während eines echten Drucks endlos
# auf FINISH, und `wait_cool` vor dem Druckende ergibt keinen Sinn.
PREP_FORBIDDEN = ("wait_print", "send_file", "wait_homing", "wait_cool")
