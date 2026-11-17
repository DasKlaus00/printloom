/* Mindestkontrast in Hell und Dunkel (seit v1.1.70).
   Liest die generierten Variablen aus index.css (Quelle: scripts/theme_vars.py) und
   rechnet den WCAG-Kontrast. Bis v1.1.69 lagen gedämpfte Texte im Hellen bei
   2,3–4,0:1 und Weiß auf grünen/gelben Knöpfen im Dunkeln unter 4,5:1. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

// CRLF (Windows-Checkout) wie LF behandeln
const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8').replace(/\r\n/g, '\n')

function vars(selector) {
  const start = css.indexOf(selector)
  if (start < 0) throw new Error(`Block ${selector} fehlt in index.css`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out = {}
  for (const m of body.matchAll(/--([a-z]+-\d+):\s*(\d+)\s+(\d+)\s+(\d+);/g)) out[m[1]] = [+m[2], +m[3], +m[4]]
  return out
}

function luminance([r, g, b]) {
  const ch = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)
}
function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

const WHITE = [255, 255, 255]
const THEMES = {
  hell: vars(':root,\n[data-theme="light"]'),
  dunkel: vars('[data-theme="dark"] {'),
}

describe('Kontrast', () => {
  it('rechnet wie WCAG (Schwarz auf Weiß = 21:1)', () => {
    expect(contrast([0, 0, 0], WHITE)).toBeCloseTo(21, 5)
  })
  for (const [name, v] of Object.entries(THEMES)) {
    it(`${name}: gedämpfte Schrift (t-400 … t-700) ≥ 4,5:1 auf Karte und Seite`, () => {
      const zuWenig = []
      for (const t of [400, 500, 600, 700]) {
        for (const flaeche of ['s-800', 's-950']) {
          const r = contrast(v[`t-${t}`], v[flaeche])
          if (r < 4.5) zuWenig.push(`t-${t} auf ${flaeche}: ${r.toFixed(2)}`)
        }
      }
      expect(zuWenig).toEqual([])
    })
    it(`${name}: Weiß auf Vollton-Knöpfen (600) und deren Hover ≥ 4,5:1`, () => {
      // Hover: hell Stufe 500, dunkel Stufe 700 (siehe index.css, .btn-*)
      const hover = name === 'hell' ? 500 : 700
      const zuWenig = []
      for (const p of ['akzent', 'rot', 'gruen', 'gelb', 'lila']) {
        for (const stufe of [600, hover]) {
          const r = contrast(WHITE, v[`${p}-${stufe}`])
          if (r < 4.5) zuWenig.push(`${p}-${stufe}: ${r.toFixed(2)}`)
        }
      }
      expect(zuWenig).toEqual([])
    })
    it(`${name}: Statusschrift (400) ≥ 4,5:1 auf der Karte`, () => {
      const zuWenig = ['akzent', 'rot', 'gruen', 'gelb', 'lila']
        .map(p => [p, contrast(v[`${p}-400`], v['s-800'])]).filter(([, r]) => r < 4.5)
      expect(zuWenig).toEqual([])
    })
  }
  it('im Dunkeln gehen Vollton-Knöpfe beim Hover auf 700', () => {
    for (const [cls, farbe] of [['btn-primary', 'blue'], ['btn-danger', 'red'], ['btn-success', 'emerald'], ['btn-warning', 'amber']]) {
      expect(css).toMatch(new RegExp(`\\[data-theme="dark"\\] \\.${cls}[^{]*\\{[^}]*hover:bg-${farbe}-700`))
    }
  })
})
