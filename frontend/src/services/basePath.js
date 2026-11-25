/* Basis-Pfad, unter dem Printloom im Browser läuft (seit v1.1.85).
   Normal „/“. Die Demo auf der Website läuft unter „/live/“ hinter einem Proxy, der das
   Präfix vor dem Backend abschneidet — das Backend sieht also immer „/api/…“, nur der
   Browser braucht das Präfix. Gesetzt wird es beim Bauen: PRINTLOOM_BASE_PATH=/live/
   (vite.config.js → base → import.meta.env.BASE_URL). Eine Stelle für alle Pfade, die
   sonst hart mit „/“ anfangen: API, WebSocket, Service Worker, Seiten-URLs. */

/** Helfer für einen gegebenen Basis-Pfad (testbar ohne Build). */
export function makeBase(raw) {
  const base = String(raw || '/').replace(/\/+$/, '')          // '' oder '/live'
  return {
    base,
    /** '/api/x' → '/live/api/x' (bzw. unverändert ohne Basis-Pfad). */
    withBase: (path) => `${base}${String(path).startsWith('/') ? path : `/${path}`}`,
    /** '/live/dashboard' → '/dashboard'; fremde Pfade bleiben, wie sie sind. */
    stripBase: (pathname) => (base && (pathname === base || String(pathname).startsWith(`${base}/`))
      ? (String(pathname).slice(base.length) || '/') : pathname),
  }
}

const current = makeBase(import.meta.env?.BASE_URL)
export const BASE = current.base
export const withBase = current.withBase
export const stripBase = current.stripBase
