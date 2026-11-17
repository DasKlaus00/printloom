import { describe, it, expect } from 'vitest'
import { normalizeHex, colorLabel } from './colorNames'

// Eine Umwandlung für alle Farbpunkte (seit v1.1.71, components/ColorDot.jsx).
describe('normalizeHex', () => {
  it('Kurzform, Bambu-RRGGBBAA und ohne # werden zu #RRGGBB in Großbuchstaben', () => {
    expect(normalizeHex('#fff')).toBe('#FFFFFF')
    expect(normalizeHex('FFFFFFFF')).toBe('#FFFFFF')
    expect(normalizeHex('ff0000')).toBe('#FF0000')
    expect(normalizeHex('#1a2B3c')).toBe('#1A2B3C')
    expect(normalizeHex(' 00FF00ff ')).toBe('#00FF00')
  })
  it('leer, null oder kein Hex ist unbekannt (null)', () => {
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex(null)).toBeNull()
    expect(normalizeHex(undefined)).toBeNull()
    expect(normalizeHex('xyz')).toBeNull()
    expect(normalizeHex('#12345')).toBeNull()
  })
  it('colorLabel bleibt wie bisher', () => {
    expect(colorLabel('FFFFFF')).toBe('White')
    expect(colorLabel('')).toBe('')
  })
})
