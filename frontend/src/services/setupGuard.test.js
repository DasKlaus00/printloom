import { describe, it, expect } from 'vitest'
import { isExistingInstall, hasMixedSlotGaps, printerBlockIsCalibrated } from './setupGuard'

describe('Setup auf bestehender Anlage', () => {
  it('Geräte oder belegte Fächer heißen „bestehend"', () => {
    expect(isExistingInstall([{ id: 1 }], {})).toBe(true)
    expect(isExistingInstall([], { slots: { '1-1': { status: 'done' } } })).toBe(true)
    expect(isExistingInstall([], { slots: { '1-1': { status: 'free', empty_plate: true } } })).toBe(true)
    expect(isExistingInstall([], { slots: { '1-1': { status: 'free' } } })).toBe(false)
    expect(isExistingInstall(null, null)).toBe(false)
  })
  it('verschiedene Fach-Abstände werden erkannt', () => {
    expect(hasMixedSlotGaps({ rack_geo: { 1: { slot_gap: 25 }, 2: { slot_gap: 25 } } })).toBe(false)
    expect(hasMixedSlotGaps({ rack_geo: { 1: { slot_gap: 25 }, 2: { slot_gap: 30 } } })).toBe(true)
  })
  it('eingemessener Drucker-Block', () => {
    expect(printerBlockIsCalibrated({ device_id: 2 }, { x: 1 })).toBe(true)
    expect(printerBlockIsCalibrated({ eject: { x: 100, y: 5, z: 10 } }, { x: 100, y: 5, z: 10 })).toBe(false)
    expect(printerBlockIsCalibrated({ eject: { x: 112, y: 5, z: 10 } }, { x: 100, y: 5, z: 10 })).toBe(true)
  })
})
