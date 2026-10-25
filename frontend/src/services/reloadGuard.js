// Stale-Chunk nach einem Update: Vite-Builds haben content-gehashte Dateinamen
// (z. B. AutoFarm-C9-ySRfk.css). Wird die App aktualisiert, ersetzt der neue Container
// die alten Assets. Ein Browser-Tab, der noch die ALTE Version geladen hat, kann beim
// Lazy-Navigieren ein gelöschtes Asset nicht mehr nachladen:
//   "Unable to preload CSS for …" / "Failed to fetch dynamically imported module".
// Einmal hart neu laden holt die frische index.html + neue Hashes. Der Guard verhindert
// eine Reload-Schleife, falls das Asset serverseitig WIRKLICH fehlt (dann bleibt die
// Fehlerseite mit „Neu laden"-Knopf stehen, statt endlos neu zu laden).
const KEY = 'ottomat3d_chunk_reload_at'
const COOLDOWN_MS = 15000

export function isChunkLoadError(error) {
  const msg = String((error && error.message) || error || '')
  return /Unable to preload CSS|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|dynamically imported module|ChunkLoadError|Loading chunk .* failed/i.test(msg)
}

export function reloadOnceForStaleChunk() {
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch { /* ignore */ }
  if (Date.now() - last < COOLDOWN_MS) return false   // gerade erst probiert → keine Schleife
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch { /* ignore */ }
  window.location.reload()
  return true
}

/* ── Neu laden, weil der Container eine andere Version meldet ────────────────
   Nach einem Update passt das im Tab geladene Bundle nicht mehr zum Server →
   einmal neu laden holt das neue Frontend.

   Warum das GEZÄHLT wird: window.location.reload() zerstört die Seite, ein
   Merker in einer Variablen ist danach weg. Kommt nach dem Neuladen WIEDER das
   alte Bundle (typisch: der Browser hat die index.html im Cache und holt
   weiterhin die alten Asset-Namen), meldet der Server unverändert die neue
   Version — und es wird sofort wieder neu geladen. Endlosschleife, die Seite
   ist nicht mehr bedienbar.

   Deshalb: höchstens MAX_VERSION_RELOADS Versuche. Danach wird nicht mehr
   geladen, sondern zurückgemeldet, dass es hängt — dann hilft nur noch ein
   Neuladen unter Umgehung des Caches (Strg+Umschalt+R). */
const VKEY  = 'printloom_version_reloads'
const VTIME = 'printloom_version_reload_at'
const MAX_VERSION_RELOADS = 2
const VERSION_WINDOW_MS = 120000     // danach zählt ein Versuch als „lange her"

/** true = Seite wird neu geladen · false = schon zu oft versucht, es hängt. */
export function reloadForVersionChange() {
  let n = 0, at = 0
  try {
    n  = Number(sessionStorage.getItem(VKEY) || 0)
    at = Number(sessionStorage.getItem(VTIME) || 0)
  } catch { /* ignore */ }
  // Liegt der letzte Versuch lange zurück, ist es ein neues Update, keine Schleife.
  if (Date.now() - at > VERSION_WINDOW_MS) n = 0
  if (n >= MAX_VERSION_RELOADS) return false
  try {
    sessionStorage.setItem(VKEY, String(n + 1))
    sessionStorage.setItem(VTIME, String(Date.now()))
  } catch { /* ignore */ }
  window.location.reload()
  return true
}

/** Nach erfolgreichem Laden aufrufen: Zähler zurücksetzen (Versionen passen). */
export function clearVersionReloads() {
  try {
    sessionStorage.removeItem(VKEY)
    sessionStorage.removeItem(VTIME)
  } catch { /* ignore */ }
}
