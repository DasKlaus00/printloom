import { describe, it, expect } from 'vitest'
import { farmLogFor } from './farmLog'

describe('farmLogFor', () => {
  const status = { log: ['10:00:00 — Regal voll'], log_en: ['10:00:00 — Rack full'] }
  it('Deutsch zeigt die deutsche Fassung', () => {
    expect(farmLogFor(status, 'de')).toEqual(['10:00:00 — Regal voll'])
  })
  it('jede andere Sprache die englische', () => {
    expect(farmLogFor(status, 'en')).toEqual(['10:00:00 — Rack full'])
    expect(farmLogFor(status, 'zh-cn')).toEqual(['10:00:00 — Rack full'])
  })
  it('älterer Server ohne log_en: deutsche Fassung, ohne Status: leer', () => {
    expect(farmLogFor({ log: ['a'] }, 'en')).toEqual(['a'])
    expect(farmLogFor(null, 'en')).toEqual([])
  })
})
