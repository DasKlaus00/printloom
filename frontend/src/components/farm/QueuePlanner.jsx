import React, { useState, useEffect } from 'react'
import { autofarmService } from '../../services/api'
import { fmtDur, jobPrintSec, ensureMeta, getCachedMeta, CHANGEOVER_SEC } from '../../services/useQueueEta'
import { gateStart } from '../../services/operatingHours'
import { locale } from '../../services/i18n'

/* Aus pages/AutoFarm.jsx verschoben (v1.1.79), wortgleich. */

/* ── B.3 Was-wäre-wenn-Planer ─────────────────────────────────
   Zeigt für die aktuelle Queue-Reihenfolge eine Zeitleiste: pro Job die
   beste verfügbare Dauer (Live > Historie > Slicer) + Wechsel-Aufschlag, mit
   kumulierter Fertig-Uhrzeit. Reihenfolge ändern (Smart-Sort / ↑↓) → Planer
   rechnet sofort neu, ohne irgendetwas zu starten. */
export default function QueuePlanner({ jobs, tr }) {
  const [hist, setHist] = useState({})
  const [cost, setCost] = useState(null)   // { power_price_eur_kwh, machine_rate_eur_h, filament_price_eur_kg }
  const [tick, setTick] = useState(0)

  const active = jobs.filter(j => ['pending', 'running', 'printing', 'sending'].includes(j.status))
  const sig = active.map(j => `${j.id}:${j.status}:${j.remaining || 0}`).join(',')

  useEffect(() => {
    let cancelled = false
    autofarmService.getHistory().then(r => { if (!cancelled) setHist(r.data || {}) }).catch(() => {})
    autofarmService.getSettings().then(r => { if (!cancelled) setCost(r.data) }).catch(() => {})
    Promise.all(active.map(j => ensureMeta(j.fileId))).then(() => { if (!cancelled) setTick(t => t + 1) })
    return () => { cancelled = true }
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!active.length) {
    return <p className="text-[11px] text-surface-600 py-3 text-center">{tr('Keine wartenden Jobs zum Planen')}</p>
  }

  // Betriebszeiten berücksichtigen: ein wartender Job startet nur im Zeitfenster.
  const ophOn    = !!cost?.operating_hours_enabled
  const ophSched = cost?.operating_schedule
  const now = Date.now()
  let clock = now, workMs = 0
  const rows = active.map((j, i) => {
    const printing = ['running', 'printing', 'sending'].includes(j.status)
    let over = 0
    if (!printing) {
      if (i > 0) over = CHANGEOVER_SEC * 1000
      clock += over
      clock = gateStart(clock, ophSched, ophOn)   // Start auf nächstes Fenster verschieben
    }
    const { sec, src } = jobPrintSec(j, getCachedMeta(j.fileId), hist)
    clock += sec * 1000
    workMs += over + sec * 1000
    return { j, sec, src, end: new Date(clock) }
  })
  const totalSec  = Math.round(workMs / 1000)            // reine Arbeitszeit (ohne Wartelücken)
  const finishAt  = rows.length ? rows[rows.length - 1].end : new Date(now)
  const waiting   = ophOn && finishAt.getTime() > now + workMs + 1000   // Fenster-Wartezeit dabei?
  const clk = (d) => d.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })
  // Kalendertage-Abstand zum Jetzt — für „heute / morgen / +N Tage", weil ein
  // Job durch Betriebszeiten erst an einem späteren Tag fertig werden kann.
  const dayOffset = (d) => {
    const a = new Date(now); a.setHours(0, 0, 0, 0)
    const b = new Date(d);   b.setHours(0, 0, 0, 0)
    return Math.round((b.getTime() - a.getTime()) / 86400000)
  }
  const relDay = (d) => {
    const n = dayOffset(d)
    return n <= 0 ? tr('heute') : n === 1 ? tr('morgen') : tr('+{0} Tage', n)
  }
  const srcMeta = {
    live:   { sym: '●', cls: 'text-blue-400',    title: tr('Live-Restzeit') },
    hist:   { sym: '📊', cls: 'text-emerald-400', title: tr('aus echter Historie') },
    slicer: { sym: '~', cls: 'text-surface-500',  title: tr('Slicer-Schätzung') },
    none:   { sym: '?', cls: 'text-amber-500',    title: tr('keine Zeitangabe') },
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        {rows.map(({ j, sec, src, end }, i) => {
          const m = srcMeta[src] ?? srcMeta.none
          return (
            <div key={j.id} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-surface-600 w-4 text-right shrink-0">{i + 1}</span>
              <span className="text-surface-300 flex-1 min-w-0 truncate">{j.fileName?.replace(/\.[^.]+$/, '')}</span>
              {j.plate != null && (
                <span className="shrink-0 font-mono text-[10px] px-1 py-0.5 rounded border border-blue-900/60 bg-blue-950/20 text-blue-300/90"
                  title={tr('Platte {0} von {1}', j.plate, j.plateTotal ?? '?') + (j.plateName ? ` — ${j.plateName}` : '')}>
                  {j.plateTotal > 1 ? tr('P{0}/{1}', j.plate, j.plateTotal) : tr('P{0}', j.plate)}
                </span>
              )}
              <span className={`shrink-0 ${m.cls}`} title={m.title}>{m.sym}</span>
              <span className="font-mono text-surface-400 w-16 text-right shrink-0">{fmtDur(sec) ?? '—'}</span>
              <span className="font-mono w-24 text-right shrink-0" title={tr('voraussichtlich fertig')}>
                <span className={dayOffset(end) > 0 ? 'text-blue-400/80' : 'text-surface-700'}>{relDay(end)}</span>
                <span className="text-surface-500 ml-1">{clk(end)}</span>
              </span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between border-t border-surface-700 pt-1.5 text-[11px]">
        <span className="text-surface-500">{tr('{0} Jobs', rows.length)}</span>
        <span className="font-mono text-surface-300">
          {fmtDur(totalSec) ? tr('~{0} · fertig {1} ~{2} Uhr', fmtDur(totalSec), relDay(finishAt), clk(finishAt)) : tr('Gesamtzeit unbekannt')}
        </span>
      </div>
      {waiting && (
        <p className="text-[10px] text-blue-400/80 text-right">{tr('🕒 inkl. Wartezeit bis zur nächsten Betriebszeit')}</p>
      )}
    </div>
  )
}
