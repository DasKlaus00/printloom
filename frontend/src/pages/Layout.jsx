import React, { useState, useEffect, useMemo } from 'react'
import { layoutService, autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'

/* Farm-Layout (Phase 4)
   ─────────────────────
   Drucker und Regale stehen in EINER Linie auf der X-Schiene des OTTOeject.
   Bisher lagen die Regal-Positionen in einer Formel (gleicher Abstand für alle),
   und es gab genau einen Drucker. Hier bekommt jedes Modul seine eigene, absolute
   X-Referenz — damit sind ungleiche Abstände und mehrere Drucker möglich.

   Sicherheit: Die Seite ist standardmäßig GESPERRT. Falsche X-Werte fahren den
   Arm gegen die Mechanik, deshalb ist Entsperren eine bewusste Handlung — und
   bei laufender Farm gar nicht erst möglich. */

const TYPE_META = {
  home:    { icon: '⌂', label: 'Home (Endschalter)', cls: 'border-surface-700 bg-surface-900' },
  rack:    { icon: '▤', label: 'Regal',              cls: 'border-emerald-800/60 bg-emerald-950/20' },
  printer: { icon: '🖨', label: 'Drucker',            cls: 'border-blue-800/60 bg-blue-950/20' },
}

export default function Layout() {
  const { tr } = useLanguage()
  const [data, setData]     = useState(null)   // { layout, configured, problems, farm_running, limits }
  const [draft, setDraft]   = useState(null)   // bearbeitete Module (nur entsperrt)
  const [busy, setBusy]     = useState(false)
  const [msg, setMsg]       = useState(null)
  const [printers, setPrinters] = useState([])

  const load = async () => {
    try {
      const r = await layoutService.get()
      setData(r.data)
      setDraft(r.data?.layout?.modules ?? [])
    } catch (e) {
      setMsg({ err: true, text: e?.response?.data?.detail || e.message })
    }
    autofarmService.farmPrinters().then(r => setPrinters(r.data?.printers ?? [])).catch(() => {})
  }
  useEffect(() => { load() }, [])

  const locked  = data?.layout?.locked !== false
  const running = !!data?.farm_running
  const mods    = draft ?? []

  // Für die Schienen-Darstellung: X-Bereich aller Module (+ etwas Luft).
  const span = useMemo(() => {
    const xs = mods.map(m => +m.x_ref || 0)
    const max = Math.max(data?.limits?.x || 0, ...xs, 100)
    return { min: 0, max: max * 1.05 }
  }, [mods, data])

  const setX = (id, v) => setDraft(ms => ms.map(m => m.id === id ? { ...m, x_ref: v } : m))
  const setField = (id, k, v) => setDraft(ms => ms.map(m => m.id === id ? { ...m, [k]: v } : m))

  const save = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await layoutService.save({ ...data.layout, modules: draft, locked: false })
      setData(d => ({ ...d, layout: r.data.layout, problems: r.data.problems }))
      setDraft(r.data.layout.modules)
      setMsg({ err: false, text: tr('Gespeichert.') })
    } catch (e) {
      setMsg({ err: true, text: e?.response?.data?.detail || e.message })
    } finally { setBusy(false) }
  }

  const toggleLock = async () => {
    if (locked && !(await confirmDialog({
      title: tr('Layout entsperren'),
      message: tr('Falsche X-Werte fahren den Arm gegen die Mechanik. Nach dem Ändern jede Position einzeln testen (📐 Einmessen im Drucker-Tab). Fortfahren?'),
      confirmLabel: tr('Entsperren'),
    }))) return
    setBusy(true)
    try {
      const r = await layoutService.setLock(!locked)
      setData(d => ({ ...d, layout: r.data.layout }))
      setDraft(r.data.layout.modules)
    } catch (e) {
      setMsg({ err: true, text: e?.response?.data?.detail || e.message })
    } finally { setBusy(false) }
  }

  const migrate = async () => {
    setBusy(true); setMsg(null)
    try {
      const r = await layoutService.migrate()
      setData(d => ({ ...d, layout: r.data.layout, configured: true, problems: r.data.problems }))
      setDraft(r.data.layout.modules)
      setMsg({ err: false, text: tr('Layout aus der bisherigen Konfiguration erzeugt — die Positionen sind unverändert.') })
    } catch (e) {
      setMsg({ err: true, text: e?.response?.data?.detail || e.message })
    } finally { setBusy(false) }
  }

  const reset = async () => {
    if (!(await confirmDialog({
      title: tr('Layout zurücksetzen'),
      message: tr('Das Layout wird verworfen. Printloom rechnet die Regal-Positionen danach wieder aus der Formel (gleicher Abstand für alle Regale). Fortfahren?'),
      confirmLabel: tr('Zurücksetzen'),
    }))) return
    setBusy(true)
    try { await layoutService.reset(); await load(); setMsg({ err: false, text: tr('Zurückgesetzt.') }) }
    catch (e) { setMsg({ err: true, text: e?.response?.data?.detail || e.message }) }
    finally { setBusy(false) }
  }

  const addModule = (type) => {
    const n = mods.filter(m => m.type === type).length + 1
    const maxX = Math.max(0, ...mods.map(m => +m.x_ref || 0))
    setDraft(ms => [...ms, {
      id: `${type}-${Date.now().toString(36)}`,
      type,
      name: type === 'rack' ? tr('Regal {0}', n) : tr('Drucker {0}', n),
      x_ref: Math.round(maxX + 250),
      ...(type === 'rack' ? { slots: 6, slot_height_mm: 50, magazine_slot: 0, legacy_rack: n } : { enabled: true }),
    }])
  }

  const removeModule = (id) => setDraft(ms => ms.filter(m => m.id !== id))

  if (!data) return <p className="text-sm text-surface-500">{tr('Lädt…')}</p>

  const errs  = (data.problems ?? []).filter(p => p.severity === 'error')
  const warns = (data.problems ?? []).filter(p => p.severity !== 'error')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Farm-Layout')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          {tr('Drucker und Regale stehen in einer Linie auf der X-Schiene. Jedes Modul hat hier seine eigene, absolute X-Position in mm.')}
        </p>
      </div>

      {!data.configured ? (
        <div className="card p-4 space-y-3">
          <p className="text-sm text-surface-300">{tr('Noch kein Layout eingerichtet.')}</p>
          <p className="text-[12px] text-surface-500 leading-relaxed">
            {tr('Printloom rechnet die Regal-Positionen bisher aus einer Formel: gleicher Abstand für alle Regale, genau ein Drucker. Das Layout löst das ab — jedes Modul bekommt seine eigene X-Position. Der erste Schritt übernimmt dabei EXAKT die Werte, die die Formel heute liefert: es verschiebt sich keine einzige Position.')}
          </p>
          <button onClick={migrate} disabled={busy || running} className="btn btn-primary text-sm disabled:opacity-50">
            {busy ? tr('Erzeuge…') : tr('Layout aus der bisherigen Konfiguration erzeugen')}
          </button>
          {running && <p className="text-[11px] text-amber-400">{tr('Farm läuft — erst stoppen.')}</p>}
        </div>
      ) : (
        <>
          {/* Sperre */}
          <div className={`rounded-xl border p-3 flex flex-wrap items-center gap-3 ${
            locked ? 'border-surface-700 bg-surface-900/60' : 'border-amber-700/70 bg-amber-950/20'}`}>
            <span className="text-lg">{locked ? '🔒' : '🔓'}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-surface-200">
                {locked ? tr('Layout gesperrt') : tr('Layout entsperrt — Änderungen möglich')}
              </p>
              <p className="text-[11px] text-surface-500">
                {running
                  ? tr('Bei laufender Farm bleibt das Layout gesperrt.')
                  : locked
                    ? tr('Zum Ändern entsperren. Falsche X-Werte fahren den Arm gegen die Mechanik.')
                    : tr('Nach dem Speichern jede Position einzeln testen (📐 Einmessen im Drucker-Tab).')}
              </p>
            </div>
            <button onClick={toggleLock} disabled={busy || (running && locked)}
              className="btn btn-secondary btn-sm disabled:opacity-50">
              {locked ? tr('Entsperren') : tr('Sperren')}
            </button>
          </div>

          {/* Schiene */}
          <div className="card p-4 space-y-3">
            <p className="section-label">{tr('Schiene (X in mm)')}</p>
            <div className="relative h-24 rounded-lg bg-surface-950 border border-surface-800 overflow-hidden">
              <div className="absolute left-0 right-0 top-1/2 h-px bg-surface-700" />
              {mods.map(m => {
                const meta = TYPE_META[m.type] ?? TYPE_META.rack
                const pct = Math.max(0, Math.min(100, ((+m.x_ref || 0) - span.min) / (span.max - span.min || 1) * 100))
                return (
                  <div key={m.id} className="absolute -translate-x-1/2 flex flex-col items-center gap-0.5"
                    style={{ left: `${pct}%`, top: '18%' }} title={`${m.name} · X ${m.x_ref}`}>
                    <span className="text-base leading-none">{meta.icon}</span>
                    <span className="text-[9px] text-surface-400 whitespace-nowrap max-w-20 truncate">{m.name}</span>
                    <span className="text-[9px] font-mono text-surface-600">{m.x_ref}</span>
                  </div>
                )
              })}
              {data.limits?.x > 0 && (
                <span className="absolute right-1 bottom-0.5 text-[9px] font-mono text-surface-700">
                  {tr('Achsgrenze X {0}', data.limits.x)}
                </span>
              )}
            </div>
            <p className="text-[10px] text-surface-600">
              {tr('Home liegt bei X 0 (Endschalter, rechts am Gerät). Die Reihenfolge ergibt sich aus den X-Werten — es gibt nichts zu ziehen.')}
            </p>
          </div>

          {/* Probleme */}
          {errs.map((p, i) => (
            <div key={`e${i}`} className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800 text-[11px] text-red-300">{p.message}</div>
          ))}
          {warns.map((p, i) => (
            <div key={`w${i}`} className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/60 text-[11px] text-amber-300">{p.message}</div>
          ))}

          {/* Module */}
          <div className="card p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="section-label">{tr('Module')}</p>
              {!locked && (
                <div className="flex items-center gap-2">
                  <button onClick={() => addModule('rack')} className="btn btn-ghost btn-sm text-[11px]">{tr('+ Regal')}</button>
                  <button onClick={() => addModule('printer')} className="btn btn-ghost btn-sm text-[11px]">{tr('+ Drucker')}</button>
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              {mods.map(m => {
                const meta = TYPE_META[m.type] ?? TYPE_META.rack
                return (
                  <div key={m.id} className={`rounded-lg border px-3 py-2 flex flex-wrap items-center gap-3 ${meta.cls}`}>
                    <span className="text-sm">{meta.icon}</span>
                    {locked ? (
                      <span className="text-sm text-surface-200 min-w-32">{m.name}</span>
                    ) : (
                      <input value={m.name} onChange={e => setField(m.id, 'name', e.target.value)}
                        className="text-sm w-40 h-7 py-0" />
                    )}
                    <label className="flex items-center gap-1.5">
                      <span className="text-[10px] text-surface-500 font-mono">X</span>
                      <input type="number" step="0.5" value={m.x_ref} disabled={locked || m.type === 'home'}
                        onChange={e => setX(m.id, parseFloat(e.target.value))}
                        className="w-24 text-sm font-mono h-7 py-0 disabled:opacity-50" />
                      <span className="text-[10px] text-surface-600">mm</span>
                    </label>
                    {m.type === 'rack' && (
                      <>
                        <label className="flex items-center gap-1.5">
                          <span className="text-[10px] text-surface-500">{tr('Fächer')}</span>
                          <input type="number" min="1" max="20" value={m.slots ?? 6} disabled={locked}
                            onChange={e => setField(m.id, 'slots', +e.target.value)}
                            className="w-14 text-sm font-mono h-7 py-0 disabled:opacity-50" />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <span className="text-[10px] text-surface-500">{tr('Fach-Nr.')}</span>
                          <input type="number" min="1" max="10" value={m.legacy_rack ?? ''} disabled={locked}
                            title={tr('Regal-Nummer in den Fach-Adressen („2-3")')}
                            onChange={e => setField(m.id, 'legacy_rack', +e.target.value)}
                            className="w-12 text-sm font-mono h-7 py-0 disabled:opacity-50" />
                        </label>
                      </>
                    )}
                    {m.type === 'printer' && (
                      <span className="text-[10px] text-surface-500 font-mono">
                        {m.device_id != null ? tr('Gerät #{0}', m.device_id) : tr('kein Gerät')}
                        {m.model ? ` · ${m.model}` : ''}
                      </span>
                    )}
                    {!locked && m.type !== 'home' && (
                      <button onClick={() => removeModule(m.id)}
                        className="ml-auto text-[11px] text-surface-600 hover:text-red-400">{tr('entfernen')}</button>
                    )}
                  </div>
                )
              })}
            </div>

            {!locked && (
              <div className="flex items-center gap-2 pt-2">
                <button onClick={save} disabled={busy} className="btn btn-primary btn-sm disabled:opacity-50">
                  {busy ? tr('Speichert…') : tr('Speichern')}
                </button>
                <button onClick={load} className="btn btn-ghost btn-sm">{tr('Verwerfen')}</button>
                <button onClick={reset} className="btn btn-ghost btn-sm text-red-400 hover:text-red-300 ml-auto">
                  {tr('Layout zurücksetzen')}
                </button>
              </div>
            )}
          </div>

          {/* Drucker-Übersicht */}
          {printers.length > 0 && (
            <div className="card p-4 space-y-2">
              <p className="section-label">{tr('Drucker in der Farm')}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {printers.map(p => (
                  <div key={p.id} className="rounded-lg border border-surface-700 bg-surface-900/60 px-3 py-2">
                    <p className="text-sm text-surface-200">🖨 {p.name}</p>
                    <p className="text-[11px] text-surface-500 font-mono">
                      X {p.x_ref} · {tr('{0} freie Fächer', p.free_slots)}
                      {p.racks?.length ? ` · ${tr('Regale {0}', p.racks.join(', '))}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {msg && (
        <p className={`text-[12px] font-mono ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>
      )}
    </div>
  )
}
