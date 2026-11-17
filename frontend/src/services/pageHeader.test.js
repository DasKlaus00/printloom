import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Eine Stelle für die Seitenüberschrift (seit v1.1.69).
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PAGES = path.join(SRC, 'pages')

describe('Seitenkopf', () => {
  it('die Überschrift-Klasse steht nur in PageHeader.jsx', () => {
    const funde = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) walk(p)
        else if (/\.jsx$/.test(e.name) && e.name !== 'PageHeader.jsx'
                 && fs.readFileSync(p, 'utf8').includes('text-[1.45rem]')) funde.push(e.name)
      }
    }
    walk(SRC)
    expect(funde).toEqual([])
  })
  it('jede Seite hat einen Kopf', () => {
    const ohne = fs.readdirSync(PAGES).filter(n => /\.jsx$/.test(n))
      .filter(n => !['Setup.jsx', 'RackManager.jsx', 'Diagnose.jsx'].includes(n))
      .filter(n => !/from '\.\.\/components\/PageHeader'/.test(fs.readFileSync(path.join(PAGES, n), 'utf8')))
    expect(ohne).toEqual([])
  })
})
