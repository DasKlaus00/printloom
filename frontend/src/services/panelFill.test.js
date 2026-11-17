import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Panels füllen ihre Rasterzelle (seit v1.1.68). react-grid-layout setzt
// `react-grid-item` auf genau das div mit .panel-fill — die alte Regel
// `.react-grid-item > .panel-fill` griff deshalb nie.
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
// Ohne Kommentare: Die erwähnen die alten Namen absichtlich.
const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const farm = fs.readFileSync(path.join(SRC, 'pages', 'AutoFarm.jsx'), 'utf8')

describe('Panels füllen ihre Zelle', () => {
  it('Regel am Raster-Element selbst, als Flex-Spalte mit Container', () => {
    const regel = css.match(/\.react-grid-item\.panel-fill\s*\{([^}]*)\}/)
    expect(regel).not.toBeNull()
    expect(regel[1]).toMatch(/display:\s*flex/)
    expect(regel[1]).toMatch(/container-type:\s*inline-size/)
    expect(css).not.toMatch(/\.react-grid-item\s*>\s*\.panel-fill/)
  })
  it('das Aktivitäts-Log hat keine feste Höhe mehr', () => {
    expect(farm).not.toMatch(/className="[^"]*\bmax-h-52\b/)
  })
  it('Hinweise liegen unter der Kopfzeile', () => {
    expect(farm).not.toMatch(/className="[^"]*\bfixed top-2\b/)
  })
})
