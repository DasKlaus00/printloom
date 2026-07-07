import React, { useState, useEffect, useCallback, useRef } from 'react'
import { controlService, printerService, deviceService, deviceSettingsService, klipperConfigService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { useFarmStatusStream } from '../services/useFarmStatusStream'
import { usePageActive, useAutoRefresh } from '../services/useAutoRefresh'

/* ── Drucker-Profile ───────────────────────────────────────── */
const PRINTER_PROFILES = [
  { id: 'bambu_x1c',      label: 'Bambu Lab X1C',           hasDoor: true,
    open:  'OPEN_DOOR_BAMBU_X_ONE_C',    close: 'CLOSE_DOOR_BAMBU_X_ONE_C',
    eject: 'EJECT_FROM_BAMBULAB_X_ONE_C', load:  'LOAD_ONTO_BAMBULAB_X_ONE_C' },
  { id: 'bambu_p1s',      label: 'Bambu Lab P1S',           hasDoor: true,
    open:  'OPEN_DOOR_BAMBU_P_ONE_S',    close: 'CLOSE_DOOR_BAMBU_P_ONE_S',
    eject: 'EJECT_FROM_BAMBULAB_P_ONE_S', load: 'LOAD_ONTO_BAMBULAB_P_ONE_S' },
  { id: 'bambu_p1p',      label: 'Bambu Lab P1P',           hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_BAMBULAB_P_ONE_P', load: 'LOAD_ONTO_BAMBULAB_P_ONE_P' },
  { id: 'bambu_a1',       label: 'Bambu Lab A1',            hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_BAMBULAB_A_ONE', load: 'LOAD_ONTO_BAMBULAB_A_ONE' },
  { id: 'elegoo_cc',      label: 'Elegoo Centauri Carbon',  hasDoor: true,
    open:  'OPEN_DOOR_ELEGOO_CC',        close: 'CLOSE_DOOR_ELEGOO_CC',
    eject: 'EJECT_FROM_ELEGOO_CC',       load:  'LOAD_ONTO_ELEGOO_CC' },
  { id: 'kobra_s1',       label: 'Anycubic Kobra S1',       hasDoor: true,
    open:  'OPEN_DOOR_ANYCUBIC_KOBRA_S_ONE', close: 'CLOSE_DOOR_ANYCUBIC_KOBRA_S_ONE',
    eject: 'EJECT_FROM_ANYCUBIC_KOBRA_S_ONE', load: 'LOAD_ONTO_ANYCUBIC_KOBRA_S_ONE' },
  { id: 'creality_k1c',   label: 'Creality K1C',            hasDoor: true,
    open:  'OPEN_DOOR_CREALITY_K_ONE_C', close: 'CLOSE_DOOR_CREALITY_K_ONE_C',
    eject: 'EJECT_FROM_CREALITY_K_ONE_C', load: 'LOAD_ONTO_CREALITY_K_ONE_C' },
  { id: 'flashforge_ad5x',label: 'Flashforge AD5X',         hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_FLASHFORGE_AD_FIVE_X', load: 'LOAD_ONTO_FLASHFORGE_AD_FIVE_X' },
]

const STATE_META = {
  idle:    { label: 'Bereit',   dot: 'dot-green',  color: 'text-emerald-400' },
  running: { label: 'Druckt',   dot: 'dot-blue',   color: 'text-blue-400'   },
  pause:   { label: 'Pausiert', dot: 'dot-amber',  color: 'text-amber-400'  },
  finish:  { label: 'Fertig',   dot: 'dot-green',  color: 'text-emerald-300'},
  failed:  { label: 'Fehler',   dot: 'dot-red',    color: 'text-red-400'    },
  offline: { label: 'Offline',  dot: 'dot-gray',   color: 'text-surface-500'},
}
const stateMeta = s => STATE_META[s?.toLowerCase()] ?? STATE_META.offline

/* ── Hilfskomponenten ──────────────────────────────────────── */
function TempGauge({ label, current, target }) {
  const pct   = target > 0 ? Math.min(100, (current / target) * 100) : 0
  const color = pct > 90 ? 'from-orange-600 to-orange-400' : pct > 50 ? 'from-amber-600 to-amber-400' : 'from-surface-600 to-surface-500'
  return (
    <div className="bg-surface-900/80 rounded-xl border border-surface-700/50 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-surface-500">{label}</span>
        <span className={`text-[10px] font-mono ${target > 0 ? 'text-amber-400' : 'text-surface-600'}`}>
          {target > 0 ? `↗ ${target}°` : '—'}
        </span>
      </div>
      <p className={`text-xl font-bold font-mono leading-none ${current > 50 ? 'text-orange-300' : 'text-surface-300'}`}>
        {current}°<span className="text-sm text-surface-500">C</span>
      </p>
      <div className="w-full bg-surface-800 rounded-full h-1 overflow-hidden">
        <div className={`h-1 rounded-full bg-gradient-to-r ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

function AmsPanel({ units, activeSlot, deviceId }) {
  const { tr } = useLanguage()
  const [busy, setBusy] = useState(false)
  const [msg,  setMsg]  = useState(null)   // { text, err }
  if (!units?.length) return null

  const run = async (label, fn) => {
    if (busy || !deviceId) return
    setBusy(true); setMsg({ text: label, err: false })
    try {
      const r = await fn()
      setMsg({ text: `✓ ${r?.data?.message || label}`, err: false })
    } catch (e) {
      setMsg({ text: e?.response?.data?.detail || e?.message || tr('Fehler'), err: true })
    } finally { setBusy(false) }
  }
  const loadSlot = (gid) =>
    run(tr('Filament S{0} laden…', gid + 1), () => printerService.amsLoad(deviceId, gid))
  const unload = () =>
    run(tr('Filament entladen…'), () => printerService.amsUnload(deviceId))
  const readSlot = (unitId, slotId) =>
    run(tr('Slot S{0} neu einlesen…', unitId * 4 + slotId + 1),
        () => printerService.amsReadSlot(deviceId, unitId, slotId))

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-2">
        <p className="section-label mb-0">AMS</p>
        <button onClick={unload} disabled={busy || !deviceId}
          className="btn btn-ghost btn-sm text-[11px] disabled:opacity-40"
          title={tr('Aktuelles Filament aus dem Extruder zurück ins AMS entladen')}>
          {tr('⬇ Entladen')}
        </button>
      </div>
      <div className="space-y-3">
        {units.map(unit => (
          <div key={unit.id}>
            <p className="text-[10px] text-surface-500 mb-1.5">
              AMS {unit.id + 1} · {unit.temp}°C · {unit.humidity}% rH
            </p>
            <div className="grid grid-cols-4 gap-1.5">
              {(unit.slots.length ? unit.slots : [0,1,2,3].map(i => ({ id: i, type: '', color: '', remain: -1 }))).map(slot => {
                const gid      = unit.id * 4 + slot.id
                const isActive = activeSlot === gid
                const cssColor = slot.color ? `#${slot.color.substring(0,6)}` : null
                const empty    = !slot.type
                return (
                  <div key={slot.id} className={`rounded-lg border p-2 flex flex-col items-center gap-1 transition-all ${
                    isActive ? 'border-blue-500 bg-blue-950/30' : empty ? 'border-surface-800 bg-surface-950 opacity-60' : 'border-surface-700 bg-surface-900'
                  }`}>
                    <div className="w-5 h-5 rounded-full border-2 flex-shrink-0"
                         style={{ backgroundColor: cssColor ?? 'transparent', borderColor: cssColor ?? '#374151' }} />
                    <p className="text-[9px] font-mono text-surface-300 leading-none">{slot.type || '—'}</p>
                    <p className="text-[8px] text-surface-600">S{gid + 1}</p>
                    {slot.remain >= 0 && (
                      <div className="w-full bg-surface-800 rounded-full h-px">
                        <div className="h-px rounded-full bg-emerald-500" style={{ width: `${slot.remain}%` }} />
                      </div>
                    )}
                    {isActive && <span className="text-[8px] text-blue-400 animate-pulse">{tr('aktiv')}</span>}
                    <div className="flex items-center gap-1 pt-0.5">
                      <button onClick={() => readSlot(unit.id, slot.id)} disabled={busy || !deviceId}
                        className="w-5 h-5 flex items-center justify-center rounded border border-surface-700 text-[10px] text-surface-400 hover:text-surface-100 hover:border-surface-500 disabled:opacity-30 transition-colors"
                        title={tr('Slot neu einlesen (RFID) — wenn die Spule nicht erkannt wurde')}>⟳</button>
                      {!empty && !isActive && (
                        <button onClick={() => loadSlot(gid)} disabled={busy || !deviceId}
                          className="w-5 h-5 flex items-center justify-center rounded border border-surface-700 text-[10px] text-surface-400 hover:text-emerald-300 hover:border-emerald-700 disabled:opacity-30 transition-colors"
                          title={tr('Dieses Filament in den Extruder laden')}>⬆</button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      {msg && (
        <p className={`mt-2 text-[10px] font-mono ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>
      )}
      <p className="mt-1 text-[9px] text-surface-600">
        {tr('Laden/Entladen heizt die Düse und dauert ~1 Minute — Fortschritt am Drucker. Während eines Drucks gesperrt (Pause ist ok).')}
      </p>
    </div>
  )
}

function PositionDisplay({ pos, loading }) {
  if (loading) return <span className="text-surface-500 text-xs font-mono animate-pulse">…</span>
  if (!pos)    return <span className="text-surface-600 text-xs font-mono">—</span>
  return (
    <span className="text-xs font-mono text-surface-300">
      X <span className="text-surface-100">{pos.x}</span>{' '}
      Y <span className="text-surface-100">{pos.y}</span>{' '}
      Z <span className="text-cyan-400 font-semibold">{pos.z}</span>
      {pos.homed_axes && <span className="ml-2 text-surface-500 text-[10px]">homed: {pos.homed_axes}</span>}
    </span>
  )
}

/* ── Mainsail Konfigurationsdateien ───────────────────────── */
function KlipperConfigViewer() {
  const { tr } = useLanguage()
  const [files,    setFiles]    = useState(null)
  const [selected, setSelected] = useState(null)
  const [content,  setContent]  = useState(null)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  const loadList = async () => {
    setLoading(true); setError(null)
    try {
      const r = await klipperConfigService.listConfigs()
      setFiles(r.data.files ?? [])
    } catch (e) {
      setError(e.response?.data?.detail ?? e.message)
      setFiles([])
    } finally { setLoading(false) }
  }

  const loadFile = async (filename) => {
    setSelected(filename); setContent(null); setLoading(true); setError(null)
    try {
      const r = await klipperConfigService.readConfig(filename)
      setContent(r.data.content)
    } catch (e) {
      setError(e.response?.data?.detail ?? e.message)
    } finally { setLoading(false) }
  }

  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="section-label">{tr('Klipper Konfiguration')}</p>
          <p className="text-[10px] text-surface-600 mt-0.5">{tr('Nur lesend — Mainsail config/')}</p>
        </div>
        <button onClick={loadList} disabled={loading} className="btn btn-ghost btn-sm">
          {loading ? '…' : files === null ? tr('Laden') : '↺'}
        </button>
      </div>

      {error && (
        <p className="text-[10px] text-red-400 font-mono px-2 py-1 bg-red-950/20 border border-red-900/40 rounded">{error}</p>
      )}

      {files === null && !error && (
        <p className="text-xs text-surface-600 py-2">{tr('Klicke „Laden" um die Konfigurationsdateien anzuzeigen.')}</p>
      )}

      {files !== null && files.length === 0 && !error && (
        <p className="text-xs text-surface-600 py-2">{tr('Keine .cfg Dateien gefunden.')}</p>
      )}

      {files?.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {files.map(f => (
            <button
              key={f.filename}
              onClick={() => loadFile(f.filename)}
              className={`text-[10px] font-mono px-2 py-1 rounded border transition-colors ${
                selected === f.filename
                  ? 'border-blue-600 bg-blue-900/30 text-blue-300'
                  : 'border-surface-700 text-surface-500 hover:text-surface-300 hover:border-surface-600'
              }`}
            >
              {f.filename}
            </button>
          ))}
        </div>
      )}

      {selected && content !== null && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-surface-500 font-mono">{selected}</p>
          <pre className="text-[9px] font-mono text-surface-400 bg-surface-950 border border-surface-800/50 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-words leading-relaxed">
            {content}
          </pre>
        </div>
      )}
    </div>
  )
}

/* ── Hauptkomponente ───────────────────────────────────────── */
export default function Steuerung() {
  const { tr } = useLanguage()
  /* Drucker */
  const [bambuDevice,   setBambuDevice]   = useState(null)
  const [status,        setStatus]        = useState(null)
  const [webcamUrl,     setWebcamUrl]     = useState('')
  const [autoRefresh,   setAutoRefresh]   = useState(true)
  const [polling,       setPolling]       = useState(false)
  const [lastUpdated,   setLastUpdated]   = useState(null)
  const [imgErr,        setImgErr]        = useState(false)
  const [editWebcam,    setEditWebcam]    = useState(false)
  const [editWebcamUrl, setEditWebcamUrl] = useState('')
  const [liveCam,       setLiveCam]       = useState(false)  // built-in X1C stream (port 6000)
  const [liveCamErr,    setLiveCamErr]    = useState(false)
  const [liveCamMsg,    setLiveCamMsg]    = useState('')     // real reason from the backend probe
  const [camReady,      setCamReady]      = useState(false)  // probe succeeded → safe to open stream
  const [camKey,        setCamKey]        = useState(0)      // bump to reconnect the stream
  const pageActive = usePageActive()                          // versteckt → kein Status-Polling
  // Verdeckt (andere Seite offen / Karte aus dem Bild) den MJPEG-Stream droppen —
  // sonst läuft der Kamera-Transcode auf dem Server ewig weiter (CPU!). Beim
  // Wiedersehen mit neuem key frisch verbinden (gleiche Mechanik wie in AutoFarm).
  const camWrapRef = useRef(null)
  const [camVisible, setCamVisible] = useState(true)
  useEffect(() => {
    const el = camWrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      setCamVisible(prev => { if (e.isIntersecting && !prev) setCamKey(k => k + 1); return e.isIntersecting })
    }, { threshold: 0.01 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const [tempThreshold, setTempThreshold] = useState(
    () => Number(localStorage.getItem('ottomat3d_temp_threshold') ?? 20)
  )
  const prevStateRef  = useRef(null)
  const intervalRef   = useRef(null)
  // Läuft die Farm, liefert das Backend den Druckerstatus live aus deren
  // persistenter Verbindung (kein eigener 15-s-Connect, keine zweite Verbindung).
  const [farmRunning, setFarmRunning] = useState(false)
  useFarmStatusStream(s => setFarmRunning(!!s?.running))

  /* OTTOeject / Makros */
  const [executing,    setExecuting]    = useState(null)
  const [emergencyOn,  setEmergencyOn]  = useState(false)
  const [activePrId,   setActivePrId]   = useState(
    () => localStorage.getItem('activePrinter') ?? 'bambu_x1c'
  )

  /* Z Kalibrierung */
  const [pos,        setPos]        = useState(null)
  const [posLoading, setPosLoading] = useState(false)
  const [jogStep,    setJogStep]    = useState(1)
  const [targetZ,    setTargetZ]    = useState('')
  const [jogBusy,    setJogBusy]    = useState(false)
  const [macroRunning, setMacroRunning] = useState(null)

  /* Feedback */
  const [feedback, setFeedback] = useState(null)
  const showFeedback = useCallback((msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 5000)
  }, [])

  const activePrinter = PRINTER_PROFILES.find(p => p.id === activePrId) ?? PRINTER_PROFILES[0]
  const busy = executing !== null || macroRunning !== null || jogBusy

  /* ── Drucker laden ─────────────────────────────────── */
  const loadDevices = useCallback(async () => {
    try {
      const r = await deviceService.listDevices()
      const b = r.data.find(d => d.device_type === 'bambu_lab')
      if (b) {
        setBambuDevice(b)
        const s = await deviceSettingsService.getSettings(b.id)
        const url = s.data.webcam_url ?? ''
        setWebcamUrl(url)
        setEditWebcamUrl(url)
      }
    } catch {}
  }, [])

  const fetchStatus = useCallback(async (deviceId) => {
    if (!deviceId) return
    setPolling(true)
    try {
      const r = await printerService.getStatus(deviceId)
      const newState = r.data.gcode_state
      if (newState === 'FINISH' && prevStateRef.current && prevStateRef.current !== 'FINISH') {
        printerService.takeSnapshot(deviceId).catch(() => {})
      }
      prevStateRef.current = newState
      setStatus(r.data)
      setLastUpdated(new Date())
    } catch {
      setStatus({ online: false, status: 'offline' })
    } finally { setPolling(false) }
  }, [])

  const fetchPos = useCallback(async () => {
    setPosLoading(true)
    try {
      const r = await controlService.getKlipperPosition()
      setPos(r.data)
    } catch { setPos(null) }
    finally { setPosLoading(false) }
  }, [])

  useEffect(() => { loadDevices() }, [loadDevices])
  useEffect(() => { if (bambuDevice) fetchStatus(bambuDevice.id) }, [bambuDevice, fetchStatus])
  // OTTOeject-Position beim (Wieder-)Aktivwerden auffrischen — kein F5 nötig.
  useAutoRefresh(fetchPos, 0)

  useEffect(() => {
    // pageActive: versteckte Seite pollt nicht (App hält Seiten gemountet).
    if (!autoRefresh || !bambuDevice || !pageActive) { clearInterval(intervalRef.current); return }
    clearInterval(intervalRef.current)
    fetchStatus(bambuDevice.id)   // beim Wieder-Aktivwerden sofort auffrischen
    // Während die Farm druckt, sind die Daten serverseitig live (aus deren
    // Verbindung) — häufiger holen ist billig (kein Drucker-Connect). Sonst 15 s.
    const ms = farmRunning ? 4000 : 15000
    intervalRef.current = setInterval(() => fetchStatus(bambuDevice.id), ms)
    return () => clearInterval(intervalRef.current)
  }, [autoRefresh, bambuDevice, fetchStatus, farmRunning, pageActive])

  /* ── Webcam speichern ─────────────────────────────── */
  const saveWebcam = async () => {
    try {
      await deviceSettingsService.updateSettings(bambuDevice.id, { webcam_url: editWebcamUrl })
      setWebcamUrl(editWebcamUrl)
      setEditWebcam(false)
      setImgErr(false)
    } catch {}
  }

  /* ── Eingebaute X1C-Kamera ────────────────────────────
     Erst ein Einzelbild probieren (normale HTTP-Antwort → Fehlertext lesbar),
     erst danach den MJPEG-Stream öffnen. So sehen wir die echte Ursache und
     öffnen nie zwei Kamera-Verbindungen gleichzeitig (X1C erlaubt nur wenige). */
  const connectLiveCam = async () => {
    if (!bambuDevice) return
    setLiveCamErr(false); setLiveCamMsg(''); setCamReady(false)
    setCamKey(k => k + 1)
    setLiveCam(true)
    try {
      const r = await fetch(`${printerService.cameraFrameUrl(bambuDevice.id)}?probe=${Date.now()}`)
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { detail = (await r.json()).detail || detail } catch {
          try { detail = (await r.text()) || detail } catch {}
        }
        setLiveCamErr(true); setLiveCamMsg(detail)
        return
      }
      setCamReady(true)
    } catch (e) {
      setLiveCamErr(true); setLiveCamMsg(String(e?.message || e))
    }
  }

  const stopLiveCam = () => { setLiveCam(false); setCamReady(false); setLiveCamErr(false); setLiveCamMsg('') }

  /* ── Makro / GCode ────────────────────────────────── */
  const gcode = async (cmd, label) => {
    if (!bambuDevice) return showFeedback(tr('Kein Bambu Lab Gerät konfiguriert'), false)
    setExecuting(label)
    try {
      await printerService.sendGcode(bambuDevice.id, cmd)
      showFeedback(tr('{0} — gesendet', label))
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setExecuting(null) }
  }

  const macro = async (name) => {
    setExecuting(name)
    try {
      const r = await controlService.executeMacro({ macro_name: name })
      showFeedback(r.data.success ? tr('{0} — OK', name) : r.data.message, r.data.success)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setExecuting(null) }
  }

  const runMacro = async (name, label) => {
    setMacroRunning(name)
    try {
      const r = await controlService.executeMacro({ macro_name: name })
      showFeedback(r.data.success ? tr('{0} — OK', label) : r.data.message, r.data.success)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setMacroRunning(null) }
  }

  const sendKlipperGcode = async (gc, label) => {
    setJogBusy(true)
    try {
      await controlService.sendKlipperGcode(gc)
      showFeedback(tr('{0} — gesendet', label))
      setTimeout(fetchPos, 1500)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setJogBusy(false) }
  }

  const jogZ = (delta) => sendKlipperGcode(`G91\nG1 Z${delta} F1000\nG90`, `Z ${delta > 0 ? '+' : ''}${delta} mm`)
  const moveToZ = () => {
    const v = parseFloat(targetZ)
    if (isNaN(v)) return showFeedback(tr('Ungültiger Z-Wert'), false)
    sendKlipperGcode(`G90\nG1 Z${v} F1000`, `Z → ${v} mm`)
  }

  const emergencyStop = async () => {
    if (!(await confirmDialog({ title: tr('NOTAUS'), message: tr('NOTAUS — alle Geräte deaktivieren?'), confirmLabel: tr('Deaktivieren') }))) return
    try {
      await controlService.emergencyStop()
      setEmergencyOn(true)
      showFeedback(tr('Notaus aktiviert'), true)
    } catch (e) { showFeedback(e.message, false) }
  }
  const resumeOps = async () => {
    try {
      await controlService.resume()
      setEmergencyOn(false)
      showFeedback(tr('Betrieb fortgesetzt'), true)
    } catch (e) { showFeedback(e.message, false) }
  }

  const slotBtns = (prefix, slots = [1,2,3,4,5,6]) => slots.map(n => (
    <button key={n} onClick={() => macro(`${prefix}_${n}`)} disabled={busy}
      className="btn btn-ghost btn-sm font-mono">{n}</button>
  ))

  /* Drucker-Statuswerte */
  const meta       = stateMeta(status?.gcode_state ?? status?.status)
  const progress   = status?.progress?.progress ?? 0
  const layer      = status?.progress?.layer ?? 0
  const totalLayer = status?.progress?.total_layers ?? 0
  const remMin     = status?.remaining_min ?? 0
  const fileName   = status?.subtask_name ?? ''
  const isRunning  = status?.gcode_state === 'RUNNING' || status?.is_printing
  const amsUnits   = status?.ams_units ?? []
  const trayActive = status?.tray_active ?? 255

  const tempWarnings = []
  if (isRunning && status) {
    const n  = status.nozzle_temp       ?? 0
    const nt = status.nozzle_target_temp ?? 0
    const b  = status.bed_temp          ?? 0
    const bt = status.bed_target_temp   ?? 0
    if (nt > 0 && Math.abs(n - nt) > tempThreshold)
      tempWarnings.push(tr('Düse: {0}°C (Ziel {1}°C)', n, nt))
    if (bt > 0 && Math.abs(b - bt) > tempThreshold)
      tempWarnings.push(tr('Bett: {0}°C (Ziel {1}°C)', b, bt))
  }

  return (
    <div className="space-y-4">

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      {/* Notaus */}
      <div className="flex gap-3">
        <button onClick={emergencyStop} className="flex-1 btn btn-danger">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>
          </svg>
          {tr('Notaus')}
        </button>
        <button onClick={resumeOps} disabled={!emergencyOn} className="flex-1 btn btn-ghost disabled:opacity-30">
          {tr('▶ Betrieb fortsetzen')}
        </button>
      </div>

      {/* ── Hauptlayout: Links Bambu Lab, Rechts OTTOeject ── */}
      <div className="grid grid-cols-[1fr_300px] gap-4 items-start">

        {/* ── Linke Spalte: Bambu Lab ──────────────────────── */}
        <div className="space-y-3">

          {/* Status-Header */}
          <div className="card">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-3">
                <span className={`dot ${meta.dot} ${isRunning ? 'animate-pulse' : ''}`} />
                <div>
                  <p className="text-base font-semibold text-surface-200">
                    {bambuDevice?.name ?? 'Bambu Lab'}
                  </p>
                  <p className={`text-xs font-medium ${meta.color}`}>{tr(meta.label)}</p>
                </div>
                {fileName && (
                  <div className="px-2.5 py-1 rounded-lg bg-surface-900 border border-surface-700">
                    <p className="text-[10px] text-surface-500">{tr('Druckt')}</p>
                    <p className="text-xs text-surface-200 truncate max-w-[200px]">{fileName}</p>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] text-surface-600">{tr('Warnschwelle')}</span>
                  <input type="number" min="1" max="100" value={tempThreshold}
                    onChange={e => { const v = Math.max(1, Number(e.target.value)); setTempThreshold(v); localStorage.setItem('ottomat3d_temp_threshold', String(v)) }}
                    className="w-12 font-mono text-xs" />
                  <span className="text-[10px] text-surface-600">°C</span>
                </div>
                {lastUpdated && <p className="text-[10px] text-surface-600 font-mono">{lastUpdated.toLocaleTimeString()}</p>}
                <button onClick={() => setAutoRefresh(v => !v)}
                  title={farmRunning ? tr('Live über die Verbindung der laufenden Farm') : tr('Auto-Aktualisierung alle 15 s')}
                  className={`btn btn-sm ${autoRefresh ? 'btn-primary' : 'btn-ghost'}`}>
                  {autoRefresh ? (farmRunning ? tr('● Live') : '⟳ 15s') : tr('⟳ Man.')}
                </button>
                <button onClick={() => bambuDevice && fetchStatus(bambuDevice.id)} disabled={polling} className="btn btn-ghost btn-sm">
                  {polling ? '…' : tr('Jetzt')}
                </button>
              </div>
            </div>

            {tempWarnings.length > 0 && (
              <div className="mt-2 px-3 py-2 rounded-lg bg-red-950/40 border border-red-800 text-red-300">
                <p className="text-[10px] font-semibold mb-1">{tr('Temperaturwarnung')}</p>
                {tempWarnings.map((w, i) => <p key={i} className="text-[10px] font-mono">{w}</p>)}
              </div>
            )}

            {(isRunning || status?.gcode_state === 'PAUSE') && (
              <div className="mt-3 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-surface-500">{tr('Fortschritt')}</span>
                  <span className="font-mono font-semibold text-blue-300">{progress}%</span>
                </div>
                <div className="w-full bg-surface-900 rounded-full h-2.5 overflow-hidden">
                  <div className="h-2.5 rounded-full bg-gradient-to-r from-blue-700 to-blue-400 transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="flex justify-between text-[10px] text-surface-500 font-mono">
                  <span>{tr('Schicht {0} / {1}', layer, totalLayer)}</span>
                  {remMin > 0 && <span>{tr('{0} verbleibend', remMin >= 60 ? `${Math.floor(remMin/60)}h ${remMin%60}min` : `${remMin} min`)}</span>}
                </div>
              </div>
            )}
          </div>

          {/* Webcam */}
          <div ref={camWrapRef} className="card space-y-2">
            <div className="flex items-center justify-between">
              <p className="section-label">{tr('Webcam')}</p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => liveCam ? stopLiveCam() : connectLiveCam()}
                  disabled={!bambuDevice}
                  className={`btn btn-sm ${liveCam ? 'btn-primary' : 'btn-ghost'}`}
                  title={tr('Eingebaute X1C-Kamera (LAN-Liveview muss am Drucker aktiv sein)')}
                >
                  {liveCam ? tr('⏹ Live stoppen') : tr('📷 Live (X1C)')}
                </button>
                <button onClick={() => setEditWebcam(v => !v)} className="btn btn-ghost btn-sm">
                  {editWebcam ? tr('Abbrechen') : tr('URL ändern')}
                </button>
              </div>
            </div>
            {editWebcam ? (
              <div className="space-y-2">
                <input type="text" placeholder="http://192.168.x.x:8080/mjpeg"
                  value={editWebcamUrl} onChange={e => setEditWebcamUrl(e.target.value)}
                  className="w-full font-mono text-sm" />
                <button onClick={saveWebcam} className="btn btn-primary btn-sm">{tr('Speichern')}</button>
                <p className="text-[10px] text-surface-600">
                  {tr('Externe Kamera (MJPEG/HTTP). Für die eingebaute X1C-Kamera einfach „📷 Live (X1C)".')}
                </p>
              </div>
            ) : liveCam && bambuDevice ? (
              <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                {liveCamErr ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-2 px-4 text-center">
                    <p className="text-xs">{tr('X1C-Kamera nicht erreichbar')}</p>
                    {liveCamMsg && <p className="text-[10px] font-mono text-red-400/80 break-all max-w-full">{liveCamMsg}</p>}
                    <p className="text-[10px] text-surface-700">{tr('„LAN-Modus Liveview" am Drucker aktivieren (Einstellungen → Allgemein), im selben Netz sein und sicherstellen, dass keine andere App (Bambu Studio / Handy-App) die Kamera belegt.')}</p>
                    <button onClick={connectLiveCam} className="btn btn-ghost btn-sm mt-1">{tr('Neu verbinden')}</button>
                  </div>
                ) : camReady ? (
                  camVisible ? (
                    <img src={`${printerService.cameraStreamUrl(bambuDevice.id)}?t=${camKey}`} alt="X1C Live"
                      onError={() => { setLiveCamErr(true); if (!liveCamMsg) setLiveCamMsg(tr('Stream-Verbindung abgebrochen')) }}
                      className="w-full h-full object-contain" />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-surface-600 text-[10px]">{tr('Pausiert (Seite im Hintergrund)')}</div>
                  )
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-xs">
                    {tr('Verbinde mit Kamera …')}
                  </div>
                )}
                <span className="absolute top-2 left-2 text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>
              </div>
            ) : webcamUrl ? (
              <div className="relative bg-black rounded-xl overflow-hidden" style={{ aspectRatio: '16/9' }}>
                {imgErr ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-2">
                    <p className="text-xs">{tr('Webcam nicht erreichbar')}</p>
                    <p className="text-[10px] font-mono text-surface-700">{webcamUrl}</p>
                  </div>
                ) : camVisible ? (
                  <img src={webcamUrl} alt="Webcam" onError={() => setImgErr(true)} onLoad={() => setImgErr(false)}
                    className="w-full h-full object-contain" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-surface-600 text-[10px]">{tr('Pausiert (Seite im Hintergrund)')}</div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-surface-600 rounded-xl border-2 border-dashed border-surface-800 gap-2">
                <p className="text-sm">{tr('Keine Kamera aktiv')}</p>
                <div className="flex gap-2">
                  <button onClick={() => { setLiveCamErr(false); setCamKey(k => k + 1); setLiveCam(true) }} disabled={!bambuDevice} className="btn btn-primary btn-sm">{tr('📷 X1C Live starten')}</button>
                  <button onClick={() => setEditWebcam(true)} className="btn btn-ghost btn-sm">{tr('Externe URL')}</button>
                </div>
              </div>
            )}
          </div>

          {/* Temperaturen */}
          <div className="grid grid-cols-2 gap-3">
            <TempGauge label={tr('Düsentemperatur')} current={status?.nozzle_temp ?? 0} target={status?.nozzle_target_temp ?? 0} />
            <TempGauge label={tr('Betttemperatur')}  current={status?.bed_temp ?? 0}    target={status?.bed_target_temp ?? 0}    />
          </div>

          {/* AMS */}
          {amsUnits.length > 0 && <AmsPanel units={amsUnits} activeSlot={trayActive} deviceId={bambuDevice?.id} />}

          {/* Drucker Homing + Z-Achse (via Bambu GCode) */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="section-label">{tr('Drucker')}</p>
              <select value={activePrId} onChange={e => { setActivePrId(e.target.value); localStorage.setItem('activePrinter', e.target.value) }} className="text-xs py-1">
                {PRINTER_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => gcode('G28', 'Home All')}    disabled={busy || !bambuDevice} className="btn btn-ghost btn-sm">Home All</button>
              <button onClick={() => gcode('G28 Z', 'Home Z')}    disabled={busy || !bambuDevice} className="btn btn-ghost btn-sm">Home Z</button>
              <button onClick={() => gcode('G28 X Y', 'Home XY')} disabled={busy || !bambuDevice} className="btn btn-ghost btn-sm">Home XY</button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {[{l:'Z +10',c:'G91\nG1 Z10 F600\nG90'},{l:'Z +1',c:'G91\nG1 Z1 F600\nG90'},{l:'Z -1',c:'G91\nG1 Z-1 F600\nG90'},{l:'Z -10',c:'G91\nG1 Z-10 F600\nG90'}].map(({l,c}) => (
                <button key={l} onClick={() => gcode(c, l)} disabled={busy || !bambuDevice} className="btn btn-ghost btn-sm font-mono text-xs">{l}</button>
              ))}
            </div>
            {activePrinter.hasDoor && (
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => macro(activePrinter.open)}  disabled={busy} className="btn btn-ghost btn-sm">{tr('Tür öffnen')}</button>
                <button onClick={() => macro(activePrinter.close)} disabled={busy} className="btn btn-ghost btn-sm">{tr('Tür schließen')}</button>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => macro(activePrinter.eject)} disabled={busy} className="btn btn-ghost btn-sm">{tr('Auswerfen')}</button>
              <button onClick={() => macro(activePrinter.load)}  disabled={busy} className="btn btn-ghost btn-sm">{tr('Einlegen')}</button>
            </div>
          </div>
        </div>

        {/* ── Rechte Spalte: OTTOeject + Kalibrierung ─────── */}
        <div className="space-y-3">

          {/* OTTOeject System */}
          <div className="card space-y-3">
            <p className="section-label">OTTOeject</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => runMacro('OTTOEJECT_HOME', 'Home')}                      disabled={busy} className="btn btn-primary btn-sm">Home</button>
              <button onClick={() => runMacro('PARK_OTTOEJECT', 'Park')}                      disabled={busy} className="btn btn-ghost btn-sm">Park</button>
              <button onClick={() => runMacro('TEST_STORAGE_RACK_CONFIGURATION', 'Test Rack')} disabled={busy} className="btn btn-ghost btn-sm text-xs">Test Rack</button>
            </div>
            <div>
              {/* Holen NUR aus dem Magazin (Fach 7) — Vorrat an leeren Platten.
                  Aus den Lager-Fächern (1–6) wird nie geholt, dort liegen fertige Drucke. */}
              <p className="text-[10px] text-surface-500 mb-1.5">{tr('Holen aus Magazin (Fach 7)')}</p>
              <div className="flex gap-1.5 flex-wrap">{slotBtns('GRAB_FROM_SLOT', [7])}</div>
            </div>
            <div>
              {/* Einlagern NUR in die Lager-Fächer (1–6), nie ins Magazin. */}
              <p className="text-[10px] text-surface-500 mb-1.5">{tr('Einlagern in Fach')}</p>
              <div className="flex gap-1.5 flex-wrap">{slotBtns('STORE_TO_SLOT')}</div>
            </div>
            {executing && (
              <div className="flex items-center gap-2 text-xs text-surface-400">
                <span className="dot dot-blue animate-pulse" />
                {tr('Läuft:')} <span className="font-mono text-surface-300">{executing}</span>
              </div>
            )}
          </div>

          {/* Z Kalibrierung */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <p className="section-label">{tr('Z Kalibrierung')}</p>
              <button onClick={fetchPos} disabled={posLoading} className="btn-icon">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                </svg>
              </button>
            </div>
            <PositionDisplay pos={pos} loading={posLoading} />
            <div>
              <p className="text-[10px] text-surface-500 mb-1.5">{tr('Schrittweite (mm)')}</p>
              <div className="flex gap-1">
                {[0.1, 0.5, 1, 5, 10].map(s => (
                  <button key={s} onClick={() => setJogStep(s)} className={`flex-1 text-[10px] py-1 rounded border font-mono transition-colors ${
                    jogStep === s ? 'bg-blue-600 border-blue-500 text-white' : 'bg-surface-800 border-surface-700 text-surface-400 hover:border-surface-500'
                  }`}>{s}</button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => jogZ(jogStep)}  disabled={busy} className="btn btn-ghost btn-sm">Z +{jogStep}</button>
              <button onClick={() => jogZ(-jogStep)} disabled={busy} className="btn btn-ghost btn-sm">Z −{jogStep}</button>
            </div>
            <div className="flex gap-2">
              <input type="number" step="0.1" placeholder={tr('Z Zielwert mm')} value={targetZ}
                onChange={e => setTargetZ(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && moveToZ()}
                className="flex-1 text-xs font-mono" />
              <button onClick={moveToZ} disabled={busy || !targetZ} className="btn btn-ghost btn-sm">{tr('Fahren')}</button>
            </div>
          </div>

          {/* Einzel-Fach Operationen */}
          <div className="card">
            <p className="section-label mb-2">{tr('Einzel-Fach')}</p>
            <div className="space-y-1.5">
              {/* Magazin (Fach 7): nur Holen — Vorrat an leeren Platten. */}
              <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-900 border border-blue-900/40">
                <span className="text-xs text-surface-400 w-16 shrink-0">{tr('Magazin')}</span>
                <button onClick={() => runMacro('GRAB_FROM_SLOT_7', tr('Aus Magazin holen'))} disabled={busy} className="btn btn-ghost btn-sm text-[10px]">{tr('Holen')}</button>
                <div className="flex gap-1 ml-auto">
                  <button onClick={() => runMacro(activePrinter.load,  tr('In Drucker'))}  disabled={busy} className="btn btn-ghost btn-sm text-[9px]">→ Dr.</button>
                  <button onClick={() => runMacro(activePrinter.eject, tr('Aus Drucker'))} disabled={busy} className="btn btn-ghost btn-sm text-[9px]">← Dr.</button>
                </div>
              </div>
              {/* Lager-Fächer 1–6: nur Einlagern (fertige Drucke), kein Holen. */}
              {[1,2,3,4,5,6].map(slot => (
                <div key={slot} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-surface-900 border border-surface-700/50">
                  <span className="text-xs text-surface-400 w-16 shrink-0">{tr('Fach {0}', slot)}</span>
                  <button onClick={() => runMacro(`STORE_TO_SLOT_${slot}`, tr('Fach {0} einlagern', slot))} disabled={busy} className="btn btn-ghost btn-sm text-[10px]">{tr('Einlagern')}</button>
                  <div className="flex gap-1 ml-auto">
                    <button onClick={() => runMacro(activePrinter.load,  tr('In Drucker'))}  disabled={busy} className="btn btn-ghost btn-sm text-[9px]">→ Dr.</button>
                    <button onClick={() => runMacro(activePrinter.eject, tr('Aus Drucker'))} disabled={busy} className="btn btn-ghost btn-sm text-[9px]">← Dr.</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Klipper Konfigurationsdateien */}
          <KlipperConfigViewer />
        </div>
      </div>
    </div>
  )
}
