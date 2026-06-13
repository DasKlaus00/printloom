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
  it('0/empty height needs 1 slot', () => expect(slotsNeeded(0, 50)).toBe(1))
  it('fits in one slot', () => expect(slotsNeeded(40, 50)).toBe(1))
  it('rounds up to two slots', () => expect(slotsNeeded(60, 50)).toBe(2))
  it('exact multiple', () => expect(slotsNeeded(100, 50)).toBe(2))
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

  it('reserves contiguous slots for a tall object', () => {
    // 80mm with 50mm slots → needs 2 contiguous slots, starts at 1-1
    expect(autoSlot([], rack(), 80, 50)).toBe('1-1')
  })

  it('respects clearance from a tall object stored below', () => {
    const rd = rack()
    // A 100mm object in 1-1 (exact 2 slots) + 1 buffer → blocks 1-1,1-2,1-3
    rd.slots['1-1'] = { status: 'done', object_height_mm: 100 }
    expect(autoSlot([], rd, 30, 50)).toBe('1-4')
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
