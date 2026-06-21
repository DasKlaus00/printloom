// Shared rack slot utilities — used by AutoFarm and Projekt pages.

export function parseSlotKey(key) {
  const parts = String(key ?? '1-1').split('-')
  return parts.length === 2 ? [+parts[0], +parts[1]] : [1, +parts[0]]
}

// Spielraum nach oben: ein Objekt darf so viele mm über die Oberkante seines
// obersten Fachs ragen, bevor ein weiteres Fach reserviert wird (Toleranz für
// den kleinen Überstand zum nächsten Tray). Beispiel @50mm/Fach + 20mm:
//   170mm → ceil((170-20)/50) = 3 Fächer · ≤70mm → 1 Fach.
// MUSS mit backend/app/routers/autofarm.py SLOT_TOLERANCE_MM übereinstimmen.
export const SLOT_TOLERANCE_MM = 20

export function slotsNeeded(h, slotH) {
  if (!h || h <= 0) return 1
  const sh = slotH || 50
  return Math.max(1, Math.ceil((h - SLOT_TOLERANCE_MM) / sh))
}

// Returns true if a stored object in a slot below extends into the given slot.
function isBlockedFromBelow(rackNum, slotNum, rSlots, slotH) {
  const sh = slotH || 50
  for (let s = slotNum - 1; s >= 1; s--) {
    const k    = `${rackNum}-${s}`
    const objH = rSlots[k]?.object_height_mm ?? 0
    if (objH <= 0) continue
    if (slotsNeeded(objH, sh) > (slotNum - s)) return true
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
  const needed = slotsNeeded(heightMm, sh)

  // Expand each queued job's base slot to ALL slots it will physically occupy.
  const taken = new Set()
  jobs
    .filter(j => !['done', 'error'].includes(j.status) && j.slot)
    .forEach(j => {
      const [rn, sn] = parseSlotKey(j.slot)
      const h = j.computedHeight ?? j.objectHeight ?? j.object_height_mm ?? 0
      const n = slotsNeeded(h, sh)
      for (let i = 0; i < n; i++) taken.add(`${rn}-${sn + i}`)
    })

  const isFree = (r, s) => {
    const k = `${r}-${s}`
    if (!(k in rSlots)) return false
    if (rSlots[k].status !== 'free') return false
    if (taken.has(k)) return false
    if (isBlockedFromBelow(r, s, rSlots, sh)) return false
    return true
  }

  for (let r = 1; r <= nr; r++) {
    for (let s = 1; s <= spr - needed + 1; s++) {
      if (Array.from({ length: needed }, (_, i) => isFree(r, s + i)).every(Boolean))
        return `${r}-${s}`
    }
  }
  // Fallback: first free slot anywhere (ignores clearance)
  for (let r = 1; r <= nr; r++) {
    for (let s = 1; s <= spr; s++) {
      const k = `${r}-${s}`
      if (k in rSlots && rSlots[k].status === 'free' && !taken.has(k)) return k
    }
  }
  return '1-0'  // sentinel: rack full, no slot available
}

export function checkClearance(slotKey, heightMm, rackData, slotH) {
  const sh     = slotH || 50
  const needed = slotsNeeded(heightMm, sh)
  const spr    = rackData?.slots_per_rack ?? 6
  const rSlots = rackData?.slots ?? {}
  const [rackNum, slotNum] = parseSlotKey(slotKey)
  const blocked = []

  // Check if this slot is blocked by a tall object in a lower slot
  if (isBlockedFromBelow(rackNum, slotNum, rSlots, sh)) {
    blocked.push(`Fach ${rackNum}-${slotNum - 1} (Objekt zu hoch)`)
  }

  // Check clearance slots above
  for (let i = 1; i < needed; i++) {
    const next = slotNum + i
    if (next > spr) { blocked.push(`Rack ${rackNum} hat nur ${spr} Fächer`); break }
    const k      = `${rackNum}-${next}`
    const status = rSlots[k]?.status ?? 'free'
    if (status !== 'free') blocked.push(`Fach ${k} (${status})`)
  }
  return { ok: blocked.length === 0, needed, blocked }
}
