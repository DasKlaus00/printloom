import { describe, it, expect } from 'vitest'
import { mergeServerValue } from './dirtyField'

describe('Feld mit Serverwert', () => {
  it('nicht bearbeitet: der neuere Serverwert gewinnt', () => {
    expect(mergeServerValue('PN-1', 'PN-2', false)).toBe('PN-2')
  })
  it('bearbeitet: die eigene Eingabe bleibt', () => {
    expect(mergeServerValue('PN-3', 'PN-2', true)).toBe('PN-3')
  })
  it('kein Serverwert ist leer, nicht undefined', () => {
    expect(mergeServerValue('x', null, false)).toBe('')
  })
})
