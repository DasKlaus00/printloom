import { controlService } from './api'

/* Geometrie lesen und schreiben — mit Revision (seit v1.1.52).
   ───────────────────────────────────────────────────────────
   Das Backend speichert nur, wenn die Revision (If-Match) noch stimmt, sonst 409.
   Bis v1.1.51 schrieb jede Seite ihre ganze Kopie zurück; eine länger offene Seite
   überschrieb damit neuere Positionen. Nach jedem Schreiben geht das Ereignis
   „printloom:geometrySaved" mit {revision, source}, damit offene Seiten Bescheid wissen. */

export async function loadGeometry() {
  const r = await controlService.getGeometry()
  return { geometry: r?.data?.geometry, revision: r?.data?.revision }
}

function announce(revision, source) {
  window.dispatchEvent(new CustomEvent('printloom:geometrySaved', { detail: { revision, source } }))
}

export async function saveGeometry(geometry, revision, source = '') {
  const r = await controlService.putGeometry(geometry, revision)
  announce(r?.data?.revision, source)
  return r
}

/* Lesen, ändern, schreiben. Hat sich die Datei dazwischen geändert (409), einmal frisch
   lesen und `fn` noch einmal auf den neuen Stand anwenden — nie die alte Kopie. */
export async function patchGeometry(fn, source = '', api = { loadGeometry, saveGeometry }) {
  for (let versuch = 0; versuch < 2; versuch++) {
    const { geometry, revision } = await api.loadGeometry()
    if (!geometry) return null
    try {
      return await api.saveGeometry(fn(structuredClone(geometry)), revision, source)
    } catch (e) {
      if (e?.response?.status !== 409 || versuch === 1) throw e
    }
  }
  return null
}
