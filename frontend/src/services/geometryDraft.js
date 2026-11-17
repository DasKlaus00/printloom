/* Drucker-Tab: Eingaben der Positionsfelder (seit v1.1.53).
   ─────────────────────────────────────────────────────────
   Bis v1.1.52 machte num() aus einem geleerten Feld die Koordinate 0: Der Autosave
   speicherte X=0, und die nächste Fahrt ging dorthin. Jetzt ist ein vom Nutzer
   geleertes oder unsinniges Feld null (ungültig), und gespeichert wird erst, wenn
   kein Feld ungültig ist. Ein nie gesetztes Feld (undefined) bleibt beim alten
   Verhalten, damit bestehende Anlagen weiter speichern können. */

export function numOrNull(v, fallback = 0) {
  if (v === undefined) return fallback
  const s = String(v ?? '').trim().replace(',', '.')
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const XYZ = ['x', 'y', 'z']

/* Pfade der ungültigen Positionsfelder, z. B. 'printers[0].eject.x'. */
export function invalidFields(g) {
  const bad = []
  const check = (obj, path, keys) => {
    if (!obj || typeof obj !== 'object') return
    for (const k of keys) if (k in obj && obj[k] === null) bad.push(`${path}.${k}`)
  }
  ;(g?.printers || []).forEach((p, i) => {
    for (const k of ['eject', 'load', 'move']) check(p?.[k], `printers[${i}].${k}`, XYZ)
    if (p?.door) for (const s of ['open', 'close']) check(p.door[s], `printers[${i}].door.${s}`, [...XYZ, 'd'])
  })
  for (const [nr, r] of Object.entries(g?.rack_geo || {})) check(r, `rack_geo[${nr}]`, ['x', 'y_engage', 'first_z', 'slot_gap'])
  check(g?.storage, 'storage', ['x_unclamp', 'y_engage', 'first_z_flat', 'slot_gap', 'rack_x_gap'])
  return bad
}
