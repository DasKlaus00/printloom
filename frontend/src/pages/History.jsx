import React, { useState, useEffect } from 'react'
import { autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { usePageActive } from '../services/useAutoRefresh'
import { confirmDialog } from '../services/confirm'

const STATUS_META = {
  done:    { label: 'Fertig',   cls: 'text-emerald-400 border-emerald-900/60 bg-emerald-950/20' },
  error:   { label: 'Fehler',   cls: 'text-red-400 border-red-900/60 bg-red-950/20' },
  ejected: { label: 'Geborgen', cls: 'text-amber-400 border-amber-900/60 bg-amber-950/20' },
}

function fmtDuration(min) {
  if (!min && min !== 0) return '—'
  const m = Math.round(min)
  const h = Math.floor(m / 60)
  return h ? `${h} h ${m % 60} min` : `${m} min`
}

// ISO → lokales Datum bzw. Uhrzeit; leer/kaputt → „—".
function parseDate(iso) { const d = iso ? new Date(iso) : null; return d && !isNaN(d) ? d : null }

export default function History() {
  const { tr } = useLanguage()
  const active = usePageActive()
  const [items, setItems] = useState(null)   // null = lädt
  const [busy, setBusy]   = useState(false)

  const load = async () => {
    try {
      const r = await autofarmService.getCompleted()
      setItems(r.data?.items ?? [])
    } catch {
      setItems([])
    }
  }
  useEffect(() => { if (active) load() }, [active])

  const clear = async () => {
    if (!(await confirmDialog({
      title: tr('Historie leeren'),
      message: tr('Wirklich die gesamte Druck-Historie löschen? Das kann nicht rückgängig gemacht werden.'),
      confirmLabel: tr('Leeren'),
    }))) return
    setBusy(true)
    try { await autofarmService.clearCompleted(); await load() }
    finally { setBusy(false) }
  }

  // Ein Modell aus der Historie erneut in die Auto-Farm-Warteschlange legen.
  const [feedback, setFeedback] = useState(null)
  const requeue = async (it) => {
    if (it.fileId == null) { setFeedback({ ok: false, msg: tr('Datei nicht mehr verfügbar') }); return }
    try {
      const [statusRes, queueRes] = await Promise.all([
        autofarmService.getStatus(true).catch(() => ({ data: {} })),
        autofarmService.getQueue().catch(() => ({ data: [] })),
      ])
      const running = !!statusRes.data?.running
      const cur = queueRes.data ?? []
      const id = cur.length ? Math.max(...cur.map(j => j.id ?? 0)) + 1 : 1
      const job = {
        id, fileId: it.fileId, fileName: it.fileName,
        slot: null, amsMap: '', status: 'pending',
        plate: it.plate ?? null, plateTotal: it.plateTotal ?? null, plateName: it.plateName || null,
        objectHeight: null, progress: 0, remaining: 0,
      }
      if (running) {
        await autofarmService.enqueue({
          id: job.id, fileId: job.fileId, fileName: job.fileName,
          slot: '1-0', amsMap: '', plate: job.plate, plateTotal: job.plateTotal, plateName: job.plateName,
        })
      } else {
        await autofarmService.saveQueue([...cur, job])
      }
      window.dispatchEvent(new CustomEvent('printloom:queueChanged'))
      setFeedback({ ok: true, msg: tr('„{0}" in die Warteschlange gelegt', (it.fileName || '').replace(/\.[^.]+$/, '')) })
    } catch {
      setFeedback({ ok: false, msg: tr('In die Warteschlange legen fehlgeschlagen') })
    }
    setTimeout(() => setFeedback(null), 4000)
  }

  const dateStr = (d) => d ? d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—'
  const timeStr = (d) => d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-surface-100">{tr('Historie')}</h1>
          <p className="text-xs text-surface-500 mt-0.5">{tr('Alle abgeschlossenen Druck-Jobs mit Datum, Anfangs- und End-Uhrzeit.')}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="btn btn-ghost btn-sm">{tr('Aktualisieren')}</button>
          {items?.length > 0 && (
            <button onClick={clear} disabled={busy} className="btn btn-ghost btn-sm text-red-400 hover:text-red-300 disabled:opacity-50">
              {tr('Leeren')}
            </button>
          )}
        </div>
      </div>

      {feedback && (
        <div className={`px-3 py-2 rounded-lg text-xs border ${feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-red-950/40 border-red-800 text-red-300'}`}>
          {feedback.msg}
        </div>
      )}

      <div className="card p-0 overflow-hidden">
        {items === null ? (
          <p className="text-sm text-surface-500 py-10 text-center">{tr('Lädt…')}</p>
        ) : !items.length ? (
          <p className="text-sm text-surface-500 py-10 text-center">{tr('Noch keine abgeschlossenen Drucke.')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-surface-500 border-b border-surface-800">
                  <th className="text-left font-medium px-4 py-2.5">{tr('Datum')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Start')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Ende')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Dauer')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Modell')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Fach')}</th>
                  <th className="text-left font-medium px-3 py-2.5">{tr('Status')}</th>
                  <th className="text-right font-medium px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it, i) => {
                  const s = parseDate(it.started_at), e = parseDate(it.ended_at)
                  const meta = STATUS_META[it.status] ?? STATUS_META.done
                  const name = (it.fileName || '').replace(/\.[^.]+$/, '')
                  const plateLabel = it.plate != null
                    ? (it.plateName ? ` · ${it.plateName}` : ` · ${tr('Platte {0}', it.plate)}${it.plateTotal > 1 ? `/${it.plateTotal}` : ''}`)
                    : ''
                  return (
                    <tr key={i} className="border-b border-surface-800/50 hover:bg-surface-900/40">
                      <td className="px-4 py-2.5 font-mono text-surface-400 whitespace-nowrap">{dateStr(s)}</td>
                      <td className="px-3 py-2.5 font-mono text-surface-400 whitespace-nowrap">{timeStr(s)}</td>
                      <td className="px-3 py-2.5 font-mono text-surface-400 whitespace-nowrap">{timeStr(e)}</td>
                      <td className="px-3 py-2.5 font-mono text-surface-400 whitespace-nowrap">{fmtDuration(it.duration_min)}</td>
                      <td className="px-3 py-2.5 text-surface-200 min-w-0">
                        <span className="truncate">{name}</span>
                        <span className="text-surface-600 text-xs">{plateLabel}</span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-surface-500 whitespace-nowrap">{it.slot ?? '—'}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${meta.cls}`} title={it.reason || ''}>
                          {tr(meta.label)}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        <button onClick={() => requeue(it)} disabled={it.fileId == null}
                          className="btn btn-ghost btn-sm text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-40"
                          title={it.fileId == null ? tr('Datei nicht mehr verfügbar') : tr('Dieses Modell erneut in die Warteschlange legen')}>
                          {tr('+ Warteschlange')}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
