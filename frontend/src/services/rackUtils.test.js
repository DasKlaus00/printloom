import { describe, it, expect } from 'vitest'
import { parseSlotKey, slotsNeeded, autoSlot, checkClearance } from './rackUtils'

/** Build rackData with all slots free (status 'free'). */
function rack(numRacks = 1, perRack = 6) {
  const slots = {}
  for (let r = 1; r <= numRacks; r++)
    for (let s = 1; s <= perRack; s++) slots[`${r}-${s}`] = { status: 'free', object_height_mm: null }
  return { num_racks: numRacks, slots_per_rack: perRack, slot_height_mm: 50, slots }
}

describe('parseSlotKey', () => {
  it('parses rack-slot', () => expect(parseSlotKey('2-3')).toEqual([2, 3]))
  it('treats single number as rack 1', () => expect(parseSlotKey('5')).toEqual([1, 5]))
})

describe('slotsNeeded', () => {
  // 20mm Toleranz (SLOT_TOLERANCE_MM): ein Objekt darf so weit über sein
  // oberstes Fach ragen → slotsNeeded = max(1, ceil((h - 20) / slotH)).
  it('0/empty height needs 1 slot', () => expect(slotsNeeded(0, 50)).toBe(1))
  it('fits in one slot', () => expect(slotsNeeded(40, 50)).toBe(1))
  it('small overshoot still 1 slot (tolerance)', () => expect(slotsNeeded(60, 50)).toBe(1))
  it('1-slot upper bound is slotH + tolerance', () => expect(slotsNeeded(70, 50)).toBe(1))
  it('just past tolerance needs two slots', () => expect(slotsNeeded(71, 50)).toBe(2))
  it('exact multiple stays two slots', () => expect(slotsNeeded(100, 50)).toBe(2))
  it('170mm needs three slots', () => expect(slotsNeeded(170, 50)).toBe(3))
  it('custom tolerance 0 = strict ceil', () => expect(slotsNeeded(170, 50, 0)).toBe(4))
  it('custom tolerance 0: 51mm needs two', () => expect(slotsNeeded(51, 50, 0)).toBe(2))
})

describe('autoSlot honors configured tolerance', () => {
  it('slot_tolerance_mm=0 reserves more slots for a tall object', () => {
    const rd = { num_racks: 1, slots_per_rack: 6, slot_height_mm: 50, slot_tolerance_mm: 0,
      slots: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`1-${i + 1}`, { status: 'free', object_height_mm: null }])) }
    rd.slots['1-1'] = { status: 'done', object_height_mm: 170 }   // 0mm Toleranz → 4 Fächer (1-1..1-4)
    expect(autoSlot([], rd, 30, 50)).toBe('1-5')
  })
})

describe('autoSlot', () => {
  it('picks first slot on an empty rack', () => {
    expect(autoSlot([], rack(), 30, 50)).toBe('1-1')
  })

  it('avoids slots taken by other pending jobs', () => {
    const jobs = [{ slot: '1-1', status: 'pending', computedHeight: 30 }]
    expect(autoSlot(jobs, rack(), 30, 50)).toBe('1-2')
  })

  it('skips non-free slots', () => {
    const rd = rack()
    rd.slots['1-1'].status = 'done'
    expect(autoSlot([], rd, 30, 50)).toBe('1-2')
  })

  it('treats a ready slot as available (matches backend)', () => {
    const rd = rack()
    rd.slots['1-1'].status = 'ready'
    expect(autoSlot([], rd, 30, 50)).toBe('1-1')
  })

  it('reserves contiguous slots for a tall object', () => {
    // 80mm with 50mm slots → needs 2 contiguous slots, starts at 1-1
    expect(autoSlot([], rack(), 80, 50)).toBe('1-1')
  })

  it('respects clearance from a tall object stored below', () => {
    const rd = rack()
    // 100mm in 1-1 → 2 Fächer (20mm Toleranz) → 1-1,1-2 belegt. 1-3 bleibt auch
    // frei: das Objekt nutzt die Toleranz aus und ragt in den Raum, den die
    // einfahrende Platte bräuchte (sie kommt ~25 mm erhöht herein).
    rd.slots['1-1'] = { status: 'done', object_height_mm: 100 }
    expect(autoSlot([], rd, 30, 50)).toBe('1-4')
  })

  it('an object at most half a slot high still allows a plate above', () => {
    const rd = rack()
    rd.slots['1-1'] = { status: 'done', object_height_mm: 25 }   // = 50 % von 50mm
    expect(autoSlot([], rd, 30, 50)).toBe('1-2')
    rd.slots['1-1'] = { status: 'done', object_height_mm: 26 }
    expect(autoSlot([], rd, 30, 50)).toBe('1-3')
  })

  it('the stacked fraction is configurable', () => {
    const rd = rack()
    rd.slot_stacked_pct = 100                                     // volle Fachhöhe
    rd.slots['1-1'] = { status: 'done', object_height_mm: 45 }
    expect(autoSlot([], rd, 30, 50)).toBe('1-2')
  })

  it('a 170mm object below blocks three slots', () => {
    const rd = rack()
    rd.slots['1-1'] = { status: 'done', object_height_mm: 170 }
    expect(autoSlot([], rd, 30, 50)).toBe('1-5')   // 1-1..1-3 belegt, 1-4 als Luft
  })

  it('nothing tall goes under the magazine', () => {
    // Über dem obersten Fach liegt das Magazin — dort passt nur der Stapel-Anteil.
    const rd = rack(1, 6)
    rd.magazine_slot = 7
    for (let s = 1; s <= 5; s++) rd.slots[`1-${s}`] = { status: 'done', object_height_mm: 20 }
    expect(autoSlot([], rd, 60, 50)).toBe('1-0')   // 60mm passt nicht unter das Magazin
    expect(autoSlot([], rd, 20, 50)).toBe('1-6')   // 20mm schon
  })

  it('returns sentinel 1-0 when the rack is full', () => {
    const rd = rack(1, 2)
    rd.slots['1-1'].status = 'done'
    rd.slots['1-2'].status = 'done'
    expect(autoSlot([], rd, 30, 50)).toBe('1-0')
  })
})

describe('checkClearance', () => {
  it('ok when target + needed slots are free', () => {
    expect(checkClearance('1-1', 30, rack(), 50).ok).toBe(true)
  })
  it('flags a too-tall object exceeding the rack', () => {
    // 6 slots * 50mm = 300mm; 400mm cannot fit from slot 1
    const res = checkClearance('1-1', 400, rack(), 50)
    expect(res.ok).toBe(false)
  })
})
