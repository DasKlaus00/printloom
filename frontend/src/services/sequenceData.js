// Step factory. `extra` carries optional flags/fields: { parallel, optional, prep, nowait, z, feed }.
const s = (id, type, label, value = '', seconds = 0, extra = {}) => ({
  id, type, label,
  value: value ?? '',
  seconds: seconds ?? 0,
  parallel: extra.parallel ?? false,
  optional: extra.optional ?? false,
  prep:     extra.prep ?? false,
  ...(extra.nowait       ? { nowait: true }     : {}),
  ...(extra.z != null    ? { z: extra.z }       : {}),
  ...(extra.feed != null ? { feed: extra.feed } : {}),
})

// ── First Start: runs exactly ONCE at farm start. Homing läuft im Hintergrund
// (nowait), währenddessen holt das OTTOeject schon die Platte und wartet vor dem
// Drucker auf Z200. Der Zyklus überspringt seinen Griff dann automatisch
// („Platte schon im Greifer"). ──
export const DEFAULT_SEQ_NEW = [
  s(1, 'send_homing_file', 'Bambu Homing (G28+Z200, im Hintergrund)', '', 180, { nowait: true }),
  s(2, 'macro',            'OTTOeject homen',      'OTTOEJECT_HOME', 0, { optional: true }),
  s(3, 'macro',            'Tür öffnen',           'OPEN_DOOR_BAMBU_X_ONE_C', 0, { optional: true }),
  s(4, 'macro',            'Platte holen',         'GRAB_FROM_RACK RACK={stack_rack} SLOT={stack_slot}'),
  s(5, 'macro',            'Vor Drucker fahren',   'MOVE_TO_PRINTER_BAMBU', 0, { optional: true }),
  s(6, 'wait_homing',      'Auf Z200 warten (Homing-Ende)', '', 180),
]

// ── Cycle: runs for EVERY job. ⏱-flagged steps fire ~1 min before print end. ──
export const DEFAULT_SEQ_NEXT = [
  s(1,  'macro',      'Tür öffnen',           'OPEN_DOOR_BAMBU_X_ONE_C', 0, { optional: true }),
  s(2,  'macro',      'Platte holen',         'GRAB_FROM_RACK RACK={stack_rack} SLOT={stack_slot}'),
  s(3,  'macro',      'Platte einlegen',      'LOAD_ONTO_BAMBULAB_X_ONE_C'),
  s(4,  'macro',      'Tür schließen',        'CLOSE_DOOR_BAMBU_X_ONE_C', 0, { parallel: true }),
  s(5,  'send_file',  'Druckdatei senden',    ''),
  s(6,  'macro',      'Parken',               'PARK_OTTOEJECT', 0, { parallel: true }),
  s(7,  'wait_print', 'Auf Druckende warten', ''),
  // Vorpositionierung — laufen ~1 Min vor Druckende (prep), damit nach Druckende keine Zeit verloren geht:
  s(8,  'macro',      'OTTOeject homen',      'OTTOEJECT_HOME',       0, { prep: true, optional: true }),
  s(9,  'macro',      'Vor Drucker fahren',   'MOVE_TO_PRINTER_BAMBU', 0, { prep: true, optional: true }),
  // Nach Druckende — Bett schnell auf Z200 (Roh-G-Code), OTTOeject sicher homen, auswerfen:
  s(10, 'bambu_move', 'Bambu Position Z200',  '', 0, { z: 200, feed: 3000 }),
  s(11, 'macro',      'OTTOeject homen',      'OTTOEJECT_HOME'),  // garantiert gehomed vor Auswurf
  s(12, 'macro',      'Auswerfen',            'EJECT_FROM_BAMBULAB_X_ONE_C'),
  s(13, 'macro',      'Platte zurücklegen',   'STORE_TO_RACK RACK={rack} SLOT={slot}'),
]
