import { describe, it, expect } from 'vitest'
import { parseRackForm, rackSaveError } from './rackForm'

const LIMITS = { num_racks: [1, 10], slots_per_rack: [1, 20], slot_height_mm: [1, 500], magazine_count: [0, 200] }

describe('Regal-Formular', () => {
  it('leer ist ein Fehler, nie 0', () => {
    const { body, errors } = parseRackForm({ slots_per_rack: '' }, LIMITS)
    expect(errors.slots_per_rack).toBeTruthy()
    expect(body.slots_per_rack).toBeUndefined()
  })
  it('0 Fächer ist ein Fehler', () => {
    expect(parseRackForm({ slots_per_rack: '0' }, LIMITS).errors.slots_per_rack).toBeTruthy()
  })
  it('Komma-Dezimal wird verstanden', () => {
    expect(parseRackForm({ slot_height_mm: '52,5' }, LIMITS).body.slot_height_mm).toBe(52.5)
    expect(parseRackForm({ slots_per_rack: '6,0' }, LIMITS).body.slots_per_rack).toBe(6)
  })
  it('Magazin-Fach innerhalb der Fächer ist ein Fehler', () => {
    expect(parseRackForm({ slots_per_rack: 6, magazine_slot: 6 }, LIMITS).errors.magazine_slot).toBeTruthy()
    expect(parseRackForm({ slots_per_rack: 6, magazine_slot: 7 }, LIMITS).errors).toEqual({})
    expect(parseRackForm({ slots_per_rack: 6, magazine_slot: 0 }, LIMITS).errors).toEqual({})
  })
  it('Platten je Magazin: ein leeres Feld ist ein Fehler', () => {
    const { errors } = parseRackForm({ magazine_defaults: ['6', '', '4'] }, LIMITS)
    expect(errors.magazine_defaults).toContain('2')
  })
  it('belegte Fächer beim Verkleinern werden lesbar gemeldet', () => {
    const e = { response: { data: { detail: { detail: 'x', slots: ['1-5', '2-6'] } } } }
    expect(rackSaveError(e)).toContain('1-5, 2-6')
    expect(rackSaveError({ response: { data: { detail: 'kaputt' } } })).toBe('kaputt')
  })
})
