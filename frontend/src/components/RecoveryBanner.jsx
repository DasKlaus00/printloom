import React, { useState, useEffect, useCallback } from 'react'
import { autofarmService } from '../services/api'
import { useLanguage, locale } from '../services/i18n'
import { recoveryHint } from '../services/recovery'

/* Unterbrochener Lauf / Platte noch im Greifer oder Drucker (Phase 3.1, v1.1.47)
   ─────────────────────────────────────────────────────────────────────────────
   Der Farm-Zustand lag bis v1.1.1 nur im Speicher: Nach einem Neustart — auch dem
   durch das eigene In-App-Update — druckte der Drucker weiter, während die Farm
   einfach weg war. Niemand wusste, ob eine Platte im Greifer hing.

   Jetzt wird der Zustand bei jedem Schritt mitgeschrieben. Seit v1.1.47 auch das
   Druckbett, und der Hinweis kommt auch nach einem Stopp oder Direktdruck, nicht nur
   nach einem Neustart. BEWUSST nur eine Meldung: automatisch weiterfahren wäre
   gefährlich. Die Farm startet erst, wenn bestätigt ist, dass Greifer und Bett leer
   sind; „Nur quittieren" lässt den Hinweis in Kurzform stehen.

   `reloadKey`: ändert sich, wenn die Farm stoppt oder ein Start abgelehnt wurde —
   dann neu fragen, damit der Hinweis ohne Neuladen der Seite erscheint. */
export default function RecoveryBanner({ onDismissed, reloadKey }) {
  const { tr } = useLanguage()
  const [rec, setRec]       = useState(null)
  const [busy, setBusy]     = useState(false)
  const [short, setShort]   = useState(false)

  const load = useCallback(() => {
    autofarmService.getRecovery()
      .then(r => setRec(r.data?.pending ? r.data : null))
      .catch(e => console.warn('Hinweis nach Abbruch nicht geladen:', e?.message || e))
  }, [])

  useEffect(() => { load() }, [load, reloadKey])

  if (!rec) return null

  const h = recoveryHint(rec)
  const when = rec.saved_at ? new Date(rec.saved_at).toLocaleString(locale()) : ''

  const dismiss = async (cleared) => {
    setBusy(true)
    try {
      const r = await autofarmService.dismissRecovery({ arm_cleared: cleared, bed_cleared: cleared })
      if (r.data?.pending) { setShort(true); load() }
      else { setRec(null); setShort(false) }
      onDismissed?.()
    } catch (e) {
      // Hinweis stehen lassen, damit er nicht still verschwindet.
      console.warn('Quittieren fehlgeschlagen:', e?.message || e)
    } finally { setBusy(false) }
  }

  const confirmBtn = (
    <button onClick={() => dismiss(true)} disabled={busy}
      className="btn btn-primary btn-sm text-[11px] disabled:opacity-50">
      {h.bedFull && !h.armFull ? tr('Druckbett ist leer — bestätigen') : tr('Platte ist abgenommen — quittieren')}
    </button>
  )

  if (short && !h.clean) {
    return (
      <div className="rounded-xl border border-amber-700/70 bg-amber-950/30 px-4 py-2 flex flex-wrap items-center gap-3">
        <span className="text-[12px] text-amber-300 flex-1">
          ✋ {[h.armFull && tr(h.arm.key, ...h.arm.args), h.bedFull && tr(h.bed.key, ...h.bed.args)].filter(Boolean).join(' · ')}
        </span>
        {confirmBtn}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-amber-700/70 bg-amber-950/30 p-4 space-y-3">
      <div className="flex items-start gap-3">
        <span className="text-lg leading-none">⚠</span>
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-amber-200">
            {rec.interrupted === false
              ? tr('Laut letztem Stand liegt noch eine Platte im Greifer oder Drucker')
              : tr('Der letzte Lauf wurde unterbrochen')}
          </p>
          {rec.interrupted !== false && (
            <p className="text-[12px] text-amber-100/80">
              {rec.job
                ? tr('Job „{0}" stand bei: {1}', rec.job, rec.step ? tr(rec.step) : tr('unbekannt'))
                : tr('Ein Lauf war aktiv, als Printloom beendet wurde.')}
              {rec.slot ? ` · ${tr('Fach {0}', rec.slot)}` : ''}
              {when ? ` · ${when}` : ''}
            </p>
          )}
          <p className={`text-[12px] font-medium ${h.armFull ? 'text-amber-300' : 'text-surface-300'}`}>
            {h.armFull ? '✋ ' : '✓ '}{tr(h.arm.key, ...h.arm.args)}
          </p>
          <p className={`text-[12px] font-medium ${h.bedFull ? 'text-amber-300' : 'text-surface-300'}`}>
            {h.bedFull ? '✋ ' : '✓ '}{tr(h.bed.key, ...h.bed.args)}
          </p>
          <p className="text-[11px] text-surface-400">
            {tr('Erst nachsehen: Steht eine Platte im Greifer oder im Drucker? Danach hier bestätigen — die Farm referenziert vor der nächsten Bewegung selbst.')}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!h.clean && confirmBtn}
        <button onClick={() => dismiss(h.clean)} disabled={busy}
          className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">
          {h.clean ? tr('Verstanden') : tr('Nur quittieren (Platte hängt noch)')}
        </button>
      </div>
    </div>
  )
}
