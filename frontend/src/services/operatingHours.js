/* Betriebszeiten-Logik (spiegelt das Backend in autofarm.py).
   `schedule` = 7 Einträge [{enabled, start:"HH:MM", end:"HH:MM"}], Index 0=Mo … 6=So.
   Über-Nacht-Fenster (Start > Ende, z. B. 22:00–06:00) gehören abends zum Start-Tag,
   der Morgenteil zum Vortag. Gegated wird nur der START eines Jobs, nicht der Lauf. */

export function parseHHMM(s) {
  const [h, m] = String(s ?? '').split(':')
  return ((+h || 0) % 24) * 60 + ((+m || 0) % 60)
}

/* JS getDay(): 0=So … 6=Sa → unser Index 0=Mo … 6=So. */
function mondayIdx(date) {
  return (date.getDay() + 6) % 7
}

export function inWindow(date, schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 7) return true
  const wd   = mondayIdx(date)
  const mins = date.getHours() * 60 + date.getMinutes()
  const d = schedule[wd]
  if (d?.enabled) {
    const s = parseHHMM(d.start), e = parseHHMM(d.end)
    if (s === e) return true
    if (s < e) { if (s <= mins && mins < e) return true }
    else if (mins >= s) return true            // über Nacht: Abendteil = heute
  }
  const dy = schedule[(wd + 6) % 7]            // Vortag
  if (dy?.enabled) {
    const sy = parseHHMM(dy.start), ey = parseHHMM(dy.end)
    if (sy > ey && mins < ey) return true      // Morgenteil eines Über-Nacht-Fensters
  }
  return false
}

export function nextWindowStart(date, schedule) {
  if (!Array.isArray(schedule) || schedule.length !== 7) return date
  for (let ahead = 0; ahead < 8; ahead++) {
    const wd = (mondayIdx(date) + ahead) % 7
    const d  = schedule[wd]
    if (!d?.enabled) continue
    const s    = parseHHMM(d.start)
    const cand = new Date(date)
    cand.setDate(cand.getDate() + ahead)
    cand.setHours(Math.floor(s / 60), s % 60, 0, 0)
    if (cand.getTime() > date.getTime()) return cand
  }
  return date
}

/* Verschiebt den Start-Zeitpunkt (ms) auf das nächste offene Fenster, wenn er
   gerade außerhalb liegt. Betriebszeiten aus → unverändert. */
export function gateStart(clockMs, schedule, enabled) {
  if (!enabled) return clockMs
  const d = new Date(clockMs)
  if (inWindow(d, schedule)) return clockMs
  const next = nextWindowStart(d, schedule)
  return next ? next.getTime() : clockMs
}
