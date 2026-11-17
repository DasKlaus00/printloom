import { describe, it, expect } from 'vitest'
import { numOrNull, invalidFields } from './geometryDraft'

describe('Positionsfelder', () => {
  it("'' ist ungültig, nie 0", () => { expect(numOrNull('')).toBeNull() })
  it("'17,5' ergibt 17.5", () => { expect(numOrNull('17,5')).toBe(17.5) })
  it("'0' ist gültig", () => { expect(numOrNull('0')).toBe(0) })
  it('Text ist ungültig', () => { expect(numOrNull('abc')).toBeNull() })
  it('nie gesetzt bleibt beim alten Verhalten', () => { expect(numOrNull(undefined, 0)).toBe(0) })
  it('ungültige Felder werden mit Pfad gemeldet', () => {
    const g = {
      printers: [{ eject: { x: null, y: 1, z: 2 }, load: { x: 1, y: 1, z: 1 }, door: { open: { x: 1, y: 1, z: 1, d: null } } }],
      rack_geo: { 1: { x: 10, first_z: null, slot_gap: 25 } },
      storage: { x_unclamp: 5, slot_gap: 25 },
    }
    expect(invalidFields(g)).toEqual(['printers[0].eject.x', 'printers[0].door.open.d', 'rack_geo[1].first_z'])
    expect(invalidFields({ printers: [{ eject: { x: 1, y: 2, z: 3 } }] })).toEqual([])
  })
})
