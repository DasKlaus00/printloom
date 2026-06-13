import { useState, useEffect, useCallback } from 'react'
import { autofarmService, fileService } from './api'

/* Gemeinsame ETA-Berechnung für Dashboard & AutoFarm: summiert die echte
   Slicer-Druckzeit (quick-meta) aller noch nicht fertigen Jobs. Der gerade
   laufende Job zählt mit seiner Live-Restzeit (mc_remaining_time = Minuten),
   die anderen mit ihrer geschätzten Druckzeit + einem Platten-Wechsel-Aufschlag. */

const _metaCache = {}            // fileId → meta | null  (modulweit, von beiden Seiten geteilt)
const CHANGEOVER_SEC = 180       // ~3 min Platten-Wechsel/Auswurf je wartendem Job
const PRINTING = new Set(['printing', 'running', 'sending'])

export function fmtDur(sec) {
  if (!sec || sec <= 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

export function useQueueEta(pollMs = 15000) {
  const [eta, setEta] = useState({
    ready: false, running: false, jobs: 0,
    printSec: 0, overheadSec: 0, totalSec: 0, known: 0, finishAt: null,
  })

  const compute = useCallback(async () => {
    try {
      const [st, q] = await Promise.all([
        autofarmService.getStatus().catch(() => ({ data: {} })),
        autofarmService.getQueue().catch(() => ({ data: [] })),
      ])
      const running = !!st.data?.running
      const raw = q.data
      const jobs = (Array.isArray(raw) ? raw : (raw?.jobs ?? [])).filter(j => j.status !== 'done')

      // fehlende Druckzeiten nachladen (einmalig je Datei)
      const need = [...new Set(jobs.map(j => j.fileId).filter(id => id != null && _metaCache[id] === undefined))]
      await Promise.all(need.map(async id => {
        try { _metaCache[id] = (await fileService.getQuickMeta(id)).data || null }
        catch { _metaCache[id] = null }
      }))

      let printSec = 0, overheadSec = 0, known = 0
      for (const j of jobs) {
        const est = _metaCache[j.fileId]?.time_seconds || 0
        if (PRINTING.has(j.status)) {
          // läuft gerade → Live-Restzeit (Minuten) bevorzugen
          printSec += j.remaining > 0 ? j.remaining * 60 : est
          if (est > 0 || j.remaining > 0) known++
        } else {
          printSec += est
          overheadSec += CHANGEOVER_SEC
          if (est > 0) known++
        }
      }
      const totalSec = printSec + overheadSec
      setEta({
        ready: true, running, jobs: jobs.length,
        printSec, overheadSec, totalSec, known,
        finishAt: totalSec > 0 ? new Date(Date.now() + totalSec * 1000) : null,
      })
    } catch {
      setEta(e => ({ ...e, ready: true }))
    }
  }, [])

  useEffect(() => {
    compute()
    const t = setInterval(compute, pollMs)
    const onChange = () => compute()
    window.addEventListener('printloom:queueChanged', onChange)
    return () => { clearInterval(t); window.removeEventListener('printloom:queueChanged', onChange) }
  }, [compute, pollMs])

  return eta
}
