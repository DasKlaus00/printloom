import React, { useState, useEffect, useCallback, useRef } from 'react'
import { printerService, deviceService, deviceSettingsService } from '../services/api'

function SnapshotGallery() {
  const [snaps, setSnaps] = useState([])
  useEffect(() => {
    printerService.getSnapshots().then(r => setSnaps(r.data ?? [])).catch(() => {})
  }, [])
  if (snaps.length === 0) return null
  return (
    <div className="card">
      <p className="section-label">Webcam-Snapshots</p>
      <div className="grid grid-cols-4 gap-2">
        {snaps.map(s => (
          <a key={s.filename} href={s.url} target="_blank" rel="noreferrer"
             className="rounded-lg overflow-hidden border border-surface-700 hover:border-blue-500 transition-colors aspect-video block">
            <img src={s.url} alt={s.filename} className="w-full h-full object-cover" />
          </a>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Helpers
   ───────────────────────────────────────────────────────────── */
const STATE_META = {
  idle:    { label: 'Bereit',     dot: 'dot-green',  color: 'text-emerald-400' },
  running: { label: 'Druckt',     dot: 'dot-blue',   color: 'text-blue-400'   },
  pause:   { label: 'Pausiert',   dot: 'dot-amber',  color: 'text-amber-400'  },
  finish:  { label: 'Fertig',     dot: 'dot-green',  color: 'text-emerald-300'},
  failed:  { label: 'Fehler',     dot: 'dot-red',    color: 'text-red-400'    },
  offline: { label: 'Offline',    dot: 'dot-gray',   color: 'text-surface-500'},
}
const stateMeta = (s) => STATE_META[s?.toLowerCase()] ?? STATE_META.offline

function TempGauge({ label, current, target }) {
  const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const hot = current > 50
  const color = pct > 90 ? 'from-orange-600 to-orange-400' : pct > 50 ? 'from-amber-600 to-amber-400' : 'from-surface-600 to-surface-500'
  return (
    <div className="bg-surface-900/80 rounded-2xl border border-surface-700/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-surface-500 font-medium">{label}</span>
        <span className={`text-[11px] font-mono ${target > 0 ? 'text-amber-400' : 'text-surface-600'}`}>
          {target > 0 ? `↗ ${target}°` : '—'}
        </span>
      </div>
      <p className={`text-2xl font-bold font-mono leading-none ${hot ? 'text-orange-300' : 'text-surface-300'}`}>
        {current}°<span className="text-base text-surface-500">C</span>
      </p>
      <div className="w-full bg-surface-800 rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full bg-gradient-to-r ${color} transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

function StatCell({ label, value, sub, color = 'text-surface-200' }) {
  return (
    <div className="bg-surface-900 rounded-xl border border-surface-700 p-3">
      <p className="text-xs text-surface-500 mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono ${color}`}>{value}</p>
      {sub && <p className="text-xs text-surface-600 mt-0.5">{sub}</p>}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Webcam Panel
   ───────────────────────────────────────────────────────────── */
function WebcamPanel({ url, deviceId }) {
  const [editUrl, setEditUrl] = useState(url ?? '')
  const [editing, setEditing] = useState(false)
  const [saving, setSaving]   = useState(false)
  const [imgErr, setImgErr]   = useState(false)
  const imgRef = useRef()

  const save = async () => {
    setSaving(true)
    try {
      await deviceSettingsService.updateSettings(deviceId, { webcam_url: editUrl })
      setEditing(false)
      setImgErr(false)
    } catch (e) {
      console.error(e)
    } finally { setSaving(false) }
  }

  const displayUrl = editing ? null : (url || null)

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <p className="section-label">Webcam</p>
        <button onClick={() => setEditing(v => !v)} className="btn btn-ghost btn-sm">
          {editing ? 'Abbrechen' : 'URL ändern'}
        </button>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            type="text"
            placeholder="http://192.168.x.x:8080/mjpeg"
            value={editUrl}
            onChange={e => setEditUrl(e.target.value)}
            className="w-full font-mono text-sm"
          />
          <div className="flex gap-2">
            <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
              {saving ? 'Speichert...' : 'Speichern'}
            </button>
            <p className="text-xs text-surface-600 self-center">MJPEG-Stream oder Snapshot-URL</p>
          </div>
        </div>
      ) : displayUrl ? (
        <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
          {imgErr ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-2">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
              </svg>
              <p className="text-xs">Webcam nicht erreichbar</p>
              <p className="text-xs font-mono text-surface-700">{displayUrl}</p>
            </div>
          ) : (
            <img
              ref={imgRef}
              src={displayUrl}
              alt="Webcam"
              onError={() => setImgErr(true)}
              onLoad={() => setImgErr(false)}
              className="w-full h-full object-contain"
              style={{ imageRendering: 'crisp-edges' }}
            />
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-8 text-surface-600 rounded-xl border-2 border-dashed border-surface-800">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-2">
            <path d="M23 7l-7 5 7 5V7z"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
          </svg>
          <p className="text-sm">Keine Webcam-URL konfiguriert</p>
          <button onClick={() => setEditing(true)} className="btn btn-ghost btn-sm mt-2">URL eingeben</button>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   AMS Panel
   ───────────────────────────────────────────────────────────── */
function AmsPanel({ units, activeSlot }) {
  if (!units || units.length === 0) return null
  return (
    <div className="card">
      <p className="section-label mb-3">AMS</p>
      <div className="space-y-4">
        {units.map(unit => (
          <div key={unit.id}>
            <div className="flex items-center gap-3 mb-2">
              <p className="text-xs text-surface-400 font-medium">AMS {unit.id + 1}</p>
              <span className="text-xs font-mono text-surface-700">
                {unit.temp}°C · {unit.humidity}% rH
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {(unit.slots.length > 0 ? unit.slots : [0,1,2,3].map(i => ({ id: i, type: '', color: '', brand: '', remain: -1 }))).map(slot => {
                const globalId = unit.id * 4 + slot.id
                const isActive  = activeSlot === globalId
                const cssColor  = slot.color ? `#${slot.color.substring(0, 6)}` : null
                const empty     = !slot.type

                return (
                  <div key={slot.id} className={`rounded-xl border p-2.5 flex flex-col items-center gap-1.5 transition-all ${
                    isActive ? 'border-blue-500 bg-blue-950/30 shadow-md shadow-blue-900/30' :
                    empty    ? 'border-surface-800 bg-surface-950 opacity-40' :
                               'border-surface-700 bg-surface-900'
                  }`}>
                    <div
                      className="w-7 h-7 rounded-full border-2 flex-shrink-0"
                      style={{
                        backgroundColor: cssColor ?? 'transparent',
                        borderColor: cssColor ? cssColor : '#374151',
                      }}
                    />
                    <p className="text-[11px] font-mono text-surface-300 font-medium leading-none">
                      {slot.type || '—'}
                    </p>
                    <p className="text-[10px] font-mono text-surface-600 leading-none">Slot {globalId + 1}</p>
                    {slot.remain >= 0 && (
                      <div className="w-full bg-surface-800 rounded-full h-0.5 mt-0.5">
                        <div className="h-0.5 rounded-full bg-emerald-500" style={{ width: `${slot.remain}%` }} />
                      </div>
                    )}
                    {isActive && (
                      <span className="text-[9px] font-mono text-blue-400 animate-pulse">aktiv</span>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Print History
   ───────────────────────────────────────────────────────────── */
function PrintHistory() {
  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    printerService.getHistory()
      .then(r => setItems(r.data.items ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return null

  if (items.length === 0) return (
    <div className="card">
      <p className="section-label">Druckhistorie</p>
      <p className="text-sm text-surface-500 py-4 text-center">Noch keine abgeschlossenen Drucke</p>
    </div>
  )

  return (
    <div className="card">
      <p className="section-label">Druckhistorie</p>
      <div className="space-y-1.5">
        {items.slice(0, 20).map((item, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-900 border border-surface-700">
            <span className={`dot flex-shrink-0 ${item.state === 'FINISH' ? 'dot-green' : 'dot-red'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-surface-200 truncate">{item.file || '—'}</p>
              <p className="text-xs text-surface-600 font-mono">
                {new Date(item.ts).toLocaleString('de-DE')} · {item.device}
              </p>
            </div>
            <span className={`badge ${item.state === 'FINISH' ? 'badge-green' : 'badge-red'} flex-shrink-0`}>
              {item.state === 'FINISH' ? 'Fertig' : 'Fehler'}
            </span>
            {item.progress != null && (
              <span className="text-xs font-mono text-surface-500 flex-shrink-0">{item.progress}%</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────────────────────
   Main Page
   ───────────────────────────────────────────────────────────── */
function LiveStatus() {
  const [bambuDevice, setBambuDevice]   = useState(null)
  const [status, setStatus]             = useState(null)
  const [webcamUrl, setWebcamUrl]       = useState('')
  const [loading, setLoading]           = useState(true)
  const [polling, setPolling]           = useState(false)
  const [lastUpdated, setLastUpdated]   = useState(null)
  const [autoRefresh, setAutoRefresh]   = useState(true)
  const [tempThreshold, setTempThreshold] = useState(
    () => Number(localStorage.getItem('ottomat3d_temp_threshold') ?? 20)
  )
  const intervalRef   = useRef(null)
  const prevStateRef  = useRef(null)

  const loadDevices = useCallback(async () => {
    try {
      const r  = await deviceService.listDevices()
      const b  = r.data.find(d => d.device_type === 'bambu_lab')
      if (b) {
        setBambuDevice(b)
        const s = await deviceSettingsService.getSettings(b.id)
        setWebcamUrl(s.data.webcam_url ?? '')
      }
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  const fetchStatus = useCallback(async (deviceId) => {
    if (!deviceId) return
    setPolling(true)
    try {
      const r = await printerService.getStatus(deviceId)
      const data = r.data
      const newState = data.gcode_state
      // Auto-snapshot when transitioning INTO FINISH
      if (newState === 'FINISH' && prevStateRef.current && prevStateRef.current !== 'FINISH') {
        printerService.takeSnapshot(deviceId).catch(() => {})
      }
      prevStateRef.current = newState
      setStatus(data)
      setLastUpdated(new Date())
    } catch {
      setStatus({ online: false, status: 'offline' })
    } finally { setPolling(false) }
  }, [])

  useEffect(() => { loadDevices() }, [loadDevices])

  useEffect(() => {
    if (!bambuDevice) return
    fetchStatus(bambuDevice.id)
  }, [bambuDevice, fetchStatus])

  // Auto-refresh every 15s
  useEffect(() => {
    if (!autoRefresh || !bambuDevice) {
      clearInterval(intervalRef.current)
      return
    }
    clearInterval(intervalRef.current)
    intervalRef.current = setInterval(() => {
      fetchStatus(bambuDevice.id)
    }, 15000)
    return () => clearInterval(intervalRef.current)
  }, [autoRefresh, bambuDevice, fetchStatus])

  if (loading) return (
    <div className="flex items-center justify-center h-64 text-surface-500 text-sm">
      Verbinde...
    </div>
  )

  if (!bambuDevice) return (
    <div className="card">
      <p className="section-label">Live Status</p>
      <p className="text-sm text-surface-500 py-4">Kein Bambu Lab Gerät konfiguriert.</p>
    </div>
  )

  const meta       = stateMeta(status?.gcode_state ?? status?.status)
  const progress   = status?.progress?.progress ?? 0
  const layer      = status?.progress?.layer ?? 0
  const totalLayer = status?.progress?.total_layers ?? 0
  const remMin     = status?.remaining_min ?? 0
  const fileName   = status?.subtask_name ?? ''
  const isRunning  = status?.gcode_state === 'RUNNING' || status?.is_printing
  const amsUnits   = status?.ams_units ?? []
  const trayActive = status?.tray_active ?? 255

  // Temperature warnings
  const tempWarnings = []
  if (isRunning && status) {
    const nozzle       = status.nozzle_temp       ?? 0
    const nozzleTarget = status.nozzle_target_temp ?? 0
    const bed          = status.bed_temp           ?? 0
    const bedTarget    = status.bed_target_temp    ?? 0
    if (nozzleTarget > 0 && Math.abs(nozzle - nozzleTarget) > tempThreshold) {
      tempWarnings.push(`Düse: ${nozzle}°C (Ziel ${nozzleTarget}°C, Abweichung ${Math.round(Math.abs(nozzle - nozzleTarget))}°C)`)
    }
    if (bedTarget > 0 && Math.abs(bed - bedTarget) > tempThreshold) {
      tempWarnings.push(`Bett: ${bed}°C (Ziel ${bedTarget}°C, Abweichung ${Math.round(Math.abs(bed - bedTarget))}°C)`)
    }
  }

  return (
    <div className="space-y-6">

      {/* ── Header ──────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`dot ${meta.dot} ${isRunning ? 'animate-pulse' : ''}`} />
            <div>
              <p className="text-lg font-semibold text-surface-200">{bambuDevice.name}</p>
              <p className={`text-sm font-medium ${meta.color}`}>{meta.label}</p>
            </div>
            {fileName && (
              <div className="ml-4 px-3 py-1 rounded-lg bg-surface-900 border border-surface-700">
                <p className="text-xs text-surface-500">Druckt:</p>
                <p className="text-sm text-surface-200 font-medium">{fileName}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-surface-600">Warnschwelle</label>
              <input
                type="number" min="1" max="100" value={tempThreshold}
                onChange={e => {
                  const v = Math.max(1, Number(e.target.value))
                  setTempThreshold(v)
                  localStorage.setItem('ottomat3d_temp_threshold', String(v))
                }}
                className="w-14 font-mono text-xs"
              />
              <span className="text-xs text-surface-600">°C</span>
            </div>
            {lastUpdated && (
              <p className="text-xs text-surface-600 font-mono">
                {lastUpdated.toLocaleTimeString('de-DE')}
              </p>
            )}
            <button
              onClick={() => setAutoRefresh(v => !v)}
              className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}
            >
              {autoRefresh ? '⟳ Auto 15s' : '⟳ Manuell'}
            </button>
            <button
              onClick={() => fetchStatus(bambuDevice.id)}
              disabled={polling}
              className="btn btn-ghost btn-sm"
            >
              {polling ? 'Aktualisiert...' : 'Jetzt'}
            </button>
          </div>
        </div>

        {/* Temperature warnings */}
        {tempWarnings.length > 0 && (
          <div className="mt-3 px-3 py-2.5 rounded-lg bg-red-950/40 border border-red-800 text-red-300">
            <p className="text-xs font-semibold mb-1">Temperaturwarnung</p>
            {tempWarnings.map((w, i) => (
              <p key={i} className="text-xs font-mono">{w}</p>
            ))}
          </div>
        )}

        {/* Progress bar */}
        {(isRunning || status?.gcode_state === 'PAUSE') && (
          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-surface-500">Fortschritt</span>
              <span className="font-mono font-semibold text-blue-300">{progress}%</span>
            </div>
            <div className="w-full bg-surface-900 rounded-full h-3 overflow-hidden">
              <div
                className="h-3 rounded-full bg-gradient-to-r from-blue-700 to-blue-400 transition-all duration-500 progress-active"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="flex justify-between text-xs text-surface-500 font-mono">
              <span>Schicht {layer} / {totalLayer}</span>
              {remMin > 0 && (
                <span className="text-surface-400">noch {remMin >= 60 ? `${Math.floor(remMin/60)}h ${remMin%60}min` : `${remMin} min`}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Main content ─────────────────────────────────── */}
      <div className="grid grid-cols-3 gap-4">

        {/* Webcam */}
        <div className="col-span-2">
          <WebcamPanel
            url={webcamUrl}
            deviceId={bambuDevice.id}
          />
        </div>

        {/* Temps + Stats */}
        <div className="space-y-3">
          <TempGauge
            label="Düsentemperatur"
            current={status?.nozzle_temp ?? 0}
            target={status?.nozzle_target_temp ?? 0}
          />
          <TempGauge
            label="Betttemperatur"
            current={status?.bed_temp ?? 0}
            target={status?.bed_target_temp ?? 0}
          />
          <StatCell
            label="Schicht"
            value={totalLayer > 0 ? `${layer} / ${totalLayer}` : '—'}
            color="text-surface-200"
          />
          <StatCell
            label="Verbleibend"
            value={remMin > 0 ? (remMin >= 60 ? `${Math.floor(remMin/60)}h ${remMin%60}m` : `${remMin} min`) : '—'}
            color="text-surface-200"
          />
        </div>
      </div>

      {/* ── AMS ──────────────────────────────────────── */}
      {amsUnits.length > 0 && (
        <AmsPanel units={amsUnits} activeSlot={trayActive} />
      )}

      {/* ── Snapshots ─────────────────────────────────── */}
      <SnapshotGallery />

      {/* ── Print History ─────────────────────────────── */}
      <PrintHistory />

    </div>
  )
}

export default LiveStatus
