/* Snapmaker U1 (Moonraker) in der Oberfläche — reine Helfer, testbar.
   Die Werte kommen von GET /api/printer/settings/{id} mit `driver: "moonraker"`
   (backend/app/services/moonraker_printer.py). */

export const isMoonraker = (device) => device?.device_type === 'moonraker'

/* Top-Cover-Modi wie in der Home-Assistant-Integration (0–3). Die Befehle dazu
   baut das Backend — hier nur Nummer und Anzeige. */
export const TOP_COVER_MODES = [
  { mode: 0, label: 'Aus' },
  { mode: 1, label: 'Kühlen' },
  { mode: 2, label: 'Warmhalten' },
  { mode: 3, label: 'Vorheizen' },
]

// Als Liste mit `label:`, damit die Übersetzungsprüfung (i18n.test.js) die Texte findet.
const STATES = [
  { state: 'standby', label: 'Bereit' }, { state: 'printing', label: 'Druckt' },
  { state: 'paused', label: 'Pausiert' }, { state: 'complete', label: 'Fertig' },
  { state: 'cancelled', label: 'Abgebrochen' }, { state: 'error', label: 'Fehler' },
]

/* Ein neuer Druck darf nur in diesen Zuständen starten (wie im Backend, IDLE_STATES). */
export const IDLE_STATES = ['standby', 'complete', 'cancelled', 'error']

/** Klipper läuft nicht (startup/shutdown/error)? Dann zählt das vor dem Druckzustand. */
export const klippyDown = (state) => !!state?.klippy_state && state.klippy_state !== 'ready'

/** Anzeige-Text für den Druckzustand (deutscher Schlüssel für tr()). `null` = offline. */
export function stateLabel(state) {
  if (!state || state.online === false) return null
  return STATES.find(x => x.state === state.print_state)?.label || state.print_state || '?'
}

/** Welche Knöpfe passen zum Zustand? Unbekannter Zustand → keiner. */
export function actionsFor(printState) {
  return {
    pause:  printState === 'printing',
    resume: printState === 'paused',
    cancel: printState === 'printing' || printState === 'paused',
    start:  IDLE_STATES.includes(printState),
  }
}

/** Zahl mit Einheit oder „—" — unbekannt ist nicht null. */
export const fmt = (v, unit = '') => (typeof v === 'number' && Number.isFinite(v)
  ? `${Math.round(v * 10) / 10}${unit}` : '—')
