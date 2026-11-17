/* Regeln, die schon einmal die Oberflaeche zerlegt haben.

   Die globale Input-Regel (w-full + Polsterung + Rahmen) galt bis v1.1.29 auch
   fuer Haken: aus einem Kontrollkaestchen wurde ein bildschirmbreiter Kasten,
   und der Text daneben stand als Spalte aus Einzelwoertern. Kein Test sah das —
   deshalb steht die Ausnahme hier fest. */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve, join } from 'path'

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// CRLF (Windows-Checkout) wie LF behandeln
const css = readFileSync(resolve(SRC, 'index.css'), 'utf8').replace(/\r\n/g, '\n')

function jsxFiles(dir = SRC) {
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...jsxFiles(p))
    else if (e.name.endsWith('.jsx')) out.push(p)
  }
  return out
}
const SOURCES = jsxFiles().map(p => [p.slice(SRC.length + 1).replace(/\\/g, '/'), readFileSync(p, 'utf8')])
const funde = (re) => SOURCES.flatMap(([name, s]) => [...s.matchAll(re)].map(m => `${name}: ${m[0]}`))

// Öffnende <button …>-Tags; ein '>' innerhalb von {…} beendet den Tag nicht
function buttonTags(s) {
  const tags = []
  for (const m of s.matchAll(/<button\b/g)) {
    let i = m.index + 7, depth = 0
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++
      else if (s[i] === '}') depth--
      else if (s[i] === '>' && depth === 0) break
    }
    tags.push(s.slice(m.index, i))
  }
  return tags
}

describe('index.css', () => {
  it('nimmt Haken und Radioknoepfe von der Textfeld-Regel aus', () => {
    const regel = css.split('\n').find(z => z.includes('textarea, select {'))
    expect(regel, 'Textfeld-Regel nicht gefunden').toBeTruthy()
    expect(regel).toContain('[type="checkbox"]')
    expect(regel).toContain('[type="radio"]')
  })

  it('gibt Haken eine eigene, kleine Groesse', () => {
    expect(css).toMatch(/input\[type="checkbox"\][^{]*\{[^}]*w-4/)
  })
})

/* Lesbarkeit (seit v1.1.70). surface-800 ist die Kartenfläche selbst, 900/950 Mulde
   und Seite — eine Linie in diesen Tönen sieht man nicht. Status-Stufen 700–900 sind
   Tönungen für Hintergründe, als Schrift in beiden Themen kaum lesbar. */
describe('Quelltext-Regeln für Lesbarkeit', () => {
  it('keine Linien in Flächenfarbe (border/divide-surface-800/900/950)', () => {
    expect(funde(/\b(border|divide)(-[trblxy])?-surface-(800|900|950)\b/g)).toEqual([])
  })
  it('keine Schrift in Tönungsstufen (Status 700–900, surface 800–950)', () => {
    expect(funde(/\btext-(blue|sky|cyan|indigo|red|rose|emerald|green|teal|amber|yellow|orange|violet|purple|fuchsia|pink)-(700|800|900)\b/g)).toEqual([])
    expect(funde(/\btext-surface-(800|900|950)\b/g)).toEqual([])
  })
  it('keine Schrift unter 10 px', () => {
    expect(funde(/\btext-\[[1-9]px\]/g)).toEqual([])
  })
  it('Knöpfe mindestens text-xs (12 px)', () => {
    const klein = SOURCES.flatMap(([name, s]) => buttonTags(s)
      .filter(t => [...t.matchAll(/text-\[(\d+)px\]/g)].some(m => Number(m[1]) < 12))
      .map(t => `${name}: ${t.slice(0, 80)}`))
    expect(klein).toEqual([])
  })
})

/* Die Kamera-Fläche ist immer schwarz: dort keine Themenfarben (seit v1.1.70). */
describe('Kamera-Fläche', () => {
  const farm = readFileSync(resolve(SRC, 'pages', 'AutoFarm.jsx'), 'utf8')
  for (const name of ['StreamView', 'X1CView', 'HaPollView']) {
    it(`${name} nutzt cam-surface und keine Themen-Schrift darin`, () => {
      const start = farm.indexOf(`function ${name}(`)
      const ende = farm.indexOf('\nfunction ', start + 10)
      const teil = farm.slice(start, ende)
      expect(teil).toContain('cam-surface')
      const flaeche = teil.slice(teil.indexOf('cam-surface'))
      expect(flaeche).not.toMatch(/text-(surface|red)-\d/)
    })
  }
  it('.cam-surface hat feste Farben', () => {
    expect(css).toMatch(/\.cam-surface\s*\{[^}]*background-color:\s*#000/)
  })
})

describe('Manifest', () => {
  const manifest = JSON.parse(readFileSync(resolve(SRC, '..', 'public', 'manifest.webmanifest'), 'utf8'))
  it('heißt Printloom', () => {
    expect(manifest.name).toBe('Printloom')
    expect(manifest.short_name).toBe('Printloom')
  })
  it('Hintergrund = helle Seitenfarbe (--s-950), Leiste = theme-color aus index.html', () => {
    const hell = css.match(/\[data-theme="light"\] \{[^}]*--s-950:\s*(\d+)\s+(\d+)\s+(\d+);/)
    const hex = '#' + hell.slice(1, 4).map(n => Number(n).toString(16).padStart(2, '0')).join('')
    expect(manifest.background_color).toBe(hex)
    const html = readFileSync(resolve(SRC, '..', 'index.html'), 'utf8')
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}"`)
  })
})

/* Seit v1.1.71: ein Farbpunkt-Baustein, benannte z-Stufen, ein Toast-System. */
describe('Eine Stelle je Baustein', () => {
  it('Farbpunkte mit backgroundColor gibt es nur in ColorDot.jsx', () => {
    const andere = SOURCES.filter(([name, s]) => name !== 'components/ColorDot.jsx' && /backgroundColor/.test(s))
      .map(([name]) => name)
    expect(andere).toEqual([])
  })
  it('keine freien z-Werte (z-[…]) — Stufen stehen in tailwind.config.js', () => {
    expect(funde(/\bz-\[\d+\]/g)).toEqual([])
  })
  it('Toasts unten rechts nur im Toaster', () => {
    const andere = SOURCES.filter(([name, s]) => name !== 'components/Toaster.jsx' && /fixed bottom-\d+ right-\d+/.test(s))
      .map(([name]) => name)
    expect(andere).toEqual([])
  })
})
