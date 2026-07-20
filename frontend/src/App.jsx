import React, { useState, useEffect, useCallback, Component, Suspense } from 'react'
import { isChunkLoadError, reloadOnceForStaleChunk } from './services/reloadGuard'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch(error) {
    // Stale-Chunk nach Update (alter Tab lädt gelöschtes Asset) → einmal hart neu laden
    // holt die frische Version. reset() würde nur neu rendern und wieder scheitern.
    if (isChunkLoadError(error)) reloadOnceForStaleChunk()
  }
  render() {
    if (this.state.hasError) {
      const stale = isChunkLoadError(this.state.error)
      return (
        <div className="p-6 space-y-3">
          <p className="text-red-400 font-semibold text-sm">
            {stale ? 'Neue Version verfügbar' : 'Fehler auf dieser Seite'}
          </p>
          <p className="text-surface-500 text-xs font-mono">
            {stale ? 'Die App wurde aktualisiert — bitte neu laden.' : String(this.state.error)}
          </p>
          {/* Echter Seiten-Reload (nicht nur Re-Render) → holt frische index.html + Assets. */}
          <button onClick={() => window.location.reload()} className="btn-secondary text-xs">Neu laden</button>
        </div>
      )
    }
    return this.props.children
  }
}
import Navigation from './components/Navigation'
import ConfirmHost from './components/ConfirmHost'
import Dashboard from './pages/Dashboard'           // Landing-Seite → eager
import Setup, { SETUP_DONE_KEY } from './pages/Setup' // braucht SETUP_DONE_KEY beim Start

/* Alle übrigen Seiten lazy: jede landet als eigener Chunk und wird erst beim
   ersten Aufruf geladen → deutlich kleineres Start-Bundle. */
const Configuration   = React.lazy(() => import('./pages/Configuration'))
const FileLibrary     = React.lazy(() => import('./pages/FileLibrary'))
const FilamentLibrary = React.lazy(() => import('./pages/FilamentLibrary'))
const RackManager     = React.lazy(() => import('./pages/RackManager'))
const Drucker         = React.lazy(() => import('./pages/Drucker'))
const AutoFarm        = React.lazy(() => import('./pages/AutoFarm'))
const Steuerung       = React.lazy(() => import('./pages/Steuerung'))
const System          = React.lazy(() => import('./pages/System'))
const SequenceEditor  = React.lazy(() => import('./pages/SequenceEditor'))
const Profiles        = React.lazy(() => import('./pages/Profiles'))
const FileAnalyzer    = React.lazy(() => import('./pages/FileAnalyzer'))
const AmsDiagnostics  = React.lazy(() => import('./pages/AmsDiagnostics'))
const MobileView      = React.lazy(() => import('./pages/MobileView'))
const Projekt         = React.lazy(() => import('./pages/Projekt'))
const History         = React.lazy(() => import('./pages/History'))
import { healthService, systemService, deviceService, printerService } from './services/api'
import { PageActiveContext } from './services/useAutoRefresh'
import Toaster from './components/Toaster'
import { learnFromAms } from './services/amsLearn'
import { loadLangPacks, useLanguage } from './services/i18n'
import { useFarmStatusStream } from './services/useFarmStatusStream'
import { VERSION } from './version'

/* ── URL ↔ page-id mapping ──────────────────────────────────── */
const PATH_TO_PAGE = {
  '/':              'dashboard',
  '/dashboard':     'dashboard',
  '/files':         'files',
  '/analyze':       'analyze',
  '/diagnose':      'diagnose',
  '/steuerung':     'steuerung',
  '/autofarm':      'autofarm',
  '/history':       'history',
  '/projekt':       'projekt',
  '/rack':          'rack',
  '/drucker':       'drucker',
  '/configuration': 'configuration',
  '/filamente':     'filamente',
  '/system':        'system',
  '/sequence':      'sequence',
  '/profiles':      'profiles',
  '/setup':         'setup',
  '/mobile':        'mobile',
}

const PAGE_TO_PATH = {
  dashboard:     '/dashboard',
  files:         '/files',
  analyze:       '/analyze',
  diagnose:      '/diagnose',
  steuerung:     '/steuerung',
  autofarm:      '/autofarm',
  history:       '/history',
  projekt:       '/projekt',
  rack:          '/rack',
  drucker:       '/drucker',
  configuration: '/configuration',
  filamente:     '/filamente',
  system:        '/system',
  sequence:      '/sequence',
  profiles:      '/profiles',
  setup:         '/setup',
  mobile:        '/mobile',
}

function pageFromPath() {
  return PATH_TO_PAGE[window.location.pathname] ?? 'dashboard'
}

/* ── Multi-target status pills (printer · klipper · server) ──── */
const STATUS_STYLES = {
  online:       { dot: 'dot-green', cls: 'bg-emerald-950/60 text-emerald-400 border-emerald-800/50', pulse: true },
  stale:        { dot: 'dot-amber', cls: 'bg-amber-950/60 text-amber-400 border-amber-800/50' },
  unauth:       { dot: 'dot-amber', cls: 'bg-amber-950/60 text-amber-400 border-amber-800/50' },
  offline:      { dot: 'dot-red',   cls: 'bg-red-950/60 text-red-400 border-red-800/50' },
  unconfigured: { dot: 'dot-gray',  cls: 'bg-surface-800 text-surface-500 border-surface-700/50' },
  unknown:      { dot: 'dot-gray',  cls: 'bg-surface-800 text-surface-500 border-surface-700/50' },
}

function StatusPill({ label, target }) {
  const status = target?.status || 'unknown'
  const st = STATUS_STYLES[status] || STATUS_STYLES.unknown
  const detail = target?.detail ? ` — ${target.detail}` : ''
  return (
    <div
      title={`${label}: ${status}${detail}`}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-xs font-mono border ${st.cls}`}
    >
      <span className={`dot ${st.dot} ${st.pulse ? 'animate-pulse' : ''}`} />
      <span className="hidden sm:inline">{label}</span>
    </div>
  )
}

/* Platzhalter, während ein lazy geladener Seiten-Chunk noch lädt */
function PageFallback() {
  return (
    <div className="flex items-center justify-center py-24">
      <div className="w-8 h-8 rounded-full border-4 border-surface-700 border-t-blue-500 animate-spin" />
    </div>
  )
}

function App() {
  const { tr } = useLanguage()
  const [currentPage, setCurrentPageState] = useState(() => pageFromPath())
  // Track which pages have been visited so we can keep them mounted once loaded
  const [visitedPages, setVisitedPages]     = useState(() => new Set([pageFromPath()]))
  const [online, setOnline]                 = useState(null)
  const [targets, setTargets]               = useState(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateOverlay,   setUpdateOverlay]   = useState(null)  // null | 'running' | 'done'
  const [farmStatus,      setFarmStatus]      = useState(null)  // für den Start-Countdown im Header
  const [clock,           setClock]           = useState(() => new Date())

  /* ── Geteilter Farm-Status (Singleton-WS) — nur für den Header-Countdown ── */
  useFarmStatusStream(setFarmStatus)
  const startCountdown = farmStatus?.running ? (farmStatus?.start_countdown ?? 0) : 0

  /* ── Uhr in der Kopfleiste (lokale Zeit, minütlich) ───────── */
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 10000)
    return () => clearInterval(t)
  }, [])

  /* ── Aus dem aktiven AMS lernen (global): neue Material+Farbe-Kombis zur
        Filament-Bibliothek hinzufügen + unten toasten. Läuft, solange offen. ── */
  useEffect(() => {
    let cancelled = false
    let bambuId = null
    const readAndLearn = async () => {
      try {
        if (bambuId == null) {
          const d = await deviceService.listDevices()
          bambuId = (d.data ?? []).find(x => x.device_type === 'bambu_lab')?.id ?? null
        }
        if (bambuId == null || cancelled) return
        const r = await printerService.getStatus(bambuId)
        const slots = []
        for (const unit of (r.data?.ams?.ams ?? [])) {
          for (const tray of (unit.tray ?? [])) {
            const type = tray.tray_type || tray.tray_sub_brands || ''
            if (type) slots.push({ type, color: (tray.tray_color || '').replace('#', '').slice(0, 6) })
          }
        }
        if (!cancelled) learnFromAms(slots)
      } catch { /* offline → später wieder */ }
    }
    readAndLearn()
    const t = setInterval(readAndLearn, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  /* ── URL-aware page setter ────────────────────────────────── */
  const setCurrentPage = useCallback((page) => {
    setCurrentPageState(page)
    setVisitedPages(prev => new Set([...prev, page]))
    const path = PAGE_TO_PATH[page] ?? '/dashboard'
    if (window.location.pathname !== path) {
      window.history.pushState({ page }, '', path)
    }
  }, [])

  /* ── Handle browser back / forward ───────────────────────── */
  useEffect(() => {
    const onPop = () => {
      const page = pageFromPath()
      setCurrentPageState(page)
      setVisitedPages(prev => new Set([...prev, page]))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  /* ── Load installed language packs once at startup ────────── */
  useEffect(() => { loadLangPacks() }, [])

  /* ── First-run: open the setup wizard if nothing is configured ── */
  useEffect(() => {
    if (localStorage.getItem(SETUP_DONE_KEY)) return
    deviceService.listDevices()
      .then(r => {
        const hasDevice = (r.data ?? []).some(d => d.device_type === 'bambu_lab')
        if (hasDevice) {
          localStorage.setItem(SETUP_DONE_KEY, '1')  // existing install → never nag
        } else if (window.location.pathname === '/' || window.location.pathname === '/dashboard') {
          setCurrentPage('setup')
        }
      })
      .catch(() => {})
  }, [setCurrentPage])

  /* ── Update check ─────────────────────────────────────────── */
  useEffect(() => {
    const checkUpdate = () =>
      systemService.getVersion()
        .then(r => setUpdateAvailable(r.data.update_available))
        .catch(() => {})
    checkUpdate()
    const t = setInterval(checkUpdate, 10 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  /* ── Auto-Reload nach Update ───────────────────────────────────
     Pollt die laufende Container-Version. Weicht sie vom geladenen Bundle ab,
     wurde aktualisiert (per Knopf ODER per CLI) → Seite neu laden, damit der
     offene Tab das neue Frontend bekommt. */
  useEffect(() => {
    let reloaded = false
    const check = () =>
      systemService.getRunningVersion()
        .then(r => {
          const v = r.data?.version
          if (!reloaded && v && v !== 'unknown' && v !== VERSION) {
            reloaded = true
            window.location.reload()
          }
        })
        .catch(() => {})
    check()
    const t = setInterval(check, 30000)
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  /* ── Online / health check (local backend) ──────────────────
     Transiente Blips (Backend-Neustart nach Update) NICHT sofort rot zeigen: erst nach
     2 Fehlversuchen offline, und nach einem Fehler schneller nachfassen (4 s statt 30 s)
     → die Anzeige erholt sich in Sekunden statt erst beim nächsten regulären Poll. */
  useEffect(() => {
    let fails = 0, timer
    const run = () => {
      healthService.check()
        .then(() => { fails = 0; setOnline(true); timer = setTimeout(run, 30000) })
        .catch(() => {
          fails += 1
          if (fails >= 2) setOnline(false)
          timer = setTimeout(run, fails >= 2 ? 15000 : 4000)
        })
    }
    run()
    return () => clearTimeout(timer)
  }, [])

  /* ── Multi-target health: printer · klipper ──────────────── */
  const fetchTargets = useCallback(() => {
    healthService.targets().then(r => setTargets(r.data)).catch(() => {})
  }, [])
  useEffect(() => {
    let timer
    const run = () => {
      healthService.targets()
        .then(r => { setTargets(r.data); timer = setTimeout(run, 30000) })
        // Bei einem Blip den LETZTEN Stand behalten (nicht auf Grau springen) + schnell nachfassen.
        .catch(() => { timer = setTimeout(run, 5000) })
    }
    run()
    // Status sofort auffrischen, wenn der Tab wieder sichtbar wird / Fokus bekommt —
    // sonst zeigt der Header nach längerem Wegklicken bis zu 30 s alten/keinen Stand.
    const onVisible = () => { if (document.visibilityState === 'visible') fetchTargets() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', fetchTargets)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', fetchTargets)
    }
  }, [fetchTargets])
  // Bei jedem Seitenwechsel den Geräte-Status frisch holen (behebt „nach Seitenwechsel
  // kein Drucker angezeigt, erst nach Reload"): die SPA bleibt zwar montiert, aber ohne
  // Trigger lief der Status nur im 30-s-Takt.
  useEffect(() => { fetchTargets() }, [currentPage, fetchTargets])

  const pageTitle = {
    dashboard:     'Dashboard',
    files:         'Datei-Bibliothek',
    analyze:       'Datei-Analyse',
    diagnose:      'AMS-Diagnose',
    steuerung:     'Steuerung',
    autofarm:      'Auto Farm',
    history:       'Historie',
    projekt:       'Projekt',
    rack:          'Rack Manager',
    drucker:       'Drucker',
    configuration: 'Konfiguration',
    system:        'System',
    sequence:      'Sequenz-Editor',
    profiles:      'Profile',
    setup:         'Setup-Assistent',
    mobile:        'Mobile View',
  }

  /* ── Render a page — lazy mount, never unmount ────────────── */
  // Components are only created on first visit, then kept in the DOM
  // (but hidden via CSS) so their state survives page switches. Der
  // PageActiveContext sagt der Seite, ob sie gerade sichtbar ist — versteckte
  // Seiten pausieren ihr Polling (usePageActive/useAutoRefresh).
  const page = (id, Component, extraProps = {}) => {
    if (!visitedPages.has(id)) return null
    return (
      <div key={id} hidden={currentPage !== id}>
        <PageActiveContext.Provider value={currentPage === id}>
          <ErrorBoundary>
            <Suspense fallback={<PageFallback />}>
              <Component {...extraProps} />
            </Suspense>
          </ErrorBoundary>
        </PageActiveContext.Provider>
      </div>
    )
  }

  // MobileView renders standalone without nav/header
  if (currentPage === 'mobile') {
    return (
      <Suspense fallback={<PageFallback />}>
        <MobileView />
      </Suspense>
    )
  }

  return (
    <div className="h-screen overflow-hidden bg-surface-950 flex flex-col">

      {/* Top bar */}
      <header className="h-13 bg-surface-900/80 backdrop-blur-md border-b border-surface-800/60 flex items-center justify-between px-5 flex-shrink-0 sticky top-0 z-40" style={{ height: '48px' }}>
        <div className="flex items-center gap-3">
          {/* Logo mark */}
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow shadow-blue-900/50">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
            </svg>
          </div>
          <span className="text-sm font-bold tracking-tight text-surface-100">Printloom</span>
          <span className="text-surface-700">/</span>
          <span className="text-sm text-surface-400">{tr(pageTitle[currentPage] ?? '')}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          {startCountdown > 0 && (
            <div
              title={tr('Nächster Job startet automatisch')}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono border bg-blue-950/60 text-blue-300 border-blue-800/50 animate-pulse"
            >
              <span>⏳</span>
              <span>{tr('Start in {0}s', startCountdown)}</span>
            </div>
          )}
          <span className="hidden md:inline text-xs font-mono text-surface-700 select-none">v{VERSION}</span>
          <StatusPill label={tr('Drucker')} target={online === false ? { status: 'offline', detail: tr('Backend offline') } : targets?.printer} />
          <StatusPill label={tr('Klipper')} target={online === false ? { status: 'offline', detail: tr('Backend offline') } : targets?.klipper} />
          <span className="text-xs font-mono text-surface-300 tabular-nums select-none pl-0.5" title={tr('Uhrzeit')}>
            {clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <Navigation
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
          updateAvailable={updateAvailable}
        />

        <main className="flex-1 overflow-auto bg-surface-950">
          <div className="p-6 max-w-6xl mx-auto">
            {page('dashboard',     Dashboard)}
            {page('files',         FileLibrary)}
            {page('filamente',     FilamentLibrary)}
            {page('analyze',       FileAnalyzer)}
            {page('diagnose',      AmsDiagnostics)}
            {page('steuerung',     Steuerung)}
            {page('autofarm',      AutoFarm, { setCurrentPage })}
            {page('history',       History)}
            {page('projekt',       Projekt)}
            {page('rack',          RackManager)}
            {page('drucker',       Drucker)}
            {page('configuration', Configuration)}
            {page('system',        System, { onUpdateAvailable: setUpdateAvailable, onUpdatePhase: setUpdateOverlay })}
            {page('sequence',      SequenceEditor)}
            {page('profiles',      Profiles)}
            {page('setup',         Setup, { setCurrentPage })}
          </div>
        </main>
      </div>
      {/* Full-screen update overlay — blocks all interaction */}
      {updateOverlay && (
        <div className="fixed inset-0 z-[9999] bg-surface-950/97 backdrop-blur-sm flex flex-col items-center justify-center gap-6 select-none">
          {updateOverlay === 'running' ? (
            <>
              <div className="w-14 h-14 rounded-full border-4 border-blue-900/50 border-t-blue-500 animate-spin" />
              <div className="text-center space-y-2">
                <p className="text-lg font-semibold text-surface-100">{tr('Update läuft…')}</p>
                <p className="text-sm text-surface-400">{tr('Container wird neugestartet — bitte warten')}</p>
                <p className="text-sm text-blue-400/90 mt-1">{tr('Die Seite lädt sich nach Fertigstellung automatisch neu')}</p>
                <p className="text-xs text-surface-600 mt-3">{tr('Keine Eingaben möglich während des Updates')}</p>
              </div>
            </>
          ) : (
            <>
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 border-2 border-emerald-500/50 flex items-center justify-center">
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-400">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-semibold text-emerald-400">{tr('Update abgeschlossen')}</p>
                <p className="text-sm text-surface-400">{tr('Seite wird neu geladen…')}</p>
              </div>
            </>
          )}
        </div>
      )}
      <ConfirmHost />
      <Toaster />
    </div>
  )
}

export default App
