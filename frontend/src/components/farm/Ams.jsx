import React from 'react'
import ColorDot from '../../components/ColorDot'
import { colorDist, amsAutoMap, EXACT_COLOR_THRESHOLD, AMS_COLOR_THRESHOLD } from '../../services/amsUtils'
import { colorLabel } from '../../services/colorNames'
import { useLanguage } from '../../services/i18n'

/* Aus pages/AutoFarm.jsx verschoben (v1.1.79), wortgleich. */

// Trefferqualität → Ampel-Farbe + Label (geteilt von Vorschau & Mapper).
const AMS_Q = {
  exact:      { dot: 'bg-emerald-500', text: 'text-emerald-400', label: 'exakt' },
  similar:    { dot: 'bg-amber-500',   text: 'text-amber-400',   label: 'ähnlich' },
  far:        { dot: 'bg-red-500',     text: 'text-red-400',     label: 'Farbe weicht ab' },
  missing:    { dot: 'bg-red-500',     text: 'text-red-400',     label: 'kein Material' },
  unreadable: { dot: 'bg-surface-600', text: 'text-surface-500', label: 'AMS offline' },
}
const colorQuality = (d) => d <= EXACT_COLOR_THRESHOLD ? 'exact' : (d <= AMS_COLOR_THRESHOLD ? 'similar' : 'far')

function AmsDot({ hex }) {
  return <ColorDot hex={hex} size="w-3.5 h-3.5" />
}

// Read-only AMS-Mapping-Vorschau (1.3) mit Ampel + Klartext-Farbnamen (1.6).
export function AmsPreview({ filaments, amsSlots }) {
  const { tr } = useLanguage()
  if (!filaments?.length || !amsSlots?.length) return null
  const rows = amsAutoMap(filaments, amsSlots)
  return (
    <div className="space-y-1 mt-1.5">
      <p className="text-[10px] uppercase tracking-wide text-surface-600">{tr('AMS-Zuordnung (Vorschau)')}</p>
      {rows.map((r, i) => {
        const q = AMS_Q[r.quality] ?? AMS_Q.unreadable
        return (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <AmsDot hex={r.color} />
            <span className="text-surface-400 truncate max-w-[7rem]">{(r.type || '?')}{r.color ? ` · ${colorLabel(r.color)}` : ''}</span>
            <span className="text-surface-700">→</span>
            {r.slot ? (
              <>
                <AmsDot hex={r.slot.color} />
                <span className="text-surface-400 truncate max-w-[7rem]">{colorLabel(r.slot.color)}<span className="text-surface-600 font-mono"> [{r.slot.gid}]</span></span>
              </>
            ) : <span className="text-surface-500">{tr('—')}</span>}
            <span className={`ml-auto flex items-center gap-1 ${q.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${q.dot}`} />{tr(q.label)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export function AmsMapper({ filaments, amsSlots, value, onChange }) {
  const { tr } = useLanguage()
  const norm = c => (c||'').replace('#','').toUpperCase().slice(0,6)

  const mapArr = React.useMemo(() => {
    if (value && value.trim()) {
      const parts = value.split(',').map(s => parseInt(s.trim(),10))
      if (parts.length === filaments.length && parts.every(n => !isNaN(n))) return parts
    }
    return filaments.map((_,i) => amsSlots[i]?.gid ?? 0)
  }, [value, filaments, amsSlots])

  if (!filaments.length) return <p className="text-[10px] text-surface-600 py-1">{tr('Keine Filament-Info in Datei (älteres Format)')}</p>
  if (!amsSlots.length)  return <p className="text-[10px] text-surface-600 py-1">{tr('Kein AMS erkannt — Drucker offline?')}</p>

  const autoMatch = () => {
    const nm = filaments.map((f, fi) => {
      const fBase  = (f.type||'').toUpperCase().trim().split(/\s+/)[0]
      const fColor = norm(f.color)
      const pool   = amsSlots.filter(s => s.type.toUpperCase().includes(fBase) || fBase.includes(s.type.toUpperCase().split(/\s+/)[0]))
      const src    = pool.length ? pool : amsSlots
      return [...src].sort((a,b) => colorDist(fColor, norm(a.color)) - colorDist(fColor, norm(b.color)))[0]?.gid ?? mapArr[fi]
    })
    onChange(nm.join(','))
  }

  return (
    <div className="space-y-1.5">
      {filaments.map((f, fi) => {
        const slot    = amsSlots.find(s => s.gid === mapArr[fi]) ?? amsSlots[0]
        const fColor  = norm(f.color)
        const sColor  = norm(slot?.color)
        const q       = AMS_Q[colorQuality((fColor && sColor) ? colorDist(fColor, sColor) : 0)]
        return (
          <div key={fi} className="flex items-center gap-1.5">
            <AmsDot hex={f.color} />
            <span className="text-[10px] text-surface-400 w-20 truncate shrink-0" title={f.color ? colorLabel(f.color) : ''}>
              {f.type||'?'}{f.color ? ` · ${colorLabel(f.color)}` : ''}
            </span>
            <span className="text-surface-700 text-[10px]">→</span>
            <select
              value={mapArr[fi] ?? ''}
              onChange={e => { const nm=[...mapArr]; nm[fi]=+e.target.value; onChange(nm.join(',')) }}
              className="flex-1 text-[10px] font-mono h-6 py-0"
            >
              {amsSlots.map(s => (
                <option key={s.gid} value={s.gid}>[{s.gid}] {s.type}{s.color ? ` · ${colorLabel(s.color)}` : ''}</option>
              ))}
            </select>
            <AmsDot hex={slot?.color} />
            <span className={`flex items-center gap-0.5 text-[10px] shrink-0 ${q.text}`} title={tr('Trefferqualität')}>
              <span className={`w-1.5 h-1.5 rounded-full ${q.dot}`} />{tr(q.label)}
            </span>
          </div>
        )
      })}
      <div className="flex items-center gap-2 pt-1 border-t border-surface-700">
        <span className="text-[10px] text-surface-700 font-mono">{tr('Map:')} {mapArr.join(',')}</span>
        <button onClick={autoMatch} className="ml-auto text-xs text-blue-400 hover:text-blue-300 transition-colors">
          {tr('Auto-Match')}
        </button>
      </div>
    </div>
  )
}
