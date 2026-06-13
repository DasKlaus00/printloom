import React, { useState, useEffect, useRef, useCallback } from 'react'
import { autofarmService, rackManagerService } from '../services/api'

function fmtDur(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

const PHASES = [
  { id: 'grab_mag',     label: 'Platte aus Magazin holen',  ms: 1400, arm: 'mag'     },
  { id: 'to_printer',   label: 'Zum Drucker fahren',        ms: 1600, arm: 'printer' },
  { id: 'load',         label: 'Platte einlegen',           ms: 700,  arm: 'printer' },
  { id: 'printing',     label: 'Druckt…',                   ms: 5000, arm: 'parked'  },
  { id: 'eject',        label: 'Platte auswerfen',          ms: 1200, arm: 'printer' },
  { id: 'to_rack',      label: 'Zum Regal fahren',          ms: 1600, arm: 'rack'    },
  { id: 'store',        label: 'Platte ins Regal legen',    ms: 700,  arm: 'rack'    },
  { id: 'return',       label: 'Arm zurückfahren',          ms: 1200, arm: 'mag'     },
]

const ARM_X = { mag: 10, printer: 44, rack: 76, parked: -15 }

// Map a step label/value to the nearest animation phase id
function labelToPhaseId(label) {
  const l = (label || '').toLowerCase()
  if (l.includes('holen') || l.includes('grab_from_rack') || l.includes('grab_from_slot') || l.includes('nolift')) return 'grab_mag'
  if (l.includes('einlegen') || l.includes('place_onto') || l.includes('reinschieben') || l.includes('z5')) return 'load'
  if (l.includes('auswerfen') || l.includes('eject')) return 'eject'
  if (l.includes('zurücklegen') || l.includes('store_to_rack')) return 'store'
  if (l.includes('parken') || l.includes('park')) return 'return'
  if (l.includes('vor drucker') || l.includes('move_to_printer')) return 'to_printer'
  if (l.includes('drucker') || l.includes('printer')) return 'to_printer'
  if (l.includes('regal') || l.includes('rack')) return 'to_rack'
  return null
}

export default function Simulator() {
  const [running,       setRunning]       = useState(false)
  const [phaseIdx,      setPhaseIdx]      = useState(0)
  const [printProgress, setPrintProgress] = useState(0)
  const [slots,         setSlots]         = useState([])
  const [magCount,      setMagCount]      = useState(4)
  const [maxPlates,     setMaxPlates]     = useState(4)
  const [numSlots,      setNumSlots]      = useState(6)
  const [totalPrinted,  setTotalPrinted]  = useState(0)
  const [errorCount,    setErrorCount]    = useState(0)
  const [elapsed,       setElapsed]       = useState(0)
  const [speed,         setSpeed]         = useState(1)
  const [log,           setLog]           = useState([])

  // Test-Phase state
  const [testRunning,   setTestRunning]   = useState(false)
  const [testStatus,    setTestStatus]    = useState(null)
  const [seqSteps,      setSeqSteps]      = useState([])
  const [rackData,      setRackData]      = useState(null)
  const [testFeedback,  setTestFeedback]  = useState(null)

  const phaseTimer   = useRef(null)
  const printTimer   = useRef(null)
  const elapsedTimer = useRef(null)
  const testPollRef  = useRef(null)
  const cycleSlot    = useRef(0)
  const magCountRef  = useRef(4)

  const addLog = (msg) => setLog(prev => [`${new Date().toLocaleTimeString('de-DE', {hour:'2-digit',minute:'2-digit',second:'2-digit'})} — ${msg}`, ...prev].slice(0, 40))

  // Load rack data + sequences on mount
  useEffect(() => {
    rackManagerService.getAll().then(r => {
      setRackData(r.data)
      setNumSlots(r.data.slots_per_rack ?? 6)
      setMaxPlates(r.data.max_plates ?? 4)
      setMagCount(r.data.magazine_count ?? r.data.max_plates ?? 4)
      magCountRef.current = r.data.magazine_count ?? r.data.max_plates ?? 4
    }).catch(() => {})
    autofarmService.getSequences().then(r => {
      setSeqSteps(r.data.seq_new ?? [])
    }).catch(() => {})
  }, [])

  // Poll test cycle status when running
  useEffect(() => {
    if (!testRunning) { clearInterval(testPollRef.current); return }
    testPollRef.current = setInterval(async () => {
      try {
        const r = await autofarmService.testCycleStatus()
        setTestStatus(r.data)
        if (!r.data.running) {
          setTestRunning(false)
          addLog('🧪 Test-Phase abgeschlossen')
          clearInterval(testPollRef.current)
        }
      } catch {}
    }, 800)
    return () => clearInterval(testPollRef.current)
  }, [testRunning])

  // When test is running, drive animation phase from real step
  const testPhaseId  = testRunning && testStatus?.step_label ? labelToPhaseId(testStatus.step_label) : null
  const testPhaseIdx = testPhaseId ? PHASES.findIndex(p => p.id === testPhaseId) : -1

  // Init slots
  useEffect(() => {
    setSlots(Array(numSlots).fill('free'))
    cycleSlot.current = 0
  }, [numSlots])

  useEffect(() => {
    magCountRef.current = maxPlates
    setMagCount(maxPlates)
  }, [maxPlates])

  useEffect(() => {
    if (!running) { clearInterval(elapsedTimer.current); return }
    elapsedTimer.current = setInterval(() => setElapsed(e => e + 1), 1000)
    return () => clearInterval(elapsedTimer.current)
  }, [running])

  const advance = useCallback(() => {
    setPhaseIdx(p => (p + 1) % PHASES.length)
  }, [])

  useEffect(() => {
    if (!running) return
    clearTimeout(phaseTimer.current)
    clearInterval(printTimer.current)
    const phase = PHASES[phaseIdx]
    const dur   = Math.max(50, phase.ms / speed)
    if (phase.id === 'printing') {
      setPrintProgress(0)
      const step = dur / 100
      let p = 0
      printTimer.current = setInterval(() => {
        p += 1; setPrintProgress(p)
        if (p >= 100) clearInterval(printTimer.current)
      }, step)
    }
    if (phase.id === 'grab_mag') {
      if (magCountRef.current <= 0) {
        magCountRef.current = maxPlates; setMagCount(maxPlates)
        addLog('📦 Magazin leer — automatisch aufgefüllt')
      } else {
        magCountRef.current -= 1; setMagCount(magCountRef.current)
      }
    }
    if (phase.id === 'store') {
      const idx = cycleSlot.current % numSlots
      setSlots(prev => { const next = [...prev]; next[idx] = 'done'; return next })
      addLog(`✓ Platte in Fach ${idx + 1} abgelegt`)
    }
    if (phase.id === 'return') {
      setTotalPrinted(t => t + 1)
      cycleSlot.current += 1
      setSlots(prev => {
        if (prev.every(s => s === 'done')) {
          addLog('🗑 Regal voll — wird automatisch geleert')
          cycleSlot.current = 0
          return Array(numSlots).fill('free')
        }
        return prev
      })
    }
    phaseTimer.current = setTimeout(advance, dur)
    return () => { clearTimeout(phaseTimer.current); clearInterval(printTimer.current) }
  }, [running, phaseIdx, speed, advance, numSlots, maxPlates])

  const reset = useCallback(() => {
    setRunning(false); setPhaseIdx(0); setPrintProgress(0)
    setSlots(Array(numSlots).fill('free'))
    magCountRef.current = maxPlates; setMagCount(maxPlates)
    setTotalPrinted(0); setElapsed(0); setLog([])
    cycleSlot.current = 0
    clearTimeout(phaseTimer.current); clearInterval(printTimer.current)
  }, [numSlots, maxPlates])

  const startTest = async () => {
    try {
      await autofarmService.testCycle()
      setTestRunning(true)
      setTestStatus(null)
      if (!running) { setRunning(true) }  // start animation alongside
      addLog('🧪 Test-Phase gestartet')
      setTestFeedback(null)
    } catch (e) {
      setTestFeedback(e.response?.data?.detail ?? e.message)
      setTimeout(() => setTestFeedback(null), 4000)
    }
  }

  const stopTest = async () => {
    try { await autofarmService.testCycleStop() } catch {}
    setTestRunning(false)
    setRunning(false)
  }

  // Which phase to show: test-driven or simulation-driven
  const activePhaseIdx = (testRunning && testPhaseIdx >= 0) ? testPhaseIdx : phaseIdx
  const phase          = PHASES[activePhaseIdx] ?? PHASES[phaseIdx]
  const armX           = ARM_X[phase.arm] ?? 10
  const platOnArm      = ['grab_mag', 'to_printer', 'eject', 'to_rack', 'store', 'return'].includes(phase.id)
  const platInPrinter  = ['load', 'printing'].includes(phase.id)

  // Test conditions
  const rackIsEmpty = rackData && Object.values(rackData.slots ?? {}).every(s => s.status === 'free')
  const magFull     = rackData && (rackData.magazine_count ?? 0) >= (rackData.max_plates ?? 1)
  const canTest     = rackIsEmpty && magFull && !running && !testRunning

  // Executable steps for the step list
  const execSteps = seqSteps.filter(s => ['macro', 'klipper_gcode', 'delay'].includes(s.type))

  return (
    <div className="space-y-4 max-w-2xl">

      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-surface-100">Auto-Farm Simulator</h2>
          <p className="text-sm text-surface-500 mt-0.5">
            Visualisiert den Roboter-Ablauf: Magazin → Drucker → Regal.
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
          {/* Test-Phase button */}
          {(canTest || testRunning) && (
            <button
              onClick={testRunning ? stopTest : startTest}
              className={`btn btn-sm ${testRunning ? 'btn-danger' : 'border border-teal-700 text-teal-400 hover:bg-teal-900/20'}`}
            >{testRunning ? '■ Stopp' : '🧪 Test-Phase'}</button>
          )}
          {!canTest && !testRunning && (
            <span className="text-[9px] text-surface-700 font-mono px-1" title="Test-Phase benötigt leeres Regal und volles Magazin">
              {!rackIsEmpty ? 'Regal belegt' : !magFull ? 'Magazin leer' : ''}
            </span>
          )}
          {[1, 2, 5].map(s => (
            <button key={s} onClick={() => setSpeed(s)}
              className={`text-xs font-mono px-2 py-1 rounded border transition-colors ${
                speed === s
                  ? 'border-blue-600 bg-blue-900/30 text-blue-300'
                  : 'border-surface-700 text-surface-600 hover:border-surface-500 hover:text-surface-400'
              }`}
            >{s}×</button>
          ))}
          <button
            onClick={() => setRunning(r => !r)}
            disabled={testRunning}
            className={`btn btn-sm ${running ? 'btn-ghost' : 'btn-primary'} disabled:opacity-40`}
          >{running ? '⏸ Pause' : '▶ Start'}</button>
          <button onClick={reset} disabled={testRunning} className="btn btn-ghost btn-sm disabled:opacity-40">↺</button>
        </div>
      </div>

      {testFeedback && (
        <div className="text-xs text-red-400 border border-red-900/50 bg-red-950/20 px-3 py-2 rounded-lg font-mono">{testFeedback}</div>
      )}

      {/* Stats strip */}
      <div className="flex gap-5 text-sm">
        <span className="font-mono text-surface-500">
          <span className="text-emerald-400 font-bold text-base">{totalPrinted}</span> gedruckt
        </span>
        <span className="font-mono text-surface-500">
          <span className={`font-bold text-base ${errorCount > 0 ? 'text-red-400' : 'text-surface-700'}`}>{errorCount}</span> Fehler
        </span>
        <span className="font-mono text-surface-500">
          <span className="text-blue-400 font-bold text-base">{fmtDur(elapsed)}</span> simuliert
        </span>
        {testRunning && testStatus && (
          <span className="font-mono text-surface-500 ml-auto">
            <span className="text-teal-400 text-[10px]">🧪 {testStatus.step_idx + 1}/{testStatus.step_total}</span>
          </span>
        )}
      </div>

      {/* Main scene */}
      <div className="card overflow-hidden p-0">

        {/* Status bar */}
        <div className={`flex items-center gap-2.5 px-4 py-3 border-b border-surface-800/50 ${
          phase.id === 'printing' ? 'bg-blue-950/20' : testRunning ? 'bg-teal-950/10' : ''
        }`}>
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            testRunning ? 'bg-teal-400 animate-pulse' :
            running ? (phase.id === 'printing' ? 'bg-blue-400 animate-pulse' : 'bg-emerald-400 animate-pulse') : 'bg-surface-700'
          }`} />
          <span className="text-sm font-mono text-surface-200">
            {testRunning && testStatus?.step_label ? testStatus.step_label : phase.label}
          </span>
          {phase.id === 'printing' && (
            <span className="ml-auto text-sm font-mono text-blue-400 font-bold">{printProgress}%</span>
          )}
        </div>

        {/* Animation scene */}
        <div className="relative h-52 bg-surface-950/50 overflow-hidden px-3 py-4">
          <div className="absolute left-[8%] right-[8%] bg-surface-800/40 rounded-full" style={{ top: '68%', height: '1px' }} />

          {/* MAGAZINE station */}
          <div className="absolute flex flex-col items-center" style={{ left: '3%', top: '8%', width: '18%' }}>
            <p className="text-[8px] text-surface-600 uppercase tracking-widest mb-1.5">Magazin</p>
            <div className="w-full border border-surface-700/50 rounded-lg p-1.5 flex flex-col-reverse gap-1">
              {Array.from({ length: maxPlates }, (_, i) => (
                <div key={i} className={`w-full rounded-sm transition-colors ${
                  i < magCount
                    ? 'bg-blue-900/60 border border-blue-700/50 h-4'
                    : 'bg-transparent border border-dashed border-surface-800/30 h-4'
                }`} />
              ))}
            </div>
            <p className="text-[9px] font-mono text-surface-500 mt-1">{magCount}/{maxPlates}</p>
          </div>

          {/* PRINTER station */}
          <div className="absolute flex flex-col items-center" style={{ left: '36%', top: '8%', width: '26%' }}>
            <p className="text-[8px] text-surface-600 uppercase tracking-widest mb-1.5">Drucker</p>
            <div className={`w-full border rounded-xl p-2.5 flex flex-col gap-2 transition-colors ${
              phase.id === 'printing' ? 'border-blue-700/60 bg-blue-950/25' : 'border-surface-700/50 bg-transparent'
            }`}>
              <div className={`w-full h-5 rounded-md transition-all ${
                platInPrinter ? 'bg-blue-800/70 border border-blue-600/60' : 'bg-surface-800/30 border border-dashed border-surface-700/25'
              }`} />
              {phase.id === 'printing' ? (
                <div className="w-full bg-surface-800 rounded-full overflow-hidden" style={{ height: '3px' }}>
                  <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${printProgress}%` }} />
                </div>
              ) : (
                <p className="text-[8px] text-surface-700 text-center">{platInPrinter ? 'eingelegt' : 'leer'}</p>
              )}
            </div>
          </div>

          {/* RACK station */}
          <div className="absolute flex flex-col items-center" style={{ right: '3%', top: '8%', width: '18%' }}>
            <p className="text-[8px] text-surface-600 uppercase tracking-widest mb-1.5">Regal</p>
            <div className="w-full border border-surface-700/50 rounded-lg p-1.5 flex flex-col-reverse gap-0.5">
              {slots.map((status, i) => (
                <div key={i} className="flex items-center gap-1">
                  <span className="text-[7px] text-surface-700 w-3 text-right">{i + 1}</span>
                  <div className={`flex-1 rounded-sm transition-all ${
                    status === 'done' ? 'bg-amber-900/60 border border-amber-700/50 h-4' : 'bg-surface-800/20 border border-dashed border-surface-800/30 h-4'
                  }`} />
                </div>
              ))}
            </div>
            <p className="text-[9px] font-mono text-surface-500 mt-1">{slots.filter(s => s === 'done').length}/{numSlots}</p>
          </div>

          {/* Moving arm + plate */}
          <div
            className="absolute flex items-center gap-0.5"
            style={{
              bottom: '28%',
              left: `${armX}%`,
              transition: `left ${Math.max(50, PHASES[activePhaseIdx >= 0 ? activePhaseIdx : phaseIdx]?.ms ?? 1000 / speed)}ms ease-in-out, opacity 200ms`,
              opacity: phase.arm === 'parked' ? 0 : 1,
            }}
          >
            <div className="w-px bg-violet-500/70 rounded-full" style={{ height: '28px' }} />
            {platOnArm && (
              <div className="rounded-sm bg-blue-800/80 border border-blue-500/60 flex items-center justify-center"
                   style={{ width: '36px', height: '20px' }}>
                <span className="text-[7px] text-blue-300 font-mono">PLATE</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Test-Phase: sequence step list */}
      {(testRunning || (testStatus && execSteps.length > 0)) && execSteps.length > 0 && (
        <div className="card">
          <p className="section-label mb-2">Test-Phase — Sequenz-Schritte</p>
          <div className="space-y-0.5 max-h-48 overflow-y-auto">
            {execSteps.map((step, i) => {
              const isCur = testRunning && testStatus && i === testStatus.step_idx
              const isDone = testRunning && testStatus && i < testStatus.step_idx
              return (
                <div key={step.id ?? i}
                  className={`flex items-center gap-2 px-2 py-1 rounded transition-colors text-[11px] font-mono ${
                    isCur  ? 'bg-teal-900/30 border border-teal-700/60 text-teal-300' :
                    isDone ? 'text-surface-700' :
                    'text-surface-500'
                  }`}
                >
                  {isCur  && <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse shrink-0" />}
                  {isDone && <span className="text-emerald-700 shrink-0">✓</span>}
                  {!isCur && !isDone && <span className="w-1.5 h-1.5 rounded-full bg-surface-700 shrink-0" />}
                  <span className="truncate">{step.label || step.value}</span>
                  {step.type === 'delay' && <span className="text-surface-700 ml-auto shrink-0">{step.seconds}s</span>}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Config + Log */}
      <div className="grid grid-cols-2 gap-3">
        <div className="card">
          <p className="section-label mb-3">Konfiguration</p>
          <div className="space-y-2.5">
            <div>
              <label className="text-[10px] text-surface-600 block mb-1">Regal-Fächer</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setNumSlots(s => Math.max(1, s - 1))} className="w-6 h-6 border border-surface-700 rounded text-surface-500 hover:text-surface-200 text-sm">−</button>
                <span className="flex-1 text-center font-mono text-sm text-surface-200">{numSlots}</span>
                <button onClick={() => setNumSlots(s => Math.min(12, s + 1))} className="w-6 h-6 border border-surface-700 rounded text-surface-500 hover:text-surface-200 text-sm">+</button>
              </div>
            </div>
            <div>
              <label className="text-[10px] text-surface-600 block mb-1">Magazin-Kapazität</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setMaxPlates(m => { const n = Math.max(1, m-1); setMagCount(c => Math.min(c, n)); return n })} className="w-6 h-6 border border-surface-700 rounded text-surface-500 hover:text-surface-200 text-sm">−</button>
                <span className="flex-1 text-center font-mono text-sm text-surface-200">{maxPlates}</span>
                <button onClick={() => setMaxPlates(m => Math.min(10, m + 1))} className="w-6 h-6 border border-surface-700 rounded text-surface-500 hover:text-surface-200 text-sm">+</button>
              </div>
            </div>
            <div className="border-t border-surface-800/40 pt-2">
              <p className="text-[9px] text-surface-700">Regal voll → automatisch geleert.<br />Magazin leer → automatisch aufgefüllt.</p>
            </div>
          </div>
        </div>

        <div className="card">
          <p className="section-label mb-2">Aktivität</p>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {log.length === 0 ? (
              <p className="text-[9px] text-surface-700 py-2">Noch keine Aktivität</p>
            ) : log.map((entry, i) => (
              <p key={i} className="text-[9px] font-mono text-surface-500 leading-tight">{entry}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Phase timeline */}
      <div className="card">
        <p className="section-label mb-3">Ablauf</p>
        <div className="flex gap-1 flex-wrap">
          {PHASES.map((p, i) => (
            <div key={p.id} className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[9px] font-mono border transition-colors ${
              i === activePhaseIdx && (running || testRunning)
                ? (testRunning ? 'border-teal-700/60 bg-teal-950/20 text-teal-300' : 'border-blue-700/60 bg-blue-950/20 text-blue-300')
                : 'border-surface-800/30 bg-transparent text-surface-600'
            }`}>
              {i === activePhaseIdx && (running || testRunning) && (
                <span className={`w-1 h-1 rounded-full animate-pulse ${testRunning ? 'bg-teal-400' : 'bg-blue-400'}`} />
              )}
              {p.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
