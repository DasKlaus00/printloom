import React, { useState, useEffect, useCallback, useRef } from 'react'
import { profileService } from '../services/api'

const PRINTER_MODELS = [
  ['BBL_X1C',     'Bambu Lab X1 Carbon'],
  ['BBL_X1',      'Bambu Lab X1'],
  ['BBL_P1S',     'Bambu Lab P1S'],
  ['BBL_P1P',     'Bambu Lab P1P'],
  ['BBL_A1',      'Bambu Lab A1'],
  ['BBL_A1_MINI', 'Bambu Lab A1 mini'],
  ['CREALITY_K1', 'Creality K1 / K1C'],
  ['PRUSA_MK4',   'Prusa MK4'],
  ['VORON',       'Voron (Klipper)'],
  ['OTHER',       'Anderer / generisch'],
]

const SECTION_LABELS = {
  macro_config: 'Kalibrierung',
  sequences:    'Sequenzen',
  rack_config:  'Regal-Konfig',
  settings:     'Einstellungen',
}

function Banner({ kind, children, onClose }) {
  if (!children) return null
  const cls = kind === 'error'
    ? 'bg-red-950/40 border-red-800 text-red-300'
    : 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
  return (
    <div className={`px-4 py-2.5 rounded-lg border text-sm flex items-start justify-between gap-3 ${cls}`}>
      <span className="min-w-0">{children}</span>
      {onClose && <button onClick={onClose} className="text-xs opacity-70 hover:opacity-100 shrink-0">×</button>}
    </div>
  )
}

function SectionDetail({ section, data }) {
  if (!data) return null

  if (section === 'macro_config') {
    const entries = Object.entries(data)
    if (!entries.length) return null
    return (
      <div className="mt-1.5 space-y-2">
        {entries.map(([key, macro]) => {
          const fields = macro?.fields ? Object.entries(macro.fields) : []
          return (
            <div key={key} className="rounded-lg border border-surface-800/60 bg-surface-900/40 p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div>
                  <p className="text-[11px] font-medium text-surface-200">{macro?.label || key}</p>
                  <p className="text-[9px] text-surface-600 font-mono mt-0.5">{key}</p>
                </div>
                {macro?.internal_macro && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-surface-800 border border-surface-700/50 text-surface-500 shrink-0">
                    {macro.internal_macro}
                  </span>
                )}
              </div>
              {fields.length > 0 && (
                <div className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
                  {fields.map(([fk, fv]) => (
                    <div key={fk} className="flex items-center justify-between gap-2 bg-surface-800/40 rounded px-2 py-1">
                      <span className="text-[9px] text-surface-500 truncate" title={fv?.label || fk}>
                        {fv?.label || fk}
                      </span>
                      <span className="text-[10px] font-mono text-blue-300 shrink-0 font-semibold">
                        {fv?.value ?? '—'}
                        {fv?.step != null && <span className="text-[8px] text-surface-600 ml-0.5">±{fv.step}</span>}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {fields.length === 0 && (
                <p className="text-[9px] text-surface-600">Keine Felder</p>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  if (section === 'sequences') {
    return (
      <div className="rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5 space-y-3 mt-1.5">
        {['seq_new', 'seq_next'].map(key => {
          const steps = data[key] ?? []
          if (!steps.length) return null
          return (
            <div key={key}>
              <p className="text-[9px] text-surface-600 uppercase tracking-wide mb-1.5">
                {key === 'seq_new' ? 'Neuer Druck' : 'Nächster Druck'}
              </p>
              <div className="space-y-0.5">
                {steps.map((step, i) => (
                  <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className="text-surface-700 w-4 text-right shrink-0">{i + 1}</span>
                    <span className={step.enabled === false ? 'text-surface-700 line-through' : 'text-surface-300'}>
                      {step.label || step.macro || step.action || JSON.stringify(step)}
                    </span>
                    {step.enabled === false && (
                      <span className="text-[9px] text-surface-700 ml-auto">off</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  if (section === 'rack_config') {
    const entries = Object.entries(data)
    return (
      <div className="mt-1.5 rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5">
        <div className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 bg-surface-800/40 rounded px-2 py-1">
              <span className="text-[9px] text-surface-500 truncate">{k}</span>
              <span className="text-[10px] font-mono text-surface-300 shrink-0">{JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (section === 'settings') {
    const LABELS = {
      poll_interval: 'Poll-Intervall (s)', min_print_minutes: 'Mindestdruckzeit (min)',
      use_ams: 'AMS verwenden', magazine_slot: 'Magazin-Fach',
    }
    const entries = Object.entries(data)
    return (
      <div className="mt-1.5 rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5">
        <div className="grid gap-x-4 gap-y-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))' }}>
          {entries.map(([k, v]) => (
            <div key={k} className="flex items-center justify-between gap-2 bg-surface-800/40 rounded px-2 py-1">
              <span className="text-[9px] text-surface-500 truncate">{LABELS[k] || k}</span>
              <span className={`text-[10px] font-mono shrink-0 font-semibold ${
                typeof v === 'boolean' ? (v ? 'text-emerald-400' : 'text-surface-600') : 'text-surface-300'
              }`}>{JSON.stringify(v)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return null
}

function SectionTabs({ profile }) {
  const [expanded, setExpanded] = useState(null)

  const present = []
  if (profile?.macro_config && Object.keys(profile.macro_config).length) present.push('macro_config')
  if (profile?.sequences && ((profile.sequences.seq_new || []).length || (profile.sequences.seq_next || []).length)) present.push('sequences')
  if (profile?.rack_config && Object.keys(profile.rack_config).length) present.push('rack_config')
  if (profile?.settings && Object.keys(profile.settings).length) present.push('settings')

  const toggle = (k) => setExpanded(prev => prev === k ? null : k)

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1.5">
        {present.map(k => (
          <button
            key={k}
            onClick={() => toggle(k)}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              expanded === k
                ? 'bg-blue-900/30 border-blue-700/60 text-blue-300'
                : 'border-surface-700/60 text-surface-400 hover:border-surface-500/70 hover:text-surface-200'
            }`}
          >
            {SECTION_LABELS[k] || k} <span className="opacity-50">{expanded === k ? '▲' : '▼'}</span>
          </button>
        ))}
        {!present.length && <span className="text-[10px] text-surface-600">keine anwendbaren Daten</span>}
      </div>
      {expanded && <SectionDetail section={expanded} data={profile?.[expanded]} />}
    </div>
  )
}

function Components({ components }) {
  if (!components?.length) return null
  return (
    <div className="space-y-2">
      <p className="text-[10px] text-surface-600 uppercase tracking-wide">Bauteile & Anleitungen</p>
      {components.map((c, i) => (
        <div key={i} className="rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-surface-200">{c.name || `Bauteil ${i + 1}`}</span>
            {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-[10px] text-blue-400 hover:underline shrink-0">Link ↗</a>}
          </div>
          {c.instructions && (
            <pre className="mt-1.5 text-[11px] text-surface-400 whitespace-pre-wrap font-sans leading-relaxed">{c.instructions}</pre>
          )}
        </div>
      ))}
    </div>
  )
}

function Profiles() {
  const [meta, setMeta]         = useState({ name: 'Mein Profil', printer_model: 'BBL_X1C', description: '' })
  const [components, setComponents] = useState([])
  const [built, setBuilt]       = useState(null)
  const [preview, setPreview]   = useState(null)
  const [library, setLibrary]   = useState([])
  const [msg, setMsg]           = useState(null)
  const [err, setErr]           = useState(null)
  const importRef               = useRef()

  const loadLibrary = useCallback(() => {
    profileService.listLocal().then(r => setLibrary(r.data || [])).catch(() => {})
  }, [])
  useEffect(() => { loadLibrary() }, [loadLibrary])

  const addComponent    = () => setComponents(p => [...p, { name: '', instructions: '', url: '' }])
  const updateComponent = (i, k, v) => setComponents(p => p.map((c, j) => j === i ? { ...c, [k]: v } : c))
  const removeComponent = (i) => setComponents(p => p.filter((_, j) => j !== i))

  const buildProfile = async () => {
    setErr(null); setMsg(null)
    try {
      const r = await profileService.export({ ...meta, components })
      setBuilt(r.data)
      setMsg('Profil aus aktueller Konfiguration erzeugt.')
      return r.data
    } catch (e) {
      setErr(e.response?.data?.detail ?? e.message)
      return null
    }
  }

  const downloadProfile = async () => {
    const p = built || await buildProfile()
    if (!p) return
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href = url
    a.download = `${(p.name || 'profil').replace(/[^a-z0-9_-]+/gi, '_')}.om4d.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveToLibrary = async () => {
    const p = built || await buildProfile()
    if (!p) return
    try {
      const r = await profileService.saveLocal(p)
      setLibrary(r.data.profiles || [])
      setMsg(`„${p.name}" in der Bibliothek gespeichert.`)
    } catch (e) {
      setErr(e.response?.data?.detail ?? e.message)
    }
  }

  const openFile = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setErr(null); setMsg(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.schema) throw new Error('Keine gültige Profildatei (schema fehlt)')
        setPreview(data)
      } catch (e2) { setErr(`Datei konnte nicht gelesen werden: ${e2.message}`) }
    }
    reader.readAsText(file)
  }

  const applyProfile = async (profile) => {
    setErr(null); setMsg(null)
    try {
      const r = await profileService.import(profile)
      const applied = Object.entries(r.data.applied).filter(([, v]) => v).map(([k]) => SECTION_LABELS[k] || k)
      setMsg(`„${profile.name}" angewendet: ${applied.join(', ') || '—'}. Sequenzen werden erst beim nächsten Auto-Farm-Start ausgeführt.`)
      setPreview(null)
    } catch (e) {
      setErr(e.response?.data?.detail ?? e.message)
    }
  }

  const deleteLibrary = async (name) => {
    try {
      const r = await profileService.deleteLocal(name)
      setLibrary(r.data.profiles || [])
    } catch (e) { setErr(e.response?.data?.detail ?? e.message) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-surface-100 mb-1">Profile</h2>
        <p className="text-sm text-surface-500">
          Bündele Kalibrierung, Sequenzen, Regal-Konfiguration, Einstellungen und Bauteil-Anleitungen
          zu einer Datei — exportieren, importieren oder lokal speichern.
          Das Importieren führt <span className="text-surface-300">keinen</span> G-Code aus;
          Sequenzen laufen erst beim nächsten Auto-Farm-Start.
        </p>
      </div>

      <Banner kind="success" onClose={() => setMsg(null)}>{msg}</Banner>
      <Banner kind="error"   onClose={() => setErr(null)}>{err}</Banner>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* ── Profil erstellen ─────────────────────────────── */}
        <div className="card flex flex-col gap-3">
          <p className="section-label">Profil erstellen & exportieren</p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-surface-600 block mb-0.5">Name</label>
              <input type="text" value={meta.name}
                onChange={e => setMeta(m => ({ ...m, name: e.target.value }))}
                className="w-full text-xs" />
            </div>
            <div>
              <label className="text-[10px] text-surface-600 block mb-0.5">Drucker-Modell</label>
              <select value={meta.printer_model}
                onChange={e => setMeta(m => ({ ...m, printer_model: e.target.value }))}
                className="w-full text-xs">
                {PRINTER_MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] text-surface-600 block mb-0.5">Beschreibung</label>
            <textarea value={meta.description}
              onChange={e => setMeta(m => ({ ...m, description: e.target.value }))}
              rows={2} className="w-full text-xs resize-none" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-[10px] text-surface-600">Bauteile & Anleitungen</label>
              <button onClick={addComponent} className="text-[10px] text-blue-400 hover:underline">+ Bauteil</button>
            </div>
            {components.map((c, i) => (
              <div key={i} className="rounded-lg border border-surface-800/60 p-2 space-y-1.5">
                <div className="flex items-center gap-2">
                  <input type="text" placeholder="Name (z.B. Greifer v2)" value={c.name}
                    onChange={e => updateComponent(i, 'name', e.target.value)}
                    className="flex-1 text-xs" />
                  <button onClick={() => removeComponent(i)} className="text-surface-700 hover:text-red-400 text-sm shrink-0">×</button>
                </div>
                <input type="text" placeholder="Link (optional)" value={c.url}
                  onChange={e => updateComponent(i, 'url', e.target.value)}
                  className="w-full text-xs" />
                <textarea placeholder="Anleitung / Hinweise…" value={c.instructions}
                  onChange={e => updateComponent(i, 'instructions', e.target.value)}
                  rows={2} className="w-full text-xs resize-none" />
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 flex-wrap border-t border-surface-800/50 pt-3">
            <button onClick={buildProfile}   className="btn btn-secondary btn-sm">Aus aktueller Konfig erzeugen</button>
            <button onClick={downloadProfile} className="btn btn-ghost btn-sm">↓ Download (.om4d.json)</button>
            <button onClick={saveToLibrary}   className="btn btn-ghost btn-sm">In Bibliothek speichern</button>
          </div>

          {built && (
            <div className="rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5 space-y-1.5">
              <p className="text-[11px] text-surface-400">Enthält:</p>
              <SectionTabs profile={built} />
            </div>
          )}
        </div>

        {/* ── Profil importieren ───────────────────────────── */}
        <div className="card flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="section-label">Profil importieren</p>
            <input ref={importRef} type="file" accept=".json" className="hidden" onChange={openFile} />
            <button onClick={() => importRef.current?.click()} className="btn btn-ghost btn-sm">↑ Datei wählen</button>
          </div>

          {!preview && (
            <p className="text-xs text-surface-600 py-4 text-center">
              Profildatei (.om4d.json) wählen oder ein Profil aus der Bibliothek laden.
            </p>
          )}

          {preview && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-surface-100">{preview.name}</p>
                <p className="text-[11px] text-surface-500">
                  {preview.printer_model}{preview.description ? ` · ${preview.description}` : ''}
                </p>
              </div>
              <SectionTabs profile={preview} />
              <Components components={preview.components} />
              <div className="flex items-center gap-2 border-t border-surface-800/50 pt-3">
                <button onClick={() => applyProfile(preview)} className="btn btn-primary btn-sm">Anwenden</button>
                <button onClick={() => setPreview(null)} className="btn btn-ghost btn-sm">Abbrechen</button>
              </div>
              <p className="text-[10px] text-amber-600">
                ⚠ Überschreibt die aktuelle Kalibrierung/Sequenzen/Regal-Konfig. Vorher ggf. eigenes Profil sichern.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* ── Lokale Bibliothek ─────────────────────────────────── */}
      <div className="card">
        <p className="section-label mb-3">Lokale Bibliothek</p>
        {!library.length && (
          <p className="text-xs text-surface-700 py-3 text-center">Noch keine Profile gespeichert.</p>
        )}
        <div className="space-y-2">
          {library.map((p, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-surface-800/60 bg-surface-900/40 p-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium text-surface-200 truncate">{p.name}</p>
                <p className="text-[10px] text-surface-600">
                  {p.printer_model}{p.description ? ` · ${p.description}` : ''}
                </p>
                <SectionTabs profile={p} />
              </div>
              <button onClick={() => setPreview(p)} className="btn btn-ghost btn-sm shrink-0">Laden</button>
              <button
                onClick={async () => {
                  const blob = new Blob([JSON.stringify(p, null, 2)], { type: 'application/json' })
                  const url  = URL.createObjectURL(blob)
                  const a    = document.createElement('a')
                  a.href = url
                  a.download = `${(p.name || 'profil').replace(/[^a-z0-9_-]+/gi, '_')}.om4d.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="btn btn-ghost btn-sm shrink-0">↓</button>
              <button onClick={() => deleteLibrary(p.name)} className="text-surface-700 hover:text-red-400 text-sm shrink-0 px-1">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Profiles
