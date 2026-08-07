/* Die Bremse gegen die Update-Schleife.
 *
 * Meldet der Server eine andere Version als das geladene Bundle, lädt die App
 * neu. Das ist richtig — aber window.location.reload() zerstört die Seite, ein
 * Merker in einer Variablen ist danach weg. Bringt das Neuladen wieder dasselbe
 * alte Bundle (typisch: die index.html liegt im Browser-Cache), meldet der Server
 * unverändert die neue Version und es wird sofort wieder geladen: Endlosschleife,
 * die App ist nicht mehr bedienbar.
 *
 * Deshalb zählt der Guard die Versuche in der sessionStorage — die überlebt das
 * Neuladen. Diese Tests halten fest, dass er wirklich abbricht. */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { reloadForVersionChange, clearVersionReloads, isChunkLoadError } from './reloadGuard'

// Minimale sessionStorage- und location-Attrappe (Testumgebung ist node, kein DOM).
function umgebung(jetzt = 1_000_000) {
  const store = new Map()
  globalThis.sessionStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  }
  const reload = vi.fn()
  globalThis.window = { location: { reload } }
  vi.spyOn(Date, 'now').mockReturnValue(jetzt)
  return { reload, store }
}

describe('Versions-Neuladen', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('lädt beim ersten Versionsunterschied neu', () => {
    const { reload } = umgebung()
    expect(reloadForVersionChange()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('gibt nach zwei Versuchen auf, statt endlos zu laden', () => {
    const { reload } = umgebung()
    expect(reloadForVersionChange()).toBe(true)
    expect(reloadForVersionChange()).toBe(true)
    // Dritter Aufruf: der Cache klemmt offensichtlich — die App soll das melden,
    // nicht weiter neu laden.
    expect(reloadForVersionChange()).toBe(false)
    expect(reload).toHaveBeenCalledTimes(2)
  })

  it('ein späteres, echtes Update darf wieder laden', () => {
    const { reload } = umgebung(1_000_000)
    reloadForVersionChange()
    reloadForVersionChange()
    expect(reloadForVersionChange()).toBe(false)

    // Drei Minuten später: das ist kein Ping-Pong mehr, sondern ein neues Update.
    Date.now.mockReturnValue(1_000_000 + 180_000)
    expect(reloadForVersionChange()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(3)
  })

  it('nach passenden Versionen zählt es wieder von vorne', () => {
    umgebung()
    reloadForVersionChange()
    reloadForVersionChange()
    expect(reloadForVersionChange()).toBe(false)

    clearVersionReloads()          // Versionen stimmen überein
    expect(reloadForVersionChange()).toBe(true)
  })

  it('funktioniert auch ohne sessionStorage', () => {
    const { reload } = umgebung()
    globalThis.sessionStorage = {
      getItem() { throw new Error('blockiert') },
      setItem() { throw new Error('blockiert') },
      removeItem() { throw new Error('blockiert') },
    }
    // Privater Modus / gesperrte Storage: lieber einmal laden als gar nicht.
    expect(reloadForVersionChange()).toBe(true)
    expect(reload).toHaveBeenCalledTimes(1)
    expect(() => clearVersionReloads()).not.toThrow()
  })
})

describe('Stale-Chunk-Erkennung', () => {
  it('erkennt die Meldungen der Browser für ein fehlendes Lazy-Modul', () => {
    for (const msg of [
      'Unable to preload CSS for /assets/AutoFarm-C9.css',
      'Failed to fetch dynamically imported module: /assets/System-x.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
      'ChunkLoadError: Loading chunk 42 failed',
    ]) {
      expect(isChunkLoadError(new Error(msg)), msg).toBe(true)
    }
  })

  it('hält einen gewöhnlichen Fehler nicht dafür', () => {
    expect(isChunkLoadError(new Error('Cannot read properties of undefined'))).toBe(false)
    expect(isChunkLoadError(null)).toBe(false)
  })
})
