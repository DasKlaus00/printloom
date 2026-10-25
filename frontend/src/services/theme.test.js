/* Welches Thema gilt beim Start?
 *
 * Standard ist „System". Gespeichert wird nur eine ausdrückliche Wahl — der Start
 * selbst schreibt nichts. Sonst wäre aus „nie gewählt" beim ersten Laden ein fest
 * gespeichertes Thema geworden, und ein neuer Standard käme bei niemandem an
 * (so geschehen in v1.1.36). */
import { describe, it, expect, beforeEach } from 'vitest'
import { getTheme, initTheme, applyTheme, DEFAULT_THEME } from './theme'

// Minimale localStorage-/document-Attrappe (Testumgebung ist node, kein DOM).
let store
beforeEach(() => {
  store = new Map()
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }
  const attrs = {}
  globalThis.document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v }, attrs },
    querySelector: () => null,
  }
  globalThis.window = { dispatchEvent: () => {}, matchMedia: () => ({ matches: false, addEventListener: () => {} }) }
  globalThis.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init?.detail } }
})

describe('getTheme', () => {
  it('ohne jede Wahl gilt „System"', () => {
    expect(DEFAULT_THEME).toBe('auto')
    expect(getTheme()).toBe('auto')
  })

  it('eine ausdrückliche Wahl gewinnt', () => {
    store.set('printloom_theme_choice', 'light')
    expect(getTheme()).toBe('light')
  })

  it('alte dunkle Themen bleiben dunkel', () => {
    for (const alt of ['dark', 'slate', 'midnight']) {
      store.clear()
      store.set('printloom_theme', alt)
      expect(getTheme()).toBe('dark')
    }
  })

  it('das von v1.1.36 beim Start gespeicherte „Hell" ist keine Wahl', () => {
    store.set('printloom_theme', 'light')
    expect(getTheme()).toBe('auto')
  })
})

describe('Start und Wahl', () => {
  it('der Start speichert nichts', () => {
    initTheme()
    expect(store.size).toBe(0)
  })

  it('eine Wahl wird gemerkt', () => {
    applyTheme('dark')
    expect(store.get('printloom_theme_choice')).toBe('dark')
    expect(getTheme()).toBe('dark')
  })
})
