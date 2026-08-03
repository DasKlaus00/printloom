// Shared rack slot utilities — used by AutoFarm and Projekt pages.
import { tr } from './i18n'

export function parseSlotKey(key) {
  const parts = String(key ?? '1-1').split('-')
  return parts.length === 2 ? [+parts[0], +parts[1]] : [1, +parts[0]]
}

// Spielraum nach oben: ein Objekt darf so viele mm über die Oberkante seines
// obersten Fachs ragen, bevor ein weiteres Fach reserviert wird (Toleranz für
// den kleinen Überstand zum nächsten Tray). Beispiel @50mm/Fach + 20mm:
//   170mm → ceil((170-20)/50) = 3 Fächer · ≤70mm → 1 Fach.
// Default; pro Regal via rackData.slot_tolerance_mm überschreibbar (Backend:
// app/services/rack_logic.py DEFAULT_SLOT_TOLERANCE_MM).
export const SLOT_TOLERANCE_MM = 20

// Toleranz aus der Regal-Konfiguration (oder Default).
export function slotTolerance(rackData) {
  const t = rackData?.slot_tolerance_mm
  return (typeof t === 'number' && t >= 0) ? t : SLOT_TOLERANCE_MM
}

// Liegt im Fach DARÜBER schon eine Platte, gilt nur noch dieser Anteil der
// Fachhöhe (%). Grund: die Platte fährt nicht waagerecht auf ihre Endhöhe ein,
// sondern kommt ~25 mm höher herein und wird abgesenkt (ottoeject_motion.
// store_to_rack) — beim Holen wird sie genauso angehoben. Solange von unten nach
// oben gefüllt wird, ist das Fach darüber in dem Moment leer und der Hub hat
// Platz; über dem Magazin (nie leer) und unter einem belegten Fach nicht.
// Backend: app/services/rack_logic.py DEFAULT_STACKED_PCT.
export const SLOT_STACKED_PCT = 50

export function stackedPct(rackData) {
  const v = rackData?.slot_stacked_pct
  return (typeof v === 'number' && v >= 0 && v <= 100) ? v : SLOT_STACKED_PCT
}

export function slotsNeeded(h, slotH, tol = SLOT_TOLERANCE_MM) {
  if (!h || h <= 0) return 1
  const sh = slotH || 50
  return Math.max(1, Math.ceil((h - tol) / sh))
}

// Höchstes Objekt, das in `needed` Fächer passt — je nachdem, was oben liegt.
export function heightLimit(needed, slotH, tol = SLOT_TOLERANCE_MM,
                            plateAbove = false, pct = SLOT_STACKED_PCT) {
  const sh = slotH || 50
  return plateAbove
    ? (needed - 1) * sh + sh * Math.max(0, Math.min(100, pct)) / 100
    : needed * sh + tol
}

// Liegt in diesem Fach physisch eine Platte? Das Magazin zählt IMMER als belegt —
// es wird von Hand nachgefüllt, jederzeit.
export function slotHasPlate(rackNum, slotNum, rSlots, magazineSlot = 0, taken = null) {
  if (magazineSlot && +slotNum === +magazineSlot) return true
  const k = `${rackNum}-${slotNum}`
  if (taken?.has(k)) return true
  const s = rSlots?.[k]
  if (!s) return false                     // kein solches Fach → offene Luft
  if (s.empty_plate) return true
  const st = s.status ?? 'free'
  return st !== 'free' && st !== 'ready'
}

// Returns true if a stored object in a slot below extends into the given slot.
function isBlockedFromBelow(rackNum, slotNum, rSlots, slotH, tol = SLOT_TOLERANCE_MM,
                            pct = SLOT_STACKED_PCT) {
  const sh = slotH || 50
  for (let s = slotNum - 1; s >= 1; s--) {
    const k    = `${rackNum}-${s}`
    const objH = rSlots[k]?.object_height_mm ?? 0
    if (objH <= 0) continue
    const gap = slotNum - s
    const needed = slotsNeeded(objH, sh, tol)
    if (needed > gap) return true
    // Endet genau darunter und ist zu hoch, als dass hier noch eine Platte
    // einfahren könnte (sie kommt erhöht herein).
    if (needed === gap && objH > heightLimit(needed, sh, tol, true, pct)) return true
  }
  return false
}

/**
 * Find the best available slot for a new job.
 * Respects: existing slot statuses, job-assigned slots, clearance from tall objects below.
 */
export function autoSlot(jobs, rackData, heightMm, slotH) {
  const nr     = rackData?.num_racks      ?? 3
  const spr    = rackData?.slots_per_rack  ?? 6
  const rSlots = rackData?.slots          ?? {}
  const sh     = slotH || 50
  const tol    = slotTolerance(rackData)
  const pct    = stackedPct(rackData)
  const mag    = +(rackData?.magazine_slot ?? 0) || 0
  const needed = slotsNeeded(heightMm, sh, tol)

  // Expand each queued job's base slot to ALL slots it will physically occupy.
  const taken = new Set()
  jobs
    .filter(j => !['done', 'error'].includes(j.status) && j.slot)
    .forEach(j => {
      const [rn, sn] = parseSlotKey(j.slot)
      const h = j.computedHeight ?? j.objectHeight ?? j.object_height_mm ?? 0
      const n = slotsNeeded(h, sh, tol)
      for (let i = 0; i < n; i++) taken.add(`${rn}-${sn + i}`)
    })

  // 'free' und 'ready' (Bereit) gelten als belegbar — identisch zum Backend
  // (_find_slot_for_height), damit Vorschau und realer Lauf dasselbe Fach wählen.
  const available = (st) => st === 'free' || st === 'ready'

  const isFree = (r, s) => {
    const k = `${r}-${s}`
    if (!(k in rSlots)) return false
    if (!available(rSlots[k].status)) return false
    if (taken.has(k)) return false
    if (isBlockedFromBelow(r, s, rSlots, sh, tol, pct)) return false
    return true
  }

  for (let r = 1; r <= nr; r++) {
    for (let s = 1; s <= spr - needed + 1; s++) {
      // Liegt über dem obersten belegten Fach schon eine Platte, passt nur noch
      // der Stapel-Anteil der Fachhöhe (identisch zum Backend, sonst zeigt die
      // Vorschau ein anderes Fach als die Farm nimmt).
      if (heightMm > heightLimit(needed, sh, tol,
                                 slotHasPlate(r, s + needed, rSlots, mag, taken), pct)) continue
      if (Array.from({ length: needed }, (_, i) => isFree(r, s + i)).every(Boolean))
        return `${r}-${s}`
    }
  }
  // Fallback: first free slot anywhere (ignores clearance from below).
  // Die Platte darüber wird auch hier beachtet — dort ist es keine Frage der
  // Reihenfolge, sondern schlicht unmöglich (die Platte fährt erhöht ein).
  for (let r = 1; r <= nr; r++) {
    for (let s = 1; s <= spr; s++) {
      const k = `${r}-${s}`
      if (!(k in rSlots) || !available(rSlots[k].status) || taken.has(k)) continue
      if (heightMm > heightLimit(needed, sh, tol,
                                 slotHasPlate(r, s + needed, rSlots, mag, taken), pct)) continue
      return k
    }
  }
  return '1-0'  // sentinel: rack full, no slot available
}

export function checkClearance(slotKey, heightMm, rackData, slotH) {
  const sh     = slotH || 50
  const tol    = slotTolerance(rackData)
  const pct    = stackedPct(rackData)
  const mag    = +(rackData?.magazine_slot ?? 0) || 0
  const needed = slotsNeeded(heightMm, sh, tol)
  const spr    = rackData?.slots_per_rack ?? 6
  const rSlots = rackData?.slots ?? {}
  const [rackNum, slotNum] = parseSlotKey(slotKey)
  const blocked = []

  // Check if this slot is blocked by a tall object in a lower slot
  if (isBlockedFromBelow(rackNum, slotNum, rSlots, sh, tol, pct)) {
    blocked.push(tr('Fach {0}-{1} (Objekt zu hoch)', rackNum, slotNum - 1))
  }

  // Liegt oben schon eine Platte, gilt nur der Stapel-Anteil — das ist der Fall,
  // der sonst erst beim Einfahren auffällt (Platte kommt erhöht herein).
  const above = slotNum + needed
  if (slotHasPlate(rackNum, above, rSlots, mag) &&
      heightMm > heightLimit(needed, sh, tol, true, pct)) {
    blocked.push(above === mag
      ? tr('Magazin darüber — hier passen nur {0} mm', Math.round(heightLimit(needed, sh, tol, true, pct)))
      : tr('Platte in Fach {0}-{1} darüber — hier passen nur {2} mm',
           rackNum, above, Math.round(heightLimit(needed, sh, tol, true, pct))))
  }

  // Check clearance slots above
  for (let i = 1; i < needed; i++) {
    const next = slotNum + i
    if (next > spr) { blocked.push(tr('Regal {0} hat nur {1} Fächer', rackNum, spr)); break }
    const k      = `${rackNum}-${next}`
    const status = rSlots[k]?.status ?? 'free'
    if (status !== 'free' && status !== 'ready') blocked.push(`Fach ${k} (${status})`)
  }
  return { ok: blocked.length === 0, needed, blocked }
}
