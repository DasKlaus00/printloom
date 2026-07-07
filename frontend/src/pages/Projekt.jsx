import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { fileService, projectService, autofarmService, deviceService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { useFarmStatusStream } from '../services/useFarmStatusStream'
import { useAutoRefresh } from '../services/useAutoRefresh'

const ACTIVE_KEY = 'printloom_active_project'
const IN_FLIGHT  = ['pending', 'sending', 'running', 'printing']
const newItemId  = () => `it_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

function Projekt() {
  const { tr } = useLanguage()
  const [files,     setFiles]     = useState([])
  const [projects,  setProjects]  = useState([])
  const [activePid, setActivePid] = useState(() => localStorage.getItem(ACTIVE_KEY) || '')
  const [farmJobs,  setFarmJobs]  = useState([])
  const [search,    setSearch]    = useState('')
  const [feedback,  setFeedback]  = useState(null)
  const [uploading, setUploading] = useState(false)
  const [loaded,    setLoaded]    = useState(false)
  const uploadRef = useRef()
  const saveRef   = useRef(null)

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok }); setTimeout(() => setFeedback(null), 4500)
  }

  /* ── Load files + projects ────────────────────────────────── */
  const reloadProjects = () =>
    projectService.list()
      .then(r => setProjects(Array.isArray(r.data?.projects) ? r.data.projects : []))
      .catch(() => {})

  // Läuft beim Mount UND bei jedem (Wieder-)Aktivwerden der Seite — kein F5 nötig.
  // Projekte nur neu laden, wenn kein Speichern aussteht (sonst würden die letzten
  // Eingaben vom Server-Stand überschrieben, bevor der Debounce-Save gefeuert hat).
  const reloadAll = useCallback(() => {
    const savePending = saveRef.current != null
    Promise.all([fileService.listFiles(), savePending ? null : projectService.list()])
      .then(([fr, pr]) => {
        setFiles((fr.data.files ?? []).filter(f => ['.3mf', '.gcode'].includes(f.file_type)))
        if (pr) setProjects(Array.isArray(pr.data?.projects) ? pr.data.projects : [])
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])
  useAutoRefresh(reloadAll, 0)

  /* ── Live farm status (für „in Arbeit" + Abhaken) ─────────── */
  useFarmStatusStream(s => setFarmJobs(Array.isArray(s?.jobs) ? s.jobs : []))

  // Sobald sich die fertigen Projekt-Jobs ändern → Projekte neu laden (done kommt vom Backend).
  const doneSig = useMemo(
    () => farmJobs.filter(j => (j.tag || '').startsWith('proj:') && j.status === 'done')
                  .map(j => j.id).sort().join(','),
    [farmJobs])
  useEffect(() => { if (loaded) reloadProjects() }, [doneSig]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Active project ───────────────────────────────────────── */
  const active = projects.find(p => p.id === activePid) || projects[0] || null
  useEffect(() => {
    if (active && active.id !== activePid) { setActivePid(active.id); localStorage.setItem(ACTIVE_KEY, active.id) }
  }, [active, activePid])

  /* ── Debounced save of the active project ─────────────────── */
  const scheduleSave = (proj) => {
    clearTimeout(saveRef.current)
    const pid = proj.id, body = { name: proj.name, items: proj.items }
    saveRef.current = setTimeout(() => {
      saveRef.current = null   // Reload-Guard freigeben (reloadAll wartet auf ausstehende Saves)
      projectService.update(pid, body).catch(() => {})
    }, 700)
  }
  // Lokale Bearbeitung des aktiven Projekts + Speichern.
  const patchActive = (updater) => setProjects(prev => {
    const next = prev.map(p => p.id === active?.id ? updater(p) : p)
    const ap = next.find(p => p.id === active?.id)
    if (ap) scheduleSave(ap)
    return next
  })

  /* ── Item-Helfer ──────────────────────────────────────────── */
  const addFile = (f) => {
    if (!active) return
    patchActive(p => {
      const ex = p.items.find(i => i.file_id === f.id)
      if (ex) return { ...p, items: p.items.map(i => i.file_id === f.id ? { ...i, quantity: Math.min(999, i.quantity + 1) } : i) }
      return { ...p, items: [...p.items, { id: newItemId(), file_id: f.id, file_name: f.original_filename, quantity: 1, done: 0 }] }
    })
  }
  const setQty     = (id, q) => patchActive(p => ({ ...p, items: p.items.map(i => i.id === id ? { ...i, quantity: Math.max(1, Math.min(999, +q || 1)) } : i) }))
  const removeItem = (id)    => patchActive(p => ({ ...p, items: p.items.filter(i => i.id !== id) }))
  const renameActive = (name) => patchActive(p => ({ ...p, name }))

  /* ── Projekt-Verwaltung ───────────────────────────────────── */
  const createProject = async () => {
    try {
      const r = await projectService.create(tr('Neues Projekt'))
      await reloadProjects()
      if (r.data?.id) { setActivePid(r.data.id); localStorage.setItem(ACTIVE_KEY, r.data.id) }
    } catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }
  const deleteProject = async () => {
    if (!active) return
    if (!window.confirm(tr('Projekt „{0}" löschen?', active.name))) return
    try { await projectService.remove(active.id); localStorage.removeItem(ACTIVE_KEY); setActivePid(''); await reloadProjects() }
    catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }
  const resetProgress = async () => {
    if (!active) return
    try { await projectService.resetProgress(active.id); await reloadProjects(); showFeedback(tr('Fortschritt zurückgesetzt')) }
    catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }

  /* ── Upload ───────────────────────────────────────────────── */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return
    e.target.value = ''; setUploading(true)
    const fd = new FormData(); fd.append('file', file)
    try {
      await fileService.upload(fd)
      const fr = await fileService.listFiles()
      setFiles((fr.data.files ?? []).filter(f => ['.3mf', '.gcode'].includes(f.file_type)))
      showFeedback(tr('{0} hochgeladen', file.name))
    } catch (err) { showFeedback(err.response?.data?.detail ?? err.message, false) }
    finally { setUploading(false) }
  }

  /* ── Fortschritt / in Arbeit ──────────────────────────────── */
  const inFlight = (itemId) => farmJobs.filter(j => j.tag === `proj:${itemId}` && IN_FLIGHT.includes(j.status)).length
  const outstanding = (it) => Math.max(0, (it.quantity || 0) - (it.done || 0) - inFlight(it.id))

  const items   = active?.items ?? []
  const totalQ  = items.reduce((s, i) => s + (i.quantity || 0), 0)
  const totalD  = items.reduce((s, i) => s + Math.min(i.done || 0, i.quantity || 0), 0)
  const totalOpen = items.reduce((s, i) => s + outstanding(i), 0)

  /* ── Drucken: offene Stücke einreihen (Farm starten falls nötig) ── */
  const pushToPrint = async () => {
    if (!active || totalOpen <= 0) return
    const units = []
    for (const it of items) for (let k = 0; k < outstanding(it); k++)
      units.push({ fileId: it.file_id, fileName: it.file_name, tag: `proj:${it.id}` })
    const baseId = Date.now() * 1000
    const jobs = units.map((u, i) => ({ id: baseId + i, fileId: u.fileId, fileName: u.fileName, slot: '1-0', status: 'pending', amsMap: '', tag: u.tag }))
    try {
      const st = await autofarmService.getStatus(1)
      if (st.data?.running) {
        for (const j of jobs) {
          await autofarmService.enqueue({ id: j.id, fileId: j.fileId, fileName: j.fileName, slot: '1-0', amsMap: '', tag: j.tag })
        }
        showFeedback(tr('{0} Objekt(e) zur Warteschlange hinzugefügt', jobs.length))
      } else {
        const [devs, settings] = await Promise.all([deviceService.listDevices(), autofarmService.getSettings()])
        const bambu = (devs.data ?? []).find(d => d.device_type === 'bambu_lab')
        if (!bambu) { showFeedback(tr('Kein Bambu Lab Gerät konfiguriert — bitte erst unter Configuration einrichten'), false); return }
        await autofarmService.start({
          bambu_id:          bambu.id,
          use_ams:           settings.data?.use_ams ?? true,
          poll_interval:     settings.data?.poll_interval ?? 20,
          min_print_minutes: settings.data?.min_print_minutes ?? 0,
          jobs,
        })
        showFeedback(tr('Auto Farm gestartet — {0} Objekt(e) eingereiht', jobs.length))
      }
    } catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }

  const filtered = files.filter(f => !search || f.original_filename.toLowerCase().includes(search.toLowerCase()))

  /* ─────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-surface-100 mb-1">{tr('Projekte')}</h2>
        <p className="text-sm text-surface-500">
          {tr('Dateien mit Stückzahl sammeln, drucken lassen und fertige Objekte automatisch abhaken.')}
        </p>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-800 text-red-300'}`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} /> {feedback.msg}
        </div>
      )}

      {/* Projekt-Auswahl */}
      <div className="card flex items-center gap-2 flex-wrap">
        <select value={active?.id ?? ''} onChange={e => { setActivePid(e.target.value); localStorage.setItem(ACTIVE_KEY, e.target.value) }}
          disabled={!projects.length} className="text-sm w-48">
          {!projects.length && <option value="">{tr('— kein Projekt —')}</option>}
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {active && (
          <input value={active.name} onChange={e => renameActive(e.target.value)}
            className="text-sm flex-1 min-w-[140px]" placeholder={tr('Projektname')} />
        )}
        <button onClick={createProject} className="btn btn-ghost btn-sm shrink-0">{tr('+ Neues Projekt')}</button>
        {active && <button onClick={deleteProject} className="btn btn-ghost btn-sm shrink-0 text-surface-600 hover:text-red-400">{tr('Löschen')}</button>}
      </div>

      {!active ? (
        <div className="card text-center py-10 text-surface-600 text-sm space-y-3">
          <p>{tr('Noch kein Projekt — leg eines an.')}</p>
          <button onClick={createProject} className="btn btn-primary btn-sm">{tr('+ Neues Projekt')}</button>
        </div>
      ) : (
        <div className="grid grid-cols-[1fr_400px] gap-4 items-start">

          {/* ── Datei-Browser ──────────────────────────────── */}
          <div className="card space-y-3">
            <div className="flex items-center gap-3">
              <p className="section-label flex-1">{tr('Datei-Bibliothek')}</p>
              <input ref={uploadRef} type="file" accept=".3mf,.gcode" className="hidden" onChange={handleUpload} />
              <button onClick={() => uploadRef.current?.click()} disabled={uploading} className="btn btn-ghost btn-sm shrink-0">
                {uploading ? '…' : tr('↑ Hochladen')}
              </button>
            </div>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder={tr('Suchen…')} className="w-full text-sm" />
            {!filtered.length ? (
              <p className="text-sm text-surface-600 text-center py-8">
                {files.length ? tr('Keine Treffer') : tr('Noch keine Dateien — erst hochladen')}
              </p>
            ) : (
              <div className="space-y-1 max-h-[62vh] overflow-y-auto -mx-1 px-1">
                {filtered.map(f => {
                  const inProj = items.find(i => i.file_id === f.id)
                  return (
                    <div key={f.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-800/50 transition-colors group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-surface-200 truncate">{f.original_filename}</p>
                        <p className="text-[10px] text-surface-600 font-mono mt-0.5">
                          {f.file_type.replace('.', '').toUpperCase()}
                          {f.file_size_kb ? ` · ${f.file_size_kb < 1024 ? `${f.file_size_kb} KB` : `${(f.file_size_kb/1024).toFixed(1)} MB`}` : ''}
                        </p>
                      </div>
                      {inProj && <span className="text-[9px] text-emerald-500 font-mono shrink-0">×{inProj.quantity}</span>}
                      <button onClick={() => addFile(f)} className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[11px]">
                        {tr('+ Hinzufügen')}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* ── Druckliste ─────────────────────────────────── */}
          <div className="space-y-3">
            <div className="card space-y-2 min-h-[120px]">
              <div className="flex items-center justify-between">
                <p className="section-label mb-0">{tr('Druckliste')}</p>
                <span className="text-[10px] font-mono text-surface-600">{totalD}/{totalQ} {tr('gedruckt')}</span>
              </div>

              {!items.length ? (
                <p className="text-xs text-surface-600 text-center py-6">{tr('Dateien aus der Bibliothek hinzufügen')}</p>
              ) : (
                <div className="space-y-1.5">
                  {items.map(item => {
                    const flight = inFlight(item.id)
                    const fullDone = (item.done || 0) >= (item.quantity || 0)
                    return (
                      <div key={item.id} className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 transition-colors ${
                        fullDone ? 'border-emerald-800/50 bg-emerald-950/15' : 'border-surface-700/50 bg-surface-900'}`}>
                        <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                          fullDone ? 'border-emerald-500 bg-emerald-500' : 'border-surface-600'}`}>
                          {fullDone && (
                            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                          )}
                        </span>
                        <p className={`flex-1 text-xs truncate min-w-0 ${fullDone ? 'text-surface-500 line-through' : 'text-surface-300'}`} title={item.file_name}>
                          {item.file_name.replace(/\.[^.]+$/, '')}
                        </p>
                        <span className="text-[10px] font-mono shrink-0 text-surface-500">
                          <span className={fullDone ? 'text-emerald-400' : 'text-surface-300'}>{Math.min(item.done || 0, item.quantity)}</span>/{item.quantity}
                          {flight > 0 && <span className="text-blue-400 ml-1">· {tr('läuft {0}', flight)}</span>}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button onClick={() => setQty(item.id, item.quantity - 1)} className="w-5 h-5 flex items-center justify-center text-surface-500 hover:text-surface-200 select-none">−</button>
                          <span className="w-6 text-center text-xs font-mono text-surface-300 select-none">{item.quantity}</span>
                          <button onClick={() => setQty(item.id, item.quantity + 1)} className="w-5 h-5 flex items-center justify-center text-surface-500 hover:text-surface-200 select-none">+</button>
                        </div>
                        <button onClick={() => removeItem(item.id)} className="w-4 h-4 flex items-center justify-center text-surface-700 hover:text-red-400 shrink-0">×</button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Aktionen */}
            <div className="card space-y-3">
              <div className="flex items-center justify-between text-xs text-surface-500">
                <span><span className="text-surface-200 font-semibold text-sm">{totalOpen}</span> {tr('offen')}</span>
                <span className="font-mono">{tr('{0} gesamt · {1} fertig', totalQ, totalD)}</span>
              </div>
              <button onClick={pushToPrint} disabled={totalOpen <= 0} className="btn btn-primary w-full">
                {tr('▶ Drucken ({0} offen)', totalOpen)}
              </button>
              {totalD > 0 && (
                <button onClick={resetProgress} className="btn btn-ghost btn-sm w-full text-surface-500">{tr('↺ Fortschritt zurücksetzen')}</button>
              )}
              <p className="text-[10px] text-surface-700 text-center">
                {tr('Startet die Farm automatisch bzw. reiht in die laufende ein. Fertige Objekte werden abgehakt.')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Projekt
