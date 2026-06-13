import React, { useState, useEffect, useCallback } from 'react'
import { fileService } from '../services/api'

/* ── Color swatch ─────────────────────────────────────────────── */
function ColorDot({ hex, size = 'w-3 h-3' }) {
  if (!hex) return <span className={`${size} rounded-full bg-surface-700 inline-block flex-shrink-0`} />
  const color = hex.startsWith('#') ? hex : `#${hex}`
  return (
    <span
      className={`${size} rounded-full inline-block border border-white/10 flex-shrink-0`}
      style={{ backgroundColor: color }}
      title={color}
    />
  )
}

/* ── Diff highlight ───────────────────────────────────────────── */
function Cell({ a, b, label, fmt = (v) => v ?? '—', mono = false }) {
  const av = fmt(a)
  const bv = fmt(b)
  const diff = b !== undefined && String(av) !== String(bv)
  return (
    <div className={`flex items-center justify-between px-3 py-1.5 rounded text-xs ${diff ? 'bg-amber-950/30 border border-amber-800/40' : ''}`}>
      <span className="text-surface-500 shrink-0 mr-3">{label}</span>
      <div className="flex items-center gap-4 min-w-0">
        <span className={`${mono ? 'font-mono' : ''} text-surface-200 truncate ${diff ? 'text-amber-300' : ''}`}>{av}</span>
        {b !== undefined && (
          <span className={`${mono ? 'font-mono' : ''} text-surface-200 truncate ${diff ? 'text-amber-300' : ''}`}>{bv}</span>
        )}
      </div>
    </div>
  )
}

/* ── Section card ─────────────────────────────────────────────── */
function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border border-surface-700 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-surface-900 hover:bg-surface-800/60 transition-colors text-left"
      >
        <span className="text-xs font-semibold text-surface-300 uppercase tracking-wide">{title}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`text-surface-600 transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && <div className="px-3 py-2 space-y-1 bg-surface-950/40">{children}</div>}
    </div>
  )
}

/* ── Single file column ───────────────────────────────────────── */
function FileColumn({ data, label }) {
  if (!data) return (
    <div className="flex-1 flex items-center justify-center py-16 text-surface-600 text-sm">
      Keine Datei gewählt
    </div>
  )
  if (data.error) return (
    <div className="flex-1 px-4 py-6 text-red-400 text-sm">{data.error}</div>
  )
  return (
    <div className="flex-1 min-w-0 space-y-1 px-1">
      {data.warnings?.length > 0 && (
        <div className="space-y-1 mb-2">
          {data.warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-950/40 border border-amber-800/50">
              <span className="text-amber-400 text-xs mt-0.5 shrink-0">⚠</span>
              <p className="text-xs text-amber-300">{w}</p>
            </div>
          ))}
        </div>
      )}

      {/* Slicer */}
      {data.slicer && (
        <p className="text-[10px] text-surface-600 font-mono px-3 truncate" title={data.slicer}>
          {data.slicer}
        </p>
      )}
    </div>
  )
}

/* ── Row renderer for compare view ───────────────────────────── */
function Rows({ a, b }) {
  if (!a && !b) return null
  const two = a && b

  const row = (label, va, vb, mono = false) => {
    const diff = two && String(va ?? '') !== String(vb ?? '')
    return (
      <div className={`grid ${two ? 'grid-cols-[180px_1fr_1fr]' : 'grid-cols-[180px_1fr]'} items-center gap-2 px-3 py-1.5 rounded text-xs ${diff ? 'bg-amber-950/25 border border-amber-800/30' : ''}`}>
        <span className="text-surface-500 text-right pr-2">{label}</span>
        <span className={`${mono ? 'font-mono' : ''} ${diff ? 'text-amber-300' : 'text-surface-200'} truncate`}>{va ?? '—'}</span>
        {two && <span className={`${mono ? 'font-mono' : ''} ${diff ? 'text-amber-300' : 'text-surface-200'} truncate`}>{vb ?? '—'}</span>}
      </div>
    )
  }

  const fmt = (v, unit = '') => v != null && v !== 0 ? `${v}${unit}` : null

  return (
    <div className="space-y-5">

      {/* Overview */}
      <Section title="Übersicht">
        {row('Slicer',      a?.slicer,  b?.slicer)}
        {row('Drucker',     a?.machine, b?.machine)}
        {row('Druckzeit',   a?.estimated_time, b?.estimated_time)}
        {row('Max Z',       fmt(a?.max_z_mm, ' mm'), fmt(b?.max_z_mm, ' mm'), true)}
        {row('Schichten',   fmt(a?.layer_count), fmt(b?.layer_count), true)}
        {row('Düse',        fmt(a?.nozzle_diameter, ' mm'), fmt(b?.nozzle_diameter, ' mm'), true)}
        {row('Quelle',      a?.source, b?.source)}
        {row('GCode eingebettet', a?.has_gcode ? 'Ja' : 'Nein', b?.has_gcode ? 'Ja' : 'Nein')}
        {row('Platte (Slicer)', a?.plate_num != null ? `Platte ${a.plate_num}` : null, b?.plate_num != null ? `Platte ${b.plate_num}` : null, true)}
        {row('GCode-Pfad', a?.plate_gcode, b?.plate_gcode, true)}
      </Section>

      {/* Layer settings */}
      <Section title="Layer-Einstellungen">
        {row('Layer-Höhe',         fmt(a?.layer_height, ' mm'),         fmt(b?.layer_height, ' mm'), true)}
        {row('Erste Schicht',      fmt(a?.initial_layer_height, ' mm'), fmt(b?.initial_layer_height, ' mm'), true)}
        {row('Infill',             fmt(a?.infill_percent, ' %'),         fmt(b?.infill_percent, ' %'), true)}
        {row('Druckgeschw.',       fmt(a?.print_speed, ' mm/s'),         fmt(b?.print_speed, ' mm/s'), true)}
        {row('Support',            a?.support ? 'Ja' : 'Nein',           b?.support != null ? (b.support ? 'Ja' : 'Nein') : null)}
        {row('Brim',               fmt(a?.brim_width, ' mm'),             fmt(b?.brim_width, ' mm'), true)}
        {row('Ironing',            a?.ironing ? 'Ja' : 'Nein',           b?.ironing != null ? (b.ironing ? 'Ja' : 'Nein') : null)}
      </Section>

      {/* Filaments — prefer ams_slots (project_settings) if available */}
      <Section title="Filamente + AMS">
        {/* Slot overview from project_settings.config */}
        {(a?.ams_slots?.length > 0 || b?.ams_slots?.length > 0) ? (
          <div className="space-y-1">
            {/* column header when comparing */}
            {two && (
              <div className={`grid grid-cols-[140px_1fr_1fr] gap-2 px-3 pb-1`}>
                <span />
                <span className="text-[10px] text-surface-600 font-semibold">{a?.file_name ?? 'A'}</span>
                <span className="text-[10px] text-surface-600 font-semibold">{b?.file_name ?? 'B'}</span>
              </div>
            )}
            {/* Merge slot list from both sides */}
            {Array.from({ length: Math.max(a?.ams_slots?.length ?? 0, b?.ams_slots?.length ?? 0) }, (_, i) => {
              const as_ = a?.ams_slots?.[i]
              const bs_ = b?.ams_slots?.[i]
              const diff = two && as_ && bs_ && (as_.type !== bs_.type || as_.color !== bs_.color)
              const SlotCell = ({ s }) => {
                if (!s) return <span className="text-surface-700 text-xs">—</span>
                return (
                  <div className={`flex items-center gap-1.5 text-xs min-w-0 ${!s.used ? 'opacity-40' : ''}`}>
                    <ColorDot hex={s.color} />
                    <span className={`font-mono font-medium ${diff ? 'text-amber-300' : s.used ? 'text-surface-100' : 'text-surface-400'}`}>
                      {s.type || '—'}
                    </span>
                    {s.profile && (
                      <span className="text-surface-600 text-[10px] font-mono truncate max-w-[120px]" title={s.profile}>
                        {s.profile}
                      </span>
                    )}
                    {s.nozzle_temp > 0 && (
                      <span className="text-surface-600 font-mono text-[10px]">{s.nozzle_temp}°/{s.bed_temp}°</span>
                    )}
                    {s.used ? (
                      <span className="text-emerald-400 font-mono text-[10px] shrink-0">
                        ✓ {s.used_m > 0 ? `${s.used_m}m` : ''}{s.used_g > 0 ? ` ${s.used_g}g` : ''}
                      </span>
                    ) : (
                      <span className="text-surface-700 font-mono text-[10px] shrink-0">nicht gedruckt</span>
                    )}
                  </div>
                )
              }
              return (
                <div key={i} className={`grid ${two ? 'grid-cols-[140px_1fr_1fr]' : 'grid-cols-[140px_1fr]'} items-center gap-2 px-3 py-1 rounded ${diff ? 'bg-amber-950/25 border border-amber-800/30' : ''}`}>
                  <span className="text-surface-500 text-xs text-right pr-2 shrink-0">
                    {as_?.slot_label ?? bs_?.slot_label ?? `A${i+1}`}
                  </span>
                  <SlotCell s={as_} />
                  {two && <SlotCell s={bs_} />}
                </div>
              )
            })}
            {/* Bed type */}
            {row('Bett-Typ', a?.curr_bed_type || null, two ? (b?.curr_bed_type || null) : undefined)}
          </div>
        ) : (
          /* Fallback to gcode-header filaments */
          <>
            {(a?.filaments ?? []).map((f, i) => {
              const bf = b?.filaments?.[i]
              const diff = two && bf && (f.type !== bf.type || f.ams_slot !== bf.ams_slot)
              return (
                <div key={i} className={`grid ${two ? 'grid-cols-[180px_1fr_1fr]' : 'grid-cols-[180px_1fr]'} items-center gap-2 px-3 py-1.5 rounded ${diff ? 'bg-amber-950/25 border border-amber-800/30' : ''}`}>
                  <span className="text-surface-500 text-xs text-right pr-2">Filament {i}</span>
                  <div className="flex items-center gap-1.5 text-xs min-w-0">
                    <ColorDot hex={f.color} />
                    <span className={`font-mono ${diff ? 'text-amber-300' : 'text-surface-200'}`}>{f.type || '—'}</span>
                    <span className="text-blue-300 font-mono px-1 rounded bg-blue-950/40 border border-blue-800/40 text-[10px]">{f.ams_label}</span>
                    {f.nozzle_temp > 0 && <span className="text-surface-600 font-mono">{f.nozzle_temp}°/{f.bed_temp}°</span>}
                  </div>
                  {two && bf && (
                    <div className="flex items-center gap-1.5 text-xs min-w-0">
                      <ColorDot hex={bf.color} />
                      <span className={`font-mono ${diff ? 'text-amber-300' : 'text-surface-200'}`}>{bf.type || '—'}</span>
                      <span className="text-blue-300 font-mono px-1 rounded bg-blue-950/40 border border-blue-800/40 text-[10px]">{bf.ams_label}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </>
        )}
      </Section>

      {/* ZIP contents */}
      {(a?.zip_files?.length > 0 || b?.zip_files?.length > 0) && (
        <Section title="ZIP-Inhalt" defaultOpen={false}>
          <div className={`grid ${two ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
            {[a, b].filter(Boolean).map((d, idx) => (
              <div key={idx} className="space-y-0.5">
                {d.zip_files?.map(f => (
                  <p key={f} className="text-[10px] font-mono text-surface-600 truncate px-1">{f}</p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Raw header */}
      <Section title="GCode-Header (roh)" defaultOpen={false}>
        <div className={`grid ${two ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
          {[a, b].filter(Boolean).map((d, idx) => (
            <pre key={idx} className="text-[10px] font-mono text-surface-600 whitespace-pre-wrap leading-4 max-h-64 overflow-y-auto p-2 bg-surface-900 rounded">
              {d.raw_header || '(leer)'}
            </pre>
          ))}
        </div>
      </Section>

    </div>
  )
}

/* ── File selector ────────────────────────────────────────────── */
function FileSelect({ files, value, onChange, label }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <label className="text-[10px] text-surface-600 uppercase tracking-wide">{label}</label>
      <select value={value ?? ''} onChange={e => onChange(e.target.value ? +e.target.value : null)} className="text-sm">
        <option value="">— Datei wählen —</option>
        {files.map(f => (
          <option key={f.id} value={f.id}>{f.original_filename}</option>
        ))}
      </select>
    </div>
  )
}

/* ── Main page ────────────────────────────────────────────────── */
function FileAnalyzer() {
  const [files,    setFiles]    = useState([])
  const [idA,      setIdA]      = useState(null)
  const [idB,      setIdB]      = useState(null)
  const [dataA,    setDataA]    = useState(null)
  const [dataB,    setDataB]    = useState(null)
  const [loadingA, setLoadingA] = useState(false)
  const [loadingB, setLoadingB] = useState(false)

  useEffect(() => {
    fileService.listFiles()
      .then(r => setFiles((r.data.files ?? []).filter(f => f.file_type === '.3mf' || f.file_type === '.gcode')))
      .catch(() => {})
  }, [])

  const analyze = useCallback(async (id, setData, setLoading) => {
    if (!id) { setData(null); return }
    setLoading(true)
    try {
      const r = await fileService.deepAnalyze(id)
      setData(r.data)
    } catch (e) {
      setData({ error: e.response?.data?.detail ?? 'Analyse fehlgeschlagen' })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { analyze(idA, setDataA, setLoadingA) }, [idA, analyze])
  useEffect(() => { analyze(idB, setDataB, setLoadingB) }, [idB, analyze])

  const comparing = idA && idB

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-surface-100 mb-1">Datei-Analyse</h2>
        <p className="text-sm text-surface-500">
          Slicing-Metadaten, Temperaturen, Filamente und AMS-Mapping aus .3mf / .gcode extrahieren.
          Zwei Dateien gleichzeitig wählen für Side-by-Side-Vergleich — Unterschiede werden <span className="text-amber-300">orange</span> hervorgehoben.
        </p>
      </div>

      {/* File selector */}
      <div className="card">
        <div className={`grid ${comparing ? 'grid-cols-2' : 'grid-cols-1 sm:grid-cols-2'} gap-4`}>
          <FileSelect files={files} value={idA} onChange={setIdA} label="Datei A" />
          <FileSelect files={files} value={idB} onChange={setIdB} label="Datei B (Vergleich)" />
        </div>
      </div>

      {/* Column headers when comparing */}
      {comparing && (dataA || dataB) && (
        <div className="grid grid-cols-[180px_1fr_1fr] gap-2 px-4">
          <div />
          <div className="text-xs font-semibold text-surface-300 truncate">
            {dataA?.file_name ?? '…'}
          </div>
          <div className="text-xs font-semibold text-surface-300 truncate">
            {dataB?.file_name ?? '…'}
          </div>
        </div>
      )}

      {/* Loading states */}
      {(loadingA || loadingB) && (
        <p className="text-sm text-surface-500 animate-pulse px-1">Analysiere…</p>
      )}

      {/* Results */}
      {(dataA || dataB) && !loadingA && !loadingB && (
        <div className="card">
          <Rows a={dataA} b={comparing ? dataB : undefined} />
        </div>
      )}

      {!idA && !idB && (
        <div className="flex flex-col items-center justify-center py-16 text-surface-600 text-center card">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="mb-3">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
          <p className="text-sm mb-1">Datei wählen um zu beginnen</p>
          <p className="text-xs">Zwei Dateien wählen für direkten Vergleich</p>
        </div>
      )}
    </div>
  )
}

export default FileAnalyzer
