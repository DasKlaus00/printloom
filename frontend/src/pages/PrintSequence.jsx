import React, { useState, useEffect } from 'react'
import { fileService, printerService, deviceService } from '../services/api'

function PrintSequence() {
  const [files, setFiles]       = useState([])
  const [bambuId, setBambuId]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [queue, setQueue]       = useState([])        // ordered list of file objects
  const [running, setRunning]   = useState(false)
  const [cursor, setCursor]     = useState(-1)        // index in queue currently printing
  const [statuses, setStatuses] = useState({})        // queueIndex → 'pending'|'sending'|'done'|'error'
  const [feedback, setFeedback] = useState(null)
  const stopRef = React.useRef(false)

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 6000)
  }

  useEffect(() => {
    Promise.all([fileService.listFiles(), deviceService.listDevices()])
      .then(([f, d]) => {
        const printable = (f.data.files ?? []).filter(x => x.file_type === '.gcode' || x.file_type === '.3mf')
        setFiles(printable)
        const b = d.data.find(x => x.device_type === 'bambu_lab')
        if (b) setBambuId(b.id)
      })
      .finally(() => setLoading(false))
  }, [])

  /* ── queue management ─────────────────────────────────── */
  const addToQueue = (file) => {
    if (queue.find(q => q._qid === file.id + '-' + queue.length)) return
    setQueue(prev => [...prev, { ...file, _qid: `${file.id}-${prev.length}` }])
  }

  const removeFromQueue = (qid) => setQueue(prev => prev.filter(q => q._qid !== qid))

  const moveUp = (idx) => {
    if (idx === 0) return
    setQueue(prev => { const a = [...prev]; [a[idx - 1], a[idx]] = [a[idx], a[idx - 1]]; return a })
  }
  const moveDown = (idx) => {
    setQueue(prev => {
      if (idx >= prev.length - 1) return prev
      const a = [...prev]; [a[idx], a[idx + 1]] = [a[idx + 1], a[idx]]; return a
    })
  }

  /* ── run sequence ─────────────────────────────────────── */
  const markStatus = (idx, s) => setStatuses(prev => ({ ...prev, [idx]: s }))

  const runSequence = async () => {
    if (!bambuId) return showFeedback('Kein Bambu Lab Gerät konfiguriert', false)
    if (queue.length === 0) return showFeedback('Keine Dateien in der Sequenz', false)

    stopRef.current = false
    setRunning(true)
    setStatuses({})
    setCursor(0)

    for (let i = 0; i < queue.length; i++) {
      if (stopRef.current) break
      const file = queue[i]
      setCursor(i)
      markStatus(i, 'sending')
      try {
        await printerService.sendFile(bambuId, file.id)
        markStatus(i, 'done')
        showFeedback(`${file.original_filename} — gesendet`)
      } catch (e) {
        markStatus(i, 'error')
        showFeedback(`${file.original_filename}: ${e.response?.data?.detail ?? e.message}`, false)
        break
      }
    }

    setRunning(false)
    setCursor(-1)
  }

  const resetSequence = () => {
    stopRef.current = true
    setRunning(false)
    setCursor(-1)
    setStatuses({})
  }

  const extColor = { '.3mf': 'badge-blue', '.gcode': 'badge-green' }

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-surface-500 text-sm">Lade Dateien...</div>
  )

  return (
    <div className="space-y-6">

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      {!bambuId && (
        <div className="px-4 py-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-300 text-sm flex items-center gap-2">
          <span className="dot dot-amber" /> Kein Bambu Lab Gerät konfiguriert — bitte unter Configuration anlegen
        </div>
      )}

      <div className="grid grid-cols-2 gap-6">

        {/* ── Datei-Bibliothek ──────────────────────────────── */}
        <div className="card">
          <p className="section-label mb-3">Verfügbare Dateien</p>
          {files.length === 0 ? (
            <p className="text-sm text-surface-500 py-6 text-center">Keine druckbaren Dateien hochgeladen</p>
          ) : (
            <div className="space-y-1.5">
              {files.map(file => (
                <div key={file.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-900 border border-surface-700">
                  <span className={`badge ${extColor[file.file_type] ?? 'badge-gray'} flex-shrink-0`}>
                    {file.file_type}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-surface-200 truncate">{file.original_filename}</p>
                    <p className="text-xs text-surface-600 font-mono">{(file.file_size / 1024).toFixed(1)} KB</p>
                  </div>
                  <button
                    onClick={() => addToQueue(file)}
                    className="btn btn-cyan btn-sm flex-shrink-0"
                  >
                    + Sequenz
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Drucksequenz ─────────────────────────────────── */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label mb-0">Drucksequenz</p>
            <div className="flex gap-2">
              {!running && queue.length > 0 && Object.keys(statuses).length === 0 && (
                <button onClick={runSequence} disabled={!bambuId} className="btn btn-primary btn-sm">
                  ▶ Starten
                </button>
              )}
              {running && (
                <button onClick={() => { stopRef.current = true; setRunning(false) }} className="btn btn-danger btn-sm">
                  Stopp
                </button>
              )}
              {!running && Object.keys(statuses).length > 0 && (
                <button onClick={resetSequence} className="btn btn-ghost btn-sm">
                  Zurücksetzen
                </button>
              )}
              {queue.length > 0 && !running && (
                <button onClick={() => { setQueue([]); setStatuses({}) }} className="btn btn-ghost btn-sm">
                  Leeren
                </button>
              )}
            </div>
          </div>

          {queue.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-surface-600">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
                <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              <p className="text-sm">Dateien aus der Bibliothek hinzufügen</p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {queue.map((file, idx) => {
                const status  = statuses[idx]
                const isActive = cursor === idx && running
                return (
                  <div key={file._qid} className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                    isActive          ? 'bg-blue-950/40 border-blue-800' :
                    status === 'done'  ? 'bg-surface-900/50 border-surface-800' :
                    status === 'error' ? 'bg-red-950/30 border-red-900' :
                                        'bg-surface-900 border-surface-700'
                  }`}>
                    {/* Status icon */}
                    <span className="w-5 flex-shrink-0 flex justify-center">
                      {status === 'done'    && <span className="text-emerald-400">✓</span>}
                      {status === 'error'   && <span className="text-red-400">✗</span>}
                      {status === 'sending' && <span className="dot dot-blue animate-pulse" />}
                      {!status && <span className="text-xs font-mono text-surface-600">{idx + 1}</span>}
                    </span>

                    <span className={`badge ${extColor[file.file_type] ?? 'badge-gray'} flex-shrink-0`}>
                      {file.file_type}
                    </span>

                    <p className={`flex-1 text-sm truncate ${
                      status === 'done'  ? 'text-surface-500 line-through' :
                      status === 'error' ? 'text-red-300' :
                      isActive           ? 'text-surface-100 font-medium' :
                                           'text-surface-200'
                    }`}>
                      {file.original_filename}
                    </p>

                    {!running && !status && (
                      <div className="flex gap-1 flex-shrink-0">
                        <button onClick={() => moveUp(idx)} disabled={idx === 0}
                          className="btn-icon opacity-60 hover:opacity-100" title="Nach oben">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="18 15 12 9 6 15"/>
                          </svg>
                        </button>
                        <button onClick={() => moveDown(idx)} disabled={idx === queue.length - 1}
                          className="btn-icon opacity-60 hover:opacity-100" title="Nach unten">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polyline points="6 9 12 15 18 9"/>
                          </svg>
                        </button>
                        <button onClick={() => removeFromQueue(file._qid)}
                          className="btn-icon opacity-60 hover:opacity-100" title="Entfernen">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Progress */}
          {queue.length > 0 && Object.keys(statuses).length > 0 && (
            <div className="mt-4 pt-3 border-t border-surface-800">
              <div className="w-full bg-surface-800 rounded-full h-1.5">
                <div className="bg-blue-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${(Object.values(statuses).filter(s => s === 'done').length / queue.length) * 100}%` }} />
              </div>
              <p className="text-xs text-surface-600 mt-1 font-mono">
                {Object.values(statuses).filter(s => s === 'done').length} / {queue.length} abgeschlossen
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default PrintSequence
