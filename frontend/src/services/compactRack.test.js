/* Kompakt-Regal im Frontend (seit v1.1.80). Dieselben Fälle wie
   backend/tests/test_compact_rack.py — die Vorschau MUSS dasselbe Fach wählen wie
   die Farm (rack_logic „Kompakt-Regal"). */
import { describe, it, expect } from 'vitest'
import { compactSpan, compactStoreSlot, compactPlateSource, compactCoveredSlots, autoSlot, isCompact, slotForRow } from './rackUtils'
import { derivedConfig, lockedBy, selectComponent, isCompactSelection } from './hardware'

// Echte Form von GET /api/rack-manager/ (Auszug)
function kompakt({ nr = 3, spr = 24, topOpen = true, platten = 0 } = {}) {
  const slots = {}
  for (let r = 1; r <= nr; r++) for (let s = 1; s <= spr; s++) {
    slots[`${r}-${s}`] = { status: 'free', file_id: null, file_name: null, object_height_mm: null, note: '', empty_plate: false }
  }
  const empty_plates = []
  let left = platten
  for (let r = nr; r >= 1 && left > 0; r--) for (let s = 1; s <= spr && left > 0; s++, left--) {
    slots[`${r}-${s}`].empty_plate = true
    empty_plates.push(`${r}-${s}`)
  }
  return { rack_type: 'compact', num_racks: nr, slots_per_rack: spr, slot_height_mm: 16,
           compact_clearance_mm: 8, compact_top_open: topOpen, magazine_slot: 0, slots, empty_plates }
}
const ablegen = (d, k, h) => { d.slots[k].status = 'done'; d.slots[k].object_height_mm = h }

describe('Kompakt-Regal: Fachwahl wie im Backend (Fach 1 = oben)', () => {
  it('belegt Fächer nach Höhe plus Zugabe', () => {
    const d = kompakt()
    expect([8, 24, 30, 0].map(h => compactSpan(h, d))).toEqual([1, 2, 3, 1])
  })
  it('erster Druck in Fach 1 von Regal 1, dann darunter angehängt', () => {
    const d = kompakt({ platten: 18 })
    expect(compactStoreSlot(d, 30)).toBe('1-1')
    ablegen(d, '1-1', 30)
    expect(compactStoreSlot(d, 30)).toBe('1-4')
    expect(compactStoreSlot(d, 8)).toBe('1-2')
  })
  it('keine Lücke wird nachgefüllt, Regal 1 voll → Regal 2', () => {
    const d = kompakt()
    ablegen(d, '1-1', 30); ablegen(d, '1-4', 60)
    expect(compactStoreSlot(d, 8)).toBe('1-5')
    const e = kompakt(); ablegen(e, '1-23', 8)
    expect(compactStoreSlot(e, 30)).toBe('2-1')
    expect(compactStoreSlot(e, 8)).toBe('1-24')
  })
  it('oben zu: der erste Druck muss in die Fächer passen', () => {
    expect(compactStoreSlot(kompakt({ topOpen: false }), 30)).toBe('1-3')
  })
  it('solange oben leere Platten liegen, kommt kein Druck darunter', () => {
    expect(compactStoreSlot(kompakt({ nr: 1, platten: 20 }), 8)).toBeNull()
  })
  it('zwischen Druck und leerer Platte bleibt ein Fach frei', () => {
    const d = kompakt({ nr: 1, platten: 20 })
    for (let f = 1; f <= 18; f++) d.slots[`1-${f}`].empty_plate = false   // oben 18 geholt
    for (let f = 1; f <= 17; f++) { expect(compactStoreSlot(d, 8)).toBe(`1-${f}`); ablegen(d, `1-${f}`, 8) }
    expect(compactStoreSlot(d, 8)).toBeNull()   // Fach 18 läge direkt über der Platte in 19
  })
  it('die Warteschlangen-Vorschau nutzt dieselben Regeln', () => {
    const d = kompakt()
    expect(isCompact(d)).toBe(true)
    expect(autoSlot([{ status: 'pending', slot: '1-1' }], d, 8)).toBe('1-2')
    expect(autoSlot([], kompakt({ nr: 1, platten: 24 }), 8)).toBe('1-0')
  })
  it('gegriffen wird die oberste leere Platte (Fach 1) des höchsten Regals', () => {
    const d = kompakt({ platten: 30 })
    expect(compactPlateSource(d)).toEqual([3, 1])
    d.empty_plates = d.empty_plates.filter(k => k !== '3-1')
    expect(compactPlateSource(d)).toEqual([3, 2])
    expect(compactPlateSource(kompakt())).toBeNull()
  })
  it('ein hoher Druck verdeckt die Fächer über sich (kleinere Nummern, Anzeige)', () => {
    const d = kompakt(); ablegen(d, '1-5', 30)
    expect([...compactCoveredSlots(d)].sort()).toEqual(['1-3', '1-4'])
    const e = kompakt(); ablegen(e, '1-1', 30)
    expect([...compactCoveredSlots(e)]).toEqual([])   // ragt oben hinaus
  })
  it('Regal-Ansicht: Kompakt Fach 1 oben, Original das höchste Fach oben', () => {
    expect([0, 1, 23].map(row => slotForRow(kompakt(), row, 24))).toEqual([1, 2, 24])
    expect([0, 1, 6].map(row => slotForRow({ rack_type: 'standard' }, row, 7))).toEqual([7, 6, 1])
    expect(slotForRow(null, 0, 7)).toBe(7)
  })
})

describe('Kompakt-Regal in der Komponenten-Auswahl', () => {
  it('bringt „kein Magazin" und den Magnet-Greifer mit', () => {
    const sel = selectComponent({ holder: 'standard', topSlot: 'magazine', gripper: 'standard' }, 'holder', 'compact')
    expect(sel).toEqual({ holder: 'compact', topSlot: 'storage', gripper: 'magnet' })
    expect(isCompactSelection(sel)).toBe(true)
    expect(lockedBy('gripper', 'standard', sel)).toMatch(/Magnet-Greifer/)
    expect(lockedBy('topSlot', 'magazine', sel)).toMatch(/kein Magazin/)
    expect(lockedBy('gripper', 'magnet', sel)).toBeNull()
  })
  it('leitet 24 Fächer, 16 mm und kein Magazin ab', () => {
    const cfg = derivedConfig({ holder: 'compact', gripper: 'standard', topSlot: 'magazine' })
    expect(cfg).toMatchObject({ rack_type: 'compact', slots_per_rack: 24, magazine_slot: 0,
                                pitch: 16, slot_height_mm: 16, gripper_id: 'magnet', with_magazine: false })
  })
  it('Standard bleibt Standard', () => {
    const cfg = derivedConfig({ holder: 'standard', gripper: 'standard', topSlot: 'magazine' })
    expect(cfg).toMatchObject({ rack_type: 'standard', slots_per_rack: 6, magazine_slot: 7, gripper_id: 'standard' })
    expect(lockedBy('gripper', 'standard', { holder: 'standard' })).toBeNull()
  })
})
