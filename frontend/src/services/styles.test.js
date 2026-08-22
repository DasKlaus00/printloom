/* Regeln, die schon einmal die Oberflaeche zerlegt haben.

   Die globale Input-Regel (w-full + Polsterung + Rahmen) galt bis v1.1.29 auch
   fuer Haken: aus einem Kontrollkaestchen wurde ein bildschirmbreiter Kasten,
   und der Text daneben stand als Spalte aus Einzelwoertern. Kein Test sah das —
   deshalb steht die Ausnahme hier fest. */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const css = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../index.css'), 'utf8')

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
