import { createContext, useContext, useEffect, useState } from 'react'

/**
 * App.jsx mountet jede besuchte Seite EINMAL und lässt sie gemountet (CSS-hidden),
 * damit ihr State Navigationswechsel überlebt. Kehrseite: mount-Zeit-Intervalle
 * liefen früher für versteckte Seiten ewig weiter (~1–2 Requests/s Dauerlast, sobald
 * man alle Seiten je besucht hatte). Dieser Context sagt jeder Seite, ob sie gerade
 * die AKTIVE ist — Polling pausiert versteckt und frischt beim Wiedersehen sofort auf.
 */
export const PageActiveContext = createContext(true)

/** true = Seite ist die aktuell angezeigte UND der Browser-Tab ist sichtbar. */
export function usePageActive() {
  const pageShown = useContext(PageActiveContext)
  const [tabVisible, setTabVisible] = useState(
    typeof document === 'undefined' || document.visibilityState !== 'hidden'
  )
  useEffect(() => {
    const on = () => setTabVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', on)
    return () => document.removeEventListener('visibilitychange', on)
  }, [])
  return pageShown && tabVisible
}

/**
 * Periodically calls `fn` while the page is ACTIVE (shown + tab visible), and once
 * immediately whenever it becomes active again (navigation back, tab focus, PWA
 * reopen). Hidden pages poll NOTHING.
 *
 * @param {Function} fn        stable callback (wrap in useCallback)
 * @param {number}   intervalMs polling interval; pass 0 to disable polling
 *                              and only refresh on (re-)activation.
 */
export function useAutoRefresh(fn, intervalMs = 12000) {
  const active = usePageActive()
  useEffect(() => {
    if (typeof fn !== 'function' || !active) return
    fn()   // beim (Wieder-)Aktivwerden sofort auffrischen — ersetzt den alten Focus-Listener
    const id = intervalMs > 0 ? setInterval(fn, intervalMs) : null
    const onFocus = () => fn()
    window.addEventListener('focus', onFocus)
    return () => {
      if (id) clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [fn, intervalMs, active])
}
