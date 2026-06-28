// AMS matching helpers — mirror of backend printer._ams_match_confident so the
// UI can flag "manuelle AMS-Festlegung notwendig" and block the start before the
// farm even runs. Keep the logic in sync with backend/app/routers/printer.py.

export const AMS_COLOR_THRESHOLD   = 80   // „noch akzeptabel" — sync mit backend printer.py
export const EXACT_COLOR_THRESHOLD = 40   // „exakt dieselbe Farbe" — sync mit backend printer.py

export function colorDist(hex1, hex2) {
  const p = h => {
    const s = (h || '000000').replace('#', '').padEnd(6, '0')
    return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]
  }
  const [r1, g1, b1] = p(hex1)
  const [r2, g2, b2] = p(hex2)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

const norm = c => (c || '').replace('#', '').toUpperCase().slice(0, 6)

/**
 * Return the filaments that have NO confident AMS match (right material AND
 * close colour). Empty array → safe to print automatically.
 * filaments: [{type, color}], amsSlots: [{gid, type, color}]
 */
export function amsMissing(filaments, amsSlots) {
  const slots = (amsSlots || []).map(s => {
    const type = (s.type || '').toUpperCase().trim()
    return { gid: s.gid, type, base: type.split(/\s+/)[0], color: norm(s.color) }
  })
  const missing = []
  ;(filaments || []).forEach((f, i) => {
    const ftype = (f.type || '').toUpperCase().trim()
    const fbase = ftype.split(/\s+/)[0]
    const fcolor = norm(f.color)

    if (!slots.length) {
      missing.push({ index: i, type: f.type, color: f.color, reason: 'AMS nicht lesbar' })
      return
    }
    const cands = slots.filter(s => fbase && (
      fbase === s.base || s.type.includes(fbase) || (s.base && ftype.includes(s.base))
    ))
    if (!cands.length) {
      missing.push({ index: i, type: f.type, color: f.color, reason: 'kein passendes Material' })
      return
    }
    if (fcolor && cands.some(s => s.color)) {
      const best = cands.reduce((a, b) => (colorDist(fcolor, a.color) <= colorDist(fcolor, b.color) ? a : b))
      if (colorDist(fcolor, best.color) > AMS_COLOR_THRESHOLD) {
        missing.push({ index: i, type: f.type, color: f.color, reason: 'Farbe weicht ab' })
      }
    }
  })
  return missing
}

/**
 * Read-only AMS-Mapping-Vorschau (1.3): zeigt je Datei-Filament den voraussichtlich
 * gewählten AMS-Slot und die Trefferqualität. Spiegelt die 3-Stufen-Logik des
 * Backends (_pick_slot): exact ≤ EXACT, similar ≤ AMS_COLOR_THRESHOLD, sonst far.
 * Rückgabe je Filament: {index, type, color, slot|null, quality}.
 * quality ∈ 'exact' | 'similar' | 'far' | 'missing' | 'unreadable'.
 */
export function amsAutoMap(filaments, amsSlots) {
  const slots = (amsSlots || []).map(s => {
    const type = (s.type || '').toUpperCase().trim()
    return { gid: s.gid, type, base: type.split(/\s+/)[0], color: norm(s.color) }
  })
  return (filaments || []).map((f, i) => {
    const ftype = (f.type || '').toUpperCase().trim()
    const fbase = ftype.split(/\s+/)[0]
    const fcolor = norm(f.color)
    if (!slots.length) return { index: i, type: f.type, color: f.color, slot: null, quality: 'unreadable' }
    const cands = slots.filter(s => fbase && (
      fbase === s.base || s.type.includes(fbase) || (s.base && ftype.includes(s.base))
    ))
    if (!cands.length) return { index: i, type: f.type, color: f.color, slot: null, quality: 'missing' }
    const best = cands.reduce((a, b) => (colorDist(fcolor, a.color) <= colorDist(fcolor, b.color) ? a : b))
    const d = (fcolor && best.color) ? colorDist(fcolor, best.color) : 0
    const quality = d <= EXACT_COLOR_THRESHOLD ? 'exact' : (d <= AMS_COLOR_THRESHOLD ? 'similar' : 'far')
    return { index: i, type: f.type, color: f.color, slot: best, quality }
  })
}
