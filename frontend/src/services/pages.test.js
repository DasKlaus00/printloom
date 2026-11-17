import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGES, NAV_GROUPS, PATH_TO_PAGE, PAGE_TO_PATH, pageForPath, pageTitle, navGroups } from './pages'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('Seitentabelle', () => {
  it('jede Seite hat eine eindeutige ID, einen Titel und eindeutige Adressen', () => {
    const ids = PAGES.map(p => p.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const p of PAGES) expect(p.title, p.id).toBeTruthy()
    const paths = PAGES.flatMap(p => [p.path, ...(p.extraPaths || [])])
    expect(new Set(paths).size).toBe(paths.length)
  })
  it('Gruppen verweisen nur auf vorhandene Gruppen, jede Gruppe hat Seiten', () => {
    const groupIds = new Set(NAV_GROUPS.map(g => g.id))
    for (const p of PAGES) if (p.group) expect(groupIds.has(p.group), p.id).toBe(true)
    for (const g of navGroups()) expect(g.pages.length, g.id).toBeGreaterThan(0)
  })
  it('Adresse und Seite passen in beide Richtungen', () => {
    for (const p of PAGES) {
      expect(PATH_TO_PAGE[PAGE_TO_PATH[p.id]]).toBe(p.id)
    }
    expect(pageForPath('/')).toBe('dashboard')
    expect(pageForPath('/layout')).toBe('drucker')
    expect(pageForPath('/mobile')).toBe('dashboard')     // alte Handy-Ansicht
    expect(pageForPath('/gibt-es-nicht')).toBe('dashboard')
    expect(pageTitle('filamente')).toBe('Filamente')    // fehlte bis v1.1.76
  })
  it('jede Seite hat eine Komponente in App.jsx und jede Leisten-Seite ein Symbol', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8')
    const block = app.slice(app.indexOf('const PAGE_COMPONENTS = {'))
    const map = block.slice(0, block.indexOf('}') + 1)
    for (const p of PAGES) expect(map, p.id).toMatch(new RegExp(`\\b${p.id}\\s*:`))
    const nav = fs.readFileSync(path.join(SRC, 'components', 'Navigation.jsx'), 'utf8')
    for (const p of PAGES.filter(x => x.group)) expect(nav, p.icon).toMatch(new RegExp(`\\n  ${p.icon}: \\(`))
  })
})
