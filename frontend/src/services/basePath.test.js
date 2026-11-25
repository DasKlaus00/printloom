/* Basis-Pfad (seit v1.1.85): Printloom läuft normal unter „/“, die Website-Demo unter
   „/live/“ hinter einem Proxy, der das Präfix abschneidet. */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { makeBase, withBase, stripBase } from './basePath'

describe('Basis-Pfad', () => {
  it('ohne Basis-Pfad bleibt alles, wie es war', () => {
    expect(withBase('/api/files/1/thumbnail')).toBe('/api/files/1/thumbnail')
    expect(stripBase('/dashboard')).toBe('/dashboard')
  })
  it('unter /live/ bekommt jeder Pfad das Präfix', () => {
    const b = makeBase('/live/')
    expect(b.base).toBe('/live')
    expect(b.withBase('/api/autofarm/ws')).toBe('/live/api/autofarm/ws')
    expect(b.withBase('sw.js')).toBe('/live/sw.js')
    expect(b.stripBase('/live/dashboard')).toBe('/dashboard')
    expect(b.stripBase('/live')).toBe('/')
    expect(b.stripBase('/lively')).toBe('/lively')      // nur das echte Präfix
    expect(b.stripBase('/dashboard')).toBe('/dashboard')
  })
})

// Wächter: Jeder Pfad, der im Browser mit „/api“ anfängt, muss über withBase laufen —
// sonst geht er in der Demo unter /live/ an die Website statt an Printloom.
describe('keine festen /api-Pfade im Browser-Code', () => {
  const SRC = path.resolve(__dirname, '..')
  const files = []
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) files.push(p)
  })
  walk(SRC)
  it('alle über withBase', () => {
    const bad = []
    for (const f of files) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/['"`]\/api\//.test(line) && !/withBase\(/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line)) {
          bad.push(`${path.relative(SRC, f)}:${i + 1}`)
        }
      })
    }
    expect(bad).toEqual([])
  })
})
