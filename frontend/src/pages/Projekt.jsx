import React, { useState, useEffect, useRef } from 'react'
import { fileService, projectService, autofarmService, rackManagerService } from '../services/api'
import { autoSlot } from '../services/rackUtils'

function Projekt() {
  const [files,       setFiles]       = useState([])
  const [items,       setItems]       = useState([])
  const [projName,    setProjName]    = useState('Mein Projekt')
  const [loaded,      setLoaded]      = useState(false)
  const [uploading,   setUploading]   = useState(false)
  const [feedback,    setFeedback]    = useState(null)
  const [search,      setSearch]      = useState('')
  const uploadRef = useRef()
  const saveRef   = useRef(null)

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 4500)
  }

  /* ── Load ─────────────────────────────────────────────────── */
  useEffect(() => {
    Promise.all([fileService.listFiles(), projectService.get()])
      .then(([fr, pr]) => {
        setFiles((fr.data.files ?? []).filter(f => ['.3mf', '.gcode'].includes(f.file_type)))
        setProjName(pr.data.name ?? 'Mein Projekt')
        setItems(pr.data.items ?? [])
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  /* ── Auto-save (debounced) ────────────────────────────────── */
  useEffect(() => {
    if (!loaded) return
    clearTimeout(saveRef.current)
    saveRef.current = setTimeout(() => {
      projectService.save({ name: projName, items }).catch(() => {})
    }, 800)
    return () => clearTimeout(saveRef.current)
  }, [projName, items, loaded])

  /* ── Upload ───────────────────────────────────────────────── */
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setUploading(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      await fileService.upload(fd)
      const fr = await fileService.listFiles()
      setFiles((fr.data.files ?? []).filter(f => ['.3mf', '.gcode'].includes(f.file_type)))
      showFeedback(`${file.name} hochgeladen`)
    } catch (err) {
      showFeedback(err.response?.data?.detail ?? err.message, false)
    } finally {
      setUploading(false)
    }
  }

  /* ── Item helpers ─────────────────────────────────────────── */
  const addItem = (f) => {
    const existing = items.find(i => i.file_id === f.id)
    if (existing) {
      setItems(prev => prev.map(i => i.file_id === f.id ? { ...i, quantity: i.quantity + 1 } : i))
    } else {
      setItems(prev => [...prev, {
        id: `${f.id}-${Date.now()}`,
        file_id:   f.id,
        file_name: f.original_filename,
        quantity:  1,
        status:    'printable',
      }])
    }
  }

  const removeItem   = (id) => setItems(prev => prev.filter(i => i.id !== id))
  const setQty       = (id, q) => setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: Math.max(1, Math.min(999, +q || 1)) } : i))
  const toggleStatus = (id) => setItems(prev => prev.map(i => i.id === id ? { ...i, status: i.status === 'printable' ? 'draft' : 'printable' } : i))
  const moveUp       = (idx) => setItems(prev => { const n = [...prev]; if (idx > 0) [n[idx-1], n[idx]] = [n[idx], n[idx-1]]; return n })
  const moveDown     = (idx) => setItems(prev => { const n = [...prev]; if (idx < n.length-1) [n[idx], n[idx+1]] = [n[idx+1], n[idx]]; return n })

  /* ── Push to AutoFarm queue ───────────────────────────────── */
  const printable  = items.filter(i => i.status === 'printable')
  const totalJobs  = printable.reduce((s, i) => s + i.quantity, 0)

  const pushToQueue = async () => {
    if (!printable.length) return
    try {
      const [qr, rr] = await Promise.all([autofarmService.getQueue(), rackManagerService.getAll()])
      const existing  = qr.data ?? []
      const rackData  = rr.data
      const slotH     = rackData?.slot_height_mm ?? 50
      let nextId      = Math.max(0, ...existing.map(j => j.id ?? 0)) + 1

      // Simulate growing job list to distribute across different slots
      const simJobs = [...existing]
      const newJobs = []

      for (const item of printable) {
        for (let i = 0; i < item.quantity; i++) {
          const slot = autoSlot(simJobs, rackData, 0, slotH)
          const job  = {
            id:               nextId++,
            fileId:           item.file_id,
            fileName:         item.file_name,
            slot,
            amsMap:           '',
            status:           'pending',
            progress:         0,
            remaining:        0,
            estimatedMinutes: null,
          }
          newJobs.push(job)
          simJobs.push(job)
        }
      }

      await autofarmService.saveQueue([...existing, ...newJobs])
      const slots = [...new Set(newJobs.map(j => j.slot))].join(', ')
      showFeedback(`${newJobs.length} Jobs in Warteschlange (Fächer: ${slots}) — Auto Farm öffnen`)
    } catch (err) {
      showFeedback(err.response?.data?.detail ?? err.message, false)
    }
  }

  const filtered = files.filter(f =>
    !search || f.original_filename.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="space-y-5">

      {/* Header */}
      <div>
        <h2 className="text-base font-semibold text-surface-100 mb-1">Projekt</h2>
        <p className="text-sm text-surface-500">
          Dateien mit Stückzahlen kombinieren und als Warteschlange an Auto Farm übergeben.
        </p>
      </div>

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      <div className="grid grid-cols-[1fr_380px] gap-5 items-start">

        {/* ── Datei-Browser ──────────────────────────────────── */}
        <div className="card space-y-3">
          <div className="flex items-center gap-3">
            <p className="section-label flex-1">Datei-Bibliothek</p>
            <input ref={uploadRef} type="file" accept=".3mf,.gcode" className="hidden" onChange={handleUpload} />
            <button
              onClick={() => uploadRef.current?.click()}
              disabled={uploading}
              className="btn btn-ghost btn-sm shrink-0"
            >
              {uploading ? '…' : '↑ Hochladen'}
            </button>
          </div>

          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Suchen…"
            className="w-full text-sm"
          />

          {!filtered.length ? (
            <p className="text-sm text-surface-600 text-center py-8">
              {files.length ? 'Keine Treffer' : 'Noch keine Dateien — erst hochladen'}
            </p>
          ) : (
            <div className="space-y-1 max-h-[65vh] overflow-y-auto -mx-1 px-1">
              {filtered.map(f => {
                const inProject = items.some(i => i.file_id === f.id)
                return (
                  <div
                    key={f.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-surface-800/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-surface-200 truncate">{f.original_filename}</p>
                      <p className="text-[10px] text-surface-600 font-mono mt-0.5">
                        {f.file_type.replace('.', '').toUpperCase()}
                        {f.file_size_kb && ` · ${f.file_size_kb < 1024 ? `${f.file_size_kb} KB` : `${(f.file_size_kb/1024).toFixed(1)} MB`}`}
                      </p>
                    </div>
                    {inProject && (
                      <span className="text-[9px] text-emerald-500 font-mono shrink-0">✓ im Projekt</span>
                    )}
                    <button
                      onClick={() => addItem(f)}
                      className="btn btn-ghost btn-sm opacity-0 group-hover:opacity-100 transition-opacity shrink-0 text-[11px]"
                    >
                      + Hinzufügen
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* ── Projekt-Panel ──────────────────────────────────── */}
        <div className="space-y-3">

          {/* Name */}
          <div className="card">
            <input
              value={projName}
              onChange={e => setProjName(e.target.value)}
              className="w-full text-sm font-semibold bg-transparent border-0 border-b border-surface-700 focus:border-blue-500 outline-none text-surface-100 pb-1"
              placeholder="Projektname"
            />
          </div>

          {/* Items */}
          <div className="card space-y-2 min-h-[120px]">
            <p className="section-label">Druckliste</p>

            {!items.length ? (
              <p className="text-xs text-surface-600 text-center py-6">
                Dateien aus der Bibliothek hinzufügen
              </p>
            ) : (
              <div className="space-y-1.5">
                {items.map((item, idx) => (
                  <div
                    key={item.id}
                    className={`flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors ${
                      item.status === 'printable'
                        ? 'border-emerald-800/50 bg-emerald-950/10'
                        : 'border-surface-700/40 bg-surface-900/60 opacity-55'
                    }`}
                  >
                    {/* Status toggle */}
                    <button
                      onClick={() => toggleStatus(item.id)}
                      title={item.status === 'printable' ? 'Als Entwurf' : 'Als druckbar'}
                      className={`w-4 h-4 rounded-full border-2 shrink-0 transition-colors ${
                        item.status === 'printable'
                          ? 'border-emerald-500 bg-emerald-500'
                          : 'border-surface-600'
                      }`}
                    />

                    {/* Filename */}
                    <p className="flex-1 text-xs text-surface-300 truncate min-w-0" title={item.file_name}>
                      {item.file_name.replace(/\.[^.]+$/, '')}
                    </p>

                    {/* Qty controls */}
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button onClick={() => setQty(item.id, item.quantity - 1)} className="w-5 h-5 flex items-center justify-center text-surface-500 hover:text-surface-200 select-none">−</button>
                      <span className="w-7 text-center text-xs font-mono text-surface-300 select-none">{item.quantity}</span>
                      <button onClick={() => setQty(item.id, item.quantity + 1)} className="w-5 h-5 flex items-center justify-center text-surface-500 hover:text-surface-200 select-none">+</button>
                    </div>

                    {/* Move up/down */}
                    <button onClick={() => moveUp(idx)} disabled={idx === 0} className="w-4 h-4 flex items-center justify-center text-[10px] text-surface-700 hover:text-surface-400 disabled:opacity-20">▲</button>
                    <button onClick={() => moveDown(idx)} disabled={idx === items.length - 1} className="w-4 h-4 flex items-center justify-center text-[10px] text-surface-700 hover:text-surface-400 disabled:opacity-20">▼</button>

                    {/* Delete */}
                    <button onClick={() => removeItem(item.id)} className="w-4 h-4 flex items-center justify-center text-surface-700 hover:text-red-400">×</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Summary + action */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between text-xs text-surface-500">
              <span><span className="text-surface-200 font-semibold text-sm">{totalJobs}</span> Jobs gesamt</span>
              <span className="font-mono">
                {printable.length} druckbar · {items.filter(i => i.status === 'draft').length} Entwurf
              </span>
            </div>
            <button
              onClick={pushToQueue}
              disabled={!printable.length}
              className="btn btn-primary w-full"
            >
              ▶ In Warteschlange ({totalJobs})
            </button>
            {!printable.length && items.length > 0 && (
              <p className="text-[10px] text-surface-600 text-center">
                Alle Einträge sind Entwürfe — Status auf "druckbar" setzen
              </p>
            )}
          </div>

          {/* Legend */}
          <div className="text-[10px] text-surface-700 space-y-1 px-1">
            <p><span className="inline-block w-3 h-3 rounded-full bg-emerald-500 mr-1.5 align-middle" />Druckbar — wird in Warteschlange eingeplant</p>
            <p><span className="inline-block w-3 h-3 rounded-full border-2 border-surface-600 mr-1.5 align-middle" />Entwurf — wird übersprungen</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default Projekt
