import { describe, it, expect } from 'vitest'
import { prepAllowed } from './sequenceRules'
import { DEFAULT_SEQ_NEXT } from './sequenceData'

describe('Vorziehen (⏱)', () => {
  it('nur für Schritte, die den Drucker nicht berühren', () => {
    expect(prepAllowed({ type: 'delay', seconds: 5 })).toBe(true)
    expect(prepAllowed({ type: 'app_op', value: 'move_to_printer' })).toBe(true)
    expect(prepAllowed({ type: 'macro', value: 'OTTOEJECT_HOME' })).toBe(true)
    expect(prepAllowed({ type: 'macro', value: 'MOVE_TO_PRINTER_X1C' })).toBe(true)
    for (const s of [{ type: 'app_op', value: 'eject' }, { type: 'app_op', value: 'place' },
                     { type: 'bambu_move' }, { type: 'gcode', value: 'G28' },
                     { type: 'macro', value: 'EJECT_FROM_BAMBULAB_X_ONE_C' }, { type: 'wait_print' }]) {
      expect(prepAllowed(s)).toBe(false)
    }
  })
  it('der Standard-Zyklus zieht nur Erlaubtes vor', () => {
    const vor = DEFAULT_SEQ_NEXT.filter(s => s.prep)
    expect(vor.length).toBeGreaterThan(0)
    expect(vor.every(prepAllowed)).toBe(true)
  })
})
