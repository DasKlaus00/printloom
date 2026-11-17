import { describe, it, expect } from 'vitest'
import { nextEmergencyState } from './emergency'

const RUHE = { active: false, armWarning: null, feedback: null }

describe('Notaus: was nach einer Antwort gilt', () => {
  it('Notaus mit angehaltenem Arm: aktiv, keine Warnung', () => {
    const s = nextEmergencyState(RUHE, 'stop', { arms: [{ name: 'OTTOeject', ok: true }], arm_stopped: true })
    expect(s.active).toBe(true)
    expect(s.armWarning).toBe(null)
    expect(s.feedback.key).toBe('stopped')
  })

  it('Arm nicht angehalten: Warntext bleibt stehen', () => {
    const s = nextEmergencyState(RUHE, 'stop', { arms: [{ name: 'OTTOeject', ok: false }], arm_stopped: false })
    expect(s.active).toBe(true)
    expect(s.armWarning).toBe('not_stopped')
  })

  it('Printloom nicht erreichbar: Warnung, weil über den Arm nichts bekannt ist', () => {
    const s = nextEmergencyState(RUHE, 'stop_failed', 'Network Error')
    expect(s.armWarning).toBe('unreachable')
    expect(s.active).toBe(true)
  })

  it('Fortsetzen fehlgeschlagen: bleibt aktiv, Warnung bleibt', () => {
    const vorher = { active: true, armWarning: 'not_stopped', feedback: null }
    const s = nextEmergencyState(vorher, 'resume', { success: false, message: 'Klipper-Neustart fehlgeschlagen' })
    expect(s.active).toBe(true)
    expect(s.armWarning).toBe('not_stopped')
    expect(s.feedback).toEqual({ text: 'Klipper-Neustart fehlgeschlagen', ok: false })
  })

  it('Fortsetzen erfolgreich: frei, Warnung weg', () => {
    const vorher = { active: true, armWarning: 'not_stopped', feedback: null }
    const s = nextEmergencyState(vorher, 'resume', { success: true })
    expect(s).toEqual({ active: false, armWarning: null, feedback: { key: 'released', ok: true } })
  })

  it('Netzfehler beim Fortsetzen ändert den Zustand nicht', () => {
    const vorher = { active: true, armWarning: null, feedback: null }
    expect(nextEmergencyState(vorher, 'resume_failed', 'timeout').active).toBe(true)
  })

  it('Zustand vom Server übernimmt nur „aktiv"', () => {
    const vorher = { active: false, armWarning: 'not_stopped', feedback: null }
    const s = nextEmergencyState(vorher, 'state', { active: true })
    expect(s.active).toBe(true)
    expect(s.armWarning).toBe('not_stopped')
  })
})
