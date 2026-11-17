import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Wegweiser in Texten zeigen nur auf Stellen, die es gibt (seit v1.1.66). Bis v1.1.65
// stand da „Rack Manager" (nicht mehr in der Navigation), „Configuration" und ein
// Knopf „+ Datei", den es nicht mehr gibt.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const REITER = ['Geräte', 'Kameras', 'Allgemein']

function trTexte() {
  const out = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.jsx?$/.test(e.name) && !/\.test\./.test(e.name) && e.name !== 'i18n.js') {
        for (const m of fs.readFileSync(p, 'utf8').matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'/g)) {
          out.push([path.relative(SRC, p), m[1]])
        }
      }
    }
  }
  walk(SRC)
  return out
}

describe('Wegweiser', () => {
  it('„Konfiguration → X" nennt einen Reiter, den es gibt', () => {
    const falsch = trTexte().filter(([, t]) => {
      const m = t.match(/Konfiguration → ([A-Za-zÄÖÜäöüß]+)/)
      return m && !REITER.includes(m[1].trim())
    })
    expect(falsch).toEqual([])
  })
  it('keine alten Namen', () => {
    const falsch = trTexte().filter(([, t]) => /Rack Manager|\bConfiguration\b|\+ Datei/.test(t))
    expect(falsch).toEqual([])
  })
})
