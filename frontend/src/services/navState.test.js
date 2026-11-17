import { describe, it, expect } from 'vitest'
import { navCompact } from './navState'

describe('Seitenleiste', () => {
  it('ohne Wahl: schmal eingeklappt, breit offen', () => {
    expect(navCompact(null, 1100)).toBe(true)
    expect(navCompact(null, 1600)).toBe(false)
  })
  it('die eigene Wahl gilt immer', () => {
    expect(navCompact('0', 1100)).toBe(false)
    expect(navCompact('1', 1920)).toBe(true)
  })
})
