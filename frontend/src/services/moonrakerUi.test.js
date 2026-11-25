/* Snapmaker U1 in der Oberfläche (seit v1.1.83). Die Zustände sind die von
   Klipper (print_stats.state), wie das Backend sie in `state.print_state` liefert. */
import { describe, it, expect } from 'vitest'
import { actionsFor, stateLabel, klippyDown, fmt, isMoonraker, TOP_COVER_MODES, IDLE_STATES } from './moonrakerUi'

describe('Snapmaker U1: Knöpfe und Anzeige', () => {
  it('Knöpfe passen zum Druckzustand', () => {
    expect(actionsFor('printing')).toEqual({ pause: true, resume: false, cancel: true, start: false })
    expect(actionsFor('paused')).toEqual({ pause: false, resume: true, cancel: true, start: false })
    expect(actionsFor('complete')).toEqual({ pause: false, resume: false, cancel: false, start: true })
    expect(actionsFor(undefined)).toEqual({ pause: false, resume: false, cancel: false, start: false })
  })
  it('starten nur in denselben Zuständen wie das Backend', () => {
    expect(IDLE_STATES).toEqual(['standby', 'complete', 'cancelled', 'error'])
  })
  it('Zustandstext, offline und Klipper aus', () => {
    expect(stateLabel({ online: true, print_state: 'printing', klippy_state: 'ready' })).toBe('Druckt')
    expect(stateLabel({ online: true, print_state: 'cancelled' })).toBe('Abgebrochen')
    expect(stateLabel({ online: false })).toBeNull()
    expect(klippyDown({ klippy_state: 'shutdown' })).toBe(true)
    expect(klippyDown({ klippy_state: 'ready' })).toBe(false)
    expect(klippyDown({})).toBe(false)
  })
  it('unbekannt ist nicht null', () => {
    expect(fmt(null, '°')).toBe('—')
    expect(fmt(219.84, '°')).toBe('219.8°')
    expect(fmt(0, ' %')).toBe('0 %')
  })
  it('erkennt das Gerät und kennt die vier Top-Cover-Modi', () => {
    expect(isMoonraker({ device_type: 'moonraker' })).toBe(true)
    expect(isMoonraker({ device_type: 'klipper' })).toBe(false)   // Klipper = OTTOeject-Arm
    expect(TOP_COVER_MODES.map(m => m.mode)).toEqual([0, 1, 2, 3])
  })
})
