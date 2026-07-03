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
