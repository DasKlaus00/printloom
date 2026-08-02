import React, { useMemo } from 'react'
import { useLanguage } from '../services/i18n'

/* Farm-Schiene (seit v1.1.8 Teil des Drucker-Tabs)
   ────────────────────────────────────────────────
   Bis v1.1.7 gab es dafür eine eigene Seite „Farm-Layout" mit EIGENEN X-Feldern
   je Modul. Damit stand jede Position zweimal in der App — hier und im
   Drucker-Tab — und beide wurden getrennt gepflegt. Der Test-Knopf fuhr nach den
   Werten des Drucker-Tabs, die Farm nach denen der Layout-Seite; welcher Wert
   gilt, war von außen nicht zu sehen.

   Deshalb zeichnet diese Ansicht nur noch, was DANEBEN eingestellt ist: sie
   bekommt die Werte als Props aus dem laufenden Formular und hat keinen eigenen
   Speicher. Was hier steht, ist damit zwangsläufig das, was der Arm fährt —
   auch schon während des Tippens.

   Richtung wie die Maschine steht: X 0 (Home/Endschalter) RECHTS, wachsende
   X-Werte nach links. */

// Randabstand in %, damit Home bei X 0 nicht an der Kante abgeschnitten wird.
const RAIL_PAD = 5

export default function FarmRail({ racks = [], printerX = null, printerName = '',
                                   limitX = 0, push = 0 }) {
  const { tr } = useLanguage()

  const mods = useMemo(() => {
    const out = [{ id: 'home', icon: '⌂', name: tr('Home'), x: 0, kind: 'home' }]
    for (const r of racks) {
      out.push({ id: `r${r.nr}`, icon: '▤', name: tr('Regal {0}', r.nr), x: r.x, kind: 'rack' })
    }
    if (printerX != null && Number.isFinite(printerX)) {
      out.push({ id: 'printer', icon: '🖨', name: printerName || tr('Drucker'),
                 x: printerX, kind: 'printer' })
    }
    return out.sort((a, b) => b.x - a.x)      // links = größtes X
  }, [racks, printerX, printerName, tr])

  const max = Math.max(limitX || 0, ...mods.map(m => m.x), 100)

  /* Zwei Dinge, die man auf der Schiene sofort sehen soll und die sonst erst der
     Arm zeigt: ein Regal ohne Platz für den Andruck-Weg (Griff unmöglich) und
     zwei Module, die praktisch übereinander stehen. */
  const tooClose = new Set(
    push > 0 ? mods.filter(m => m.kind === 'rack' && m.x - push < 0).map(m => m.id) : [])
  const overLimit = new Set(limitX > 0 ? mods.filter(m => m.x > limitX).map(m => m.id) : [])

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-surface-400">{tr('Schiene (X in mm) — 0 rechts')}</span>
        {limitX > 0 && (
          <span className="text-[9px] font-mono text-surface-600">{tr('Achsgrenze X {0}', limitX)}</span>
        )}
      </div>
      <div className="relative h-20 rounded-lg bg-surface-950 border border-surface-800 overflow-hidden">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-surface-700" />
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-surface-700 leading-none">◀</span>
        {mods.map(m => {
          const pct = Math.max(0, Math.min(100, (m.x / (max || 1)) * 100))
          const bad = tooClose.has(m.id) || overLimit.has(m.id)
          return (
            <div key={m.id}
              className="absolute translate-x-1/2 flex flex-col items-center gap-0.5"
              style={{ right: `${RAIL_PAD + pct * (100 - 2 * RAIL_PAD) / 100}%`, top: '14%' }}
              title={`${m.name} · X ${m.x}`}>
              <span className="text-sm leading-none">{m.icon}</span>
              <span className={`text-[9px] whitespace-nowrap max-w-20 truncate ${
                bad ? 'text-red-400' : 'text-surface-400'}`}>{m.name}</span>
              <span className={`text-[9px] font-mono ${bad ? 'text-red-400' : 'text-surface-600'}`}>
                {m.x}
              </span>
            </div>
          )
        })}
        <span className="absolute right-1 bottom-0.5 text-[9px] font-mono text-surface-600">
          {tr('0 · Home')}
        </span>
      </div>
      <p className="text-[9px] text-surface-600">
        {tr('Home liegt bei X 0 (Endschalter, rechts am Gerät) — deshalb ist die Schiene von rechts nach links gezeichnet. Die Positionen kommen aus den Feldern oben; es gibt keine zweite Stelle, an der sie stehen.')}
      </p>
      {tooClose.size > 0 && (
        <p className="text-[10px] text-red-400">
          {tr('⚠ Rot markiert: weniger als der Andruck-Weg ({0} mm) vom Endschalter entfernt — Greifen und Ablegen sind dort nicht möglich.', push)}
        </p>
      )}
    </div>
  )
}
