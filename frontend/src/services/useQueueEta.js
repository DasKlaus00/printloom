import { useState, useEffect, useCallback } from 'react'
import { autofarmService, fileService } from './api'

/* Gemeinsame ETA-Berechnung für Dashboard, AutoFarm & Planer.
   Pro Job zählt die beste verfügbare Druckzeit:
     1. Live-Restzeit des laufenden Jobs (mc_remaining_time, Minuten)
     2. echte Historie aus früheren Läufen (farm_history.json, Wanduhr-Schnitt)  ← B.2
     3. Slicer-Schätzung (quick-meta)
   Wartende Jobs bekommen zusätzlich einen Platten-Wechsel-Aufschlag. */

const _metaCache = {}            // fileId → meta | null  (modulweit, von allen Seiten geteilt)
export const CHANGEOVER_SEC = 180  // ~3 min Platten-Wechsel/Auswurf je wartendem Job
const PRINTING = new Set(['printing', 'running', 'sending'])

export function fmtDur(sec) {
  if (!sec || sec <= 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/* Lädt die quick-meta einer Datei (gecacht) — vom Planer genutzt. */
export async function ensureMeta(fileId) {
  if (fileId == null) return null
  if (_metaCache[fileId] === undefined) {
    try { _metaCache[fileId] = (await fileService.getQuickMeta(fileId)).data || null }
    catch { _metaCache[fileId] = null }
  }
  return _metaCache[fileId]
}

export function getCachedMeta(fileId) {
  return _metaCache[fileId] ?? null
}

/* Beste reine Druckzeit (Sekunden) eines Jobs aus Live/Historie/Slicer.
   `src` meldet zurück, woher der Wert stammt ('live'|'hist'|'slicer'|'none'). */
export function jobPrintSec(job, meta, hist) {
  if (PRINTING.has(job.status) && job.remaining > 0) return { sec: job.remaining * 60, src: 'live' }
  const h = hist?.[job.fileId] ?? hist?.[String(job.fileId)]
  if (h?.avg_min > 0) return { sec: Math.round(h.avg_min * 60), src: 'hist' }
  const est = meta?.time_seconds || 0
  return { sec: est, src: est > 0 ? 'slicer' : 'none' }
}

export function useQueueEta(pollMs = 15000) {
  const [eta, setEta] = useState({
    ready: false, running: false, jobs: 0,
    printSec: 0, overheadSec: 0, totalSec: 0, known: 0, histCount: 0, finishAt: null,
  })

  const compute = useCallback(async () => {
    try {
      // Kein eigener /status-Poll mehr: `running` lässt sich aus der Queue ableiten
      // (ein druckender Job ⇒ Farm läuft). Spart auf Dashboard & AutoFarm je einen
      // doppelten Status-Request pro Intervall.
      const [q, hi] = await Promise.all([
        autofarmService.getQueue().catch(() => ({ data: [] })),
        autofarmService.getHistory().catch(() => ({ data: {} })),
      ])
      const hist = hi.data || {}
      const raw = q.data
      const jobs = (Array.isArray(raw) ? raw : (raw?.jobs ?? [])).filter(j => j.status !== 'done')
      const running = jobs.some(j => PRINTING.has(j.status))

      // fehlende Slicer-Druckzeiten nachladen (einmalig je Datei)
      const need = [...new Set(jobs.map(j => j.fileId).filter(id => id != null && _metaCache[id] === undefined))]
      await Promise.all(need.map(id => ensureMeta(id)))

      let printSec = 0, overheadSec = 0, known = 0, histCount = 0
      for (const j of jobs) {
        const { sec, src } = jobPrintSec(j, _metaCache[j.fileId], hist)
        printSec += sec
        if (src === 'hist') histCount++
        if (sec > 0) known++
        if (!PRINTING.has(j.status)) overheadSec += CHANGEOVER_SEC
      }
      const totalSec = printSec + overheadSec
      setEta({
        ready: true, running, jobs: jobs.length,
        printSec, overheadSec, totalSec, known, histCount,
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
