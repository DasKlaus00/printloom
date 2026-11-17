import { tr } from './i18n'
import { apiDetail } from './apiError'

/* Regal-Formulare: Eingaben prüfen, bevor etwas gespeichert wird (seit v1.1.50).
   ─────────────────────────────────────────────────────────────────────────────
   Bis v1.1.49 machte jedes Formular selbst `+wert` oder `parseInt(v) || 0`: Ein
   geleertes Feld wurde 0 (null Fächer, null Platten im Magazin) und ging so an
   den Server. Hier gibt es für jedes Feld entweder eine Zahl oder einen Fehler.
   Die Grenzen kommen vom Backend (GET /rack-manager/ → limits, dieselben, mit denen
   rack_store.apply_config klemmt), stehen also nur einmal. */

const INTEGER = new Set(['num_racks', 'slots_per_rack', 'magazine_slot', 'max_plates', 'magazine_count'])

export function parseNumber(raw, key, limits = {}) {
  const s = String(raw ?? '').trim().replace(',', '.')
  if (s === '') return { error: tr('leer') }
  const n = Number(s)
  if (!Number.isFinite(n)) return { error: tr('keine Zahl') }
  if (INTEGER.has(key) && !Number.isInteger(n)) return { error: tr('nur ganze Zahlen') }
  const [lo, hi] = limits[key] || []
  if (lo != null && n < lo) return { error: tr('mindestens {0}', lo) }
  if (hi != null && n > hi) return { error: tr('höchstens {0}', hi) }
  return { value: n }
}

/* fields: { schlüssel: Eingabe } — Listen (magazine_defaults, magazine_counts) als
   Array. → { body, errors }; errors[schlüssel] = Text, leer = alles gültig. */
export function parseRackForm(fields, limits = {}) {
  const body = {}
  const errors = {}
  for (const [key, raw] of Object.entries(fields)) {
    if (Array.isArray(raw)) {
      const vals = raw.map(v => parseNumber(v, 'magazine_count', limits))
      const bad = vals.findIndex(v => v.error)
      if (bad >= 0) errors[key] = tr('Regal {0}: {1}', bad + 1, vals[bad].error)
      else body[key] = vals.map(v => v.value)
      continue
    }
    const r = parseNumber(raw, key, limits)
    if (r.error) errors[key] = r.error
    else body[key] = r.value
  }
  // Das Magazin-Fach liegt über den Lagerfächern (sonst wäre es Ablageziel), 0 = keins.
  if (body.magazine_slot != null && body.slots_per_rack != null
      && body.magazine_slot !== 0 && body.magazine_slot <= body.slots_per_rack) {
    errors.magazine_slot = tr('muss über den Fächern liegen (> {0}) oder 0 sein', body.slots_per_rack)
  }
  return { body, errors }
}

/* Fehlertext einer abgelehnten Regal-Speicherung. Bei 409 „Verkleinern über belegte
   Fächer" schickt das Backend {detail, slots} — als Objekt nicht direkt anzeigbar. */
export function rackSaveError(e) {
  const d = apiDetail(e)
  if (d && typeof d === 'object') {
    if (Array.isArray(d.slots) && d.slots.length) {
      return tr('Fächer {0} sind belegt — erst unter Auto Farm → Regal leeren', d.slots.join(', '))
    }
    return d.detail || tr('Fehler')
  }
  return d ?? e?.message ?? tr('Fehler')
}
