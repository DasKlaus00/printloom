import { describe, it, expect } from 'vitest'
import { amsMissing } from './amsUtils'
import { amsClimate } from './amsUtils'

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


describe('AMS-Klima', () => {
  // Echte Form aus dem Drucker (Strings), über printer._status_from_raw
  it('Feuchte in % rF, wenn der Drucker sie meldet', () => {
    expect(amsClimate({ temp: '24.1', humidity: '4', humidity_raw: '37' })).toBe('24.1 °C · 37 % rF')
  })
  it('sonst die Stufe, nie als Prozent', () => {
    expect(amsClimate({ temp: '24.1', humidity: '4' })).toBe('24.1 °C · Feuchte-Stufe 4/5')
  })
  it('fehlend ist „—", nicht 0', () => {
    expect(amsClimate({ temp: null, humidity: null })).toBe('— · —')
  })
})
