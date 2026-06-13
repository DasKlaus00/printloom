import React, { useState, useEffect, useCallback, Component } from 'react'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }
  componentDidCatch() {}
  reset() { this.setState({ hasError: false, error: null }) }
  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 space-y-3">
          <p className="text-red-400 font-semibold text-sm">Fehler auf dieser Seite</p>
          <p className="text-surface-500 text-xs font-mono">{String(this.state.error)}</p>
          <button onClick={() => this.reset()} className="btn-secondary text-xs">Neu laden</button>
        </div>
      )
    }
    return this.props.children
  }
}
import Navigation from './components/Navigation'
import Dashboard from './pages/Dashboard'
import Configuration from './pages/Configuration'
import FileLibrary from './pages/FileLibrary'
import FilamentLibrary from './pages/FilamentLibrary'
import RackManager from './pages/RackManager'
import AutoFarm from './pages/AutoFarm'
import Steuerung from './pages/Steuerung'
import System from './pages/System'
import SequenceEditor from './pages/SequenceEditor'
import Profiles from './pages/Profiles'
import FileAnalyzer from './pages/FileAnalyzer'
import AmsDiagnostics from './pages/AmsDiagnostics'
import MobileView from './pages/MobileView'
import Projekt from './pages/Projekt'
import Setup, { SETUP_DONE_KEY } from './pages/Setup'
import { healthService, systemService, deviceService } from './services/api'
import { loadLangPacks } from './services/i18n'
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
  '/projekt':       'projekt',
  '/rack':          'rack',
  '/configuration': 'configuration',
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
  projekt:       '/projekt',
  rack:          '/rack',
  configuration: '/configuration',
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

function App() {
  const [currentPage, setCurrentPageState] = useState(() => pageFromPath())
  // Track which pages have been visited so we can keep them mounted once loaded
  const [visitedPages, setVisitedPages]     = useState(() => new Set([pageFromPath()]))
  const [online, setOnline]                 = useState(null)
  const [targets, setTargets]               = useState(null)
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [updateOverlay,   setUpdateOverlay]   = useState(null)  // null | 'running' | 'done'

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

  /* ── Online / health check (local backend) ────────────────── */
  useEffect(() => {
    const check = () =>
      healthService.check().then(() => setOnline(true)).catch(() => setOnline(false))
    check()
    const t = setInterval(check, 30000)
    return () => clearInterval(t)
  }, [])

  /* ── Multi-target health: printer · klipper ──────────────── */
  useEffect(() => {
    const check = () =>
      healthService.targets()
        .then(r => setTargets(r.data))
        .catch(() => setTargets(null))
    check()
    const t = setInterval(check, 30000)
    return () => clearInterval(t)
  }, [])

  const pageTitle = {
    dashboard:     'Dashboard',
    files:         'Datei-Bibliothek',
    analyze:       'Datei-Analyse',
    diagnose:      'AMS-Diagnose',
    steuerung:     'Steuerung',
    autofarm:      'Auto Farm',
    projekt:       'Projekt',
    rack:          'Rack Manager',
    configuration: 'Konfiguration',
    system:        'System',
    sequence:      'Sequenz-Editor',
    profiles:      'Profile',
    setup:         'Setup-Assistent',
    mobile:        'Mobile View',
  }

  /* ── Render a page — lazy mount, never unmount ────────────── */
  // Components are only created on first visit, then kept in the DOM
  // (but hidden via CSS) so their state survives page switches.
  const page = (id, Component, extraProps = {}) => {
    if (!visitedPages.has(id)) return null
    return (
      <div key={id} hidden={currentPage !== id}>
        <ErrorBoundary>
          <Component {...extraProps} />
        </ErrorBoundary>
      </div>
    )
  }

  // MobileView renders standalone without nav/header
  if (currentPage === 'mobile') {
    return <MobileView />
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
          <span className="text-sm text-surface-400">{pageTitle[currentPage]}</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden md:inline text-xs font-mono text-surface-700 select-none">v{VERSION}</span>
          <StatusPill label="Drucker" target={online === false ? { status: 'offline', detail: 'Backend offline' } : targets?.printer} />
          <StatusPill label="Klipper" target={online === false ? { status: 'offline', detail: 'Backend offline' } : targets?.klipper} />
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
            {page('autofarm',      AutoFarm)}
            {page('projekt',       Projekt)}
            {page('rack',          RackManager)}
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
                <p className="text-lg font-semibold text-surface-100">Update läuft…</p>
                <p className="text-sm text-surface-400">Container wird neugestartet — bitte warten</p>
                <p className="text-xs text-surface-600 mt-3">Keine Eingaben möglich während des Updates</p>
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
                <p className="text-lg font-semibold text-emerald-400">Update abgeschlossen</p>
                <p className="text-sm text-surface-400">Seite wird neu geladen…</p>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

export default App
