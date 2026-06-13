import React, { useState, useEffect } from 'react'
import { controlService, printerService, deviceService } from '../services/api'

/* ── small helpers ──────────────────────────────────────────── */

function SectionHeader({ title }) {
  return <p className="section-label">{title}</p>
}

function FeedbackBar({ msg }) {
  if (!msg) return null
  const ok = msg.success !== false && !msg.error
  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
      ok
        ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
        : 'bg-red-950/40    border-red-800    text-red-300'
    }`}>
      <span className={`dot ${ok ? 'dot-green' : 'dot-red'}`} />
      {msg.message || msg.error || JSON.stringify(msg)}
    </div>
  )
}

/* ── printer profiles (V2.1) ────────────────────────────────── */
const PRINTER_PROFILES = [
  { id: 'bambu_x1c',     label: 'Bambu Lab X1C',         hasDoor: true,
    open:  'OPEN_DOOR_BAMBU_X_ONE_C',   close: 'CLOSE_DOOR_BAMBU_X_ONE_C',
    eject: 'EJECT_FROM_BAMBULAB_X_ONE_C', load: 'LOAD_ONTO_BAMBULAB_X_ONE_C' },
  { id: 'bambu_p1s',     label: 'Bambu Lab P1S',         hasDoor: true,
    open:  'OPEN_DOOR_BAMBU_P_ONE_S',   close: 'CLOSE_DOOR_BAMBU_P_ONE_S',
    eject: 'EJECT_FROM_BAMBULAB_P_ONE_S', load: 'LOAD_ONTO_BAMBULAB_P_ONE_S' },
  { id: 'bambu_p1p',     label: 'Bambu Lab P1P',         hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_BAMBULAB_P_ONE_P', load: 'LOAD_ONTO_BAMBULAB_P_ONE_P' },
  { id: 'bambu_a1',      label: 'Bambu Lab A1',          hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_BAMBULAB_A_ONE', load: 'LOAD_ONTO_BAMBULAB_A_ONE' },
  { id: 'elegoo_cc',     label: 'Elegoo Centauri Carbon',hasDoor: true,
    open:  'OPEN_DOOR_ELEGOO_CC',       close: 'CLOSE_DOOR_ELEGOO_CC',
    eject: 'EJECT_FROM_ELEGOO_CC',      load:  'LOAD_ONTO_ELEGOO_CC' },
  { id: 'kobra_s1',      label: 'Anycubic Kobra S1',     hasDoor: true,
    open:  'OPEN_DOOR_ANYCUBIC_KOBRA_S_ONE', close: 'CLOSE_DOOR_ANYCUBIC_KOBRA_S_ONE',
    eject: 'EJECT_FROM_ANYCUBIC_KOBRA_S_ONE', load: 'LOAD_ONTO_ANYCUBIC_KOBRA_S_ONE' },
  { id: 'creality_k1c',  label: 'Creality K1C',          hasDoor: true,
    open:  'OPEN_DOOR_CREALITY_K_ONE_C',close: 'CLOSE_DOOR_CREALITY_K_ONE_C',
    eject: 'EJECT_FROM_CREALITY_K_ONE_C', load: 'LOAD_ONTO_CREALITY_K_ONE_C' },
  { id: 'flashforge_ad5x', label: 'Flashforge AD5X',     hasDoor: false,
    open: null, close: null,
    eject: 'EJECT_FROM_FLASHFORGE_AD_FIVE_X', load: 'LOAD_ONTO_FLASHFORGE_AD_FIVE_X' },
]

/* ── main component ─────────────────────────────────────────── */

function Controls() {
  const [bambuId, setBambuId]     = useState(null)
  const [executing, setExecuting] = useState(null)
  const [feedback, setFeedback]   = useState(null)
  const [macros, setMacros]               = useState([])
  const [emergencyActive, setEmergencyActive] = useState(false)
  const [activePrinterId, setActivePrinterId] = useState(
    () => localStorage.getItem('activePrinter') ?? 'bambu_x1c'
  )
  const [buzzerFreq, setBuzzerFreq] = useState(
    () => Number(localStorage.getItem('ottomat3d_buzzer_freq') ?? 1046)
  )
  const [buzzerDuration, setBuzzerDuration] = useState(
    () => Number(localStorage.getItem('ottomat3d_buzzer_dur') ?? 200)
  )

  const activePrinter = PRINTER_PROFILES.find(p => p.id === activePrinterId) ?? PRINTER_PROFILES[0]

  const selectPrinter = (id) => {
    setActivePrinterId(id)
    localStorage.setItem('activePrinter', id)
  }

  useEffect(() => {
    deviceService.listDevices().then(r => {
      const b = r.data.find(d => d.device_type === 'bambu_lab')
      if (b) setBambuId(b.id)
    })
    controlService.listMacros().then(r => setMacros(r.data.macros ?? []))
  }, [])

  const showFeedback = (msg) => {
    setFeedback(msg)
    setTimeout(() => setFeedback(null), 5000)
  }

  /* ── send gcode to Bambu ── */
  const gcode = async (cmd, label) => {
    if (!bambuId) return showFeedback({ success: false, message: 'No Bambu Lab device configured' })
    setExecuting(label)
    try {
      const r = await printerService.sendGcode(bambuId, cmd)
      showFeedback({ success: true, message: `${label} — command sent` })
    } catch (e) {
      showFeedback({ success: false, message: e.response?.data?.detail ?? e.message })
    } finally {
      setExecuting(null)
    }
  }

  /* ── execute Klipper macro ── */
  const macro = async (name) => {
    setExecuting(name)
    try {
      const r = await controlService.executeMacro({ macro_name: name })
      showFeedback(r.data)
    } catch (e) {
      showFeedback({ success: false, message: e.response?.data?.detail ?? e.message })
    } finally {
      setExecuting(null)
    }
  }

  /* ── emergency ── */
  const emergencyStop = async () => {
    if (!confirm('EMERGENCY STOP — deactivate all devices?')) return
    try {
      await controlService.emergencyStop()
      setEmergencyActive(true)
      showFeedback({ success: true, message: 'Emergency stop activated' })
    } catch (e) {
      showFeedback({ success: false, message: e.message })
    }
  }

  const resumeOps = async () => {
    try {
      await controlService.resume()
      setEmergencyActive(false)
      showFeedback({ success: true, message: 'Operations resumed' })
    } catch (e) {
      showFeedback({ success: false, message: e.message })
    }
  }

  const busy = executing !== null

  /* ── slot button helpers ── */
  const slotButtons = (prefix, cmdFn) =>
    [1, 2, 3, 4, 5, 6].map(n => (
      <button
        key={n}
        onClick={() => cmdFn(`${prefix}_${n}`)}
        disabled={busy}
        className="btn btn-ghost btn-sm font-mono"
      >
        {n}
      </button>
    ))

  return (
    <div className="space-y-6">

      {/* Feedback */}
      <FeedbackBar msg={feedback} />

      {/* ── EMERGENCY ─────────────────────────────────────────── */}
      <div className="card border border-red-900/50">
        <SectionHeader title="Emergency" />
        <div className="flex gap-3">
          <button
            onClick={emergencyStop}
            className="btn btn-danger btn-lg flex-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>
            </svg>
            Emergency Stop
          </button>
          <button
            onClick={resumeOps}
            disabled={!emergencyActive}
            className="btn btn-success btn-lg flex-1"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polygon points="5 3 19 12 5 21 5 3"/>
            </svg>
            Resume Operations
          </button>
        </div>
      </div>

      {/* ── BUZZER ────────────────────────────────────────────── */}
      <div className="card">
        <SectionHeader title="Drucker-Buzzer" />
        <div className="grid grid-cols-3 gap-4 mt-3">
          <div>
            <label className="text-xs text-surface-500 block mb-1">Frequenz (Hz)</label>
            <input
              type="number" min="100" max="4000" value={buzzerFreq}
              onChange={e => {
                const v = Number(e.target.value)
                setBuzzerFreq(v)
                localStorage.setItem('ottomat3d_buzzer_freq', String(v))
              }}
              className="font-mono w-full"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">Dauer (ms)</label>
            <input
              type="number" min="50" max="5000" step="50" value={buzzerDuration}
              onChange={e => {
                const v = Number(e.target.value)
                setBuzzerDuration(v)
                localStorage.setItem('ottomat3d_buzzer_dur', String(v))
              }}
              className="font-mono w-full"
            />
          </div>
          <div className="flex flex-col justify-end">
            <button
              onClick={() => gcode(`M300 S${buzzerFreq} P${buzzerDuration}`, 'Buzzer-Test')}
              disabled={busy || !bambuId}
              className="btn btn-ghost"
            >
              ▶ Buzzer testen
            </button>
          </div>
        </div>
        <p className="text-[10px] text-surface-700 mt-2">
          M300 S{buzzerFreq} P{buzzerDuration} — Unterstützung abhängig von Drucker-Firmware.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-6">

        {/* ── DRUCKER ───────────────────────────────────────────── */}
        <div className="card space-y-5">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <SectionHeader title="Drucker" />
            <div className="flex items-center gap-2">
              {!bambuId && <span className="badge badge-amber">Nicht konfiguriert</span>}
              <select
                value={activePrinterId}
                onChange={e => selectPrinter(e.target.value)}
                className="text-xs py-1"
              >
                {PRINTER_PROFILES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
          </div>

          {/* Homing */}
          <div>
            <p className="text-xs text-surface-500 mb-2">Homing</p>
            <div className="grid grid-cols-3 gap-2">
              <button
                onClick={() => gcode('G28', 'Home All')}
                disabled={busy || !bambuId}
                className="btn btn-cyan"
              >
                Home All
              </button>
              <button
                onClick={() => gcode('G28 Z', 'Home Z')}
                disabled={busy || !bambuId}
                className="btn btn-ghost"
              >
                Home Z
              </button>
              <button
                onClick={() => gcode('G28 X Y', 'Home XY')}
                disabled={busy || !bambuId}
                className="btn btn-ghost"
              >
                Home XY
              </button>
            </div>
          </div>

          {/* Z Movement */}
          <div>
            <p className="text-xs text-surface-500 mb-2">Z Axis</p>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Z +10', cmd: 'G91\nG1 Z10 F600\nG90' },
                { label: 'Z +1',  cmd: 'G91\nG1 Z1  F600\nG90' },
                { label: 'Z -1',  cmd: 'G91\nG1 Z-1 F600\nG90' },
                { label: 'Z -10', cmd: 'G91\nG1 Z-10 F600\nG90' },
              ].map(({ label, cmd }) => (
                <button
                  key={label}
                  onClick={() => gcode(cmd, label)}
                  disabled={busy || !bambuId}
                  className="btn btn-ghost text-xs font-mono"
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Door (only if printer has a door) */}
          {activePrinter.hasDoor && (
            <div>
              <p className="text-xs text-surface-500 mb-2">Tür (via Klipper)</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => macro(activePrinter.open,  'Tür öffnen')}   disabled={busy} className="btn btn-ghost">Tür öffnen</button>
                <button onClick={() => macro(activePrinter.close, 'Tür schließen')} disabled={busy} className="btn btn-ghost">Tür schließen</button>
              </div>
            </div>
          )}

          {/* Plate */}
          <div>
            <p className="text-xs text-surface-500 mb-2">Platte (via Klipper)</p>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => macro(activePrinter.eject, 'Auswerfen')} disabled={busy} className="btn btn-ghost">Auswerfen</button>
              <button onClick={() => macro(activePrinter.load,  'Einlegen')}  disabled={busy} className="btn btn-ghost">Einlegen</button>
            </div>
          </div>
        </div>

        {/* ── OTTOEJECT ─────────────────────────────────────────── */}
        <div className="card space-y-5">
          <SectionHeader title="OTTOeject" />

          {/* System */}
          <div>
            <p className="text-xs text-surface-500 mb-2">System</p>
            <div className="grid grid-cols-3 gap-2">
              <button onClick={() => macro('OTTOEJECT_HOME')}                 disabled={busy} className="btn btn-ghost">Home</button>
              <button onClick={() => macro('PARK_OTTOEJECT')}                 disabled={busy} className="btn btn-ghost">Park</button>
              <button onClick={() => macro('TEST_STORAGE_RACK_CONFIGURATION')} disabled={busy} className="btn btn-ghost text-xs">Test Rack</button>
            </div>
          </div>

          {/* Grab from slot */}
          <div>
            <p className="text-xs text-surface-500 mb-2">Grab from Slot</p>
            <div className="flex gap-2">
              {slotButtons('GRAB_FROM_SLOT', macro)}
            </div>
          </div>

          {/* Store to slot */}
          <div>
            <p className="text-xs text-surface-500 mb-2">Store to Slot</p>
            <div className="flex gap-2">
              {slotButtons('STORE_TO_SLOT', macro)}
            </div>
          </div>

          {/* Status indicator */}
          {executing && (
            <div className="flex items-center gap-2 text-xs text-surface-400">
              <span className="dot dot-blue animate-pulse" />
              Executing: <span className="font-mono text-surface-300">{executing}</span>
            </div>
          )}
        </div>
      </div>

    </div>
  )
}

export default Controls
