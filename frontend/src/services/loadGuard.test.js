import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Wächter: „geladen" nur nach erfolgreichem Laden.
   ───────────────────────────────────────────────
   Bis v1.1.47 setzten mehrere Seiten ihr loaded/ready auch im finally oder catch.
   Nach einem Ladefehler (Backend kurz weg, Datei kaputt) speicherten sie dann ihre
   Vorgaben über die echten Daten: leere Warteschlange, Standard-Sequenzen,
   Vorgabe-Geometrie. Diese Formen sind in src/pages verboten. */
const HERE = path.dirname(fileURLToPath(import.meta.url))
const PAGES = path.resolve(HERE, '..', 'pages')

const VERBOTEN = [
  /\.finally\(\s*\(\)\s*=>\s*\{?\s*set\w*(Loaded|Ready)\(true\)/,
  /\.catch\(\s*\(\)\s*=>\s*\{?\s*set\w*(Loaded|Ready)\(true\)/,
  /\.finally\(\s*\(\)\s*=>\s*\{?\s*hydrated\.current\s*=\s*true/,
  /\.catch\(\s*\(?\w*\)?\s*=>\s*\{?\s*hydrated\.current\s*=\s*true/,
]

describe('Speichern erst nach erfolgreichem Laden', () => {
  it('keine Seite setzt „geladen" im finally oder catch', () => {
    const funde = []
    for (const name of fs.readdirSync(PAGES).filter(n => /\.jsx?$/.test(n))) {
      const text = fs.readFileSync(path.join(PAGES, name), 'utf8')
      for (const re of VERBOTEN) if (re.test(text)) funde.push(`${name}: ${re}`)
    }
    expect(funde).toEqual([])
  })

  it('erkennt die Fehlerformen', () => {
    const trifft = s => VERBOTEN.some(re => re.test(s))
    expect(trifft('.finally(() => setQueueLoaded(true))')).toBe(true)
    expect(trifft('.catch(() => setRackReady(true))')).toBe(true)
    expect(trifft('.catch(() => {}).finally(() => { hydrated.current = true })')).toBe(true)
    expect(trifft('.then(r => { setLoaded(true) })')).toBe(false)
  })
})
