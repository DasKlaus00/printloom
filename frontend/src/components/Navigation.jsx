import React, { useState, useRef } from 'react'
import { useLanguage, setLanguage, availableLanguages } from '../services/i18n'
import { fileService } from '../services/api'

const icons = {
  autofarm: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
      <circle cx="19" cy="19" r="3" fill="currentColor" className="text-emerald-400"/>
    </svg>
  ),
  live: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49"/><path d="M7.76 7.76a6 6 0 0 0 0 8.49"/>
      <path d="M20.07 4.93a10 10 0 0 1 0 14.14"/><path d="M3.93 4.93a10 10 0 0 0 0 14.14"/>
    </svg>
  ),
  history: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l3 2"/>
    </svg>
  ),
  library: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/>
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
      <path d="M9 6h7"/>
    </svg>
  ),
  projekt: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="4" rx="1"/>
      <rect x="3" y="10" width="11" height="4" rx="1"/>
      <rect x="3" y="17" width="14" height="4" rx="1"/>
      <circle cx="19" cy="19" r="3" fill="none"/>
      <line x1="17.5" y1="19" x2="20.5" y2="19"/><line x1="19" y1="17.5" x2="19" y2="20.5"/>
    </svg>
  ),
  rack: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="4" rx="1"/>
      <rect x="2" y="10" width="20" height="4" rx="1"/>
      <rect x="2" y="17" width="20" height="4" rx="1"/>
    </svg>
  ),
  drucker: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 6 2 18 2 18 9"/>
      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
      <rect x="6" y="14" width="12" height="8" rx="1"/>
    </svg>
  ),
  calibration: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
    </svg>
  ),
  dashboard: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  ),
  files: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/><line x1="9" y1="17" x2="13" y2="17"/>
    </svg>
  ),
  controls: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/>
      <path d="M14.66 9.34a5 5 0 0 1 0 5.32M9.34 9.34a5 5 0 0 0 0 5.32"/>
    </svg>
  ),
  system: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
    </svg>
  ),
  sequence: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  ),
  analyze: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="11" y1="8" x2="11" y2="14"/><line x1="8" y1="11" x2="14" y2="11"/>
    </svg>
  ),
  simulator: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="8" width="5" height="9" rx="1"/>
      <rect x="9.5" y="5" width="5" height="14" rx="1"/>
      <rect x="17" y="8" width="5" height="9" rx="1"/>
      <line x1="7" y1="12.5" x2="9.5" y2="12.5"/>
      <line x1="14.5" y1="12.5" x2="17" y2="12.5"/>
    </svg>
  ),
  diagnose: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 3H5a2 2 0 0 0-2 2v4"/><path d="M9 3h6"/><path d="M15 3h4a2 2 0 0 1 2 2v4"/>
      <path d="M3 9v6"/><path d="M21 9v6"/>
      <path d="M3 15v2a2 2 0 0 0 2 2h4"/><path d="M21 15v2a2 2 0 0 1-2 2h-4"/>
      <path d="M9 21h6"/>
      <path d="M12 8v4"/><path d="M10 12h4"/>
    </svg>
  ),
  profiles: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <polyline points="14 2 14 8 20 8"/>
      <circle cx="12" cy="14" r="2.2"/><path d="M8.5 19a3.5 3.5 0 0 1 7 0"/>
    </svg>
  ),
  filamente: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/>
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  ),
  config: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
}

/* Gruppen wie in der Prüfplanung: der Alltag oben ohne Überschrift, darunter
   Aufträge und die Einrichtung. Setup-Assistent bewusst NICHT hier — er sitzt in
   System (einmalige Einrichtung, kein Alltags-Tab). Direktaufruf über /setup bleibt.
   „Farm-Layout" war bis v1.1.7 ein eigener Tab mit einer ZWEITEN Stelle für
   dieselben X-Positionen; die Schienen-Ansicht steckt jetzt im Drucker-Tab. */
function buildGroups(t, tr) {
  return [
    { label: null, pages: [
      { id: 'dashboard',     label: t('nav.dashboard'),     icon: 'dashboard'   },
      { id: 'autofarm',      label: t('nav.autofarm'),      icon: 'autofarm'    },
      { id: 'steuerung',     label: tr('Steuerung'),        icon: 'controls'    },
      { id: 'history',       label: tr('Historie'),         icon: 'history'     },
    ]},
    { label: tr('Aufträge'), pages: [
      { id: 'files',         label: t('nav.files'),         icon: 'files'       },
      { id: 'projekt',       label: tr('Projekt'),          icon: 'projekt'     },
      { id: 'library',       label: tr('Bibliothek'),       icon: 'library'     },
    ]},
    { label: tr('Einrichtung'), pages: [
      { id: 'drucker',       label: tr('Drucker'),          icon: 'drucker'     },
      { id: 'sequence',      label: t('nav.sequence'),      icon: 'sequence'    },
      { id: 'profiles',      label: t('nav.profiles'),      icon: 'profiles'    },
      { id: 'filamente',     label: tr('Filamente'),        icon: 'filamente'   },
      { id: 'configuration', label: t('nav.configuration'), icon: 'config'      },
      { id: 'system',        label: t('nav.system'),        icon: 'system'      },
    ]},
  ]
}

/* ─── Schnell-Upload ──────────────────────────────────────────────── */
function QuickUpload() {
  const { tr } = useLanguage()
  const [dragging,   setDragging]   = useState(false)
  const [uploading,  setUploading]  = useState(false)
  const [lastFile,   setLastFile]   = useState(null)
  const [err,        setErr]        = useState(null)
  const inputRef = useRef()

  const doUpload = async (files) => {
    const valid = [...files].filter(f => f.name.endsWith('.gcode') || f.name.endsWith('.3mf'))
    if (!valid.length) { setErr(tr('Nur .gcode / .3mf')); setTimeout(() => setErr(null), 3000); return }
    setUploading(true); setErr(null)
    try {
      for (const file of valid) {
        const fd = new FormData()
        fd.append('file', file)
        await fileService.uploadFile(fd)
        setLastFile(file.name.replace(/\.[^.]+$/, ''))
      }
      window.dispatchEvent(new CustomEvent('printloom:fileUploaded'))
      setTimeout(() => setLastFile(null), 4000)
    } catch (e) {
      setErr(e.response?.data?.detail ?? tr('Upload fehlgeschlagen'))
      setTimeout(() => setErr(null), 4000)
    }
    setUploading(false)
  }

  // Prüfplanung: .ablage — gestrichelte Fläche, beim Darüberziehen Akzent.
  const zustand = uploading ? 'border-blue-600 bg-blue-950 text-blue-300'
    : err      ? 'border-red-600 bg-red-950 text-red-300'
    : lastFile ? 'border-emerald-600 bg-emerald-950 text-emerald-300'
    : dragging ? 'border-blue-600 bg-blue-900 text-blue-300'
    :            'border-surface-700 bg-surface-900 text-surface-400 hover:border-surface-600 hover:text-surface-200'

  return (
    <div className="px-3 pb-3">
      <input ref={inputRef} type="file" accept=".gcode,.3mf" multiple className="hidden"
        onChange={e => { doUpload(e.target.files); e.target.value = '' }} />
      <div
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget)) setDragging(false) }}
        onDrop={e => { e.preventDefault(); setDragging(false); doUpload(e.dataTransfer.files) }}
        title={tr('Schnell-Upload')}
        className={`flex items-center gap-2.5 rounded border-2 border-dashed cursor-pointer select-none transition-colors px-3 py-2.5 ${zustand}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
          className={`flex-none ${uploading ? 'animate-pulse' : ''}`}>
          {lastFile ? <polyline points="20 6 9 17 4 12"/> : err ? (
            <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>
          ) : (
            <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></>
          )}
        </svg>
        <span className="min-w-0 leading-tight">
          <span className="block text-[13px] truncate">
            {uploading ? tr('Hochladen…') : err ? err : lastFile ? lastFile : dragging ? tr('Hier ablegen') : tr('Schnell-Upload')}
          </span>
          <span className="block text-[11px] opacity-75">
            {lastFile ? tr('Hochgeladen') : '.gcode · .3mf'}
          </span>
        </span>
      </div>
    </div>
  )
}

/* ─── Sprache ─────────────────────────────────────────────────────── */
function LanguageToggle() {
  const { lang } = useLanguage()
  const langs = availableLanguages()
  return (
    <div className="segmented" role="group" aria-label="Language">
      {langs.map(l => (
        <button key={l.code} type="button" onClick={() => setLanguage(l.code)} title={l.name}
          className={lang === l.code ? 'active' : ''}>
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  )
}

/* ─── Seitenleiste ─────────────────────────────────────────────────
   Wie die Prüfplanung: feste Leiste links, Gruppen mit kleiner Überschrift,
   aktive Seite mit Akzentstrich links. Einklappbar auf reine Symbole (der
   Zustand bleibt je Gerät). Auf schmalen Bildschirmen schiebt sie sich über
   den Inhalt und schließt nach der Auswahl wieder. */
function Navigation({ currentPage, setCurrentPage, updateAvailable, collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }) {
  const { t, tr } = useLanguage()
  const groups = buildGroups(t, tr)
  const go = (id) => { setCurrentPage(id); onCloseMobile?.() }

  return (
    <>
      {mobileOpen && (
        <div className="fixed inset-0 top-[47px] z-30 bg-surface-50/30 md:hidden" onClick={onCloseMobile} aria-hidden="true" />
      )}
      <nav
        className={`flex-shrink-0 bg-surface-800 border-r border-surface-700 flex flex-col overflow-hidden
          transition-[width,transform] duration-150 ease-out
          fixed md:static top-[47px] bottom-0 left-0 z-40 md:z-auto
          ${collapsed ? 'md:w-[54px]' : 'md:w-[210px]'} w-[240px]
          ${mobileOpen ? 'translate-x-0 shadow-lg' : '-translate-x-full md:translate-x-0'}`}
        aria-label={tr('Navigation')}
      >
        <div className="flex-1 overflow-y-auto overflow-x-hidden py-2">
          {groups.map((g, gi) => (
            <div key={gi}>
              {g.label && (collapsed
                ? <div className="hidden md:block border-t border-surface-700 mx-2.5 my-1.5" />
                : null)}
              {g.label && (
                <div className={`text-[10px] uppercase tracking-[.06em] text-surface-400 opacity-80 px-[19px] pt-3 pb-1 whitespace-nowrap ${collapsed ? 'md:hidden' : ''}`}>
                  {g.label}
                </div>
              )}
              {g.pages.map(page => {
                const active = currentPage === page.id
                return (
                  <button
                    key={page.id}
                    onClick={() => go(page.id)}
                    title={collapsed ? page.label : undefined}
                    aria-current={active ? 'page' : undefined}
                    className={`relative w-full flex items-center gap-3 min-h-[38px] border-l-[3px] whitespace-nowrap text-left transition-colors
                      ${collapsed ? 'md:pl-[15px] pl-4 pr-4' : 'pl-4 pr-4'}
                      ${active
                        ? 'border-blue-600 bg-blue-900 text-surface-100 font-semibold'
                        : 'border-transparent text-surface-400 hover:bg-surface-900 hover:text-surface-100'}`}
                  >
                    <span className="flex-none">{icons[page.icon]}</span>
                    <span className={`flex-1 truncate ${collapsed ? 'md:hidden' : ''}`}>{page.label}</span>
                    {page.id === 'system' && updateAvailable && (
                      <span className={`w-2 h-2 rounded-full bg-amber-500 flex-shrink-0 ${collapsed ? 'md:absolute md:top-2 md:left-8' : ''}`} title={tr('Update verfügbar')} />
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        <div className={collapsed ? 'md:hidden' : ''}>
          <QuickUpload />
          <div className="px-4 pb-3 flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-[.06em] text-surface-400">{tr('Sprache')}</span>
            <LanguageToggle />
          </div>
        </div>

        <button
          onClick={onToggleCollapsed}
          className="hidden md:flex items-center gap-3 border-t border-surface-700 text-surface-400 hover:bg-surface-900 hover:text-surface-100 px-4 py-2.5 whitespace-nowrap text-left"
          title={collapsed ? tr('Seitenleiste erweitern') : tr('Seitenleiste minimieren')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
            className={`flex-none transition-transform ${collapsed ? 'rotate-180' : ''}`}>
            <polyline points="15 18 9 12 15 6"/>
          </svg>
          <span className={collapsed ? 'hidden' : ''}>{tr('Einklappen')}</span>
        </button>
      </nav>
    </>
  )
}

export default Navigation
