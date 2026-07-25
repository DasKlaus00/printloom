import React, { useState, useEffect } from 'react'
import { autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'

/* Unterbrochener Lauf (Phase 3.1)
   ───────────────────────────────
   Der Farm-Zustand lag bis v1.1.1 nur im Speicher: Nach einem Neustart — auch dem
   durch das eigene In-App-Update — druckte der Drucker weiter, während die Farm
   einfach weg war. Niemand wusste, ob eine Platte im Greifer hing.

   Jetzt wird der Zustand bei jedem Schritt mitgeschrieben, und beim nächsten Start
   meldet Printloom, was unterbrochen wurde. BEWUSST nur eine Meldung: automatisch
   weiterfahren wäre gefährlich, denn der Arm steht an unbekannter Stelle. Nach dem
   Quittieren referenziert die nächste Bewegung selbst. */

export default function RecoveryBanner({ onDismissed }) {
  const { tr } = useLanguage()
  const [rec, setRec]   = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    autofarmService.getRecovery()
      .then(r => { if (r.data?.pending) setRec(r.data) })
      .catch(() => {})
  }, [])

  if (!rec) return null

  const dismiss = async (armCleared) => {
    setBusy(true)
    try {
      await autofarmService.dismissRecovery({ arm_cleared: armCleared })
      setRec(null)
      onDismissed?.()
    } catch { /* Banner stehen lassen, damit es nicht still verschwindet */ }
    finally { setBusy(false) }
  }

  const holding = rec.arm?.holding ?? 'none'
  const when = rec.saved_at ? new Date(rec.saved_at).toLocaleString() : ''

  return (
    <div className="rounded-xl border border-amber-700/70 bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none">⚠</span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-amber-200">
            {tr('Der letzte Lauf wurde unterbrochen')}
          </p>
          <p className="text-[12px] text-amber-100/80">
            {rec.job
              ? tr('Job „{0}" stand bei: {1}', rec.job, rec.step || tr('unbekannt'))
              : tr('Ein Lauf war aktiv, als Printloom beendet wurde.')}
            {rec.slot ? ` · ${tr('Fach {0}', rec.slot)}` : ''}
            {when ? ` · ${when}` : ''}
          </p>
          <p className={`text-[12px] font-medium ${holding === 'none' ? 'text-surface-300' : 'text-amber-300'}`}>
            {holding === 'none' ? '✓ ' : '✋ '}{rec.arm_hint}
          </p>
          <p className="text-[11px] text-surface-400">{rec.advice}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {holding !== 'none' && (
          <button onClick={() => dismiss(true)} disabled={busy}
            className="btn btn-primary btn-sm text-[11px] disabled:opacity-50">
            {tr('Platte ist abgenommen — quittieren')}
          </button>
        )}
        <button onClick={() => dismiss(holding === 'none')} disabled={busy}
          className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">
          {holding === 'none' ? tr('Verstanden') : tr('Nur quittieren (Platte hängt noch)')}
        </button>
      </div>
    </div>
  )
}
