import React, { useMemo } from 'react'
import { useLanguage } from '../services/i18n'

/* Farm-Schiene — die Übersicht über den ganzen Aufbau
   ───────────────────────────────────────────────────
   Bis v1.1.7 gab es dafür eine eigene Seite „Farm-Layout" mit EIGENEN X-Feldern
   je Modul. Damit stand jede Position zweimal in der App und beide Stellen wurden
   getrennt gepflegt; welcher Wert gilt, war von außen nicht zu sehen.

   Deshalb zeichnet diese Ansicht nur, was DANEBEN eingestellt ist: sie bekommt die
   Werte als Props aus dem laufenden Formular und hat keinen eigenen Speicher. Was
   hier steht, ist zwangsläufig das, was der Arm fährt — auch schon beim Tippen.

   Richtung wie die Maschine steht: X 0 (Home/Endschalter) RECHTS, wachsende
   X-Werte nach links. Anklickbar: ein Modul springt zu seinem Abschnitt. */

// Randabstand in %, damit Home bei X 0 nicht an der Kante abgeschnitten wird.
const RAIL_PAD = 5

export default function FarmRail({ racks = [], printers = [], limitX = 0, push = 0,
                                   activeId = null, onSelect = null }) {
  const { tr } = useLanguage()

  const mods = useMemo(() => {
    const out = [{ id: 'home', icon: '⌂', name: tr('Home'), x: 0, kind: 'home' }]
    for (const r of racks) {
      out.push({ id: `rack-${r.nr}`, icon: '▤', x: r.x, kind: 'rack',
                 name: r.name || tr('Regal {0}', r.nr), sub: r.printerName || '' })
    }
    for (const p of printers) {
      if (p.x == null || !Number.isFinite(p.x)) continue
      out.push({ id: p.id, icon: '🖨', x: p.x, kind: 'printer', name: p.name || tr('Drucker') })
    }
    return out.sort((a, b) => b.x - a.x)      // links = größtes X
  }, [racks, printers, tr])

  const max = Math.max(limitX || 0, ...mods.map(m => m.x), 100)

  /* Drei Dinge, die man auf der Schiene sofort sehen soll und die sonst erst der
     Arm zeigt: ein Regal ohne Platz für den Andruck-Weg (Griff unmöglich), ein
     Modul jenseits der Achsgrenze und zwei Module übereinander. */
  const tooClose = new Set(
    push > 0 ? mods.filter(m => m.kind === 'rack' && m.x - push < 0).map(m => m.id) : [])
  const overLimit = new Set(limitX > 0 ? mods.filter(m => m.x > limitX).map(m => m.id) : [])
  const collision = new Set(
    mods.filter((m, i) => mods.some((o, j) => j !== i && o.kind !== 'home'
      && m.kind !== 'home' && Math.abs(o.x - m.x) < 1)).map(m => m.id))

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-surface-400">{tr('Schiene (X in mm) — 0 rechts')}</span>
        {limitX > 0 && (
          <span className="text-[9px] font-mono text-surface-600">{tr('Achsgrenze X {0}', limitX)}</span>
        )}
      </div>
      <div className="relative h-24 rounded-lg bg-surface-950 border border-surface-800 overflow-hidden">
        <div className="absolute left-0 right-0 top-1/2 h-px bg-surface-700" />
        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[10px] text-surface-700 leading-none">◀</span>
        {mods.map(m => {
          const pct = Math.max(0, Math.min(100, (m.x / (max || 1)) * 100))
          const bad = tooClose.has(m.id) || overLimit.has(m.id) || collision.has(m.id)
          const active = activeId && m.id === activeId
          return (
            <button key={m.id} type="button"
              onClick={onSelect ? () => onSelect(m.id, m.kind) : undefined}
              disabled={!onSelect || m.kind === 'home'}
              className={`absolute translate-x-1/2 flex flex-col items-center gap-0.5 px-1 py-0.5 rounded
                          ${onSelect && m.kind !== 'home' ? 'hover:bg-surface-800/70 cursor-pointer' : ''}
                          ${active ? 'bg-blue-950/60 ring-1 ring-blue-700' : ''}`}
              style={{ right: `${RAIL_PAD + pct * (100 - 2 * RAIL_PAD) / 100}%`, top: '10%' }}
              title={`${m.name} · X ${m.x}`}>
              <span className="text-sm leading-none">{m.icon}</span>
              <span className={`text-[9px] whitespace-nowrap max-w-24 truncate ${
                bad ? 'text-red-400' : active ? 'text-blue-200' : 'text-surface-400'}`}>{m.name}</span>
              <span className={`text-[9px] font-mono ${bad ? 'text-red-400' : 'text-surface-600'}`}>
                {m.x}
              </span>
              {m.sub && <span className="text-[8px] text-surface-600 max-w-24 truncate">{m.sub}</span>}
            </button>
          )
        })}
        <span className="absolute right-1 bottom-0.5 text-[9px] font-mono text-surface-600">
          {tr('0 · Home')}
        </span>
      </div>
      <p className="text-[9px] text-surface-600">
        {tr('Home liegt bei X 0 (Endschalter, rechts am Gerät) — deshalb ist die Schiene von rechts nach links gezeichnet. Die Positionen kommen aus den Abschnitten unten; es gibt keine zweite Stelle, an der sie stehen. Ein Klick springt zum Abschnitt.')}
      </p>
      {tooClose.size > 0 && (
        <p className="text-[10px] text-red-400">
          {tr('⚠ Rot markiert: weniger als der Andruck-Weg ({0} mm) vom Endschalter entfernt — Greifen und Ablegen sind dort nicht möglich.', push)}
        </p>
      )}
      {collision.size > 0 && (
        <p className="text-[10px] text-red-400">
          {tr('⚠ Zwei Module stehen an derselben X-Position — das kann nur eines von beiden sein.')}
        </p>
      )}
    </div>
  )
}
