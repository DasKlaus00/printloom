import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fmtDur, fmtEur, fmtKwh } from './format'
import { costBreakdown } from './costs'

describe('fmtDur', () => {
  it('erst runden, dann teilen (kein „60 min")', () => {
    expect(fmtDur(7170)).toBe('2 h 0 min')
    expect(fmtDur(3599)).toBe('1 h 0 min')
    expect(fmtDur(3600 + 5 * 60)).toBe('1 h 5 min')
    expect(fmtDur(12 * 60)).toBe('12 min')
  })
  it('kurze Dauern zeigen mindestens 1 min', () => {
    expect(fmtDur(59)).toBe('1 min')
    expect(fmtDur(20)).toBe('1 min')
  })
  it('keine Dauer → null', () => {
    expect(fmtDur(0)).toBeNull()
    expect(fmtDur(null)).toBeNull()
    expect(fmtDur(undefined)).toBeNull()
    expect(fmtDur(-5)).toBeNull()
    expect(fmtDur(NaN)).toBeNull()
  })
})

describe('Beträge', () => {
  // Intl setzt zwischen Zahl und € ein geschütztes Leerzeichen
  it('Euro in der Sprache der Oberfläche', () => {
    expect(fmtEur(12.34, 'de-DE').replace(/\s/g, ' ')).toBe('12,34 €')
    expect(fmtEur(12.34, 'en-US')).toBe('€12.34')
  })
  it('kWh mit höchstens einer Nachkommastelle', () => {
    expect(fmtKwh(12.345, 'de-DE')).toBe('12,3')
    expect(fmtKwh(12, 'en-US')).toBe('12')
  })
})

describe('costBreakdown', () => {
  // Echte Form von GET /autofarm/stats und /autofarm/settings
  const stats = { total_jobs: 7, successful_jobs: 6, total_kwh: 3.4, total_print_min: 545,
                  total_filament_g: 812.5, filament_jobs: 5 }
  const cfg = { power_price_eur_kwh: 0.32, machine_rate_eur_h: 1.5, filament_price_eur_kg: 22, idle_off_min: 0 }
  it('die Teile ergeben die Summe — auch mit Maschinenzeit', () => {
    const c = costBreakdown(stats, cfg)
    expect(c.energy).toBeCloseTo(3.4 * 0.32, 10)
    expect(c.machine).toBeCloseTo((545 / 60) * 1.5, 10)
    expect(c.material).toBeCloseTo(0.8125 * 22, 10)
    expect(c.energy + c.machine + c.material).toBeCloseTo(c.total, 10)
  })
  it('fehlende Werte zählen als 0, ohne Einstellungen keine Rechnung', () => {
    const c = costBreakdown({ total_jobs: 1 }, cfg)
    expect(c.total).toBe(0)
    expect(costBreakdown(stats, null)).toBeNull()
    expect(costBreakdown(null, cfg)).toBeNull()
  })
})

describe('eine Stelle für Dauern', () => {
  it('kein eigener h/min-Formatierer außerhalb von format.js', () => {
    const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
    const funde = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.jsx?$/.test(e.name) && !/\.test\.js$/.test(e.name) && e.name !== 'format.js'
                 && /\$\{[^}]+\}\s?h\s?\$\{/.test(fs.readFileSync(p, 'utf8'))) funde.push(e.name)
      }
    }
    walk(SRC)
    expect(funde).toEqual([])
  })
})
