import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Wächter: useAutoRefresh nie mit einer Inline-Funktion aufrufen.
   ─────────────────────────────────────────────────────────────
   Der Effekt in useAutoRefresh hängt am Funktions-Objekt und ruft es sofort auf.
   Eine neue Funktion je Render ergibt eine Schleife: aufrufen → Zustand setzen →
   neu rendern → neue Funktion → aufrufen … So geschehen in v1.1.44 (motionLock.js,
   Dauerfeuer auf /autofarm/stress-test/status). Immer useCallback übergeben. */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const INLINE = /useAutoRefresh\(\s*(async\s*)?(\([^)]*\)\s*=>|[\w$]+\s*=>|function\b)/

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...sourceFiles(p)) }
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

describe('useAutoRefresh', () => {
  it('bekommt nie eine Inline-Funktion', () => {
    const bad = sourceFiles(SRC).filter(f => INLINE.test(fs.readFileSync(f, 'utf8')))
      .map(f => path.relative(SRC, f))
    expect(bad).toEqual([])
  })

  it('erkennt die Fehlerform', () => {
    expect(INLINE.test('useAutoRefresh(() => { load() }, 5000)')).toBe(true)
    expect(INLINE.test('useAutoRefresh(async () => {}, 0)')).toBe(true)
    expect(INLINE.test('useAutoRefresh(loadStress, 5000)')).toBe(false)
  })
})
