import React, { useState, useEffect, useCallback } from 'react'
import { controlService, deviceService } from '../services/api'

const NUM_SLOTS = 6

function PositionDisplay({ pos, loading }) {
  if (loading) return <span className="text-surface-500 text-xs font-mono">…</span>
  if (!pos)    return <span className="text-surface-600 text-xs font-mono">—</span>
  return (
    <span className="text-xs font-mono text-surface-300">
      X <span className="text-surface-100">{pos.x}</span>{' '}
      Y <span className="text-surface-100">{pos.y}</span>{' '}
      Z <span className="text-cyan-400 font-semibold">{pos.z}</span>
      {pos.homed_axes && (
        <span className="ml-2 text-surface-500">homed: {pos.homed_axes || '—'}</span>
      )}
    </span>
  )
}

function Calibration() {
  const [feedback, setFeedback] = useState(null)
  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 5000)
  }

  useEffect(() => {
    deviceService.listDevices().catch(() => {})
  }, [])

  const [pos, setPos]               = useState(null)
  const [posLoading, setPosLoading] = useState(false)
  const fetchPos = useCallback(async () => {
    setPosLoading(true)
    try {
      const r = await controlService.getKlipperPosition()
      setPos(r.data)
    } catch { setPos(null) }
    finally { setPosLoading(false) }
  }, [])
  useEffect(() => { fetchPos() }, [fetchPos])

  const [jogStep, setJogStep] = useState(1)
  const [targetZ, setTargetZ] = useState('')
  const [jogBusy, setJogBusy] = useState(false)

  const sendGcode = async (gcode, label) => {
    setJogBusy(true)
    try {
      await controlService.sendKlipperGcode(gcode)
      showFeedback(`${label} — gesendet`)
      setTimeout(fetchPos, 1500)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setJogBusy(false) }
  }

  const jogZ    = (delta) => sendGcode(`G91\nG1 Z${delta} F1000\nG90`, `Z ${delta > 0 ? '+' : ''}${delta} mm`)
  const moveToZ = () => {
    const v = parseFloat(targetZ)
    if (isNaN(v)) return showFeedback('Ungültiger Z-Wert', false)
    sendGcode(`G90\nG1 Z${v} F1000`, `Z → ${v} mm`)
  }

  const [macroRunning, setMacroRunning] = useState(null)
  const runMacro = async (macro, label) => {
    setMacroRunning(macro)
    try {
      const r = await controlService.executeMacro({ macro_name: macro })
      if (r.data.success) showFeedback(`${label} — OK`)
      else showFeedback(`${label}: ${r.data.message}`, false)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    } finally { setMacroRunning(null) }
  }

  const anyBusy = macroRunning !== null || jogBusy

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

      {/* ── TOP ROW ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">

        <div className="card space-y-3">
          <p className="section-label">Quick Actions</p>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => runMacro('OTTOEJECT_HOME', 'Home')}                     disabled={anyBusy} className="btn btn-primary btn-sm">Home</button>
            <button onClick={() => runMacro('PARK_OTTOEJECT', 'Park')}                     disabled={anyBusy} className="btn btn-ghost btn-sm">Park</button>
            <button onClick={() => runMacro('OPEN_DOOR_BAMBU_X_ONE_C', 'Tür öffnen')}     disabled={anyBusy} className="btn btn-ghost btn-sm">Tür öffnen</button>
            <button onClick={() => runMacro('CLOSE_DOOR_BAMBU_X_ONE_C', 'Tür schließen')} disabled={anyBusy} className="btn btn-ghost btn-sm">Tür schließen</button>
            <button onClick={() => runMacro('EJECT_FROM_BAMBULAB_X_ONE_C', 'Auswerfen')}   disabled={anyBusy} className="btn btn-warning btn-sm">Auswerfen</button>
            <button onClick={() => runMacro('LOAD_ONTO_BAMBULAB_X_ONE_C', 'Einlegen')}    disabled={anyBusy} className="btn btn-ghost btn-sm">Einlegen</button>
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <p className="section-label">Z Position</p>
            <button onClick={fetchPos} disabled={posLoading} className="btn-icon">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
              </svg>
            </button>
          </div>
          <PositionDisplay pos={pos} loading={posLoading} />
          <div>
            <p className="text-xs text-surface-500 mb-1.5">Jog Schrittweite</p>
            <div className="flex gap-1">
              {[0.1, 0.5, 1, 5, 10].map(s => (
                <button key={s} onClick={() => setJogStep(s)}
                  className={`flex-1 text-xs py-1 rounded border font-mono transition-colors ${
                    jogStep === s ? 'bg-blue-600 border-blue-500 text-white'
                                  : 'bg-surface-800 border-surface-700 text-surface-400 hover:border-surface-500'
                  }`}>{s}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => jogZ(jogStep)}  disabled={anyBusy} className="btn btn-ghost">Z +{jogStep}</button>
            <button onClick={() => jogZ(-jogStep)} disabled={anyBusy} className="btn btn-ghost">Z -{jogStep}</button>
          </div>
          <div className="flex gap-2">
            <input type="number" step="0.1" placeholder="Z Zielwert mm" value={targetZ}
              onChange={e => setTargetZ(e.target.value)} onKeyDown={e => e.key === 'Enter' && moveToZ()}
              className="flex-1 text-xs font-mono" />
            <button onClick={moveToZ} disabled={anyBusy || !targetZ} className="btn btn-cyan btn-sm">Fahren</button>
          </div>
        </div>
      </div>

      {/* ── EINZEL-FACH OPERATIONEN ─────────────────────────────── */}
      <div className="card">
        <p className="section-label mb-4">Einzel-Fach Operationen</p>
        <div className="space-y-2">
          {Array.from({ length: NUM_SLOTS }, (_, i) => i + 1).map(slot => (
            <div key={slot} className="flex items-center gap-3 px-3 py-2.5 rounded-lg bg-surface-900 border border-surface-700">
              <span className="text-sm font-semibold text-surface-300 w-14 flex-shrink-0">Fach {slot}</span>
              <div className="flex gap-2 flex-1">
                <button onClick={() => runMacro(`GRAB_FROM_SLOT_${slot}`, `Fach ${slot} holen`)}    disabled={anyBusy} className="btn btn-cyan btn-sm">Holen</button>
                <button onClick={() => runMacro(`STORE_TO_SLOT_${slot}`, `Fach ${slot} einlagern`)} disabled={anyBusy} className="btn btn-ghost btn-sm">Einlagern</button>
              </div>
              <div className="flex gap-2">
                <button onClick={() => runMacro('LOAD_ONTO_BAMBULAB_X_ONE_C', 'In Drucker laden')}    disabled={anyBusy} className="btn btn-ghost btn-sm text-xs">→ Drucker</button>
                <button onClick={() => runMacro('EJECT_FROM_BAMBULAB_X_ONE_C', 'Aus Drucker nehmen')} disabled={anyBusy} className="btn btn-warning btn-sm text-xs">← Drucker</button>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  )
}

export default Calibration
