import React, { useState, useEffect, useCallback, useRef } from 'react'
import { deviceService, printerService, rackManagerService, autofarmService } from '../services/api'
import { useQueueEta, fmtDur } from '../services/useQueueEta'
import { useFarmStatusStream } from '../services/useFarmStatusStream'
import { useLanguage } from '../services/i18n'

function fmtMin(min) {
  if (!min || min <= 0) return '—'
  if (min < 60) return `${Math.round(min)} min`
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function parseKey(k) {
  const p = String(k).split('-')
  return p.length === 2 ? [+p[0], +p[1]] : [1, +p[0]]
}

/* Printer utilization over the last 24h. Reconstructs active spans by pairing
   print_start with the next print_done/error/farm_stop; renders them on a time bar
   with error markers. Gaps inside farm-running windows read as idle. */
function UsageTimeline({ data }) {
  const { tr } = useLanguage()
  if (!data) return null
  const nowMs    = new Date(data.now).getTime()
  const windowMs = (data.hours || 24) * 3600 * 1000
  const startMs  = nowMs - windowMs
  const evs = (data.events || [])
    .map(e => ({ ...e, t: new Date(e.ts).getTime() }))
    .filter(e => !isNaN(e.t))
    .sort((a, b) => a.t - b.t)

  const spans  = []   // {left%, width%, kind}
  const errors = []   // {left%, detail}
  let openStart = null
  let activeMin = 0
  for (const e of evs) {
    if (e.type === 'print_start') {
      openStart = e.t
    } else if (e.type === 'print_done' || e.type === 'error' || e.type === 'farm_stop') {
      if (openStart != null) {
        const a = Math.max(openStart, startMs)
        const b = Math.min(e.t, nowMs)
        if (b > a) {
          spans.push({
            left:  ((a - startMs) / windowMs) * 100,
            width: ((b - a) / windowMs) * 100,
            kind:  e.type === 'error' ? 'error' : 'active',
          })
          activeMin += (b - a) / 60000
        }
        openStart = null
      }
      if (e.type === 'error')
        errors.push({ left: ((Math.min(e.t, nowMs) - startMs) / windowMs) * 100, detail: e.detail })
    }
  }
  // A print still running: span from its start to now.
  if (openStart != null) {
    const a = Math.max(openStart, startMs)
    spans.push({ left: ((a - startMs) / windowMs) * 100, width: ((nowMs - a) / windowMs) * 100, kind: 'active' })
    activeMin += (nowMs - a) / 60000
  }

  const utilPct = Math.round((activeMin / (windowMs / 60000)) * 100)
  const ticks = [0, 6, 12, 18, 24] // hours ago labels (right = now)

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <p className="section-label">{tr('Auslastung (24h)')}</p>
        <span className="text-[10px] font-mono text-surface-500">{tr('{0}% aktiv', utilPct)}</span>
      </div>
      <div className="relative h-6 rounded bg-surface-800 overflow-hidden">
        {spans.map((s, i) => (
          <div
            key={i}
            className={`absolute top-0 h-full ${s.kind === 'error' ? 'bg-red-600/70' : 'bg-emerald-500/80'}`}
            style={{ left: `${s.left}%`, width: `${Math.max(0.4, s.width)}%` }}
          />
        ))}
        {errors.map((e, i) => (
          <div key={`e${i}`} className="absolute top-0 h-full w-[2px] bg-red-400" style={{ left: `${e.left}%` }} title={e.detail || tr('Fehler')} />
        ))}
      </div>
      <div className="flex justify-between mt-1">
        {ticks.map(h => (
          <span key={h} className="text-[8px] font-mono text-surface-700">{h === 0 ? tr('jetzt') : `-${h}h`}</span>
        )).reverse()}
      </div>
      <div className="flex items-center gap-3 mt-2">
        <span className="flex items-center gap-1 text-[9px] text-surface-500"><span className="w-2 h-2 rounded-sm bg-emerald-500/80" /> {tr('aktiv')}</span>
        <span className="flex items-center gap-1 text-[9px] text-surface-500"><span className="w-2 h-2 rounded-sm bg-surface-800 border border-surface-700" /> {tr('idle')}</span>
        <span className="flex items-center gap-1 text-[9px] text-surface-500"><span className="w-2 h-2 rounded-sm bg-red-400" /> {tr('Fehler')}</span>
      </div>
    </div>
  )
}

export default function Dashboard() {
  const { tr } = useLanguage()
  const [farmStatus, setFarmStatus] = useState(null)
  const [rackData,   setRackData]   = useState(null)
  const [bambuId,    setBambuId]    = useState(null)
  const [printer,    setPrinter]    = useState(null)
  const [queueJobs,  setQueueJobs]  = useState([])
  const [lastRefresh, setLastRefresh] = useState(null)
  const [stats,       setStats]       = useState(null)
  const [timeline,    setTimeline]    = useState(null)
  const [costCfg,     setCostCfg]     = useState(null)   // Strompreis etc. für Kostenanzeige
  const farmStatusRef = useRef(null)                     // P6: aktueller Status für refresh()
  farmStatusRef.current = farmStatus
  const eta = useQueueEta()   // echte Rest-Druckzeit der Warteschlange

  // P6: Farm-Status live per WebSocket (mit HTTP-Poll-Fallback) — der erste
  // Snapshot setzt zugleich lastRefresh, damit das Skeleton verschwindet.
  useFarmStatusStream((data) => { setFarmStatus(data); setLastRefresh(new Date()) })

  const refresh = useCallback(async () => {
    try {
      // Status kommt live per WebSocket (useFarmStatusStream) — hier nur noch
      // Regal/Geräte/Statistik/Kosten, die der WS-Kanal nicht abdeckt.
      const [rd, dd] = await Promise.all([
        rackManagerService.getAll(),
        deviceService.listDevices(),
      ])
      setRackData(rd.data)
      autofarmService.getStats().then(r => setStats(r.data)).catch(() => {})
      autofarmService.getTimeline(24).then(r => setTimeline(r.data)).catch(() => {})
      autofarmService.getSettings().then(r => setCostCfg(r.data)).catch(() => {})
      const b = dd.data.find(x => x.device_type === 'bambu_lab')
      if (b) setBambuId(b.id)

      if (!farmStatusRef.current?.running) {
        autofarmService.getQueue()
          .then(r => setQueueJobs((r.data?.jobs ?? r.data ?? []).filter(j => j.status === 'pending')))
          .catch(() => {})
      }
      setLastRefresh(new Date())
    } catch {}
  }, [])

  const fetchPrinter = useCallback(async () => {
    if (!bambuId) return
    try {
      const r = await printerService.getStatus(bambuId)
      setPrinter(r.data)
    } catch { setPrinter(null) }
  }, [bambuId])

  // Farm aus einer Pause (z. B. nach HMS-Fehler) direkt vom Dashboard fortsetzen.
  const [resuming, setResuming] = useState(false)
  const resumeFarm = async () => {
    setResuming(true)
    try { await autofarmService.pause() }   // toggelt Pause aus + Backend löscht den Fehler
    catch {}
    finally { setResuming(false) }
  }

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, 15000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    fetchPrinter()
    const t = setInterval(fetchPrinter, 20000)
    return () => clearInterval(t)
  }, [fetchPrinter])

  /* ── Derived ─────────────────────────────────────────── */
  const farmRunning = farmStatus?.running  ?? false
  const farmPaused  = farmStatus?.paused   ?? false
  const farmError   = farmStatus?.error
  const seqLabel    = farmStatus?.seq_step_label
  const allJobs     = farmStatus?.jobs ?? []
  const curJobId    = farmStatus?.current_job_id
  const curJob      = allJobs.find(j => j.id === curJobId)
  const pendingJobs = farmRunning ? allJobs.filter(j => j.status === 'pending') : queueJobs

  const progress  = curJob?.progress  ?? 0
  const remaining = curJob?.remaining ?? printer?.remaining_min ?? 0
  const fileName  = curJob?.fileName  ?? printer?.subtask_name  ?? null

  const gcodeState = printer?.gcode_state ?? 'IDLE'
  const printerActive = ['RUNNING', 'PAUSE'].includes(gcodeState)
  const showProgress  = farmRunning || printerActive

  const totalPendingMin = allJobs
    .filter(j => j.status === 'pending')
    .reduce((s, j) => s + (j.estimatedMinutes ?? 0), 0)
  const totalWithOverhead = totalPendingMin + pendingJobs.length * 3
  const etaDate = totalWithOverhead > 0
    ? new Date(Date.now() + (remaining + totalWithOverhead) * 60_000)
    : null

  /* ── Rack ─────────────────────────────────────────────── */
  const nr  = rackData?.num_racks      ?? 1
  const spr = rackData?.slots_per_rack ?? 6
  const slotH    = rackData?.slot_height_mm ?? 50
  const magCount = rackData?.magazine_count ?? 0
  const allSlots = rackData?.slots ?? {}
  const doneSlots    = Object.values(allSlots).filter(s => s.status === 'done').length
  const printingSlots = Object.values(allSlots).filter(s => s.status === 'printing').length

  /* ── Status helpers ───────────────────────────────────── */
  const farmLabel = farmPaused  ? tr('Pausiert')  :
                    farmRunning ? (seqLabel ?? tr('Farm läuft')) :
                    tr('Gestoppt')
  const farmColor = farmPaused  ? 'text-amber-400' :
                    farmRunning ? 'text-emerald-400' :
                    'text-surface-600'
  const dotColor  = farmPaused  ? 'bg-amber-400' :
                    farmRunning ? 'bg-emerald-400 animate-pulse' :
                    'bg-surface-700'

  // Q4: Skeleton beim allerersten Laden (noch kein erfolgreicher Refresh)
  if (!lastRefresh) {
    return (
      <div className="space-y-3 w-full max-w-md mx-auto pb-6" aria-busy="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card animate-pulse space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-3 w-32 rounded bg-surface-800" />
              <div className="h-6 w-12 rounded bg-surface-800" />
            </div>
            <div className="h-2 w-full rounded bg-surface-800/70" />
            <div className="h-2 w-2/3 rounded bg-surface-800/70" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3 w-full max-w-md mx-auto pb-6">

      {/* ══ Current Print Status ══════════════════════════════ */}
      <div className={`card transition-colors ${
        farmRunning && !farmPaused ? 'border-emerald-800/40 bg-emerald-950/5' :
        farmPaused                 ? 'border-amber-800/40 bg-amber-950/5' : ''
      }`}>
        {/* Header row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
            <span className={`text-sm font-semibold ${farmColor}`}>{farmLabel}</span>
          </div>
          {showProgress && progress > 0 && (
            <span className="text-2xl font-mono font-bold text-surface-100">{progress}%</span>
          )}
        </div>

        {/* File name */}
        {fileName && (
          <p className="text-xs text-surface-500 truncate mt-1.5 ml-4">{fileName}</p>
        )}

        {/* Progress bar */}
        {showProgress && progress > 0 && (
          <div className="mt-3 space-y-1.5">
            <div className="w-full bg-surface-800/80 rounded-full h-3 overflow-hidden">
              <div
                className={`h-3 rounded-full transition-all duration-1000 ${
                  farmPaused ? 'bg-amber-500' : 'bg-gradient-to-r from-emerald-600 to-emerald-400'
                }`}
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] font-mono text-surface-500">
              <span className="text-surface-300">
                {remaining > 0 ? tr('~{0} verbleibend', fmtMin(remaining)) : tr('Fast fertig…')}
              </span>
              {totalWithOverhead > 0 && (
                <span className="text-surface-600">
                  {tr('{0} wartend · ~{1} gesamt', pendingJobs.length, fmtMin(remaining + totalWithOverhead))}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Error / pause message */}
        {farmError && (
          <div className="mt-3 flex items-start gap-2 text-xs text-amber-300 bg-amber-950/30 border border-amber-800/40 rounded-lg px-3 py-2">
            <span className="shrink-0">⚠</span>
            <span className="flex-1">{farmError}</span>
            {farmPaused && (
              <button onClick={resumeFarm} disabled={resuming}
                className="shrink-0 btn btn-primary btn-sm whitespace-nowrap disabled:opacity-50">
                {resuming ? tr('…') : tr('▶ Fortsetzen')}
              </button>
            )}
          </div>
        )}

        {/* Idle state */}
        {!showProgress && !farmRunning && !farmError && (
          <p className="text-xs text-surface-600 mt-2 ml-4">{tr('Kein aktiver Druck')}</p>
        )}
      </div>

      {/* ══ Quick Stats ═══════════════════════════════════════ */}
      <div className="grid grid-cols-3 gap-2">

        {/* Printer */}
        <div className={`card py-3 text-center ${printerActive ? 'border-blue-800/40 bg-blue-950/5' : ''}`}>
          <p className="text-[9px] text-surface-600 uppercase tracking-widest mb-1.5">{tr('Drucker')}</p>
          <span className={`w-2 h-2 rounded-full mx-auto block mb-1 ${
            gcodeState === 'RUNNING' ? 'bg-blue-400 animate-pulse' :
            gcodeState === 'PAUSE'   ? 'bg-amber-400' :
            bambuId                  ? 'bg-surface-600' : 'bg-red-600'
          }`} />
          <p className={`text-[11px] font-semibold ${
            gcodeState === 'RUNNING' ? 'text-blue-400' :
            gcodeState === 'PAUSE'   ? 'text-amber-400' :
            'text-surface-500'
          }`}>
            {gcodeState === 'RUNNING' ? tr('Druckt') :
             gcodeState === 'PAUSE'   ? tr('Pause') :
             gcodeState === 'IDLE'    ? tr('Bereit') :
             bambuId                  ? gcodeState :
             tr('Nicht konfiguriert')}
          </p>
        </div>

        {/* Magazine */}
        <div className={`card py-3 text-center ${
          magCount === 0 ? 'border-red-800/50 bg-red-950/10' :
          magCount <= 1  ? 'border-amber-800/40 bg-amber-950/5' : ''
        }`}>
          <p className="text-[9px] text-surface-600 uppercase tracking-widest mb-1.5">{tr('Magazin')}</p>
          <p className={`text-2xl font-mono font-bold leading-none ${
            magCount === 0 ? 'text-red-400' :
            magCount <= 1  ? 'text-amber-400' :
            'text-surface-100'
          }`}>{magCount}</p>
          <p className="text-[9px] text-surface-600 mt-1">{tr('von {0} Platten', nr * spr)}</p>
        </div>

        {/* Rack done */}
        <div className={`card py-3 text-center ${doneSlots > 0 ? 'border-amber-800/40 bg-amber-950/5' : ''}`}>
          <p className="text-[9px] text-surface-600 uppercase tracking-widest mb-1.5">{tr('Regal')}</p>
          <p className={`text-2xl font-mono font-bold leading-none ${doneSlots > 0 ? 'text-amber-400' : 'text-surface-600'}`}>
            {doneSlots}
          </p>
          <p className="text-[9px] text-surface-600 mt-1">{tr('fertig / {0} Fächer', nr * spr)}</p>
        </div>
      </div>

      {/* ══ Rack Visualization ════════════════════════════════ */}
      {nr > 0 && spr > 0 && rackData && (
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">{tr('Regal')}</p>
            <span className="text-[9px] font-mono text-surface-700">{tr('{0} mm/Fach', slotH)}</span>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${nr}, 1fr)` }}>
            {Array.from({ length: nr }, (_, ri) => (
              <div key={ri} className="space-y-1">
                {nr > 1 && (
                  <p className="text-[9px] text-center font-mono text-surface-700 mb-0.5">R{ri+1}</p>
                )}
                {Array.from({ length: spr }, (_, si) => {
                  const si2  = spr - 1 - si
                  const key  = `${ri+1}-${si2+1}`
                  const slot = allSlots[key] ?? { status: 'free' }
                  const done    = slot.status === 'done'
                  const print   = slot.status === 'printing'
                  const locked  = slot.status === 'locked'
                  const objH    = slot.object_height_mm
                  return (
                    <div key={key} className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                      done   ? 'border-amber-800/40 bg-amber-950/10' :
                      print  ? 'border-blue-800/40  bg-blue-950/10' :
                      locked ? 'border-red-900/40   bg-red-950/10' :
                      'border-surface-800/20 bg-transparent'
                    }`}>
                      <span className="font-mono text-surface-700 text-[9px] w-3 text-right shrink-0">{si2+1}</span>
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        done   ? 'bg-amber-400' :
                        print  ? 'bg-blue-400 animate-pulse' :
                        locked ? 'bg-red-400' :
                        'bg-surface-800'
                      }`} />
                      <p className={`text-[9px] flex-1 truncate leading-tight ${
                        done ? 'text-amber-400' : print ? 'text-blue-400' : 'text-surface-700'
                      }`}>
                        {slot.file_name
                          ? slot.file_name.replace(/\.[^.]+$/, '').slice(0, 14)
                          : done ? tr('Fertig') : print ? tr('Druckt') : ''}
                      </p>
                      {objH > 0 && (
                        <span className="text-[8px] font-mono text-surface-700 shrink-0">{Math.round(objH)}mm</span>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-surface-800/40">
            <span className="text-[9px] text-surface-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" /> {tr('Fertig')}
            </span>
            <span className="text-[9px] text-surface-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block" /> {tr('Druckt')}
            </span>
            <span className="text-[9px] text-surface-700 flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-surface-800 inline-block" /> {tr('Leer')}
            </span>
          </div>
        </div>
      )}

      {/* ══ Pending Queue ═════════════════════════════════════ */}
      {pendingJobs.length > 0 && (
        <div className="card">
          <div className="flex items-baseline justify-between mb-2.5 gap-2">
            <p className="section-label">{tr('Warteschlange')}</p>
            {eta.ready && eta.totalSec > 0 && (
              <div className="text-right shrink-0">
                <span className="text-[11px] font-mono text-blue-300">~{fmtDur(eta.totalSec)}</span>
                {eta.finishAt && (
                  <span className="block text-[10px] text-surface-500 font-mono">
                    {tr('fertig ~{0} Uhr', eta.finishAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }))}
                  </span>
                )}
                {eta.known < eta.jobs && (
                  <span className="block text-[9px] text-surface-600 font-mono">{tr('{0}/{1} mit Zeit', eta.known, eta.jobs)}</span>
                )}
              </div>
            )}
          </div>
          <div className="space-y-2">
            {pendingJobs.map((j, i) => (
              <div key={j.id ?? i} className="flex items-center gap-2">
                <span className="text-[10px] text-surface-700 font-mono w-4 shrink-0">{i+1}.</span>
                <span className="text-xs text-surface-400 truncate flex-1">
                  {(j.fileName ?? j.file_name ?? '—').replace(/\.[^.]+$/, '')}
                </span>
                {(j.estimatedMinutes ?? 0) > 0 && (
                  <span className="text-[10px] text-surface-600 font-mono shrink-0">
                    ~{fmtMin(j.estimatedMinutes)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══ Druckstatistiken ══════════════════════════════════ */}
      {stats && stats.total_jobs > 0 && (() => {
        const rate = Math.round((stats.successful_jobs / stats.total_jobs) * 100)
        const topErrors = Object.entries(stats.errors ?? {}).sort(([,a],[,b]) => b - a).slice(0, 3)
        const since = stats.since ? new Date(stats.since).toLocaleDateString('de-DE') : null
        return (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <p className="section-label">{tr('Druckstatistiken')}</p>
              <div className="flex items-center gap-2">
                {since && <span className="text-[9px] text-surface-700 font-mono">{tr('seit {0}', since)}</span>}
                <button
                  onClick={() => autofarmService.resetStats().then(() => setStats(null)).catch(() => {})}
                  className="text-[9px] text-surface-700 hover:text-red-400 transition-colors"
                  title={tr('Statistiken zurücksetzen')}
                >↺ Reset</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div className="text-center">
                <p className="text-3xl font-bold font-mono text-surface-100">{stats.total_jobs}</p>
                <p className="text-[9px] text-surface-600 mt-0.5">{tr('Jobs gesamt')}</p>
              </div>
              <div className="text-center">
                <p className={`text-3xl font-bold font-mono ${rate >= 90 ? 'text-emerald-400' : rate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
                  {rate}%
                </p>
                <p className="text-[9px] text-surface-600 mt-0.5">{tr('Erfolgsrate')}</p>
              </div>
              <div className="text-center">
                <p className="text-xl font-bold font-mono text-blue-400">{fmtMin(stats.total_print_min)}</p>
                <p className="text-[9px] text-surface-600 mt-0.5">{tr('Druckzeit gesamt')}</p>
              </div>
              <div className="text-center">
                <p className={`text-xl font-bold font-mono ${stats.failed_jobs > 0 ? 'text-red-400' : 'text-surface-600'}`}>
                  {stats.failed_jobs}
                </p>
                <p className="text-[9px] text-surface-600 mt-0.5">{tr('Fehlschläge')}</p>
              </div>
            </div>
            {(() => {
              const kwh   = stats.total_kwh || 0
              const price = costCfg?.power_price_eur_kwh ?? 0.30
              const rate  = costCfg?.machine_rate_eur_h ?? 0
              const eCost = kwh * price
              const mCost = (stats.total_print_min / 60) * rate
              const total = eCost + mCost
              return (
                <div className="border-t border-surface-800/40 pt-2.5 mb-2.5">
                  <p className="text-[9px] text-surface-600 mb-1.5">{tr('Energie & Kosten')}</p>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div>
                      <p className="text-base font-bold font-mono text-amber-400">{kwh.toFixed(1)}</p>
                      <p className="text-[9px] text-surface-600">{tr('kWh gesamt')}</p>
                    </div>
                    <div>
                      <p className="text-base font-bold font-mono text-amber-400">{eCost.toFixed(2)} €</p>
                      <p className="text-[9px] text-surface-600">{tr('Stromkosten')}</p>
                    </div>
                    <div>
                      <p className="text-base font-bold font-mono text-surface-200">{total.toFixed(2)} €</p>
                      <p className="text-[9px] text-surface-600">{rate > 0 ? tr('Strom + Maschine') : tr('Gesamtkosten')}</p>
                    </div>
                  </div>
                  {kwh === 0 && (
                    <p className="text-[9px] text-surface-700 mt-1.5 text-center">
                      {tr('Noch kein Stromverbrauch erfasst — Smart-Steckdose unter Konfiguration → Energie & Kosten einrichten.')}
                    </p>
                  )}
                </div>
              )
            })()}
            {topErrors.length > 0 && (
              <div className="border-t border-surface-800/40 pt-2.5">
                <p className="text-[9px] text-surface-600 mb-1.5">{tr('Häufigste Fehler')}</p>
                <div className="space-y-1">
                  {topErrors.map(([msg, count]) => (
                    <div key={msg} className="flex items-start gap-2">
                      <span className="text-[9px] font-mono text-red-400 shrink-0">{count}×</span>
                      <span className="text-[9px] text-surface-500 truncate">{msg}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ══ Usage timeline (24h) ══════════════════════════════ */}
      {timeline && timeline.events?.length > 0 && <UsageTimeline data={timeline} />}

      {/* ══ Last refresh ══════════════════════════════════════ */}
      {lastRefresh && (
        <p className="text-center text-[9px] text-surface-800 font-mono">
          {tr('Aktualisiert {0} · alle 15s', lastRefresh.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}
        </p>
      )}
    </div>
  )
}
