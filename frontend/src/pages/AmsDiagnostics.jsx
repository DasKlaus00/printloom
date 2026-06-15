import React, { useState, useEffect, useCallback } from 'react'
import { printerService } from '../services/api'
import { useLanguage } from '../services/i18n'

function StatusBadge({ result }) {
  const { tr } = useLanguage()
  if (result === 'ok')      return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/50 text-emerald-400 border border-emerald-800/50">OK</span>
  if (result === 'error')   return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-red-950/50 text-red-400 border border-red-800/50">{tr('FEHLER')}</span>
  if (result === 'running') return <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-950/50 text-amber-400 border border-amber-800/50 animate-pulse">{tr('läuft…')}</span>
  return null
}

function StepBlock({ step }) {
  const [open, setOpen] = useState(true)
  return (
    <div className={`rounded-lg border text-xs ${step.ok ? 'border-surface-800/60 bg-surface-900/30' : 'border-red-800/50 bg-red-950/20'}`}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left"
      >
        <div className="flex items-center gap-2">
          <span className={`text-[10px] font-mono shrink-0 ${step.ok ? 'text-emerald-500' : 'text-red-400'}`}>
            {step.ok ? '✓' : '✗'}
          </span>
          <span className={`font-mono font-medium ${step.ok ? 'text-surface-300' : 'text-red-300'}`}>
            {step.title}
          </span>
        </div>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-surface-700 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div className="px-3 pb-2.5 space-y-0.5 border-t border-surface-800/30">
          {(step.lines ?? []).map((line, i) => (
            <p key={i} className={`font-mono text-[11px] leading-5 whitespace-pre ${
              line.includes('✓') ? 'text-emerald-400' :
              line.includes('FEHL') || line.includes('FEHLER') ? 'text-red-400' :
              line.includes('Quelle') ? 'text-surface-400' :
              line.startsWith('  ►') || line.startsWith('►') ? 'text-sky-300 font-semibold' :
              'text-surface-500'
            }`}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function SessionCard({ session, idx }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState(idx === 0)
  return (
    <div className="card">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-start justify-between gap-3 text-left"
      >
        <div className="flex items-start gap-3 min-w-0">
          <div className="mt-0.5 shrink-0">
            <StatusBadge result={session.result} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-surface-100 truncate">{session.file}</p>
            <p className="text-[11px] text-surface-600 font-mono mt-0.5">{session.ts}</p>
          </div>
        </div>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-surface-600 transition-transform shrink-0 mt-1 ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          {(session.steps ?? []).map((step, i) => (
            <StepBlock key={i} step={step} />
          ))}
          {session.steps?.length === 0 && (
            <p className="text-xs text-surface-700 py-2">{tr('Keine Schritte aufgezeichnet.')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function AmsDiagnostics() {
  const { tr } = useLanguage()
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [clearing, setClearing] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    printerService.getSendDiagnostics()
      .then(r => setSessions(r.data.sessions ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const clear = () => {
    setClearing(true)
    printerService.clearSendDiagnostics()
      .then(() => setSessions([]))
      .catch(() => {})
      .finally(() => setClearing(false))
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-surface-100 mb-1">{tr('AMS-Diagnose')}</h2>
          <p className="text-sm text-surface-500">
            {tr('Zeigt für jeden Sende-Vorgang genau, woher das AMS-Mapping stammt und welcher Slot gewählt wurde. Seite aktualisiert sich alle 5 Sekunden automatisch.')}
          </p>
        </div>
        <button
          onClick={clear}
          disabled={clearing}
          className="btn btn-ghost btn-sm shrink-0"
        >
          {clearing ? '…' : '↺ Reset'}
        </button>
      </div>

      {loading && sessions.length === 0 && (
        <p className="text-sm text-surface-600 animate-pulse">{tr('Lade…')}</p>
      )}

      {sessions.length === 0 && !loading && (
        <div className="card flex flex-col items-center py-16 text-surface-600 text-center">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="mb-3">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="9" y1="13" x2="15" y2="13"/>
          </svg>
          <p className="text-sm mb-1">{tr('Noch keine Sende-Vorgänge aufgezeichnet')}</p>
          <p className="text-xs">{tr('Sende eine Datei an den Drucker — der Vorgang wird hier vollständig protokolliert.')}</p>
        </div>
      )}

      <div className="space-y-4">
        {sessions.map((s, i) => (
          <SessionCard key={`${s.ts}-${i}`} session={s} idx={i} />
        ))}
      </div>
    </div>
  )
}

export default AmsDiagnostics
