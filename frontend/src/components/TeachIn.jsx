import React, { useState, useEffect, useCallback } from 'react'
import { controlService } from '../services/api'
import { useLanguage } from '../services/i18n'

/* Einmess-Assistent (Phase 2.1)
   ─────────────────────────────
   Bisher trug man Positionen als Zahlen ein und probierte im Wechsel „Test" →
   „Wert korrigieren" → „Test". Hier fährt der Arm hin, man justiert mit den
   Pfeilen nach, drückt „Hierher übernehmen" — und Printloom rechnet den Wert
   aus der ECHTEN Ist-Position.

   Sicherheit: Jeder Jog geht über /control/ottoeject/jog, das VORHER gegen die
   Achsgrenzen prüft (und gegen 0 = Endschalter). Ein Tippfehler beim Einmessen
   kann den Arm also nicht mehr in den Anschlag fahren.

   `onApply(pos)` bekommt {x, y, z} der Ist-Position. Was davon übernommen wird,
   entscheidet die aufrufende Stelle (z. B. nur X bei der Regal-Position). */

const STEPS_MM = [0.1, 0.5, 1, 5, 10]

export default function TeachIn({
  title,                 // z. B. „Fach 1 in Regal 1"
  hint,                  // was man anfahren soll
  axes = ['x', 'y', 'z'],
  onApply,               // (pos) => void
  onApproach,            // optional: () => Promise — „Position anfahren"
  applyLabel,
  onClose,
}) {
  const { tr } = useLanguage()
  const [pos, setPos]     = useState(null)     // {x,y,z,homed_axes}
  const [step, setStep]   = useState(1)
  const [busy, setBusy]   = useState(false)
  const [msg, setMsg]     = useState('')
  const [err, setErr]     = useState(false)

  const readPos = useCallback(async () => {
    try {
      const r = await controlService.getKlipperPosition()
      setPos(r.data)
      return r.data
    } catch (e) {
      setErr(true)
      setMsg(e?.response?.data?.detail || tr('Position nicht lesbar'))
      return null
    }
  }, [tr])

  useEffect(() => { readPos() }, [readPos])

  const jog = async (axis, dir) => {
    if (busy) return
    setBusy(true); setErr(false); setMsg('')
    try {
      const r = await controlService.jog(axis, dir * step)
      setMsg(tr('{0} {1} → {2} mm', axis.toUpperCase(), dir > 0 ? `+${step}` : `−${step}`, r.data.to))
      // Kurz warten, bis die (kurze) Bewegung durch ist, dann Ist-Position holen.
      setTimeout(readPos, 350)
    } catch (e) {
      setErr(true)
      setMsg(e?.response?.data?.detail || tr('Bewegung abgelehnt'))
    } finally { setBusy(false) }
  }

  const approach = async () => {
    if (!onApproach || busy) return
    setBusy(true); setErr(false); setMsg(tr('Fahre an…'))
    try {
      await onApproach()
      setMsg(tr('Angefahren — jetzt mit den Pfeilen genau justieren'))
      setTimeout(readPos, 800)
    } catch (e) {
      setErr(true)
      setMsg(e?.response?.data?.detail || tr('Anfahren fehlgeschlagen'))
    } finally { setBusy(false) }
  }

  const apply = async () => {
    const p = await readPos()
    if (!p) return
    onApply?.({ x: p.x, y: p.y, z: p.z })
    setMsg(tr('✓ Übernommen: X {0} · Y {1} · Z {2}', p.x, p.y, p.z))
    setErr(false)
  }

  const homed = String(pos?.homed_axes ?? '').toLowerCase()
  const notHomed = pos && axes.some(a => !homed.includes(a))

  return (
    <div className="rounded-xl border border-blue-800/50 bg-blue-950/10 p-3 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-blue-200">{tr('📐 Einmessen')}{title ? ` — ${title}` : ''}</p>
          {hint && <p className="text-[11px] text-surface-500 mt-0.5">{hint}</p>}
        </div>
        {onClose && (
          <button onClick={onClose} className="text-surface-600 hover:text-surface-300 text-sm shrink-0">✕</button>
        )}
      </div>

      {notHomed && (
        <p className="text-[11px] text-amber-400">
          {tr('Nicht referenziert — erst „Referenzfahrt", sonst lehnt Klipper jede Bewegung ab.')}
        </p>
      )}

      {/* Ist-Position */}
      <div className="flex items-center gap-3 font-mono text-xs">
        {['x', 'y', 'z'].map(a => (
          <span key={a} className={axes.includes(a) ? 'text-surface-200' : 'text-surface-700'}>
            {a.toUpperCase()} {pos?.[a] ?? '—'}
          </span>
        ))}
        <button onClick={readPos} title={tr('Position neu lesen')}
          className="ml-auto text-[11px] text-blue-400 hover:text-blue-300">↻</button>
      </div>

      {/* Schrittweite */}
      <div className="flex items-center gap-1">
        <span className="text-[11px] text-surface-500 mr-1">{tr('Schritt')}</span>
        {STEPS_MM.map(s => (
          <button key={s} onClick={() => setStep(s)}
            className={`text-[11px] px-1.5 py-0.5 rounded border ${
              step === s ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                         : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>
            {s}
          </button>
        ))}
        <span className="text-[11px] text-surface-600">mm</span>
      </div>

      {/* Jog je Achse */}
      <div className="space-y-1.5">
        {axes.map(a => (
          <div key={a} className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-surface-400 w-3">{a.toUpperCase()}</span>
            <button onClick={() => jog(a, -1)} disabled={busy}
              className="btn btn-secondary btn-sm text-[11px] w-10 disabled:opacity-40">−</button>
            <button onClick={() => jog(a, +1)} disabled={busy}
              className="btn btn-secondary btn-sm text-[11px] w-10 disabled:opacity-40">+</button>
            <span className="text-[10px] text-surface-600">
              {a === 'x' ? tr('links / rechts') : a === 'y' ? tr('vor / zurück') : tr('runter / hoch')}
            </span>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-800/60">
        {onApproach && (
          <button onClick={approach} disabled={busy}
            className="btn btn-ghost btn-sm text-[11px] disabled:opacity-40">{tr('→ Position anfahren')}</button>
        )}
        <button onClick={apply} disabled={busy || !pos}
          className="btn btn-primary btn-sm text-[11px] disabled:opacity-40">
          {applyLabel || tr('✓ Hierher übernehmen')}
        </button>
        {msg && <span className={`text-[11px] font-mono ${err ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</span>}
      </div>
    </div>
  )
}
