import React, { useState, useEffect, useCallback, useRef } from 'react'
import { PageTitle } from '../components/PageHeader'
import { createPortal } from 'react-dom'
import { apiError } from '../services/apiError'
import { withBase } from '../services/basePath'
import { rackManagerService, fileService, deviceService, printerService, controlService, autofarmService, deviceSettingsService, systemService } from '../services/api'
import { parseNumber, rackSaveError } from '../services/rackForm'
import { ResponsiveDashboardGrid, PANELS, ROW_HEIGHT } from '../components/DashboardGrid'
import {
  FARM_BREAKPOINTS, FARM_COLS, FARM_LAYOUTS, FARM_GRID_VERSION, migrateFarmLayout, mergeChange, shouldPersist,
} from '../services/dashboardLayout'
import { parseSlotKey, slotsNeeded, autoSlot, slotTolerance, slotForRow } from '../services/rackUtils'
import { amsMissing } from '../services/amsUtils'
import { useQueueEta, fmtDur, getCachedMeta } from '../services/useQueueEta'
import { useFarmStatusStream } from '../services/useFarmStatusStream'
import { usePageActive, useAutoRefresh } from '../services/useAutoRefresh'
import { useLanguage, tr as translate, locale } from '../services/i18n'
import RecoveryBanner from '../components/RecoveryBanner'
import { mergeServerJobs, pendingOrder } from '../services/queueModel'
import { confirmDialog } from '../services/confirm'
import PrinterOverview from '../components/PrinterOverview'
import { AmsPreview, AmsMapper } from '../components/farm/Ams'
import { CameraPanel } from '../components/farm/Camera'
import QueuePlanner from '../components/farm/QueuePlanner'
import { pickFarmPrinter } from '../services/farmPrinter'

/* Snapshot eines Jobs — blendet sich aus, wenn kein Bild da ist (z. B. keine
   Webcam am Drucker → 404), statt ein kaputtes Bild-Icon zu zeigen. */
function JobSnapshot({ name }) {
  const [err, setErr] = useState(false)
  if (!name || err) return null
  const src = withBase(`/api/printer/snapshots/${name}`)
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block w-fit">
      <img src={src} alt="Snapshot" onError={() => setErr(true)}
        className="h-16 rounded border border-surface-700 object-cover" />
    </a>
  )
}
async function checkPreflight(bambuId, tr = (s) => s) {
  const errors = []
  try {
    await printerService.getStatus(bambuId)
    // Printer may already be running — continuous mode handles that
  } catch {
    errors.push(tr('Drucker nicht erreichbar — Verbindung prüfen'))
  }
  try {
    const r = await controlService.getKlipperInfo()
    if (!r.data.ready) {
      const stateMsg = r.data.state_message ? `: ${r.data.state_message}` : ''
      errors.push(tr('OTTOeject nicht bereit ({0}{1}) — bitte Firmware neu starten', r.data.state, stateMsg))
    }
  } catch {
    errors.push(tr('OTTOeject nicht erreichbar — Verbindung prüfen'))
  }
  return errors
}

const S = {
  pending:  { label: 'Wartet',        dot: 'dot-gray',  color: 'text-surface-500' },
  running:  { label: 'Läuft…',        dot: 'dot-blue',  color: 'text-blue-400',   pulse: true },
  printing: { label: 'Druckt…',       dot: 'dot-green', color: 'text-emerald-400', pulse: true },
  sending:  { label: 'Datei senden',  dot: 'dot-blue',  color: 'text-blue-400'   },
  done:     { label: 'Fertig',        dot: 'dot-green', color: 'text-emerald-400' },
  error:    { label: 'Fehler',        dot: 'dot-red',   color: 'text-red-400'    },
}


const TEMPLATES_KEY = 'ottomat3d_queue_templates'
const loadTemplates = () => {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}') } catch { return {} }
}

const RACK_DOT   = { free: 'dot-gray', ready: 'dot-green', printing: 'dot-blue', done: 'dot-amber', locked: 'dot-red' }
const RACK_COL   = { free: 'text-surface-600', ready: 'text-emerald-400', printing: 'text-blue-400', done: 'text-amber-400', locked: 'text-red-400' }
const RACK_LABEL = { free: 'Leer', ready: 'Bereit', printing: 'Druckt', done: 'Fertig', locked: 'Gesperrt' }

/* ── Aktueller Schritt (Dashboard-Panel) ──────────────────────
   idle=true → zeigt auch im Leerlauf einen Platzhalter (sonst leeres Panel). */
function CurrentStep({ farmStatus, idle }) {
  const { tr } = useLanguage()
  const active = farmStatus?.running && farmStatus?.seq_step_label
  if (!active) {
    if (!idle) return null
    return (
      <div className="card p-2.5">
        <p className="section-label mb-1">{tr('Aktueller Schritt')}</p>
        <p className="text-[10px] text-surface-600">{tr('Kein aktiver Schritt')}</p>
      </div>
    )
  }
  return (
    <div className="card p-2.5 bg-blue-950/20 border-blue-800/40">
      <p className="section-label mb-1">{tr('Aktueller Schritt')}</p>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        <p className="text-[10px] font-mono text-blue-300 truncate">{tr(farmStatus.seq_step_label)}</p>
      </div>
    </div>
  )
}

/* ── Farm-Visualisierung: Ablauf-Phasen ─── */
function FarmViz({ farmStatus, jobs, curJobId }) {
  const { tr } = useLanguage()
  const curJob     = jobs.find(j => j.id === curJobId)
  const isPrinting = curJob?.status === 'printing'

  const PHASES = [
    { id: 'grab_mag',   label: 'Leere Platte holen' },   // Magazin, Lagerfach oder Kompakt-Regal
    { id: 'to_printer', label: 'Zum Drucker' },
    { id: 'load',       label: 'Einlegen' },
    { id: 'printing',   label: 'Druckt…' },
    { id: 'eject',      label: 'Auswerfen' },
    { id: 'to_rack',    label: 'Zum Regal' },
    { id: 'store',      label: 'Einlagern' },
    { id: 'return',     label: 'Zurück' },
  ]

  const seqLabel = farmStatus?.seq_step_label?.toLowerCase() ?? ''
  let activePhase = null
  if (isPrinting) activePhase = 'printing'
  else if (seqLabel.includes('holen') || seqLabel.includes('grab') || seqLabel.includes('magazin')) activePhase = 'grab_mag'
  else if (seqLabel.includes('einlegen') || seqLabel.includes('load')) activePhase = 'load'
  else if (seqLabel.includes('auswerfen') || seqLabel.includes('eject')) activePhase = 'eject'
  else if (seqLabel.includes('einlagern') || seqLabel.includes('store')) activePhase = 'store'
  else if (seqLabel.includes('regal') || seqLabel.includes('rack')) activePhase = 'to_rack'
  else if (seqLabel.includes('drucker') || seqLabel.includes('printer')) activePhase = 'to_printer'
  else if (seqLabel.includes('zurück') || seqLabel.includes('park')) activePhase = 'return'

  const running = farmStatus?.running

  return (
    <div className="space-y-2">
      {/* Ablauf-Phasen — der „Aktuelle Schritt" sitzt jetzt oben in der Sidebar (CurrentStep) */}
      <div className="card p-2.5 space-y-0.5">
        {PHASES.map(p => (
          <div key={p.id} className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[10px] font-mono transition-colors ${
            activePhase === p.id && running
              ? 'bg-blue-900/30 text-blue-300'
              : 'text-surface-700'
          }`}>
            {activePhase === p.id && running
              ? <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse shrink-0" />
              : <span className="w-1 h-1 rounded-full bg-surface-800 shrink-0" />}
            {tr(p.label)}
          </div>
        ))}
      </div>
    </div>
  )
}

const HIDE_CAM2_KEY    = 'printloom_autofarm_hide_cam2'  // untere (hochkant) Kamera ausblenden

function AutoFarm({ setCurrentPage } = {}) {
  const { tr } = useLanguage()
  const [gcodeFiles,      setGcodeFiles]      = useState([])
  const [rackData,        setRackData]        = useState(null)
  const [bambuId,         setBambuId]         = useState(null)
  const [webcamUrl,       setWebcamUrl]       = useState('')        // untere (hochkant) Kamera
  const [webcamUrlTop,    setWebcamUrlTop]    = useState('')        // obere (Bambu / quer) Kamera
  const [haCamReady,      setHaCamReady]      = useState(false)     // X1C-Cam via Home Assistant
  const [cameraOn,        setCameraOn]        = useState(true)      // Kamera-Toggle (Anzeige + Snapshots)
  const [hideCam2,        setHideCam2]        = useState(() => localStorage.getItem(HIDE_CAM2_KEY) === '1')  // untere Kamera aus
  const toggleCam2 = useCallback(() => {
    setHideCam2(v => { const next = !v; localStorage.setItem(HIDE_CAM2_KEY, next ? '1' : '0'); return next })
  }, [])
  const [jobs,            setJobs]            = useState([])
  const [farmStatus,      setFarmStatus]      = useState(null)
  const [feedback,        setFeedback]        = useState(null)
  const [showSettings,    setShowSettings]    = useState(false)
  const [pollInterval,    setPollInterval]    = useState(20)
  const [minPrintMinutes, setMinPrintMinutes] = useState(0)
  const [useAms,          setUseAms]          = useState(true)
  const [exactColorOnly,  setExactColorOnly]  = useState(false)   // 1.4: nur exakte Farbe (read-only; gesetzt in Configuration)
  const [queueError,      setQueueError]      = useState('')
  const [queueLoaded,     setQueueLoaded]     = useState(false)
  const [homingFile,      setHomingFile]      = useState(null)   // {configured, file_id, filename}
  const [homingSetupBusy, setHomingSetupBusy] = useState(false)
  const [addFileId,       setAddFileId]       = useState(null)
  const [addCount,        setAddCount]        = useState(1)
  const [templates,       setTemplates]       = useState(loadTemplates)
  const [tplOpen,         setTplOpen]         = useState(false)
  // Lage des Vorlagen-Menüs (fixed, am Knopf ausgerichtet; nach oben, wenn unten kein Platz).
  const tplBtnRef  = useRef(null)
  const tplMenuRef = useRef(null)
  const [tplPos, setTplPos] = useState(null)
  const [tplName,         setTplName]         = useState('')
  const [plannerOpen,     setPlannerOpen]     = useState(false)
  const [showDone,        setShowDone]        = useState(false)   // fertige Jobs ausgeblendet (→ Historie)
  const [filePlates,      setFilePlates]      = useState([])     // plate numbers in selected file (multi-plate .3mf) → ALL get added as jobs
  const [amsSlots,        setAmsSlots]        = useState([])
  const [amsLoading,      setAmsLoading]      = useState(false)
  const [amsOpenIds,      setAmsOpenIds]      = useState(() => new Set())
  const [showRackCfg,    setShowRackCfg]     = useState(false)
  const [rackCfgNr,      setRackCfgNr]       = useState(3)
  const [rackCfgSpr,     setRackCfgSpr]      = useState(6)
  const [rackCfgH,       setRackCfgH]        = useState(50)
  const [stackRack,      setStackRack]       = useState(1)
  const [stackSlot,      setStackSlot]       = useState(7)
  const [maxPlates,       setMaxPlates]       = useState(4)
  const [heightMarginPct, setHeightMarginPct] = useState(15)
  // Frei konfigurierbares Dashboard (Position/Größe/Ein-Aus der Panels, serverseitig)
  const [editingDash, setEditingDash] = useState(false)
  // Je Rasterbreite eine Anordnung (seit v1.1.68), wie auf der Startseite.
  const [dashLayouts, setDashLayouts] = useState(FARM_LAYOUTS)
  const [dashHidden,  setDashHidden]  = useState([])
  const [logFilter,   setLogFilter]   = useState('')   // Q2: Aktivitäts-Log durchsuchen
  const [dragId,      setDragId]      = useState(null) // Q1: gezogener Job (Drag-&-Drop)
  const dashSaveRef   = useRef(null)
  const rootRef       = useRef(null)   // Q3: Sichtbarkeits-Check für Tastenkürzel
  const logFilterRef  = useRef(null)
  const togglePauseRef = useRef(null)
  const dashLoadedRef = useRef(false)
  const prevRunningRef = useRef(false)
  const pollTimerRef = useRef(null)
  const runningRef  = useRef(false)
  const rackDataRef = useRef(null)

  const running  = farmStatus?.running  ?? false
  const [recoveryPing, setRecoveryPing] = useState(0)
  const paused   = farmStatus?.paused   ?? false
  const farmLog  = farmStatus?.log      ?? []
  // Use current_job_id from backend; fall back to finding any active job
  const curJobId = farmStatus?.current_job_id
    ?? farmStatus?.jobs?.find(j => ['running', 'printing', 'sending'].includes(j.status))?.id
    ?? null
  const seqProgress = (farmStatus?.seq_step_total > 0) ? {
    idx:   farmStatus.seq_step_idx,
    total: farmStatus.seq_step_total,
    label: farmStatus.seq_step_label,
  } : null

  runningRef.current  = running
  rackDataRef.current = rackData

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 5000)
  }

  // Kamera an/aus: blendet Livebild aus und stoppt (auto.) Snapshots. Persistiert
  // pro Drucker; andere Ansichten ziehen über das cameraSettingsSaved-Event nach.
  const toggleCamera = useCallback(async () => {
    if (!bambuId) return
    const next = !cameraOn
    setCameraOn(next)
    try {
      await deviceSettingsService.updateSettings(bambuId, { camera_enabled: next })
      window.dispatchEvent(new CustomEvent('printloom:cameraSettingsSaved'))
    } catch {
      setCameraOn(!next)  // bei Fehler zurückrollen
      showFeedback(tr('Kamera-Status konnte nicht gespeichert werden'), false)
    }
  }, [bambuId, cameraOn])

  /* ── Dashboard-Layout laden/speichern (serverseitig, global) ─── */
  useEffect(() => {
    systemService.getDashboardLayout()
      .then(r => {
        const d = r.data || {}
        // Alte Fassungen (EIN Layout, Raster-Version 1/2) heben, dann bereinigen.
        setDashLayouts(migrateFarmLayout(d))
        if (Array.isArray(d.hidden)) setDashHidden(d.hidden)
      })
      .catch(() => {})
      .finally(() => { dashLoadedRef.current = true })
  }, [])

  // `layout` (= lg) bleibt mit gespeichert: Eine ältere Version (bis v1.1.67) liest nur das.
  const persistDash = useCallback((layouts, hidden) => {
    if (!dashLoadedRef.current) return          // nicht während des Erst-Ladens speichern
    clearTimeout(dashSaveRef.current)
    dashSaveRef.current = setTimeout(() => {
      systemService.saveDashboardLayout({ layouts, layout: layouts.lg, hidden, grid_v: FARM_GRID_VERSION })
        .catch(e => console.warn('Layout nicht gespeichert:', e?.message || e))
    }, 600)
  }, [])

  // RGL meldet nur die sichtbaren Items — in den Gesamt-Layout-Stand einmischen,
  // damit ausgeblendete Panels ihre Position/Größe behalten.
  // Nur im Bearbeiten-Modus (siehe Dashboard.jsx): Seitenwechsel und Breitenänderung
  // melden ebenfalls ein Layout; gespeichert wurde es bis v1.1.66 jedes Mal.
  const editingDashRef = useRef(false)
  editingDashRef.current = editingDash
  const onDashLayoutChange = useCallback((_cur, all) => {
    if (!all || !shouldPersist({ editing: editingDashRef.current, loaded: dashLoadedRef.current })) return
    setDashLayouts(prev => {
      const next = mergeChange(prev, all)
      persistDash(next, dashHidden)
      return next
    })
  }, [dashHidden, persistDash])

  const toggleDashPanel = useCallback((id) => {
    setDashHidden(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      persistDash(dashLayouts, next)
      return next
    })
  }, [dashLayouts, persistDash])

  const resetDash = useCallback(() => {
    setDashLayouts(FARM_LAYOUTS)
    setDashHidden([])
    dashLoadedRef.current = true
    systemService.saveDashboardLayout({ layouts: FARM_LAYOUTS, layout: FARM_LAYOUTS.lg, hidden: [],
                                        grid_v: FARM_GRID_VERSION })
      .catch(e => console.warn('Layout nicht gespeichert:', e?.message || e))
    showFeedback(tr('Dashboard auf Standard zurückgesetzt'))
  }, [])

  const fetchAmsSlots = useCallback(async () => {
    if (!bambuId) { setAmsSlots([]); return }
    setAmsLoading(true)
    try {
      const r   = await printerService.getStatus(bambuId)
      const raw = r.data?.ams?.ams ?? []
      const slots = []
      for (const unit of raw) {
        const uid = +unit.id
        for (const tray of (unit.tray ?? [])) {
          // Loaded = has a material type; remain (-1 = unknown) does NOT mean empty.
          const type = tray.tray_type || tray.tray_sub_brands || ''
          if (!type) continue
          slots.push({
            gid:   uid * 4 + +tray.id,
            type,
            color: (tray.tray_color || '').replace('#','').slice(0,6),
          })
        }
      }
      setAmsSlots(slots)
    } catch { setAmsSlots([]) }
    setAmsLoading(false)
  }, [bambuId])

  /* ── Warteschlange vom Server (Status/WebSocket), immer ─────────
     Seit v1.1.58 führt der Server die Liste auch ohne Lauf. Die Seite übernimmt
     Reihenfolge und Stand und hält nur ihre Analyse (Filamente …) je Job-ID. */
  useEffect(() => {
    if (!Array.isArray(farmStatus?.jobs)) return
    setJobs(prev => mergeServerJobs(prev, farmStatus.jobs))
  }, [farmStatus])

  // Filamente für Jobs nachladen, die noch keine haben (z. B. aus der Datei-
  // Bibliothek in die laufende Farm gelegt) — plattengenau, damit der AMS-Mapper
  // die richtige Farbe zeigt statt „Keine Filament-Info". Pro Job nur einmal.
  const filReqRef = useRef(new Set())
  useEffect(() => {
    jobs.forEach(j => {
      if (j.fileId && j.filaments === undefined && !filReqRef.current.has(j.id)) {
        filReqRef.current.add(j.id)
        autofarmService.getFileFilaments(j.fileId, j.plate)
          .then(r => setJobField(j.id, { filaments: r.data.filaments ?? [] }))
          .catch(() => setJobField(j.id, { filaments: [] }))
      }
    })
  }, [jobs]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Fächer werden NICHT vorab angezeigt ─────────────────────
     Wartende Jobs behalten den Platzhalter '1-0' (Anzeige „Auto"). Wo eine
     Platte hinkommt, berechnet der Server LIVE erst beim Druckstart anhand des
     aktuellen Regalzustands — nur der startende/druckende Job erscheint dann im
     Regal, die wartenden bewusst nicht. (Früher gab es hier eine Vorschau.) */

  /* Tab-Titel: App.jsx (services/tabTitle.js) — eine Stelle. */


  /* ── Farm status polling ─────────────────────────────────── */
  const fetchStatus = useCallback(async () => {
    try {
      const r = await autofarmService.getStatus()
      setFarmStatus(r.data)
    } catch {}
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // P6: Status kommt live per WebSocket (mit HTTP-Poll-Fallback) — ersetzt das
  // bisherige 5s-Status-Polling. fetchStatus bleibt für sofortige Updates nach
  // Aktionen (Start/Stop/Pause) erhalten.
  useFarmStatusStream(setFarmStatus)

  // Auto-stop notification — only fires when farm stopped on its own (not manual)
  useEffect(() => {
    const nowRunning = farmStatus?.running ?? false
    if (prevRunningRef.current && !nowRunning && farmStatus?.stop_reason === 'completed') {
      showFeedback(tr('✓ Alle Jobs abgearbeitet — Auto Farm beendet'))
    }
    prevRunningRef.current = nowRunning
  }, [farmStatus?.running, farmStatus?.stop_reason]) // eslint-disable-line react-hooks/exhaustive-deps

  const pageActive = usePageActive()

  // Vorlagen-Menü: Lage, Schließen (erst NACH pageActive — sonst Zugriff vor der Deklaration).
  useEffect(() => {
    if (!tplOpen) { setTplPos(null); return undefined }
    if (!pageActive) { setTplOpen(false); return undefined }
    const r = tplBtnRef.current?.getBoundingClientRect()
    if (!r) return undefined
    const right = Math.max(8, window.innerWidth - r.right)
    const unten = window.innerHeight - r.bottom
    setTplPos(unten < 320 && r.top > unten
      ? { right, bottom: window.innerHeight - r.top + 4, top: 'auto' }
      : { right, top: r.bottom + 4, bottom: 'auto' })
    const close = () => setTplOpen(false)
    const onDown = (e) => {
      if (tplMenuRef.current?.contains(e.target) || tplBtnRef.current?.contains(e.target)) return
      close()
    }
    const onKey = (e) => { if (e.key === 'Escape') close() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [tplOpen, pageActive])
  useEffect(() => {
    if (running && pageActive) {
      // Status läuft jetzt über den WebSocket (P6). Während die Farm läuft ziehen
      // wir nur noch das Regal nach, damit fertige Fächer sofort „fertig" werden —
      // aber nur solange die Seite sichtbar ist (versteckt: kein Polling).
      const poll = () => {
        rackManagerService.getAll().then(r => setRackData(r.data)).catch(() => {})
      }
      poll()
      pollTimerRef.current = setInterval(poll, 5000)
    } else {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [running, pageActive])

  // Farm-Einstellungen nur LESEN: Diese Seite hat keine Eingabe dafür (die stehen in
  // der Konfiguration). Bis v1.1.47 schrieb ein Effekt sie nach jedem Laden zurück,
  // nach einem Ladefehler also die Vorgaben über die echten Werte.
  const loadSettings = useCallback(() => autofarmService.getSettings()
    .then(r => {
      setPollInterval(Math.max(1, r.data.poll_interval ?? 20))
      setMinPrintMinutes(r.data.min_print_minutes ?? 0)
      setUseAms(r.data.use_ams ?? true)
      setExactColorOnly(!!r.data.exact_color_only)
      return r.data
    }), [])
  useEffect(() => {
    loadSettings().catch(e => console.warn('Farm-Einstellungen nicht geladen:', e?.message || e))
    autofarmService.getHomingFileInfo()
      .then(r => setHomingFile(r.data))
      .catch(() => {})
  }, [loadSettings])

  // Gespeichert wird die Warteschlange erst, NACHDEM sie geladen ist. Bis v1.1.47
  // galt sie auch nach einem Ladefehler als geladen, und 800 ms später speicherte
  // die Seite die leere Liste über die echte Warteschlange.
  const loadQueue = useCallback(() => {
    setQueueError('')
    return autofarmService.getQueue()
      .then(r => {
        setJobs(prev => mergeServerJobs(prev, r.data ?? []))
        setQueueLoaded(true)
      })
      .catch(e => setQueueError(apiError(e)))
  }, [])
  // Antwort einer Änderung (enthält die neue Liste) sofort übernehmen.
  const applyServer = (r) => { if (Array.isArray(r?.data?.jobs)) setJobs(prev => mergeServerJobs(prev, r.data.jobs)) }
  useEffect(() => { loadQueue() }, [loadQueue])

  // Neu laden, wenn eine andere Seite einreiht oder der Tab wieder sichtbar wird.
  useEffect(() => {
    // Bibliothek, Historie oder OrcaSlicer haben eingereiht: die Liste des Servers holen.
    const reload = () => { loadQueue(); if (runningRef.current) fetchStatus() }
    const onFocus = () => { if (document.visibilityState === 'visible') reload() }
    window.addEventListener('printloom:queueChanged', reload)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('printloom:queueChanged', reload)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [fetchStatus]) // eslint-disable-line react-hooks/exhaustive-deps
  // Bis v1.1.57 stand hier ein Effekt, der die ganze lokale Liste 800 ms nach jeder
  // Änderung zurückschrieb (PUT /queue) — samt Löschen dessen, was anderswo dazukam.

  /* ── Load ────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    const [r, f, d, fp] = await Promise.allSettled([
      rackManagerService.getAll(),
      fileService.listFiles(),
      deviceService.listDevices(),
      autofarmService.getFarmPrinter(),
    ])
    if (r.status === 'fulfilled') {
      const rd = r.value.data
      setRackData(rd)
      setRackCfgNr(rd.num_racks      ?? 3)
      setRackCfgSpr(rd.slots_per_rack ?? 6)
      setRackCfgH(rd.slot_height_mm  ?? 50)
      setStackRack(rd.stack_rack     ?? 1)
      setStackSlot(rd.stack_slot     ?? 7)
      setMaxPlates(rd.max_plates ?? 4)
      setHeightMarginPct(rd.height_margin_pct ?? 15)
    }
    if (f.status === 'fulfilled') {
      const files = (f.value.data.files ?? []).filter(x => x.file_type === '.gcode' || x.file_type === '.3mf')
      setGcodeFiles(files)
      setAddFileId(prev => prev ?? files[0]?.id ?? null)
    }
    if (d.status === 'fulfilled') {
      // Der Drucker der Farm (Server), nicht mehr „der erste Bambu“: seit v1.1.87
      // kann es ein Snapmaker U1 sein.
      const b = pickFarmPrinter(d.value.data, fp.status === 'fulfilled' ? fp.value.data?.device_id : null)
      if (b) {
        setBambuId(b.id)
        deviceSettingsService.getSettings(b.id)
          .then(s => {
            setWebcamUrl(s.data?.webcam_url || ''); setWebcamUrlTop(s.data?.webcam_url_top || '')
            setHaCamReady(!!(s.data?.ha_url && s.data?.ha_camera && s.data?.ha_token_set))
            setCameraOn(s.data?.camera_enabled !== false)
          })
          .catch(() => {})
      }
    }
    if ([r, f, d].some(x => x.status === 'rejected')) {
      showFeedback(tr('Einige Daten konnten nicht geladen werden'), false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /* ── Live refresh: keep file dropdown + rack viz current ─────
     load() runs once on mount and App.jsx keeps this page mounted, so
     without this the file list and rack state stay stale until a full
     page reload. Only refreshes the volatile live data (not the rack
     config modal fields), so it won't clobber in-progress edits. */
  const refreshLiveData = useCallback(async () => {
    const [r, f] = await Promise.allSettled([
      rackManagerService.getAll(),
      fileService.listFiles(),
    ])
    if (r.status === 'fulfilled') setRackData(r.value.data)
    if (f.status === 'fulfilled') {
      const files = (f.value.data.files ?? []).filter(x => x.file_type === '.gcode' || x.file_type === '.3mf')
      setGcodeFiles(files)
      setAddFileId(prev => prev ?? files[0]?.id ?? null)
    }
  }, [])

  // Beim (Wieder-)Aktivwerden der Seite Rack + Dateiliste auffrischen — kein F5
  // mehr nötig, wenn sich zwischenzeitlich etwas geändert hat (kein Polling).
  useAutoRefresh(refreshLiveData, 0)

  // Load live AMS slots up front so the queue can flag filament mismatches
  // ("manuelle AMS-Festlegung notwendig") before the farm is even started.
  useEffect(() => { if (bambuId) fetchAmsSlots() }, [bambuId, fetchAmsSlots])

  // Detect multi-plate .3mf for the file selected in the "add job" picker.
  useEffect(() => {
    const fid = addFileId ?? gcodeFiles[0]?.id
    const f   = gcodeFiles.find(x => x.id === fid)
    if (!fid || f?.file_type !== '.3mf') { setFilePlates([]); return }
    let cancelled = false
    printerService.getPlates(fid)
      .then(r => {
        if (cancelled) return
        const plates = r.data?.plates ?? []
        setFilePlates(plates.length > 1 ? plates : [])   // >1 → beim Hinzufügen wird je Platte ein Job angelegt
      })
      .catch(() => { if (!cancelled) setFilePlates([]) })
    return () => { cancelled = true }
  }, [addFileId, gcodeFiles])

  // Sync rack config changes from Configuration page without F5
  useEffect(() => {
    const handler = () => refreshLiveData()
    window.addEventListener('printloom:rackConfigSaved', handler)
    return () => window.removeEventListener('printloom:rackConfigSaved', handler)
  }, [refreshLiveData])

  // Kamera-URLs aus der Konfiguration ohne F5 übernehmen
  useEffect(() => {
    const handler = () => {
      if (!bambuId) return
      deviceSettingsService.getSettings(bambuId)
        .then(s => {
          setWebcamUrl(s.data?.webcam_url || ''); setWebcamUrlTop(s.data?.webcam_url_top || '')
          setHaCamReady(!!(s.data?.ha_url && s.data?.ha_camera && s.data?.ha_token_set))
          setCameraOn(s.data?.camera_enabled !== false)
        })
        .catch(() => {})
    }
    window.addEventListener('printloom:cameraSettingsSaved', handler)
    return () => window.removeEventListener('printloom:cameraSettingsSaved', handler)
  }, [bambuId])

  // Filaments of a job that have no confident match in the live AMS.
  const jobAmsMissing = (job) =>
    (useAms && amsSlots.length > 0 && !(job.amsMap || '').trim() && job.filaments?.length > 0)
      ? amsMissing(job.filaments, amsSlots, exactColorOnly) : []
  const jobNeedsAms = (job) => job.needs_ams === true || jobAmsMissing(job).length > 0

  /* ── Job helpers ─────────────────────────────────────────── */
  const setJobField = (id, updates) =>
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j))

  // Einreihen macht der Server: Name, Platten, Höhe und ID kommen von dort.
  // plate = null → alle Platten der Datei, je `count`.
  const _doAddJobs = async (file, amsMap, count, plate = null) => {
    try {
      const r = await autofarmService.addJobs({ fileId: file.id, plate, count, amsMap: amsMap ?? '' })
      applyServer(r)
      if (count > 1) setAddCount(1)
      return r.data?.ids?.length ?? 0
    } catch (e) {
      showFeedback(apiError(e), false)
      return 0
    }
  }

  const addJob = () => {
    if (!gcodeFiles.length) return
    const file  = gcodeFiles.find(f => f.id === addFileId) ?? gcodeFiles[0]
    const count = Math.max(1, addCount)
    // Kein Datei-Preset mehr (entfernt): amsMap bleibt leer → die Farm matcht beim
    // Druck material- UND farbgenau (nie materialübergreifend) oder pausiert.
    const amsMap = ''
    // Mehr-Platten-.3mf: der Server legt JE Platte einen Job an (× Wiederholungen).
    _doAddJobs(file, amsMap, count)
  }

  /* ── Queue-Vorlagen (Templates) ─── */
  const saveTemplate = () => {
    const name = tplName.trim()
    if (!name || !jobs.length) return
    // collapse identical jobs (same file + AMS-Map) into {fileId, fileName, amsMap, count}
    const groups = []
    jobs.forEach(j => {
      // Je Platte eine Gruppe: Sonst legte eine Vorlage aus 3 Platten beim Laden
      // 3 × alle Platten an.
      const g = groups.find(x => x.fileId === j.fileId && x.amsMap === (j.amsMap || '') &&
                                 (x.plate ?? null) === (j.plate ?? null))
      if (g) g.count++
      else groups.push({ fileId: j.fileId, fileName: j.fileName, amsMap: j.amsMap || '',
                         plate: j.plate ?? null, count: 1 })
    })
    const all = { ...loadTemplates(), [name]: groups }
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all))
    setTemplates(all)
    setTplName('')
    showFeedback(tr('Vorlage „{0}" gespeichert ({1} Jobs)', name, jobs.length))
  }

  const applyTemplate = (name) => {
    const entries = templates[name]
    if (!entries?.length) return
    let added = 0, missing = 0
    entries.forEach(e => {
      const file = gcodeFiles.find(f => f.id === e.fileId)
      if (!file) { missing++; return }
      _doAddJobs(file, e.amsMap || '', e.count || 1, e.plate ?? null)
      added += e.count || 1
    })
    setTplOpen(false)
    showFeedback(
      missing
        ? tr('{0} Jobs geladen — {1} Datei(en) nicht mehr vorhanden', added, missing)
        : tr('Vorlage „{0}" geladen ({1} Jobs)', name, added),
      added > 0
    )
  }

  const deleteTemplate = (name) => {
    const all = loadTemplates()
    delete all[name]
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all))
    setTemplates(all)
  }

  const removeJob = async (id) => {
    try {
      applyServer(await autofarmService.deleteJob(id))
    } catch (e) {
      if (e.response?.status === 404) { loadQueue(); return }    // anderswo schon entfernt
      showFeedback(apiError(e), false)
    }
  }

  // Neue Reihenfolge an den Server (mit und ohne Lauf). Fehlt der Seite ein Job,
  // behält der Server ihn hinten (farm_queue.reorder).
  const syncReorder = (updatedJobs) => {
    autofarmService.setOrder(pendingOrder(updatedJobs))
      .then(applyServer)
      .catch(e => { showFeedback(apiError(e), false); loadQueue() })
  }

  const moveJobUp = (id) => setJobs(prev => {
    const i = prev.findIndex(j => j.id === id)
    if (i <= 0) return prev
    const next = [...prev]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    syncReorder(next)
    return next
  })

  const moveJobDown = (id) => setJobs(prev => {
    const i = prev.findIndex(j => j.id === id)
    if (i >= prev.length - 1) return prev
    const next = [...prev]
    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
    syncReorder(next)
    return next
  })

  // Q1: gezogenen Job vor das Ziel einsortieren (nur zwischen wartenden Jobs).
  const moveJobTo = (dragJobId, targetId) => {
    if (dragJobId == null || dragJobId === targetId) return
    setJobs(prev => {
      const from = prev.findIndex(j => j.id === dragJobId)
      const to   = prev.findIndex(j => j.id === targetId)
      if (from < 0 || to < 0) return prev
      if (prev[from].status !== 'pending' || prev[to].status !== 'pending') return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      const insertAt = next.findIndex(j => j.id === targetId)   // nach Entfernen neu bestimmen
      next.splice(insertAt, 0, moved)
      syncReorder(next)
      return next
    })
  }

  // ── Magazin je Regal: Bestand direkt in der Regal-Ansicht setzen (nach dem
  //    Auffüllen einzelner Magazine, ohne den Umweg über die Konfiguration). ──
  const [magEdit, setMagEdit] = useState({})
  const saveMagCount = async (ri, v) => {
    // Geprüft statt parseInt(v) || 0: Ein geleertes Feld hieß bis v1.1.49 „Magazin leer".
    const parsed = parseNumber(v, 'magazine_count', rackDataRef.current?.limits || {})
    if (parsed.error) {
      showFeedback(tr('Magazin R{0}: {1}', ri + 1, parsed.error), false)
      setMagEdit(m => { const x = { ...m }; delete x[ri]; return x })
      return
    }
    const n = parsed.value
    const cur = rackDataRef.current?.magazine_counts ?? []
    if (n === (cur[ri] ?? 0)) { setMagEdit(m => { const x = { ...m }; delete x[ri]; return x }); return }
    const counts = Array.from({ length: numRacks }, (_, i) => (i === ri ? n : (cur[i] ?? 0)))
    try {
      await rackManagerService.updateConfig({ magazine_counts: counts })
      setRackData(d => d ? { ...d, magazine_counts: counts, magazine_count: counts.reduce((a, b) => a + b, 0) } : d)
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      showFeedback(tr('Magazin R{0}: {1} Platten', ri + 1, n))
    } catch (e) {
      showFeedback(rackSaveError(e) || tr('Magazin-Zähler speichern fehlgeschlagen'), false)
    }
    setMagEdit(m => { const x = { ...m }; delete x[ri]; return x })
  }

  // Nur Fehlgeschlagene: Ein fertiger Job auf „wartet" würde ein zweites Mal gedruckt.
  const resetJob = async (id) => {
    try { applyServer(await autofarmService.patchJob(id, { retry: true })) }
    catch (e) { showFeedback(apiError(e), false) }
  }

  // Persist the external webcam URL (shared with the Steuerung page via device settings)
  const saveWebcamUrl = useCallback(async (url) => {
    setWebcamUrl(url)
    if (bambuId) {
      try { await deviceSettingsService.updateSettings(bambuId, { webcam_url: url }) } catch {}
    }
  }, [bambuId])

  // Bis v1.1.57 setzte „Reset" ALLE Jobs auf „wartet", auch fertige (Doppeldruck).
  const resetFarm = async () => {
    const n = jobs.filter(j => j.status === 'error').length
    if (!n || !(await confirmDialog({
      title: tr('Fehlgeschlagene wiederholen?'),
      message: tr('{0} fehlgeschlagene Job(s) kommen wieder in die Warteschlange. Fertige bleiben fertig.', n),
      confirmLabel: tr('Wiederholen'),
    }))) return
    try { applyServer(await autofarmService.resetFailed()) }
    catch (e) { showFeedback(apiError(e), false) }
  }

  /* ── Rack management ─────────────────────────────────────── */
  // Fertige Jobs verschwinden aus der Warteschlange, sobald ihre Platte aus dem
  // Regal entnommen wird — unten bleiben nur aktive/wartende Jobs und die
  // fertigen, deren Platte noch im Regal liegt. Bei laufender Farm zusätzlich
  // im Backend entfernen (sonst fügt der Live-Status sie wieder hinzu).
  const removeDoneJobsForSlots = (slotKeys) => {
    const keys = new Set(slotKeys)
    setJobs(prev => {
      const gone = prev.filter(j => j.status === 'done' && keys.has(j.slot))
      if (!gone.length) return prev
      gone.forEach(j => autofarmService.deleteJob(j.id).catch(e => console.warn('Job nicht entfernt:', e?.message || e)))
      return prev.filter(j => !(j.status === 'done' && keys.has(j.slot)))
    })
  }

  const clearRackSlot = async (slotId) => {
    try {
      await rackManagerService.updateSlot(slotId, { status: 'free', file_id: null, file_name: null })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      removeDoneJobsForSlots([slotId])
    } catch {
      showFeedback(tr('Fach konnte nicht geleert werden'), false)
    }
  }

  // Fach manuell als „belegt" markieren (Status 'locked') → der Farm-Slot-Finder
  // überspringt es (nur free/ready werden belegt), der Roboter legt dort nichts ab.
  // 'locked' zählt NICHT als Platte (kein Magazin-Nachzählen beim Freigeben).
  const toggleSlotBlocked = async (slotId) => {
    const block = rackData?.slots?.[slotId]?.status !== 'locked'
    try {
      await rackManagerService.updateSlot(slotId, block
        ? { status: 'locked' }
        : { status: 'free', file_name: null })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      showFeedback(block ? tr('Fach {0} als belegt markiert', slotId) : tr('Fach {0} freigegeben', slotId))
    } catch {
      showFeedback(tr('Fach konnte nicht geändert werden'), false)
    }
  }

  // Ohne Magazin: „hier liegt eine leere Platte" markieren/aufheben. Die Farm greift
  // ihren Nachschub aus diesen Fächern (oberstes zuerst) und legt fertige Drucke
  // NIE dorthin ab — sonst käme der Druck auf eine liegende Platte.
  const toggleEmptyPlate = async (slotId) => {
    const has = plateSlots.has(slotId)
    try {
      await rackManagerService.updateSlot(slotId, { empty_plate: !has })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      showFeedback(has ? tr('Fach {0}: keine Leerplatte mehr', slotId)
                       : tr('Fach {0}: Leerplatte liegt drin', slotId))
    } catch (e) {
      showFeedback(apiError(e, tr('Markierung konnte nicht geändert werden')), false)
    }
  }

  const assignJobToSlot = async (slotKey) => {
    try {
      await rackManagerService.updateSlot(slotKey, { status: 'free', file_id: null, file_name: null })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      removeDoneJobsForSlots([slotKey])
      // Kein Fach am Job mehr: Der Server wählt es erst beim Druckstart (das hier
      // gesetzte Fach hatte nie eine Wirkung, der Start schickte immer '1-0').
      showFeedback(tr('Fach {0} geleert — der nächste Job nimmt beim Start ein freies Fach', slotKey))
    } catch {
      showFeedback(tr('Zuweisung fehlgeschlagen'), false)
    }
  }

  const clearAllDoneSlots = async () => {
    try {
      const done = Object.entries(rackData?.slots ?? {}).filter(([, s]) => s.status === 'done')
      if (!done.length) return
      const res = await rackManagerService.clearSlots({ slot_ids: done.map(([n]) => n) })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      removeDoneJobsForSlots(done.map(([n]) => n))
      const n = res.data?.cleared ?? done.length
      showFeedback(tr('{0} Fach/Fächer geleert', n))
    } catch {
      showFeedback(tr('Regal konnte nicht geleert werden'), false)
    }
  }

  const refillMagazine = async () => {
    try {
      await rackManagerService.refillMagazine()
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      showFeedback(tr('Magazin aufgefüllt ({0} Platten)', r.data.magazine_count))
    } catch {
      showFeedback(tr('Magazin konnte nicht aufgefüllt werden'), false)
    }
  }

  /* ── Log export ──────────────────────────────────────────── */
  const exportLog = () => {
    const text = [...farmLog].reverse().join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `printloom_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── Log in die Zwischenablage (gefiltert, älteste zuerst) ── */
  const copyLog = async (lines) => {
    const text = [...lines].reverse().join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showFeedback(tr('Log kopiert ({0} Zeilen)', lines.length))
    } catch {
      showFeedback(tr('Kopieren nicht möglich'), false)
    }
  }

  /* ── Farm control ────────────────────────────────────────── */
  const startFarm = async () => {
    if (!bambuId) return showFeedback(tr('Kein Drucker für die Farm konfiguriert'), false)
    if (!queueLoaded) return showFeedback(tr('Warteschlange nicht geladen — erst neu laden'), false)
    // Frisch lesen: In der Konfiguration können sich Takt, Mindestdruckzeit und AMS
    // seit dem Öffnen dieser Seite geändert haben.
    let fresh
    try { fresh = await loadSettings() } catch (e) {
      return showFeedback(apiError(e), false)
    }

    const preflightErrors = await checkPreflight(bambuId, tr)
    if (preflightErrors.length) return showFeedback(preflightErrors[0], false)

    const pending = jobs.filter(j => j.status === 'pending')
    if (!pending.length) return showFeedback(tr('Keine Jobs in der Warteschlange'), false)

    // Queue preflight (hard block): every job's filaments must match the live AMS.
    const amsBlocked = pending.filter(j => jobNeedsAms(j))
    if (amsBlocked.length) {
      return showFeedback(
        tr('Manuelle AMS-Festlegung notwendig für {0} Job(s) — Filament zuweisen, dann starten', amsBlocked.length),
        false,
      )
    }

    // Kapazitäts-Hinweis (weich): grobe Simulation des Fächer-Plans. Bei vollem
    // Regal wird NICHT pausiert — die fertige Platte wartet im Drucker, bis Platz
    // frei ist, und es geht automatisch weiter. Reiner Hinweis, kein Vorzeigen.
    if (rackData) {
      const slotH = rackData.slot_height_mm ?? 50
      const assigned = []
      let noSlot = 0
      for (const j of pending) {
        const h = j.computedHeight ?? j.objectHeight ?? 0
        const s = autoSlot(assigned, rackData, h, slotH)
        if (s === '1-0') noSlot++
        else assigned.push({ slot: s, computedHeight: h, status: 'pending' })
      }
      if (noSlot > 0) {
        showFeedback(tr('ℹ Regal evtl. zu klein für {0}/{1} Jobs — übrige warten dann im Drucker, bis Platz frei wird', noSlot, pending.length), false)
      }
    }

    try {
      await autofarmService.start({
        bambu_id:          bambuId,
        use_ams:           fresh.use_ams ?? true,
        poll_interval:     Math.max(1, fresh.poll_interval ?? 20),
        min_print_minutes: fresh.min_print_minutes ?? 0,
        // Keine Jobliste mehr: Die Farm nimmt ihre eigene (seit v1.1.58).
      })
      await fetchStatus()
      showFeedback(tr('Auto Farm gestartet'))
    } catch (e) {
      showFeedback(apiError(e), false)
      // Abgelehnt, weil noch eine Platte im Greifer/Drucker liegt: Hinweis neu laden.
      if (e.response?.status === 409) setRecoveryPing(n => n + 1)
    }
  }

  const stopFarm = async () => {
    try { await autofarmService.stop(); await fetchStatus() }
    catch (e) { showFeedback(apiError(e), false) }
  }

  const forceReset = async () => {
    try { await autofarmService.forceReset(); await fetchStatus(); showFeedback(tr('Farm-State zurückgesetzt')) }
    catch (e) { showFeedback(apiError(e), false) }
  }

  const togglePause = async () => {
    try { await autofarmService.pause(); await fetchStatus() }
    catch (e) { showFeedback(apiError(e), false) }
  }
  togglePauseRef.current = togglePause

  /* ── Q3: Tastenkürzel — nur aktiv, wenn diese Seite sichtbar ist ──
     (App.jsx hält Seiten im DOM, daher Sichtbarkeits-Check via offsetParent).
     '/' fokussiert den Log-Filter · Esc verlässt ihn · Leertaste pausiert/
     setzt fort (nur während eines Laufs; Start bleibt bewusst nur per Klick). */
  useEffect(() => {
    const onKey = (e) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                           t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        logFilterRef.current?.focus()
      } else if (e.key === 'Escape' && t === logFilterRef.current) {
        setLogFilter('')
        t.blur()
      } else if (e.code === 'Space' && !typing && runningRef.current) {
        e.preventDefault()
        togglePauseRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ── Derived helpers ─────────────────────────────────────── */
  const slotH      = rackData?.slot_height_mm  ?? 50
  const slotTol    = slotTolerance(rackData)
  const numRacks   = rackData?.num_racks        ?? 3
  const slotsPerRack = rackData?.slots_per_rack ?? 6
  // Aufbau ohne Magazin („alle Fächer = Lagerfächer"): die leeren Platten liegen
  // einzeln in den Fächern. Dann markiert der Nutzer je Fach, ob eine drin liegt —
  // und der Magazin-Zähler je Regal entfällt, weil es kein Magazin gibt.
  const noMagazine = (rackData?.magazine_slot ?? 7) <= 0
  const plateSlots = new Set(rackData?.empty_plates ?? [])
  const slots      = rackData
    ? Object.entries(rackData.slots ?? {}).sort(([a], [b]) => {
        const [ar, as] = parseSlotKey(a)
        const [br, bs] = parseSlotKey(b)
        return ar !== br ? ar - br : as - bs
      })
    : []
  const doneSlots = slots.filter(([, s]) => s.status === 'done')

  const pendingJobs   = jobs.filter(j => j.status === 'pending')
  const errorJobs     = jobs.filter(j => j.status === 'error')
  const activeJobs    = jobs.filter(j => ['pending', 'printing'].includes(j.status))
  // Fertige Jobs werden in der Queue ausgeblendet (stehen in der Historie); optional einblendbar.
  const doneJobsCount = jobs.filter(j => j.status === 'done').length
  const visibleJobs   = showDone ? jobs : jobs.filter(j => j.status !== 'done')
  const eta = useQueueEta()   // echte Rest-Druckzeit der Warteschlange (Dashboard nutzt denselben Hook)

  // Slot → Job-Map für die Regal-Anzeige. NUR aktiv laufende Jobs (Server hat ihr
  // Fach live zugewiesen) — wartende Jobs werden bewusst NICHT im Regal vorgezeigt.
  const slotJobMap = {}
  jobs.forEach(j => {
    if (['running', 'printing', 'sending'].includes(j.status) && j.slot && j.slot !== '1-0') {
      if (!slotJobMap[j.slot]) slotJobMap[j.slot] = []
      slotJobMap[j.slot].push(j)
    }
  })

  // Ghost-Fächer: ein hohes Teil belegt sein Basis-Fach + die Fächer darüber.
  // Wir markieren die ÜBERLIEGENDEN Fächer (k → Basis-Job), damit sie als
  // reserviert (Ghost) statt leer angezeigt werden. Quelle: zugewiesene Jobs
  // (Vorschau) UND eingelagerte Platten aus dem Regal-Status (Drucken/Fertig).
  const ghostMap = {}   // "r-s" (überliegendes Fach) → { name, baseSlot }
  const addGhost = (slotKey, height, name) => {
    if (!slotKey || slotKey === '1-0' || !height || height <= 0) return
    const [r, s] = parseSlotKey(slotKey)
    const used = slotsNeeded(height, slotH, slotTol)   // einheitliche Fächer-Logik inkl. Toleranz
    for (let i = 1; i < used; i++) {
      const k = `${r}-${s + i}`
      if (!ghostMap[k]) ghostMap[k] = { name: name || '', baseSlot: s }
    }
  }
  // Ghosts NUR aus tatsächlich belegten Regal-Fächern (Drucken/Fertig) — wartende
  // Jobs erzeugen keine Vorschau. Der startende Job ist im Regal bereits als
  // „printing" mit Höhe hinterlegt, ragt also korrekt in die Fächer darüber.
  Object.entries(rackData?.slots ?? {}).forEach(([k, sd]) => {
    // Ein entnommenes (Status „free") Fach darf keinen Ghost mehr erzeugen, auch
    // wenn die alte Höhe noch im Datensatz steht.
    if (sd?.object_height_mm > 0 && ['printing', 'done'].includes(sd.status))
      addGhost(k, sd.object_height_mm, sd.file_name)
  })

  /* ─────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4" ref={rootRef}>

      {/* Feedback */}
      {/* ── Schwebende Hinweise: FIXED oben mittig unter der Kopfzeile (z-float, siehe tailwind.config.js).
             Bewusst KEIN Element im Layoutfluss — ein auftauchender Hinweis darf das
             Dashboard nicht mehr nach unten schieben. pageActive-Gate: die Seite bleibt
             versteckt gemountet, das Overlay darf nur auf der aktiven Seite erscheinen. ── */}
      {pageActive && (feedback || !bambuId || paused
        || (running && !curJobId && !pendingJobs.length)
        || (running && !!curJobId && !jobs.find(j => j.id === curJobId))) && (
        // Unter der Kopfzeile (47 px, z-40): Bis v1.1.67 lagen die Hinweise darüber und
        // verdeckten Logo, Statuspillen und Theme-Schalter (#74).
        <div className="fixed top-[55px] left-1/2 -translate-x-1/2 z-float flex flex-col items-center gap-1.5 w-max max-w-[92vw] pointer-events-none">
          {feedback && (
            <div className={`pointer-events-auto max-w-full min-w-0 flex items-center gap-2 px-4 py-1.5 rounded-full text-sm border shadow-xl backdrop-blur-md ${
              feedback.ok
                ? 'bg-emerald-950/85 border-emerald-800 text-emerald-300'
                : 'bg-red-950/85 border-red-800 text-red-300'
            }`}>
              <span className={`dot shrink-0 ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
              <span className="truncate">{feedback.msg}</span>
            </div>
          )}
          {!bambuId && (
            <div className="pointer-events-auto max-w-full min-w-0 flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-950/85 border border-amber-800 text-amber-300 text-sm shadow-xl backdrop-blur-md">
              <span className="dot dot-amber shrink-0" /> <span className="truncate">{tr('Kein Drucker für die Farm konfiguriert — bitte erst unter Konfiguration → Geräte einrichten')}</span>
            </div>
          )}
          {paused && (
            <div className="pointer-events-auto max-w-full min-w-0 flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-950/85 border border-amber-800 text-amber-300 text-sm shadow-xl backdrop-blur-md">
              <span className="dot dot-amber animate-pulse shrink-0" /> <span className="truncate">{tr('Pausiert — warte auf Fortsetzen…')}</span>
            </div>
          )}
          {running && !curJobId && !pendingJobs.length && (
            <div className="pointer-events-auto max-w-full min-w-0 flex items-center gap-2 px-4 py-1.5 rounded-full bg-surface-800/90 border border-surface-700 text-surface-400 text-sm shadow-xl backdrop-blur-md">
              <span className="dot dot-gray animate-pulse shrink-0" /> <span className="truncate">{tr('Wartet auf neue Jobs — Dateien in der Datei-Bibliothek einreihen')}</span>
            </div>
          )}
          {running && !jobs.find(j => j.id === curJobId) && !!curJobId && (
            <div className="pointer-events-auto max-w-full min-w-0 flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-950/85 border border-blue-800 text-blue-300 text-sm shadow-xl backdrop-blur-md">
              <span className="dot dot-blue animate-pulse shrink-0" /> <span className="truncate">{tr('Auto Farm läuft im Server — Status wird live aktualisiert')}</span>
            </div>
          )}
        </div>
      )}

      {/* Unterbrochener Lauf (Neustart/Update mitten im Zyklus) — ganz oben, weil
          es beantwortet werden muss, bevor irgendetwas wieder losfährt. */}
      <RecoveryBanner onDismissed={() => load()} reloadKey={`${running}-${recoveryPing}`} />

      {queueError && (
        <div className="rounded-lg border border-red-700 bg-red-950 px-4 py-2 flex flex-wrap items-center gap-3" role="alert">
          <span className="text-[12px] text-red-200 flex-1">
            {tr('Warteschlange nicht geladen: {0}. Nichts wird gespeichert, bis sie geladen ist.', queueError)}
          </span>
          <button onClick={loadQueue} className="btn btn-secondary btn-sm text-xs">{tr('Erneut laden')}</button>
        </div>
      )}

      {/* Mehrere Drucker + Arm-Status — nur mit eingerichtetem Farm-Layout */}
      <PrinterOverview />

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div>
            <PageTitle className="mb-1">Auto Farm</PageTitle>
            {running && (
              <p className="text-[11px] text-surface-600 font-mono mt-0.5">
                {paused
                  ? tr('Pausiert')
                  : curJobId
                    ? tr('Läuft · {0}', jobs.find(j => j.id === curJobId)?.fileName?.replace(/\.[^.]+$/, '')?.slice(0, 28) ?? '…')
                    : pendingJobs.length
                      ? tr('{0} Job(s) wartet', pendingJobs.length)
                      : tr('Wartet auf Jobs…')}
              </p>
            )}
          </div>
          {running && (
            <div className="flex items-center gap-1.5">
              <span className="dot dot-blue animate-pulse" />
              <span className="text-xs text-blue-400 font-medium">{paused ? tr('Pausiert') : tr('Läuft')}</span>
            </div>
          )}
          {errorJobs.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-950/40 border border-red-800 text-red-400">
              {tr('{0} Fehler', errorJobs.length)}
            </span>
          )}
        </div>

        {/* Sequence progress */}
        {seqProgress && (
          <div className="flex items-center gap-2 min-w-0 max-w-xs shrink-0">
            <div className="w-20 bg-surface-800 rounded-full h-1 overflow-hidden shrink-0">
              <div
                className="h-1 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.round(((seqProgress.idx + 1) / seqProgress.total) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-blue-300 truncate">{tr(seqProgress.label)}</span>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditingDash(e => !e)}
            className={`btn btn-sm ${editingDash ? 'btn-primary' : 'btn-ghost'}`}
            title={tr('Dashboard anpassen: Panels verschieben, Größe ändern, ein-/ausblenden')}
          >
            {editingDash ? tr('✓ Fertig') : tr('✎ Layout')}
          </button>
          {!running ? (
            <>
              {jobs.some(j => j.status === 'error') && (
                <button onClick={resetFarm} className="btn btn-ghost btn-sm text-surface-500 hover:text-surface-300" title={tr('Fehlgeschlagene Jobs wiederholen')}>
                  {tr('↺ Reset')}
                </button>
              )}
              <button
                onClick={startFarm}
                disabled={!bambuId}
                className="btn btn-primary btn-sm"
              >
                {tr('▶ Aktivieren')}
                {pendingJobs.length > 0 && (
                  <span className="ml-1.5 opacity-60 text-[10px] font-mono">{pendingJobs.length}</span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={togglePause}
                title={tr('Tastenkürzel: Leertaste')}
                className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-ghost text-amber-400 hover:text-amber-300'}`}
              >
                {paused ? tr('▶ Fortsetzen') : tr('⏸ Pause')}
              </button>
              <button onClick={stopFarm} className="btn btn-danger btn-sm">{tr('■ Stopp')}</button>
              <button
                onClick={forceReset}
                title={tr('Erzwingt das Zurücksetzen des Farm-States — benutze dies wenn Stopp nicht reagiert')}
                className="btn btn-ghost btn-sm text-surface-600 hover:text-red-400 text-xs"
              >↺</button>
            </>
          )}
        </div>
      </div>

      {/* ── Bearbeiten-Leiste: Panels ein-/ausblenden ── */}
      {editingDash && (
        <div className="card p-2.5 flex items-center gap-2 flex-wrap">
          <span className="section-label mb-0 mr-1">{tr('Panels')}</span>
          {PANELS.map(p => {
            const on = !dashHidden.includes(p.id)
            return (
              <button key={p.id} onClick={() => toggleDashPanel(p.id)}
                className={`text-xs font-medium px-2 h-7 rounded-lg border transition-colors ${
                  on ? 'border-blue-700 bg-blue-950/40 text-blue-300'
                     : 'border-surface-700 text-surface-600 hover:text-surface-400'}`}
                title={on ? tr('Ausblenden') : tr('Einblenden')}>
                {on ? '☑' : '☐'} {tr(p.label)}
              </button>
            )
          })}
          <button onClick={resetDash}
            className="ml-auto text-xs text-surface-500 hover:text-surface-300 transition-colors"
            title={tr('Positionen, Größen und Sichtbarkeit auf Standard zurücksetzen')}>
            {tr('↺ Standard')}
          </button>
        </div>
      )}

      {editingDash && (
        <p className="text-[10px] text-surface-600 -mt-1">
          {tr('Panel am Rahmen ziehen zum Verschieben, an der rechten unteren Ecke zum Größe-Ändern. Jede Bildschirmbreite hat ihre eigene Anordnung — am Handy liegt alles untereinander.')}
        </p>
      )}

      {/* ── Frei konfigurierbares Dashboard-Raster, je Rasterbreite ── */}
      <ResponsiveDashboardGrid layouts={dashLayouts} editing={editingDash} onLayoutChange={onDashLayoutChange}
        breakpoints={FARM_BREAKPOINTS} cols={FARM_COLS} rowHeight={ROW_HEIGHT} margin={[14, 14]}>
        {[
          !dashHidden.includes('camera') && (
            <div key="camera" className="panel-fill">
              <CameraPanel bambuId={bambuId} webcamUrl={webcamUrl} webcamUrlTop={webcamUrlTop} haCamReady={haCamReady} cameraOn={cameraOn} onToggle={toggleCamera} hideCam2={hideCam2} onToggleCam2={toggleCam2} />
            </div>
          ),
          !dashHidden.includes('phases') && (
            <div key="phases" className="panel-fill">
              <FarmViz farmStatus={farmStatus} jobs={jobs} curJobId={curJobId} />
            </div>
          ),
          !dashHidden.includes('queue') && (
            <div key="queue" className="panel-fill">
        {/* ── Print queue ─────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
            <div>
              <p className="section-label">{tr('Warteschlange')}</p>
              {eta.ready && eta.jobs > 0 && (
                <p className="text-[11px] text-surface-500 font-mono mt-0.5">
                  {fmtDur(eta.totalSec)
                    ? <>{tr('~{0} gesamt', fmtDur(eta.totalSec))}{eta.finishAt && <span className="text-surface-600">{tr(' · fertig ~{0} Uhr', eta.finishAt.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' }))}</span>}</>
                    : tr('Gesamtzeit unbekannt')}
                  {eta.known < eta.jobs && <span className="text-surface-600"> {tr('({0}/{1} mit Zeit)', eta.known, eta.jobs)}</span>}
                  {eta.histCount > 0 && <span className="text-emerald-500/80" title={tr('Basierend auf echten früheren Druckzeiten')}> {tr('· 📊 {0} aus Historie', eta.histCount)}</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 flex-wrap justify-end min-w-0">
              {/* B.3 Planer */}
              {activeJobs.length > 0 && (
                <button
                  onClick={() => setPlannerOpen(o => !o)}
                  className={`btn btn-sm shrink-0 ${plannerOpen ? 'btn-primary' : 'btn-ghost'}`}
                  title={tr('Zeitplan der Warteschlange anzeigen (Was-wäre-wenn)')}
                >{tr('🗓 Planer')}</button>
              )}
              {/* Queue-Vorlagen */}
              <div className="relative">
                <button
                  ref={tplBtnRef}
                  onClick={() => setTplOpen(o => !o)}
                  className="btn btn-ghost btn-sm shrink-0"
                  title={tr('Warteschlangen-Vorlagen speichern/laden')}
                >{tr('☰ Vorlagen')}{tplOpen ? ' ▲' : ' ▼'}</button>
                {tplOpen && tplPos && createPortal(
                  // Am <body> statt im Panel: In einer kleinen Rasterzelle schnitt das Panel
                  // das Menü bis v1.1.67 ab, und unter dem Nachbarpanel lag es verdeckt.
                  <div ref={tplMenuRef} style={{ position: 'fixed', right: tplPos.right, top: tplPos.top, bottom: tplPos.bottom }}
                    className="z-menu w-64 card p-2 space-y-2 shadow-xl border border-surface-700">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tplName}
                        onChange={e => setTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTemplate() }}
                        placeholder={tr('Name der aktuellen Queue…')}
                        className="flex-1 text-[11px] h-7 py-0 px-1.5"
                      />
                      <button
                        onClick={saveTemplate}
                        disabled={!tplName.trim() || !jobs.length}
                        className="btn btn-ghost btn-sm shrink-0 disabled:opacity-40"
                        title={!jobs.length ? tr('Warteschlange ist leer') : tr('Aktuelle Warteschlange speichern')}
                      >＋</button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {Object.keys(templates).length === 0 ? (
                        <p className="text-[10px] text-surface-600 text-center py-2">{tr('Noch keine Vorlagen')}</p>
                      ) : (
                        Object.entries(templates).map(([name, entries]) => {
                          const total = entries.reduce((s, e) => s + (e.count || 1), 0)
                          return (
                            <div key={name} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-700/50">
                              <button
                                onClick={() => applyTemplate(name)}
                                className="flex-1 min-w-0 text-left"
                                title={tr('{0} Jobs laden', total)}
                              >
                                <span className="text-[11px] text-surface-200 truncate block">{name}</span>
                                <span className="text-[10px] text-surface-600 font-mono">{tr('{0} Datei(en) · {1} Jobs', entries.length, total)}</span>
                              </button>
                              <button
                                onClick={() => deleteTemplate(name)}
                                className="text-xs text-surface-700 hover:text-red-400 transition-colors shrink-0"
                                title={tr('Vorlage löschen')}
                              >×</button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>,
                  document.body,
                )}
              </div>
              <span className="text-[11px] text-surface-500 italic px-1 min-w-0 truncate">
                {tr('Jobs in der')} <span className="text-surface-300">{tr('Datei-Bibliothek')}</span> {tr('hinzufügen →')}
              </span>
            </div>
          </div>

          {/* B.3 Planer-Panel */}
          {plannerOpen && (
            <div className="mb-4 -mt-1 p-2.5 rounded-xl bg-surface-900/60 border border-surface-700/60">
              <QueuePlanner jobs={jobs} tr={tr} />
            </div>
          )}

          {/* Fertige Jobs sind ausgeblendet (→ Historie); Zähler + Einblenden-Umschalter. */}
          {doneJobsCount > 0 && (
            <div className="flex items-center gap-2 mb-3 text-[11px]">
              <span className="text-surface-600">{tr('{0} fertig — ausgeblendet', doneJobsCount)}</span>
              <button onClick={() => setShowDone(s => !s)} className="text-blue-400 hover:text-blue-300">
                {showDone ? tr('ausblenden') : tr('anzeigen')}
              </button>
              <span className="text-surface-700">·</span>
              <button onClick={() => setCurrentPage?.('history')} className="text-surface-500 hover:text-surface-300">
                {tr('Historie öffnen →')}
              </button>
            </div>
          )}
          {!visibleJobs.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-surface-600 text-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="mb-3 opacity-40">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
              <p className="text-sm mb-1">{tr('Keine Jobs')}</p>
              <p className="text-xs text-surface-700">
                {tr('Dateien in der Datei-Bibliothek einreihen, um zu beginnen')}<br/>
                {tr('Regal-Fächer werden automatisch vergeben')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleJobs.map((job, idx) => {
                const sm      = S[job.status] ?? S.pending
                const busy    = running && job.id === curJobId
                const displayH = job.computedHeight ?? job.objectHeight
                const slotsUsed = (displayH > 0) ? slotsNeeded(displayH, slotH, slotTol) : 0
                const pending = job.status === 'pending'
                // Zeit je Job: gemessene Schätzung (Laufzeit) → Slicer-Prognose DIESER
                // Platte (plate_times) → Datei-Slicer-Zeit. Jede Platte einzeln.
                const jobMeta = getCachedMeta(job.fileId)
                const jobEstSec = (job.estimatedMinutes > 0 ? job.estimatedMinutes * 60 : 0)
                  || (job.plate != null ? (jobMeta?.plate_times?.[job.plate] ?? jobMeta?.plate_times?.[String(job.plate)] ?? 0) : 0)
                  || (jobMeta?.time_seconds ?? 0)

                // '1-0' has two meanings: a real "rack full" result from the
                // preflight autoSlot() preview (only while NOT running), OR the
                // "assign at execution" placeholder the backend echoes back once
                // the farm is running. Only the former is a genuine overflow —
                // otherwise the badge falsely cries "Regal voll" mid-run.
                const isOverflow = !running && job.slot === '1-0'
                return (
                  <div
                    key={job.id}
                    onDragOver={pending && dragId != null && dragId !== job.id ? (e) => e.preventDefault() : undefined}
                    onDrop={pending && dragId != null ? (e) => { e.preventDefault(); moveJobTo(dragId, job.id); setDragId(null) } : undefined}
                    className={`rounded-xl border p-2.5 space-y-1.5 transition-colors ${
                      dragId === job.id ? 'opacity-40' : ''
                    } ${
                      dragId != null && dragId !== job.id && pending ? 'border-dashed border-blue-700/60' :
                      busy                ? 'border-blue-700 bg-blue-950/20' :
                      job.status==='done'  ? 'border-surface-700 bg-surface-900/20 opacity-40' :
                      job.status==='error' ? 'border-red-900/70 bg-red-950/15' :
                      isOverflow          ? 'border-amber-900/60 bg-amber-950/10' :
                      'border-surface-700 bg-surface-900'
                    }`}
                  >
                    {/* ── Row 1: status + controls ── */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-surface-700 w-5 shrink-0 text-right">#{idx+1}</span>
                      <span className={`dot ${sm.dot} ${busy && sm.pulse ? 'animate-pulse' : ''} shrink-0`} />
                      <span className={`text-xs font-medium ${sm.color} shrink-0`}>{tr(sm.label)}</span>
                      {job.status === 'printing' && job.progress > 0 && (
                        <span className="text-xs text-surface-500 font-mono shrink-0">
                          {job.progress}%{job.remaining > 0 ? ` · ~${job.remaining} min` : ''}
                        </span>
                      )}
                      {pending && jobEstSec > 0 && (
                        <span className="text-[10px] text-surface-700 font-mono shrink-0"
                          title={tr('Slicer-Prognose dieser Platte')}>~{fmtDur(jobEstSec)}</span>
                      )}
                      <div className="flex-1" />
                      {/* oben rechts: Höhe + Fächer-Bedarf */}
                      {job.plate != null && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-900/60 bg-blue-950/20 text-blue-300 shrink-0 max-w-[13rem] truncate"
                          title={tr('Platte {0} aus Multi-Plate-.3mf', job.plate) + (job.plateName ? ` — ${job.plateName}` : '')}>
                          {job.plateName
                            ? `${job.plateName} · ${job.plate}${job.plateTotal ? `/${job.plateTotal}` : ''}`
                            : (job.plateTotal > 1 ? tr('Platte {0}/{1}', job.plate, job.plateTotal) : tr('Platte {0}', job.plate))}
                        </span>
                      )}
                      {job.heightLoading ? (
                        <span className="text-[10px] text-surface-700 font-mono animate-pulse shrink-0">{tr('Höhe…')}</span>
                      ) : displayH != null && displayH > 0 ? (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border text-emerald-400 border-emerald-900/60 bg-emerald-950/20 shrink-0"
                          title={job.layerCount > 0 && job.layerHeightMm > 0
                            ? tr('Roh: {0} mm · {1} Schichten × {2} mm · +{3}% = {4} mm', job.objectHeight, job.layerCount, job.layerHeightMm, heightMarginPct, job.computedHeight)
                            : `${job.objectHeight} mm (${job.heightSource ?? ''})`}
                        >
                          {displayH} mm
                          {slotsUsed > 0 && (
                            <span className="opacity-70 ml-1 text-[10px]">· {tr(slotsUsed === 1 ? '{0} Fach' : '{0} Fächer', slotsUsed)}</span>
                          )}
                        </span>
                      ) : null}
                      {pending && (
                        <>
                          <button onClick={() => moveJobUp(job.id)} disabled={idx === 0}
                            className="w-5 h-5 flex items-center justify-center text-xs text-surface-700 hover:text-surface-300 disabled:opacity-20 transition-colors">▲</button>
                          <button onClick={() => moveJobDown(job.id)} disabled={idx === visibleJobs.length - 1}
                            className="w-5 h-5 flex items-center justify-center text-xs text-surface-700 hover:text-surface-300 disabled:opacity-20 transition-colors">▼</button>
                          <span
                            draggable
                            onDragStart={(e) => { setDragId(job.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(job.id)) } catch {} }}
                            onDragEnd={() => setDragId(null)}
                            title={tr('Ziehen zum Umsortieren')}
                            className="w-5 h-5 flex items-center justify-center text-surface-700 hover:text-surface-300 cursor-grab active:cursor-grabbing select-none leading-none">⠿</span>
                        </>
                      )}
                      {!busy && !['running', 'printing', 'sending'].includes(job.status) && (
                        <button onClick={() => removeJob(job.id)} className="btn-icon opacity-25 hover:opacity-100 ml-0.5">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* ── Progress bar ── */}
                    {job.status === 'printing' && job.progress > 0 && (
                      <div className="w-full bg-surface-800 rounded-full h-1 overflow-hidden">
                        <div className="h-1 rounded-full bg-emerald-500 transition-all" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}

                    {/* ── Produkt (fest — Jobs entstehen nur in der Datei-Bibliothek) ── */}
                    <div
                      className="w-full text-sm px-3 py-2 rounded-lg bg-surface-800/50 border border-surface-700/60 text-surface-200 truncate"
                      title={job.fileName}
                    >{job.fileName}</div>

                    {/* ── Manuelle AMS-Festlegung — nur wenn die Farm wirklich darauf
                           wartet (sonst kein AMS-Block, hält die Karte kompakt) ── */}
                    {jobNeedsAms(job) && (
                      <div className="space-y-1">
                        <span
                          className="inline-block text-[10px] font-mono px-1 rounded border border-red-800/60 bg-red-950/30 text-red-400"
                          title={jobAmsMissing(job).map(m => `${m.type ?? '?'} ${m.color ?? ''} (${tr(m.reason)})`).join(', ')}
                        >{tr('⚠ Manuelle AMS-Festlegung')}</span>
                        <AmsMapper
                          filaments={job.filaments ?? []}
                          amsSlots={amsSlots}
                          value={job.amsMap}
                          onChange={map => {
                            setJobField(job.id, { amsMap: map })
                            autofarmService.patchJob(job.id, { amsMap: map })
                              .catch(e => showFeedback(apiError(e), false))
                          }}
                        />
                      </div>
                    )}

                    {/* ── AMS-Mapping-Vorschau (1.3): wenn alles passt, zeigt sie nur,
                           welcher Slot je Filament genommen wird (exakt/ähnlich) ── */}
                    {!jobNeedsAms(job) && !(job.amsMap || '').trim() && useAms && (job.filaments?.length > 0) && amsSlots.length > 0 && (
                      <AmsPreview filaments={job.filaments} amsSlots={amsSlots} />
                    )}

                    {/* ── Snapshot (best-effort; blendet sich aus, wenn kein Bild da ist) ── */}
                    <JobSnapshot name={job.snapshot} />

                    {/* ── Error state ── */}
                    {job.status === 'error' && (
                      <div className="flex items-center gap-3 pt-0.5">
                        <span className="text-xs text-red-400 flex-1">{tr('Fehlgeschlagen')}</span>
                        {!running && (
                          <button onClick={() => resetJob(job.id)} className="text-xs text-blue-400 hover:text-blue-300 font-mono transition-colors">
                            {tr('↺ Wiederholen')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
            </div>
          ),
          !dashHidden.includes('step') && (
            <div key="step" className="panel-fill">
              <CurrentStep farmStatus={farmStatus} idle />
            </div>
          ),
          !dashHidden.includes('rack') && (
            <div key="rack" className="panel-fill">
          {/* Rack */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="section-label">{tr('Regal')}</p>
                {rackData && (
                  <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                    rackData.magazine_count === 0 ? 'border-red-800/60 bg-red-950/30 text-red-400' :
                    rackData.magazine_count <= 1  ? 'border-amber-800/50 bg-amber-950/20 text-amber-400' :
                    'border-surface-700/50 bg-surface-800/30 text-surface-500'
                  }`}
                    title={noMagazine
                      ? tr('Leere Platten in den Fächern (mit ▭ markiert) — Nachschub der Farm')
                      : tr('Platten im Magazin')}>
                    {noMagazine ? '▭' : '📦'} {rackData.magazine_count}/{rackData.magazine_total ?? (numRacks * slotsPerRack)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={load} className="text-xs text-surface-700 hover:text-surface-400 transition-colors">↺</button>
                {doneSlots.length > 0 && (
                  <button
                    onClick={clearAllDoneSlots}
                    className="text-xs text-amber-500 hover:text-amber-400 font-medium transition-colors"
                    title={tr('Fertige Platten entnehmen — Magazin füllt sich automatisch wieder auf')}
                  >
                    {tr('Alle entnehmen')}
                  </button>
                )}
              </div>
            </div>

            {numRacks === 0 ? (
              <p className="text-xs text-surface-700 py-3 text-center">{tr('Kein Regal konfiguriert')}</p>
            ) : (
              <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${numRacks}, 1fr)` }}>
                {Array.from({length: numRacks}, (_, ri) => (
                  <div key={ri+1}>
                    <p className="text-[10px] text-center font-mono text-surface-600 mb-1 tracking-wide">
                      R{ri+1}
                    </p>
                    {/* Magazin dieses Regals: Bestand anzeigen + direkt setzen (Enter/Blur).
                        Ohne Magazin gibt es keinen Zähler — dort markiert der Nutzer die
                        einzelnen Fächer (▭), und hier steht nur, wie viele es sind. */}
                    {noMagazine ? (
                      <div className="flex items-center justify-center gap-1 mb-1.5"
                        title={tr('Leere Platten in R{0} — je Fach mit ▭ markieren', ri + 1)}>
                        <span className="text-[10px] opacity-60">▭</span>
                        <span className={`text-[10px] font-mono ${
                          [...plateSlots].filter(k => k.startsWith(`${ri + 1}-`)).length === 0
                            ? 'text-red-400' : 'text-surface-500'
                        }`}>
                          {[...plateSlots].filter(k => k.startsWith(`${ri + 1}-`)).length}
                        </span>
                      </div>
                    ) : (
                      <div
                        className="flex items-center justify-center gap-1 mb-1.5"
                        title={tr('Magazin R{0} — Bestand nach dem Auffüllen hier setzen', ri + 1)}
                      >
                        <span className={`text-[10px] ${(rackData?.magazine_counts?.[ri] ?? 0) === 0 ? 'opacity-100' : 'opacity-60'}`}>📦</span>
                        <input
                          type="number" min="0"
                          value={magEdit[ri] ?? (rackData?.magazine_counts?.[ri] ?? 0)}
                          onChange={e => setMagEdit(m => ({ ...m, [ri]: e.target.value }))}
                          onBlur={e => { if (magEdit[ri] != null) saveMagCount(ri, e.target.value) }}
                          onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                          className={`w-11 h-5 text-[10px] font-mono text-center py-0 px-0.5 ${
                            (magEdit[ri] ?? (rackData?.magazine_counts?.[ri] ?? 0)) == 0 ? 'text-red-400 border-red-900/60' : ''
                          }`}
                        />
                      </div>
                    )}
                    <div className="space-y-1">
                      {Array.from({length: slotsPerRack}, (_, si) => {
                        // oben das höchste Fach (Original) bzw. Fach 1 (Kompakt-Regal)
                        const si2          = slotForRow(rackData, si, slotsPerRack) - 1
                        const key          = `${ri+1}-${si2+1}`
                        const slot         = rackData?.slots?.[key] ?? { status: 'free' }
                        const assignedJobs = slotJobMap[key] ?? []
                        const topJob       = assignedJobs[0] ?? null
                        const isDone       = slot.status === 'done'
                        const isStuck      = !running && slot.status === 'printing'
                        const isActive     = running && (slot.status === 'printing' || topJob?.id === curJobId)
                        const isLocked     = slot.status === 'locked'
                        const dispH        = topJob?.computedHeight ?? topJob?.objectHeight
                        const heightPct    = dispH ? Math.min(100, (dispH / slotH) * 100) : 0
                        const overHeight   = dispH && dispH > slotH
                        // Ghost-Fach: in dieses leere Fach ragt ein hohes Teil aus einem
                        // tieferen Fach hinein → als reserviert (Ghost) zeigen, nicht als leer.
                        const occupied     = isDone || isActive || isLocked || !!topJob
                        const ghost        = !occupied ? ghostMap[key] : null
                        const isGhost      = !!ghost
                        const ghostName    = ghost?.name ?? ''
                        const ghostBase    = ghost?.baseSlot ?? ''
                        // Fach mit untypischem Belegt-Status (z. B. "occupied"/"ready") —
                        // rendert sonst wie leer, ist aber nicht frei und „hängt".
                        const isOther      = !occupied && !isGhost && slot.status !== 'free'
                        // Leeren-Knopf für JEDES belegte, nicht gerade aktiv druckende Fach,
                        // damit sich auch hängende Fächer immer zurücksetzen lassen.
                        // 'locked' (manuell belegt) bekommt stattdessen den 🔓-Freigabe-Knopf.
                        const canClear     = !isActive && slot.status !== 'free' && !isLocked
                        // 🔒 nur auf wirklich freien, nicht reservierten Fächern anbieten.
                        const canBlock     = !occupied && !isGhost && !isOther && slot.status === 'free'
                        // ▭ Leerplatte: nur im Aufbau OHNE Magazin. Ein markiertes Fach ist
                        // physisch belegt (Nachschub-Platte) — die Farm greift daraus und
                        // legt dort nie einen fertigen Druck ab.
                        const hasPlate     = noMagazine && plateSlots.has(key)
                        const canMarkPlate = noMagazine && !occupied && !isGhost && !isOther && slot.status === 'free'

                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-1 px-1.5 h-8 rounded-lg border text-xs transition-colors ${
                              isDone   ? 'border-amber-800/40 bg-amber-950/10' :
                              isActive ? 'border-blue-800/40 bg-blue-950/10' :
                              isLocked ? 'border-surface-600/50 bg-surface-800/50 opacity-70' :
                              topJob   ? 'border-surface-700/50 bg-surface-900' :
                              hasPlate ? 'border-emerald-800/40 bg-emerald-950/10' :
                              isGhost  ? 'border-dashed border-surface-700/40 bg-surface-800/15' :
                              'border-surface-700 bg-transparent'
                            }`}
                          >
                            <span className="font-mono text-surface-600 text-[10px] w-3 text-right shrink-0">{si2+1}</span>
                            <span className={`dot shrink-0 ${
                              isDone   ? 'dot-amber' :
                              isActive ? 'dot-blue animate-pulse' :
                              isLocked ? 'dot-gray opacity-60' :
                              topJob   ? (S[topJob.status]?.dot ?? 'dot-gray') :
                              hasPlate ? 'dot-green opacity-70' :
                              isGhost  ? 'dot-gray opacity-50' :
                              isOther  ? 'dot-amber opacity-70' :
                              'dot-gray opacity-30'
                            }`} />
                            <div className="flex-1 min-w-0">
                              {isDone ? (
                                <p className="text-[10px] text-amber-400 truncate leading-tight">{slot.file_name?.replace(/\.[^.]+$/, '') || tr('Fertig')}</p>
                              ) : topJob ? (
                                <p className="text-[10px] text-surface-400 truncate leading-tight">{topJob.fileName.replace(/\.[^.]+$/, '')}</p>
                              ) : isGhost ? (
                                <p className="text-[10px] text-surface-600 italic truncate leading-tight" title={tr('Belegt durch „{0}" (ragt aus Fach {1})', ghostName.replace(/\.[^.]+$/, ''), ghostBase)}>↑ {ghostName.replace(/\.[^.]+$/, '')}</p>
                              ) : isOther ? (
                                <p className="text-[10px] text-amber-600/80 truncate leading-tight" title={tr('Hängendes Fach (Status: {0}) — ✓ zum Leeren', slot.status)}>{slot.file_name?.replace(/\.[^.]+$/, '') || tr('belegt')}</p>
                              ) : hasPlate ? (
                                <p className="text-[10px] text-emerald-500/90 truncate leading-tight"
                                   title={tr('Leere Platte liegt hier — die Farm holt sich von hier Nachschub')}>{tr('▭ Leerplatte')}</p>
                              ) : (
                                <p className={`text-[10px] ${isLocked ? 'text-surface-400' : 'text-surface-500'}`}>{isLocked ? tr('🔒 Belegt') : ''}</p>
                              )}
                            </div>
                            {(heightPct > 0 || isGhost) && (
                              <div className="w-1 h-5 bg-surface-800 rounded-full overflow-hidden shrink-0">
                                <div
                                  className={`w-full rounded-full ${isGhost ? 'bg-surface-600/40' : overHeight ? 'bg-amber-500/70' : isActive ? 'bg-blue-400/70' : 'bg-surface-500/60'}`}
                                  style={{ height: `${isGhost ? 100 : heightPct}%`, marginTop: `${isGhost ? 0 : 100 - heightPct}%` }}
                                />
                              </div>
                            )}
                            {canClear && (
                              <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
                                <button onClick={() => clearRackSlot(key)} title={tr('Fach leeren')} className={`text-xs hover:text-amber-300 ${isStuck || isOther ? 'text-red-500' : 'text-amber-500'}`}>✓</button>
                                {isDone && (
                                  <button onClick={() => assignJobToSlot(key)} title={tr('Fach leeren')} className="text-xs text-blue-500 hover:text-blue-300">↻</button>
                                )}
                              </div>
                            )}
                            {/* ▭ Leerplatte — nur ohne Magazin (mit Magazin kommt der
                                Nachschub aus dem obersten Fach, nicht aus den Lagerfächern) */}
                            {canMarkPlate && (
                              <button onClick={() => toggleEmptyPlate(key)}
                                title={hasPlate
                                  ? tr('Hier liegt KEINE leere Platte mehr')
                                  : tr('Hier liegt eine leere Platte — die Farm holt sie von hier und legt nichts darauf ab')}
                                className={`text-xs shrink-0 ml-0.5 ${hasPlate
                                  ? 'text-emerald-500 hover:text-emerald-300'
                                  : 'text-surface-700 hover:text-emerald-400'}`}>▭</button>
                            )}
                            {canBlock && !hasPlate && (
                              <button onClick={() => toggleSlotBlocked(key)} title={tr('Fach als belegt markieren — der Roboter legt hier nichts ab')}
                                className="text-xs text-surface-700 hover:text-surface-300 shrink-0 ml-0.5">🔒</button>
                            )}
                            {isLocked && (
                              <button onClick={() => toggleSlotBlocked(key)} title={tr('Fach wieder freigeben')}
                                className="text-xs text-surface-500 hover:text-emerald-300 shrink-0 ml-0.5">🔓</button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Ohne Magazin kann man sich zubauen: liegt in JEDEM freien Fach eine
                leere Platte, bleibt kein Ziel für den fertigen Druck übrig. */}
            {noMagazine && slots.length > 0 &&
              !slots.some(([k, s]) => s.status === 'free' && !plateSlots.has(k)) && (
              <p className="mt-2 px-2 py-1.5 rounded-lg bg-amber-950/30 border border-amber-800/60 text-[10px] text-amber-300">
                {tr('⚠ In jedem freien Fach liegt eine leere Platte — es bleibt kein Fach für den fertigen Druck. Mindestens ein Fach freilassen (▭ abwählen).')}
              </p>
            )}

            {/* Rack legend */}
            {slots.length > 0 && (
              <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-surface-700">
                <span className="text-[10px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-amber w-1.5 h-1.5" /> {tr('Fertig')}
                </span>
                <span className="text-[10px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-blue w-1.5 h-1.5" /> {tr('Druckt')}
                </span>
                <span className="text-[10px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-gray w-1.5 h-1.5 opacity-30" /> {tr('Leer')}
                </span>
                <span className="text-[10px] text-surface-700 flex items-center gap-1">
                  🔒 {tr('Belegt')}
                </span>
                {noMagazine && (
                  <span className="text-[10px] text-surface-700 flex items-center gap-1">
                    <span className="dot dot-green w-1.5 h-1.5 opacity-70" /> {tr('▭ Leerplatte')}
                  </span>
                )}
                <span className="flex-1 text-right text-[10px] text-surface-700 font-mono">
                  {tr('{0} mm/Fach', slotH)}
                </span>
              </div>
            )}
          </div>
            </div>
          ),
          !dashHidden.includes('activity') && (
            <div key="activity" className="panel-fill">
          {/* Activity log — füllt die Zelle (bis v1.1.67 fest max-h-52) */}
          <div className="card flex flex-col">
            <div className="flex items-center justify-between flex-wrap gap-y-1 mb-2 shrink-0">
              <div className="flex items-center gap-2 min-w-0">
                <p className="section-label shrink-0">{tr('Aktivität')}</p>
                {seqProgress && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-700/60 text-blue-300 animate-pulse truncate">
                    {tr(seqProgress.label)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {farmLog.length > 0 && (
                  <div className="relative">
                    <input
                      ref={logFilterRef}
                      value={logFilter}
                      onChange={e => setLogFilter(e.target.value)}
                      placeholder={tr('Filter…')}
                      className="w-24 focus:w-32 transition-all bg-surface-900/60 border border-surface-700 rounded px-2 py-0.5 text-[10px] text-surface-300 placeholder-surface-700 focus:outline-none focus:border-blue-700"
                    />
                    {logFilter && (
                      <button onClick={() => setLogFilter('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-surface-600 hover:text-surface-300 text-xs" title={tr('Filter löschen')}>✕</button>
                    )}
                  </div>
                )}
                {(() => {
                  const shown = logFilter ? farmLog.filter(l => l.toLowerCase().includes(logFilter.toLowerCase())) : farmLog
                  return (
                    <button onClick={() => copyLog(shown)} disabled={!shown.length} className="text-xs text-surface-700 hover:text-blue-400 disabled:opacity-40 transition-colors" title={tr('Sichtbare Zeilen kopieren')}>⧉</button>
                  )
                })()}
                <button onClick={() => autofarmService.downloadLogFile()} className="text-xs text-surface-700 hover:text-blue-400 transition-colors" title={tr('Persistentes Log-File herunterladen (alle Läufe)')}>{tr('↓ Log')}</button>
                <button onClick={exportLog} className="text-xs text-surface-700 hover:text-surface-400 transition-colors" title={tr('Aktuellen Log als .txt')}>↓</button>
                <button onClick={() => { autofarmService.clearLog().catch(() => {}); setFarmStatus(s => s ? { ...s, log: [] } : s) }} className="text-xs text-surface-700 hover:text-surface-400 transition-colors">✕</button>
              </div>
            </div>
            {!farmLog.length ? (
              <p className="text-[10px] text-surface-700 py-2">{tr('Noch keine Aktivität')}</p>
            ) : (() => {
              const shown = logFilter ? farmLog.filter(l => l.toLowerCase().includes(logFilter.toLowerCase())) : farmLog
              if (!shown.length) return <p className="text-[10px] text-surface-700 py-2">{tr('Kein Treffer für „{0}"', logFilter)}</p>
              return (
              <div className="space-y-0.5 font-mono text-[10px] flex-1 min-h-0 overflow-y-auto">
                {logFilter && <p className="text-[10px] text-surface-600 sticky top-0 bg-surface-800 py-0.5">{tr('{0} von {1} Zeilen', shown.length, farmLog.length)}</p>}
                {shown.map((line, i) => (
                  <p key={i} className={
                    line.includes('FEHLER') ? 'text-red-400' :
                    line.includes('═══')    ? 'text-surface-500 font-semibold' :
                    line.includes('✓')      ? 'text-emerald-400' :
                    line.includes('▶') || line.includes('▸') ? 'text-surface-600' :
                    'text-surface-400'
                  }>{line}</p>
                ))}
              </div>
              )
            })()}
          </div>
            </div>
          ),
        ].filter(Boolean)}
      </ResponsiveDashboardGrid>
    </div>
  )
}

export default AutoFarm
