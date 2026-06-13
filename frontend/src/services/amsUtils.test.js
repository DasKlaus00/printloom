import { describe, it, expect } from 'vitest'
import { amsMissing } from './amsUtils'

const slots = [
  { gid: 0, type: 'PLA', color: 'FF0000' },   // red PLA
  { gid: 1, type: 'PETG', color: '000000' },  // black PETG
]

describe('amsMissing', () => {
  it('no missing when material + colour match', () => {
    expect(amsMissing([{ type: 'PLA', color: '#FF0000' }], slots)).toEqual([])
  })

  it('tolerates a near-identical colour', () => {
    expect(amsMissing([{ type: 'PLA', color: '#FE0202' }], slots)).toEqual([])
  })

  it('flags a wrong colour (right material)', () => {
    const m = amsMissing([{ type: 'PLA', color: '#00FF00' }], slots)
    expect(m).toHaveLength(1)
    expect(m[0].reason).toBe('Farbe weicht ab')
  })

  it('flags a missing material', () => {
    const m = amsMissing([{ type: 'TPU', color: '#FFFFFF' }], slots)
    expect(m).toHaveLength(1)
    expect(m[0].reason).toBe('kein passendes Material')
  })

  it('flags everything when AMS is unreadable', () => {
    expect(amsMissing([{ type: 'PLA', color: '#FF0000' }], [])).toHaveLength(1)
  })

  it('matches material sub-brand names containing the base type', () => {
    expect(amsMissing([{ type: 'PLA Matte', color: '#FF0000' }], slots)).toEqual([])
  })
})
