import React, { useState, useEffect, useRef } from 'react'
import { deviceService, configService, deviceSettingsService, systemService, autofarmService, rackManagerService, printerService } from '../services/api'
import { availableLanguages, setLanguage, useLanguage, getTranslationTemplate } from '../services/i18n'
import { confirmDialog } from '../services/confirm'

/* Häufige Zeitzonen für die Auswahl (IANA). Die erkannte Browser-Zone wird bei
   Bedarf vorangestellt, damit sie immer wählbar ist. */
export const TIMEZONES = [
  'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Prague',
  'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
]

/* ─── Language & downloadable language packs ─────────────────────── */
function LanguagePacks() {
  const { lang, tr } = useLanguage()
  const [installed, setInstalled] = useState({})
  const [status, setStatus]       = useState(null)
  const [busy, setBusy]           = useState(false)
  const fileRef = useRef()

  const loadInstalled = () => systemService.getLangInstalled()
    .then(r => setInstalled(r.data || {})).catch(() => {})
  useEffect(() => { loadInstalled() }, [])

  const importFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setStatus(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const pack = JSON.parse(ev.target.result)
        const hasStrings = pack.strings && typeof pack.strings === 'object' && Object.keys(pack.strings).length > 0
        const hasTranslations = pack.translations && typeof pack.translations === 'object' && Object.keys(pack.translations).length > 0
        if (!pack.code || (!hasStrings && !hasTranslations))
          throw new Error(tr('Pack braucht code + strings'))
        await systemService.importLang({
          code: pack.code, name: pack.name,
          strings: hasStrings ? pack.strings : undefined,
          translations: hasTranslations ? pack.translations : undefined,
        })
        await loadInstalled()
        setStatus({ ok: true, msg: tr('Sprachpaket „{0}" importiert.', pack.code) })
      } catch (e2) {
        setStatus({ ok: false, msg: e2.response?.data?.detail ?? e2.message })
      }
    }
    reader.readAsText(file)
  }

  const exportTemplate = () => {
    const template = {
      code: 'xy',
      name: 'Language Name',
      strings: getTranslationTemplate(),
    }
    const blob = new Blob([JSON.stringify(template, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'printloom-lang-template.json'
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const remove = async (code) => {
    setBusy(true); setStatus(null)
    try {
      await systemService.deleteLang(code)
      await loadInstalled()
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setBusy(false) }
  }

  const langs = availableLanguages()

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Sprache & Sprachpakete')}</p>
        <p className="text-[11px] text-surface-600 mt-0.5">
          {tr('Standard ist Deutsch. Weitere Sprachen lassen sich aus dem Server-Katalog laden oder als Datei importieren.')}
        </p>
      </div>

      {/* Active language */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-surface-600 mr-1">{tr('Aktiv:')}</span>
        {langs.map(l => (
          <button key={l.code} onClick={() => setLanguage(l.code)} title={l.name}
            className={`text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              lang === l.code ? 'bg-blue-700 border-blue-600 text-white'
                              : 'bg-surface-800 border-surface-700 text-surface-400 hover:text-surface-200'}`}>
            {l.code.toUpperCase()} {!l.builtin && '·'}
          </button>
        ))}
      </div>

      {/* Installed packs */}
      {Object.keys(installed).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-surface-600">{tr('Installierte Pakete')}</p>
          {Object.entries(installed).map(([code, p]) => (
            <div key={code} className="flex items-center gap-2 text-xs">
              <span className="font-mono text-surface-300">{code.toUpperCase()}</span>
              <span className="text-surface-500 flex-1 truncate">{p.name || code}</span>
              <button onClick={() => remove(code)} className="text-surface-700 hover:text-red-400 px-1">×</button>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap border-t border-surface-800/50 pt-3">
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />
        <button onClick={exportTemplate} className="btn btn-ghost btn-sm">{tr('Template exportieren')}</button>
        <button onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm">{tr('Pack importieren')}</button>
      </div>
      <p className="text-[10px] text-surface-600 leading-relaxed">
        {tr('Template exportieren lädt eine JSON-Vorlage mit allen deutschen Strings und englischen Referenz-Übersetzungen. Einfach einer KI geben: „Übersetze alle Werte auf Französisch" — dann code + name anpassen und importieren.')}
      </p>

      {status && (
        <div className={`text-[11px] font-mono px-2 py-1 rounded border ${
          status.ok ? 'text-emerald-400 border-emerald-900/50 bg-emerald-950/20'
                    : 'text-red-400 border-red-900/50 bg-red-950/20'}`}>
          {status.msg}
        </div>
      )}
    </div>
  )
}

/* ─── Farm-Einstellungen ─────────────────────────────────────────── */
function FarmSettings() {
  const { tr } = useLanguage()
  const [pollInterval,    setPollInterval]    = useState(20)
  const [minPrintMinutes, setMinPrintMinutes] = useState(0)
  const [useAms,          setUseAms]          = useState(true)
  const [exactColorOnly,  setExactColorOnly]  = useState(false)   // 1.4
  const [connAlarm,       setConnAlarm]       = useState(true)
  const [stallMin,        setStallMin]        = useState(0)
  const [ophEnabled,      setOphEnabled]      = useState(false)         // 2.5 Betriebszeiten
  const [tz,              setTz]              = useState('')             // Zeitzone (IANA)
  // Pro Wochentag (Index 0=Mo … 6=So) ein eigenes Fenster.
  const [ophSchedule,     setOphSchedule]     = useState(
    () => Array.from({ length: 7 }, () => ({ enabled: true, start: '22:00', end: '06:00' }))
  )
  const [homingFile,      setHomingFile]      = useState(null)
  const [homingBusy,      setHomingBusy]      = useState(false)
  const [loaded,          setLoaded]          = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [status,          setStatus]          = useState(null)
  const saveRef = useRef(null)

  // Zeitzone des Browsers (IANA). Der Backend-Container läuft meist in UTC; ohne diese
  // Angabe würden die Betriebszeiten gegen UTC geprüft → Farm startet Stunden zu spät.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''

  useEffect(() => {
    autofarmService.getSettings()
      .then(r => {
        setPollInterval(r.data.poll_interval ?? 20)
        setMinPrintMinutes(r.data.min_print_minutes ?? 0)
        setUseAms(r.data.use_ams ?? true)
        setExactColorOnly(!!r.data.exact_color_only)
        setConnAlarm(r.data.conn_alarm ?? true)
        setStallMin(r.data.progress_stall_min ?? 0)
        setOphEnabled(r.data.operating_hours_enabled ?? false)
        if (Array.isArray(r.data.operating_schedule) && r.data.operating_schedule.length === 7) {
          setOphSchedule(r.data.operating_schedule.map(d => ({
            enabled: d?.enabled ?? true, start: d?.start ?? '22:00', end: d?.end ?? '06:00',
          })))
        }
        // Gespeicherte TZ übernehmen, sonst die Browser-Zone als Vorschlag.
        const storedTz = r.data.timezone || ''
        setTz(storedTz || browserTz)
        // Beim ersten Mal (noch keine TZ gespeichert) die Browser-Zone hinterlegen.
        if (browserTz && !storedTz) {
          autofarmService.saveSettings({ timezone: browserTz }).catch(() => {})
        }
      }).catch(() => {}).finally(() => setLoaded(true))
    autofarmService.getHomingFileInfo()
      .then(r => setHomingFile(r.data)).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      await autofarmService.saveSettings({
        poll_interval: pollInterval, min_print_minutes: minPrintMinutes, use_ams: useAms,
        exact_color_only: exactColorOnly,
        conn_alarm: connAlarm, progress_stall_min: Math.max(0, Math.round(Number(stallMin) || 0)),
        operating_hours_enabled: ophEnabled, operating_schedule: ophSchedule,
        timezone: tz || browserTz,
      })
      setStatus({ ok: true, msg: tr('Einstellungen gespeichert.') })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  const setupHoming = async () => {
    setHomingBusy(true)
    try {
      const r = await autofarmService.setupHomingFile()
      setHomingFile({ configured: true, file_id: r.data.file_id, filename: r.data.filename })
      setStatus({ ok: true, msg: tr('Homing-Datei erstellt.') })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setHomingBusy(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Farm-Einstellungen')}</p>
        <p className="text-[11px] text-surface-600 mt-0.5">{tr('Drucker-Poll, Mindestdruckzeit, AMS, Homing-Datei')}</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Drucker-Poll (Sekunden)')}</label>
          <div className="flex items-center gap-2">
            <input type="number" min="1" max="600" value={pollInterval}
              onChange={e => setPollInterval(Math.max(1, Number(e.target.value)))}
              className="w-20 font-mono text-xs" />
            <span className="text-[10px] text-surface-700">1–600 s</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Mindestdruckzeit (Minuten)')}</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="999" value={minPrintMinutes}
              onChange={e => setMinPrintMinutes(Math.max(0, Number(e.target.value)))}
              className="w-20 font-mono text-xs" />
            <span className="text-[10px] text-surface-700">{minPrintMinutes === 0 ? tr('(deaktiviert)') : tr('min')}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-surface-400 select-none">{tr('AMS verwenden')}</label>
        <button onClick={() => setUseAms(v => !v)}
          className={`relative w-9 h-5 rounded-full transition-colors ${useAms ? 'bg-blue-600' : 'bg-surface-700'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useAms ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>
      {useAms && (
        <div className="flex items-center gap-3">
          <label className="text-xs text-surface-400 select-none flex-1">{tr('Nur exakte Farbe drucken')}
            <span className="block text-[9px] text-surface-700">{tr('Keine ähnliche Ersatzfarbe — ohne exakten Treffer pausiert die Farm zur manuellen Zuordnung')}</span></label>
          <button onClick={() => setExactColorOnly(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${exactColorOnly ? 'bg-blue-600' : 'bg-surface-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${exactColorOnly ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
      )}

      {/* Watchdog (Roadmap 1.1 / 1.7) */}
      <div className="border-t border-surface-800/40 pt-3 space-y-2.5">
        <p className="text-[10px] text-surface-400 font-medium">{tr('Watchdog')}</p>
        <div className="flex items-center gap-3">
          <label className="text-xs text-surface-400 select-none flex-1">{tr('Alarm bei Verbindungsverlust')}
            <span className="block text-[9px] text-surface-700">{tr('Push, wenn der Reconnect zum Drucker mehrfach scheitert')}</span></label>
          <button onClick={() => setConnAlarm(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${connAlarm ? 'bg-blue-600' : 'bg-surface-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${connAlarm ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Stillstand-Watchdog (Minuten ohne Fortschritt)')}</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="999" value={stallMin}
              onChange={e => setStallMin(Math.max(0, Number(e.target.value)))}
              className="w-20 font-mono text-xs" />
            <span className="text-[10px] text-surface-700">{Number(stallMin) === 0 ? tr('(deaktiviert)') : tr('min → pausiert bei möglicher Verstopfung')}</span>
          </div>
        </div>
      </div>
      {/* Betriebszeiten (Roadmap 2.5) */}
      <div className="border-t border-surface-800/40 pt-3 space-y-2.5">
        {/* Zeitzone — Basis für die Betriebszeiten. Der Server-Container läuft in UTC;
            ohne korrekte Zone startet die Farm zur falschen Uhrzeit. */}
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-surface-400 flex-1 min-w-[140px]">{tr('Zeitzone')}
            <span className="block text-[9px] text-surface-700">{tr('Maßgeblich für Betriebszeiten & Uhrzeiten.')}</span></label>
          <select value={tz} onChange={e => setTz(e.target.value)} className="text-xs font-mono w-48">
            {(TIMEZONES.includes(tz) || !tz ? TIMEZONES : [tz, ...TIMEZONES]).map(z => (
              <option key={z} value={z}>{z}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3 border-t border-surface-800/30 pt-2.5">
          <label className="text-xs text-surface-400 select-none flex-1">{tr('Betriebszeiten')}
            <span className="block text-[9px] text-surface-700">{tr('Neue Drucke nur im Zeitfenster starten (Ruhezeiten / Stromtarif). Laufende Drucke werden nicht unterbrochen.')}</span></label>
          <button onClick={() => setOphEnabled(v => !v)}
            className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${ophEnabled ? 'bg-blue-600' : 'bg-surface-700'}`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${ophEnabled ? 'translate-x-4' : 'translate-x-0'}`} />
          </button>
        </div>
        {ophEnabled && (
          <div className="space-y-1">
            {[tr('Mo'), tr('Di'), tr('Mi'), tr('Do'), tr('Fr'), tr('Sa'), tr('So')].map((label, i) => {
              const day = ophSchedule[i] ?? { enabled: false, start: '22:00', end: '06:00' }
              const setDay = (patch) => setOphSchedule(s => s.map((d, j) => j === i ? { ...d, ...patch } : d))
              return (
                <div key={i} className="flex items-center gap-2">
                  <button onClick={() => setDay({ enabled: !day.enabled })}
                    className={`text-[10px] w-8 h-7 rounded border transition-colors shrink-0 ${day.enabled
                      ? 'bg-blue-900/40 border-blue-700/60 text-blue-300'
                      : 'bg-surface-900 border-surface-700 text-surface-600'}`}>{label}</button>
                  {day.enabled ? (
                    <>
                      <input type="time" value={day.start} onChange={e => setDay({ start: e.target.value })}
                        className="font-mono text-xs h-7 py-0 px-1.5 w-[88px]" />
                      <span className="text-surface-600 text-xs">–</span>
                      <input type="time" value={day.end} onChange={e => setDay({ end: e.target.value })}
                        className="font-mono text-xs h-7 py-0 px-1.5 w-[88px]" />
                      <span className="text-[9px] text-surface-700 w-14">{day.start > day.end ? tr('über Nacht') : ''}</span>
                      <button onClick={() => setOphSchedule(s => s.map(() => ({ ...day })))}
                        title={tr('Diese Zeiten auf alle Tage übernehmen')}
                        className="ml-auto text-[10px] text-surface-600 hover:text-surface-300 shrink-0">⎘ {tr('auf alle')}</button>
                    </>
                  ) : (
                    <span className="text-[10px] text-surface-600">{tr('kein Druck an diesem Tag')}</span>
                  )}
                </div>
              )
            })}
            <p className="text-[9px] text-surface-700 pt-0.5">{tr('Über-Nacht-Fenster (z. B. 22:00–06:00) erlaubt. Gilt nur für den Start neuer Drucke.')}</p>
          </div>
        )}
      </div>

      <div className="border-t border-surface-800/40 pt-3 space-y-2">
        <p className="text-[10px] text-surface-400 font-medium">{tr('Homing-Datei (G28 + Z200)')}</p>
        <div className="flex items-center gap-2">
          {homingFile?.configured
            ? <span className="flex-1 text-[10px] font-mono text-emerald-400 truncate">✓ {homingFile.filename}</span>
            : <span className="flex-1 text-[10px] font-mono text-surface-600">{tr('Nicht konfiguriert')}</span>}
          <button onClick={setupHoming} disabled={homingBusy} className="btn btn-ghost btn-sm text-[10px]">
            {homingBusy ? '…' : homingFile?.configured ? tr('↺ Neu erstellen') : tr('+ Erstellen')}
          </button>
        </div>
        <p className="text-[9px] text-surface-700 font-mono">{tr('Generiert eine .3mf mit G28+Z200 — im Sequenzeditor als ⇫ Homing verwenden')}</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">{tr('Speichern')}</button>
        {status && (
          <span className={`text-[11px] font-mono ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>
        )}
      </div>
    </div>
  )
}

/* ─── Regal-Konfiguration ────────────────────────────────────────── */
function RegalKonfiguration() {
  const { tr } = useLanguage()
  const [nr,             setNr]             = useState(3)
  const [spr,            setSpr]            = useState(6)
  const [h,              setH]              = useState(50)
  const [margin,         setMargin]         = useState(15)
  const [magazineSlot,   setMagazineSlot]   = useState(7)
  const [magazineCounts, setMagazineCounts] = useState([6, 6, 6])
  const [saving,         setSaving]         = useState(false)
  const [status,         setStatus]         = useState(null)

  const load = async () => {
    try {
      const r = await rackManagerService.getAll()
      const d = r.data
      setNr(d.num_racks ?? 3)
      setSpr(d.slots_per_rack ?? 6)
      setH(d.slot_height_mm ?? 50)
      setMargin(d.height_margin_pct ?? 15)
      setMagazineSlot(d.magazine_slot ?? 7)
      const counts = d.magazine_counts ?? []
      setMagazineCounts(counts.length ? counts : Array(d.num_racks ?? 3).fill(6))
    } catch {}
  }
  useEffect(() => { load() }, [])

  // When nr changes, resize magazine_counts to match
  const handleNrChange = (val) => {
    const n = Math.max(1, Math.min(10, +val || 1))
    setNr(n)
    setMagazineCounts(prev => {
      if (prev.length === n) return prev
      if (prev.length < n) return [...prev, ...Array(n - prev.length).fill(6)]
      return prev.slice(0, n)
    })
  }

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      await rackManagerService.updateConfig({
        num_racks:        +nr,
        slots_per_rack:   +spr,
        slot_height_mm:   +h,
        height_margin_pct: +margin,
        magazine_slot:    +magazineSlot,
        magazine_counts:  magazineCounts.map(Number),
      })
      await load()
      setStatus({ ok: true, msg: tr('Regal gespeichert.') })
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Regal-Konfiguration')}</p>
        <p className="text-[11px] text-surface-600 mt-0.5">{tr('Größe, Fach-Höhen, Magazin-Fach und Platten-Anzahl pro Rack')}</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Anzahl Racks')}</label>
          <input type="number" min="1" max="10" value={nr} onChange={e => handleNrChange(e.target.value)} className="w-full font-mono text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Fächer/Rack')}</label>
          <input type="number" min="1" max="20" value={spr} onChange={e => setSpr(e.target.value)} className="w-full font-mono text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">{tr('Fach-Höhe (mm)')}</label>
          <input type="number" min="10" max="500" value={h} onChange={e => setH(e.target.value)} className="w-full font-mono text-xs" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-surface-500 block mb-1">
          {tr('Höhen-Toleranz (%)')} <span className="text-surface-700">{tr('— Sicherheitspuffer')}</span>
        </label>
        <div className="flex items-center gap-2">
          <input type="number" min="0" max="100" step="1" value={margin} onChange={e => setMargin(e.target.value)} className="w-20 font-mono text-xs" />
          <span className="text-[10px] text-surface-500">%</span>
          {h > 0 && <span className="text-[9px] text-surface-700 font-mono">{tr('z.B. 100 mm → {0} mm effektiv', Math.round(100 * (1 + margin/100)))}</span>}
        </div>
      </div>
      <div className="border-t border-surface-800/40 pt-2 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-surface-500 flex-1">{tr('Magazin-Fach')}</p>
          <span className="text-[9px] text-surface-700 font-mono">{'{stack_slot}'} = {magazineSlot}</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min="1" max="99" value={magazineSlot}
            onChange={e => setMagazineSlot(e.target.value)} className="w-20 font-mono text-xs" />
          <span className="text-[10px] text-surface-600">{tr('Fach in jedem Rack (Standard: 7)')}</span>
        </div>
      </div>
      <div className="border-t border-surface-800/40 pt-2 space-y-2">
        <p className="text-[10px] text-surface-500">{tr('Platten pro Magazin')} <span className="text-surface-700">{tr('— aktueller Bestand')}</span></p>
        <p className="text-[9px] text-surface-700">{tr('Farm leert Rack 1 zuerst, dann 2, dann 3 usw.')}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {magazineCounts.map((cnt, ri) => (
            <div key={ri} className="flex items-center gap-1.5">
              <span className="text-[10px] text-surface-600 font-mono">R{ri + 1}</span>
              <input
                type="number" min="0" max="20" value={cnt}
                onChange={e => setMagazineCounts(prev => prev.map((c, i) => i === ri ? +e.target.value : c))}
                className="w-14 font-mono text-xs"
              />
            </div>
          ))}
          <span className="text-[9px] text-surface-700 font-mono ml-1">
            {tr('= {0} gesamt', magazineCounts.reduce((s, c) => s + (+c || 0), 0))}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">{tr('Speichern')}</button>
        {status && <span className={`text-[11px] font-mono ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>}
      </div>
    </div>
  )
}

const INITIAL_FORM = {
  name: '', device_type: 'bambu_lab', ip_address: '',
  port: 8883, serial_number: '', access_code: '',
  mqtt_port: 8883, use_tls: true,
}

function TestResultBar({ result }) {
  if (!result) return null
  return (
    <div className={`mt-3 px-4 py-3 rounded-lg border text-sm space-y-1 ${
      result.success
        ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
        : 'bg-red-950/40    border-red-800    text-red-300'
    }`}>
      <div className="flex items-center gap-2 font-medium">
        <span className={`dot ${result.success ? 'dot-green' : 'dot-red'}`} />
        {result.message}
      </div>
      {result.mqtt && (
        <div className="flex gap-4 text-xs font-mono mt-1 pl-4">
          <span>MQTT: {result.mqtt.connected ? '✓ connected' : '✗ failed'}</span>
          {result.ftp && <span>FTP: {result.ftp.connected ? '✓ connected' : `✗ ${result.ftp.message}`}</span>}
        </div>
      )}
    </div>
  )
}

/* ─── Energie & Kosten: Smart-Plug + Stromtarif (Roadmap 3.1/3.2/3.4) ──── */
function PowerSettings() {
  const { tr } = useLanguage()
  const [bambuId, setBambuId] = useState(null)
  const [cfg, setCfg] = useState({
    plug_type: 'none', plug_url: '', plug_password: '', plug_password_set: false,
    plug_token: '', plug_token_set: false, cam_ha_token_set: false,
    plug_switch_entity: '', plug_power_entity: '', plug_energy_entity: '',
  })
  const [cost, setCost] = useState({ power_price_eur_kwh: 0.30, machine_rate_eur_h: 0, filament_price_eur_kg: 20, idle_off_min: 0 })
  const [live, setLive] = useState(null)   // { watts, on, energy_kwh } | 'loading'
  const [status, setStatus] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    deviceService.listDevices().then(async d => {
      const b = d.data.find(x => x.device_type === 'bambu_lab')
      if (!b) return
      setBambuId(b.id)
      try {
        const s = await deviceSettingsService.getSettings(b.id)
        setCfg(c => ({
          ...c,
          plug_type: s.data.plug_type ?? 'none',
          plug_url: s.data.plug_url ?? '',
          plug_password: '', plug_password_set: !!s.data.plug_password_set,
          plug_token: '', plug_token_set: !!s.data.plug_token_set,
          cam_ha_token_set: !!s.data.ha_token_set,
          plug_switch_entity: s.data.plug_switch_entity ?? '',
          plug_power_entity:  s.data.plug_power_entity ?? '',
          plug_energy_entity: s.data.plug_energy_entity ?? '',
        }))
      } catch {}
    }).catch(() => {})
    autofarmService.getSettings().then(r => setCost({
      power_price_eur_kwh:   r.data.power_price_eur_kwh ?? 0.30,
      machine_rate_eur_h:    r.data.machine_rate_eur_h ?? 0,
      filament_price_eur_kg: r.data.filament_price_eur_kg ?? 20,
      idle_off_min:          r.data.idle_off_min ?? 0,
    })).catch(() => {})
  }, [])

  const isHa = cfg.plug_type === 'ha'
  const isHttp = cfg.plug_type === 'tasmota' || cfg.plug_type === 'shelly'

  const save = async () => {
    if (!bambuId) { setStatus({ ok: false, msg: tr('Kein Bambu-Gerät konfiguriert') }); return }
    setSaving(true); setStatus(null)
    try {
      const payload = {
        plug_type: cfg.plug_type, plug_url: cfg.plug_url.trim(),
        plug_switch_entity: cfg.plug_switch_entity.trim(),
        plug_power_entity:  cfg.plug_power_entity.trim(),
        plug_energy_entity: cfg.plug_energy_entity.trim(),
      }
      if (cfg.plug_password.trim()) payload.plug_password = cfg.plug_password.trim()
      if (cfg.plug_token.trim()) payload.plug_token = cfg.plug_token.trim()
      await deviceSettingsService.updateSettings(bambuId, payload)
      await autofarmService.saveSettings({
        power_price_eur_kwh:   Number(cost.power_price_eur_kwh) || 0,
        machine_rate_eur_h:    Number(cost.machine_rate_eur_h) || 0,
        filament_price_eur_kg: Number(cost.filament_price_eur_kg) || 0,
        idle_off_min:          Math.max(0, Math.round(Number(cost.idle_off_min) || 0)),
      })
      setStatus({ ok: true, msg: tr('Gespeichert.') })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  const test = async () => {
    if (!bambuId) return
    setLive('loading')
    try {
      const r = await deviceSettingsService.getPower(bambuId)
      setLive(r.data?.configured ? r.data : { error: tr('Nicht konfiguriert') })
    } catch (e) { setLive({ error: e.response?.data?.detail ?? e.message }) }
  }

  const switchPlug = async (on) => {
    if (!bambuId) return
    try { await deviceSettingsService.switchPower(bambuId, on); setTimeout(test, 800) }
    catch (e) { setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message }) }
  }

  const num = (key, step = '0.01') => (
    <input type="number" step={step} min="0" value={cost[key]}
      onChange={e => setCost(c => ({ ...c, [key]: e.target.value }))}
      className="w-24 font-mono text-xs" />
  )

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Energie & Kosten')}</p>
        <p className="text-[11px] text-surface-600 mt-0.5">{tr('Smart-Steckdose für Stromverbrauch, Auto-Abschaltung und Kostenrechnung')}</p>
      </div>

      {/* Steckdosen-Typ */}
      <div>
        <label className="text-[10px] text-surface-500 block mb-1">{tr('Steckdosen-Typ')}</label>
        <select value={cfg.plug_type} onChange={e => setCfg(c => ({ ...c, plug_type: e.target.value }))}
          className="text-xs h-8 py-0 px-2 bg-surface-900 border border-surface-700 rounded">
          <option value="none">{tr('Keine')}</option>
          <option value="ha">{tr('Home Assistant')}</option>
          <option value="tasmota">Tasmota</option>
          <option value="shelly">Shelly (Gen2)</option>
        </select>
      </div>

      {isHa && (() => {
        const tokenAvailable = !!cfg.plug_token.trim() || cfg.plug_token_set || cfg.cam_ha_token_set
        return (
        <div className="space-y-2">
          <p className="text-[10px] text-surface-600">{tr('Eigene Home-Assistant-URL + Long-Lived-Token eintragen. Leer lassen funktioniert nur, wenn HA bereits für die Kamera eingerichtet ist (dann werden dessen URL + Token genutzt).')}</p>
          <label className="text-[10px] text-surface-500 block">{tr('Home-Assistant-URL')}
            <input value={cfg.plug_url} onChange={e => setCfg(c => ({ ...c, plug_url: e.target.value }))}
              placeholder="http://192.168.1.60:8123" className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
          <label className="text-[10px] text-surface-500 block">{tr('Long-Lived-Token')}
            <input type="password" value={cfg.plug_token} onChange={e => setCfg(c => ({ ...c, plug_token: e.target.value }))}
              placeholder={cfg.plug_token_set || cfg.cam_ha_token_set ? '•••••• ' + tr('(gesetzt)') : tr('Token aus HA → Profil → Sicherheit')}
              className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
          {!tokenAvailable && (
            <p className="text-[10px] text-amber-400">{tr('⚠ Kein Token vorhanden — bitte Long-Lived-Token eintragen (deine Kamera nutzt kein Home Assistant).')}</p>
          )}
          <div className="grid grid-cols-1 gap-2">
            <label className="text-[10px] text-surface-500">{tr('Schalter-Entität (switch.…)')}
              <input value={cfg.plug_switch_entity} onChange={e => setCfg(c => ({ ...c, plug_switch_entity: e.target.value }))}
                placeholder="switch.drucker_steckdose" className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
            <label className="text-[10px] text-surface-500">{tr('Leistungs-Sensor (W, sensor.…)')}
              <input value={cfg.plug_power_entity} onChange={e => setCfg(c => ({ ...c, plug_power_entity: e.target.value }))}
                placeholder="sensor.drucker_power" className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
            <label className="text-[10px] text-surface-500">{tr('Energie-Zähler (kWh, sensor.…)')}
              <input value={cfg.plug_energy_entity} onChange={e => setCfg(c => ({ ...c, plug_energy_entity: e.target.value }))}
                placeholder="sensor.drucker_energy" className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
          </div>
        </div>
      )})()}

      {isHttp && (
        <div className="space-y-2">
          <label className="text-[10px] text-surface-500 block">{tr('Geräte-URL')}
            <input value={cfg.plug_url} onChange={e => setCfg(c => ({ ...c, plug_url: e.target.value }))}
              placeholder="http://192.168.1.61" className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
          {cfg.plug_type === 'tasmota' && (
            <label className="text-[10px] text-surface-500 block">{tr('Passwort (optional)')}
              <input type="password" value={cfg.plug_password} onChange={e => setCfg(c => ({ ...c, plug_password: e.target.value }))}
                placeholder={cfg.plug_password_set ? '•••••• ' + tr('(gesetzt)') : ''} className="text-xs h-8 py-0 px-2 mt-0.5 font-mono w-full" /></label>
          )}
        </div>
      )}

      {/* Test + Live + Schalten */}
      {cfg.plug_type !== 'none' && (
        <div className="flex items-center gap-2 flex-wrap border-t border-surface-800/40 pt-3">
          <button onClick={test} className="btn btn-ghost btn-sm">{tr('Live prüfen')}</button>
          {live === 'loading' && <span className="text-[11px] text-surface-500">{tr('Lädt…')}</span>}
          {live && live !== 'loading' && !live.error && (
            <>
              <span className="text-[11px] font-mono text-surface-300">{live.watts != null ? `${Math.round(live.watts)} W` : '— W'}</span>
              {live.energy_kwh != null && <span className="text-[11px] font-mono text-surface-500">{live.energy_kwh} kWh</span>}
              {live.on != null && <span className={`text-[10px] font-mono ${live.on ? 'text-emerald-400' : 'text-surface-600'}`}>{live.on ? tr('AN') : tr('AUS')}</span>}
              <button onClick={() => switchPlug(true)} className="btn btn-ghost btn-sm text-[10px]">{tr('Ein')}</button>
              <button onClick={() => switchPlug(false)} className="btn btn-ghost btn-sm text-[10px]">{tr('Aus')}</button>
            </>
          )}
          {live?.error && <span className="text-[11px] font-mono text-red-400">{live.error}</span>}
        </div>
      )}

      {/* Auto-Abschaltung + Kosten */}
      <div className="border-t border-surface-800/40 pt-3 grid grid-cols-2 gap-3">
        <label className="text-[10px] text-surface-500">{tr('Auto-Abschaltung nach Leerlauf (min)')}
          <div className="flex items-center gap-2 mt-0.5">
            <input type="number" min="0" step="1" value={cost.idle_off_min}
              onChange={e => setCost(c => ({ ...c, idle_off_min: e.target.value }))} className="w-20 font-mono text-xs" />
            <span className="text-[9px] text-surface-700">{Number(cost.idle_off_min) > 0 ? tr('min') : tr('(aus)')}</span>
          </div></label>
        <label className="text-[10px] text-surface-500">{tr('Strompreis (€/kWh)')}<div className="mt-0.5">{num('power_price_eur_kwh')}</div></label>
        <label className="text-[10px] text-surface-500">{tr('Maschinenstundensatz (€/h)')}<div className="mt-0.5">{num('machine_rate_eur_h')}</div></label>
        <label className="text-[10px] text-surface-500">{tr('Filamentpreis (€/kg)')}<div className="mt-0.5">{num('filament_price_eur_kg', '0.5')}</div></label>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">{tr('Speichern')}</button>
        {status && <span className={`text-[11px] font-mono ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>}
      </div>
    </div>
  )
}

/* ─── Fehlerstrategie (Roadmap 1.3) ──────────────────────────────── */
const ERROR_CATALOG = [
  { key: 'hms',             label: 'Drucker-Fehler (HMS)',        desc: 'Schwere/fatale Druckermeldung (z. B. Hardwarefehler)',        actions: ['pause', 'skip', 'stop', 'ignore'] },
  { key: 'print_failed',    label: 'Druck fehlgeschlagen',         desc: 'Drucker meldet FAILED nach den Wiederholungen',               actions: ['eject', 'skip', 'pause', 'stop'] },
  { key: 'connection_lost', label: 'Verbindung verloren',          desc: 'Drucker nach mehreren Reconnects nicht erreichbar',           actions: ['skip', 'pause', 'stop'] },
  { key: 'progress_stall',  label: 'Stillstand / kein Fortschritt', desc: 'Watchdog: kein Druckfortschritt (mögliche Verstopfung)',      actions: ['pause', 'skip', 'stop'] },
  { key: 'no_slot',         label: 'Kein freies Regalfach',        desc: 'Regal voll — kein Platz für die fertige Platte',              actions: ['pause', 'stop'] },
  { key: 'ams_unmatched',   label: 'AMS-Festlegung nötig',         desc: 'Kein passendes Filament im AMS gefunden',                     actions: ['pause', 'skip'] },
]
const ERROR_DEFAULTS = { hms: 'pause', print_failed: 'eject', connection_lost: 'skip', progress_stall: 'pause', no_slot: 'pause', ams_unmatched: 'pause' }
const ACTION_LABEL = { pause: 'Pausieren', skip: 'Job überspringen', stop: 'Farm stoppen', ignore: 'Ignorieren', eject: 'Platte auswerfen & weiter' }

function ErrorStrategy() {
  const { tr } = useLanguage()
  const [strategy, setStrategy] = useState({})
  const [retries, setRetries]   = useState(1)
  const [saving, setSaving]     = useState(false)
  const [status, setStatus]     = useState(null)

  useEffect(() => {
    autofarmService.getSettings().then(r => {
      setStrategy({ ...ERROR_DEFAULTS, ...(r.data.error_strategy || {}) })
      setRetries(r.data.failed_retries ?? 1)
    }).catch(() => setStrategy({ ...ERROR_DEFAULTS }))
  }, [])

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      await autofarmService.saveSettings({ error_strategy: strategy, failed_retries: Math.max(0, Math.round(Number(retries) || 0)) })
      setStatus({ ok: true, msg: tr('Gespeichert.') })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">{tr('Fehlerstrategie')}</p>
        <p className="text-[11px] text-surface-600 mt-0.5">{tr('Festlegen, was die Farm bei jedem Fehlertyp automatisch tut')}</p>
      </div>
      <div className="space-y-2">
        {ERROR_CATALOG.map(err => (
          <div key={err.key} className="flex items-center gap-3 py-1.5 border-b border-surface-800/40 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-surface-200">{tr(err.label)}</p>
              <p className="text-[10px] text-surface-600">{tr(err.desc)}</p>
              {err.key === 'print_failed' && (
                <>
                  <div className="flex items-center gap-1.5 mt-1">
                    <span className="text-[10px] text-surface-500">{tr('Wiederholungen:')}</span>
                    <input type="number" min="0" max="9" value={retries}
                      onChange={e => setRetries(Math.max(0, Number(e.target.value)))}
                      className="w-12 font-mono text-xs h-6 py-0" />
                  </div>
                  <p className="text-[10px] text-emerald-700/90 mt-1 leading-snug">
                    {tr('„Platte auswerfen & weiter": Bett auf Z200, Tür öffnen, Platte auswerfen und ins Fach einlagern — dann startet der nächste Job automatisch. „Job überspringen" lässt die fehlgeschlagene Platte im Drucker (nur wählen, wenn du sie selbst entnimmst).')}
                  </p>
                </>
              )}
            </div>
            <select value={strategy[err.key] ?? ERROR_DEFAULTS[err.key]}
              onChange={e => setStrategy(s => ({ ...s, [err.key]: e.target.value }))}
              className="w-44 text-xs h-8 py-0 px-2 bg-surface-900 border border-surface-700 rounded shrink-0">
              {err.actions.map(a => <option key={a} value={a}>{tr(ACTION_LABEL[a])}</option>)}
            </select>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">{tr('Speichern')}</button>
        {status && <span className={`text-[11px] font-mono ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>}
      </div>
    </div>
  )
}

function Configuration() {
  const { tr } = useLanguage()
  const [devices, setDevices]     = useState([])
  const [showForm, setShowForm]   = useState(false)
  const [editId, setEditId]       = useState(null)   // null = neues Gerät; sonst Gerät bearbeiten
  const [form, setForm]           = useState(INITIAL_FORM)
  const [testing, setTesting]       = useState(null)
  const [testResults, setTestResults] = useState({})
  const [webcamUrls, setWebcamUrls]   = useState({})       // untere (hochkant) Kamera
  const [webcamTopUrls, setWebcamTopUrls] = useState({})   // obere (Bambu / quer) Kamera
  const [haCams, setHaCams]           = useState({})       // { [id]: { url, token, entity, tokenSet } }
  const [haTest, setHaTest]           = useState({})       // { [id]: { ok, detail } | 'loading' }
  const [savingWebcam, setSavingWebcam] = useState(null)
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState(null)
  const [tab, setTab]             = useState('devices')

  const bambu = devices.find(d => d.device_type === 'bambu_lab')

  const load = async () => {
    const d = await deviceService.listDevices()
    setDevices(d.data)
    // load webcam urls for each device (untere + obere Kamera + Home-Assistant-Kamera)
    const urls = {}, tops = {}, ha = {}
    for (const dev of d.data) {
      try {
        const s = await deviceSettingsService.getSettings(dev.id)
        urls[dev.id] = s.data.webcam_url ?? ''
        tops[dev.id] = s.data.webcam_url_top ?? ''
        ha[dev.id]   = { url: s.data.ha_url ?? '', token: '', entity: s.data.ha_camera ?? '', tokenSet: !!s.data.ha_token_set }
      } catch { urls[dev.id] = ''; tops[dev.id] = ''; ha[dev.id] = { url: '', token: '', entity: '', tokenSet: false } }
    }
    setWebcamUrls(urls)
    setWebcamTopUrls(tops)
    setHaCams(ha)
  }

  useEffect(() => { load() }, [])

  // Setup-Assistent (oder andere Stellen) ändern Geräte/Einstellungen → ohne F5 neu laden.
  useEffect(() => {
    const reload = () => load()
    window.addEventListener('printloom:devicesChanged', reload)
    window.addEventListener('printloom:cameraSettingsSaved', reload)
    return () => {
      window.removeEventListener('printloom:devicesChanged', reload)
      window.removeEventListener('printloom:cameraSettingsSaved', reload)
    }
  }, [])

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target
    setForm(prev => {
      const updated = { ...prev, [name]: type === 'checkbox' ? checked : value }
      // Auto-set sensible default port when device type changes
      if (name === 'device_type') {
        updated.port = value === 'klipper' ? 7125 : 8883
      }
      return updated
    })
  }

  // Gerät zum Bearbeiten in das Formular laden. Access-Code wird NICHT vorbefüllt
  // (Geheimnis) — leer lassen heißt „unverändert".
  const startEdit = (device) => {
    setEditId(device.id)
    setForm({
      name: device.name ?? '', device_type: device.device_type ?? 'bambu_lab',
      ip_address: device.ip_address ?? '', port: device.port ?? 8883,
      serial_number: device.serial_number ?? '', access_code: '',
      mqtt_port: device.mqtt_port ?? 8883, use_tls: device.use_tls ?? true,
    })
    setShowForm(true)
    setError(null)
  }

  const closeForm = () => { setShowForm(false); setEditId(null); setForm(INITIAL_FORM); setError(null) }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      if (editId != null) {
        // Partielles Update: leeren Access-Code weglassen, damit er erhalten bleibt.
        const payload = {
          name: form.name, device_type: form.device_type, ip_address: form.ip_address,
          port: +form.port, mqtt_port: +form.mqtt_port, use_tls: form.use_tls,
          serial_number: form.serial_number,
        }
        if (form.access_code) payload.access_code = form.access_code
        await deviceService.updateDevice(editId, payload)
      } else {
        await deviceService.createDevice({ ...form, port: +form.port, mqtt_port: +form.mqtt_port })
      }
      closeForm()
      await load()
    } catch (e) {
      setError(e.response?.data?.detail ?? (editId != null ? 'Failed to update device' : 'Failed to add device'))
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!(await confirmDialog({ title: tr('Gerät löschen'), message: tr('Dieses Gerät wirklich löschen?'), confirmLabel: tr('Löschen') }))) return
    await deviceService.deleteDevice(id)
    await load()
  }

  const handleTest = async (id) => {
    setTesting(id)
    try {
      const r = await deviceService.testDevice(id)
      setTestResults(prev => ({ ...prev, [id]: r.data }))
    } catch (e) {
      setTestResults(prev => ({ ...prev, [id]: { success: false, message: e.response?.data?.detail ?? e.message } }))
    } finally {
      setTesting(null)
    }
  }

  const typeLabel = { bambu_lab: 'Bambu Lab X1C', klipper: 'Klipper / OTTOeject', otto: 'OTTOeject' }

  return (
    <div className="space-y-6">

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div className="flex gap-1 border-b border-surface-800">
        {[['devices', 'Geräte'], ['cameras', 'Kameras'], ['general', 'Allgemein']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors ${
              tab === id ? 'border-blue-500 text-surface-100' : 'border-transparent text-surface-500 hover:text-surface-300'}`}>
            {tr(label)}
          </button>
        ))}
      </div>

      {/* ── Allgemein: Farm + Regal ──────────────────────────────── */}
      {tab === 'general' && <FarmSettings />}
      {tab === 'general' && <ErrorStrategy />}
      {tab === 'general' && <PowerSettings />}
      {tab === 'general' && <RegalKonfiguration />}

      {/* ── Devices ──────────────────────────────────────────────── */}
      {tab === 'devices' && (
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="section-label mb-0">Devices</p>
          <button onClick={() => (showForm ? closeForm() : setShowForm(true))} className="btn btn-primary btn-sm">
            {showForm ? tr('Abbrechen') : '+ Add Device'}
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-surface-900 rounded-xl border border-surface-700 p-5 mb-4 space-y-4">
            <p className="text-sm font-medium text-surface-200">{editId != null ? tr('Gerät bearbeiten') : tr('Neues Gerät')}</p>
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-sm">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-surface-500 block mb-1">Device Name</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. Bambu Lab X1C" required />
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Device Type{editId != null ? ` (${tr('nicht änderbar')})` : ''}</label>
                <select name="device_type" value={form.device_type} onChange={handleChange} disabled={editId != null}
                  className={editId != null ? 'opacity-60 cursor-not-allowed' : ''}>
                  <option value="bambu_lab">Bambu Lab X1C</option>
                  <option value="klipper">Klipper / OTTOeject</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">IP Address</label>
                <input name="ip_address" value={form.ip_address} onChange={handleChange} placeholder="192.168.1.100" required />
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Port</label>
                <input name="port" type="number" value={form.port} onChange={handleChange} required />
              </div>
            </div>

            {form.device_type === 'bambu_lab' && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Serial Number</label>
                  <input name="serial_number" value={form.serial_number} onChange={handleChange} placeholder={tr('z. B. 00M…')} required />
                </div>
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Access Code</label>
                  <input name="access_code" type="password" value={form.access_code} onChange={handleChange}
                    required={editId == null}
                    placeholder={editId != null ? tr('leer lassen = unverändert') : ''} />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" name="use_tls" id="use_tls" checked={form.use_tls} onChange={handleChange} className="w-auto" />
                  <label htmlFor="use_tls" className="text-sm text-surface-400 cursor-pointer">Use TLS (recommended)</label>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? tr('Speichert…') : (editId != null ? tr('Änderungen speichern') : 'Add Device')}
              </button>
            </div>
          </form>
        )}

        {/* Device list */}
        {devices.length === 0 ? (
          <p className="text-sm text-surface-500 py-6 text-center">No devices configured</p>
        ) : (
          <div className="space-y-3">
            {devices.map(device => (
              <div key={device.id}>
                <div className="flex items-center justify-between px-4 py-3 rounded-lg bg-surface-900 border border-surface-700">
                  <div className="flex items-center gap-4">
                    <div>
                      <p className="text-sm font-medium text-surface-200">{device.name}</p>
                      <p className="text-xs text-surface-500 font-mono mt-0.5">
                        {typeLabel[device.device_type] ?? device.device_type} · {device.ip_address}:{device.port}
                      </p>
                      {device.serial_number && (
                        <p className="text-xs text-surface-600 font-mono">S/N: {device.serial_number}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${device.is_active ? 'badge-green' : 'badge-red'}`}>
                      {device.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => handleTest(device.id)}
                      disabled={testing === device.id}
                      className="btn btn-ghost btn-sm"
                    >
                      {testing === device.id ? 'Testing...' : 'Test'}
                    </button>
                    <button onClick={() => startEdit(device)} className={`btn-icon ${editId === device.id ? 'text-blue-400' : ''}`} title={tr('Gerät bearbeiten')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                      </svg>
                    </button>
                    <button onClick={() => handleDelete(device.id)} className="btn-icon" title={tr('Gerät löschen')}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                </div>
                {testResults[device.id] && <TestResultBar result={testResults[device.id]} />}
              </div>
            ))}
          </div>
        )}
      </div>
      )}

      {/* ── Kameras (eigener Tab; gilt für den Bambu-Drucker) ─────── */}
      {tab === 'cameras' && (
        <div className="card space-y-3">
          <p className="section-label">{tr('Kameras (AutoFarm)')}</p>
          {!bambu ? (
            <p className="text-sm text-surface-500">{tr('Erst unter „Geräte" einen Bambu-Drucker anlegen — dann hier die Kameras konfigurieren.')}</p>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <span className="text-xs text-surface-600 w-32 shrink-0">{tr('Oben (Bambu / quer)')}</span>
                <input type="text" placeholder="http://192.168.1.50:8889/bambu  (WebRTC/HLS/MJPEG)"
                  value={webcamTopUrls[bambu.id] ?? ''}
                  onChange={e => setWebcamTopUrls(prev => ({ ...prev, [bambu.id]: e.target.value }))}
                  className="flex-1 text-xs font-mono py-1" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-surface-600 w-32 shrink-0">{tr('Unten (hochkant)')}</span>
                <input type="text" placeholder="http://192.168.1.50:8889/stream  (WebRTC/HLS/MJPEG)"
                  value={webcamUrls[bambu.id] ?? ''}
                  onChange={e => setWebcamUrls(prev => ({ ...prev, [bambu.id]: e.target.value }))}
                  className="flex-1 text-xs font-mono py-1" />
              </div>

              {/* Home-Assistant-Kamera (eingebaute X1C-Cam, Firmware ≥01.11). */}
              <div className="mt-1 pt-2 border-t border-surface-800 space-y-2">
                <p className="text-[11px] text-surface-500 font-medium">
                  {tr('🏠 X1C-Kamera über Home Assistant')}
                  <span className="text-surface-600 font-normal">{tr(' — für die eingebaute Cam (oben). Wird in AutoFarm automatisch als „Oben"-Kamera genutzt.')}</span>
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-surface-600 w-32 shrink-0">{tr('HA-URL')}</span>
                  <input type="text" placeholder="http://192.168.1.60:8123"
                    value={haCams[bambu.id]?.url ?? ''}
                    onChange={e => setHaCams(prev => ({ ...prev, [bambu.id]: { ...prev[bambu.id], url: e.target.value } }))}
                    className="flex-1 text-xs font-mono py-1" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-surface-600 w-32 shrink-0">{tr('Entity-ID')}</span>
                  <input type="text" placeholder="camera.x1c_..._kamera"
                    value={haCams[bambu.id]?.entity ?? ''}
                    onChange={e => setHaCams(prev => ({ ...prev, [bambu.id]: { ...prev[bambu.id], entity: e.target.value } }))}
                    className="flex-1 text-xs font-mono py-1" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-surface-600 w-32 shrink-0">{tr('Token')}</span>
                  <input type="password" autoComplete="off"
                    placeholder={haCams[bambu.id]?.tokenSet ? tr('•••••• (gesetzt — leer lassen zum Behalten)') : tr('Long-Lived Access Token aus HA')}
                    value={haCams[bambu.id]?.token ?? ''}
                    onChange={e => setHaCams(prev => ({ ...prev, [bambu.id]: { ...prev[bambu.id], token: e.target.value } }))}
                    className="flex-1 text-xs font-mono py-1" />
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => {
                    setHaTest(prev => ({ ...prev, [bambu.id]: 'loading' }))
                    try { const r = await printerService.haCameraTest(bambu.id); setHaTest(prev => ({ ...prev, [bambu.id]: r.data })) }
                    catch (e) { setHaTest(prev => ({ ...prev, [bambu.id]: { ok: false, detail: e.response?.data?.detail || String(e) } })) }
                  }} className="btn btn-ghost btn-sm text-xs">{tr('Testen')}</button>
                  {haTest[bambu.id] === 'loading'
                    ? <span className="text-[10px] text-surface-500">{tr('prüfe …')}</span>
                    : haTest[bambu.id]
                      ? <span className={`text-[10px] ${haTest[bambu.id].ok ? 'text-green-400' : 'text-red-400'}`}>{haTest[bambu.id].detail}</span>
                      : <span className="text-[10px] text-surface-600">{tr('erst speichern, dann testen')}</span>}
                  <button onClick={async () => {
                    // HA komplett entfernen (inkl. gespeichertem Token → ha_token: null löscht serverseitig).
                    try {
                      await deviceSettingsService.updateSettings(bambu.id, { ha_url: '', ha_camera: '', ha_token: null })
                      setHaCams(prev => ({ ...prev, [bambu.id]: { url: '', entity: '', token: '', tokenSet: false } }))
                      setHaTest(prev => ({ ...prev, [bambu.id]: null }))
                      window.dispatchEvent(new CustomEvent('printloom:cameraSettingsSaved'))
                    } catch (e) { console.error(e) }
                  }} className="btn btn-ghost btn-sm text-xs ml-auto text-red-400/80 hover:text-red-300">
                    {tr('HA-Kamera entfernen')}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] text-surface-600">{tr('Typ wird automatisch erkannt — Port 8889 = WebRTC (<1 s), 8888/.m3u8 = HLS, sonst MJPEG.')}</p>
                <button onClick={async () => {
                  setSavingWebcam(bambu.id)
                  try {
                    const ha = haCams[bambu.id] || {}
                    const payload = {
                      webcam_url:     webcamUrls[bambu.id] ?? '',
                      webcam_url_top: webcamTopUrls[bambu.id] ?? '',
                      ha_url:    (ha.url || '').trim(),
                      ha_camera: (ha.entity || '').trim(),
                    }
                    if ((ha.token || '').trim()) payload.ha_token = ha.token.trim()
                    await deviceSettingsService.updateSettings(bambu.id, payload)
                    if ((ha.token || '').trim())
                      setHaCams(prev => ({ ...prev, [bambu.id]: { ...prev[bambu.id], token: '', tokenSet: true } }))
                    window.dispatchEvent(new CustomEvent('printloom:cameraSettingsSaved'))
                  } catch(e) { console.error(e) }
                  finally { setSavingWebcam(null) }
                }} disabled={savingWebcam === bambu.id} className="btn btn-ghost btn-sm flex-shrink-0 text-xs">
                  {savingWebcam === bambu.id ? '...' : tr('Speichern')}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'general' && <LanguagePacks />}
    </div>
  )
}

export default Configuration
