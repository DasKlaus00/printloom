import React, { useState, useEffect } from 'react'
import { autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { usePageActive } from '../services/useAutoRefresh'

/* Drucker-Übersicht + Arm-Status (Phase 4.7)
   ──────────────────────────────────────────
   Erscheint NUR, wenn ein Farm-Layout mit Druckern eingerichtet ist. Bei einer
   klassischen Ein-Drucker-Installation gibt es nichts zu vergleichen, dann bleibt
   die Ansicht wie bisher.

   Der wichtigste Teil ist der Arm: Er ist die geteilte Ressource. Werden zwei
   Drucker gleichzeitig fertig, muss sichtbar sein, wer gerade bedient wird und
   wer wartet — sonst wirkt die Farm „hängend", obwohl sie nur der Reihe nach
   arbeitet. */

export default function PrinterOverview() {
  const { tr } = useLanguage()
  const active = usePageActive()
  const [data, setData] = useState(null)
  const [plan, setPlan] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => autofarmService.farmPrinters()
    .then(r => setData(r.data))
    .catch(() => setData(null))

  useEffect(() => {
    if (!active) return
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [active])

  const printers = data?.printers ?? []
  if (printers.length < 1) return null      // kein Layout → nichts anzeigen

  const arm = data?.arm ?? {}

  const preview = async (apply) => {
    setBusy(true)
    try {
      const r = await autofarmService.dispatch(apply)
      setPlan(r.data)
      if (apply) { setTimeout(() => setPlan(null), 4000); load() }
    } catch (e) {
      setPlan({ error: e?.response?.data?.detail || e.message })
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="section-label">{tr('Drucker')}</p>
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
          arm.busy ? 'border-blue-800/60 bg-blue-950/30 text-blue-300'
                   : 'border-surface-700/50 bg-surface-800/30 text-surface-500'}`}
          title={tr('Der OTTOeject kann immer nur an EINER Station sein')}>
          {arm.busy ? tr('🦾 Arm: {0}', arm.holder || '—') : tr('🦾 Arm frei')}
          {arm.waiting?.length ? ` · ${tr('{0} wartet', arm.waiting.length)}` : ''}
        </span>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {printers.map(p => (
          <div key={p.id} className={`rounded-lg border px-3 py-2 ${
            p.busy ? 'border-blue-800/50 bg-blue-950/15'
                   : p.enabled ? 'border-surface-700 bg-surface-900/50'
                               : 'border-surface-800 bg-surface-900/30 opacity-60'}`}>
            <div className="flex items-center gap-2">
              <span className={`dot shrink-0 ${p.busy ? 'dot-blue animate-pulse' : p.enabled ? 'dot-green' : 'dot-gray'}`} />
              <span className="text-sm text-surface-200 truncate">{p.name}</span>
              {arm.holder === p.id && (
                <span className="text-[9px] font-mono text-blue-400 shrink-0">{tr('am Arm')}</span>
              )}
              {arm.waiting?.includes(p.id) && (
                <span className="text-[9px] font-mono text-amber-400 shrink-0">{tr('wartet')}</span>
              )}
            </div>
            <p className="text-[11px] text-surface-500 font-mono mt-0.5">
              {tr('{0} frei', p.free_slots)} · {tr('{0} in Warteschlange', p.queue_len)}
              {p.racks?.length ? ` · ${tr('R{0}', p.racks.join(','))}` : ''}
            </p>
          </div>
        ))}
      </div>

      {printers.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-800/50">
          <button onClick={() => preview(false)} disabled={busy}
            className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('Verteilung ansehen')}</button>
          <button onClick={() => preview(true)} disabled={busy}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('⇉ Jetzt verteilen')}</button>
          {plan?.error && <span className="text-[11px] text-red-400">{plan.error}</span>}
          {plan && !plan.error && (
            <span className="text-[11px] text-surface-400">
              {plan.applied ? tr('✓ übernommen') : tr('Vorschau')}: {' '}
              {plan.plan.filter(x => x.printer).length}/{plan.plan.length} {tr('zugewiesen')}
              {plan.unassigned?.length ? ` · ${tr('{0} ohne Drucker', plan.unassigned.length)}` : ''}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
