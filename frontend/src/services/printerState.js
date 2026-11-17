/* Druckerzustand (gcode_state des Bambu-Druckers) als Anzeige (seit v1.1.66).
   Bis v1.1.65 kannte die Steuerung nur sechs Zustände; alles andere hieß „Offline" —
   auch PREPARE/SLICING, während der Drucker die Datei vorbereitete. Jetzt heißt
   „Offline" nur noch: kein Status. Ein unbekannter Zustand wird genannt. */
import { tr } from './i18n'

const META = {
  idle:    { label: 'Bereit',          dot: 'dot-green', color: 'text-emerald-400' },
  running: { label: 'Druckt',          dot: 'dot-blue',  color: 'text-blue-400' },
  prepare: { label: 'Bereitet vor…',   dot: 'dot-blue',  color: 'text-blue-300' },
  slicing: { label: 'Bereitet vor…',   dot: 'dot-blue',  color: 'text-blue-300' },
  pause:   { label: 'Pausiert',        dot: 'dot-amber', color: 'text-amber-400' },
  finish:  { label: 'Fertig',          dot: 'dot-green', color: 'text-emerald-300' },
  failed:  { label: 'Fehler',          dot: 'dot-red',   color: 'text-red-400' },
  offline: { label: 'Offline',         dot: 'dot-gray',  color: 'text-surface-500' },
}

/* → { label (übersetzt), dot, color } */
export function printerState(s) {
  const key = String(s ?? '').trim().toLowerCase()
  if (!key) return { ...META.offline, label: tr(META.offline.label) }
  const m = META[key]
  if (m) return { ...m, label: tr(m.label) }
  return { label: tr('Unbekannt ({0})', String(s).toUpperCase()), dot: 'dot-amber', color: 'text-amber-300' }
}
