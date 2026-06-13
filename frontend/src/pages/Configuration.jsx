import React, { useState, useEffect, useRef } from 'react'
import { deviceService, configService, deviceSettingsService, systemService, marketplaceService, autofarmService, rackManagerService, printerService } from '../services/api'
import { availableLanguages, setLanguage, useLanguage } from '../services/i18n'

/* ─── Language & downloadable language packs ─────────────────────── */
function LanguagePacks() {
  const { lang } = useLanguage()
  const [installed, setInstalled] = useState({})
  const [catalog, setCatalog]     = useState(null)  // null = not loaded
  const [status, setStatus]       = useState(null)
  const [busy, setBusy]           = useState(false)
  const fileRef = useRef()

  const loadInstalled = () => systemService.getLangInstalled()
    .then(r => setInstalled(r.data || {})).catch(() => {})
  useEffect(() => { loadInstalled() }, [])

  const loadCatalog = async () => {
    setBusy(true); setStatus(null)
    try {
      const r = await systemService.getLangCatalog()
      setCatalog(Array.isArray(r.data) ? r.data : (r.data?.items || r.data?.langpacks || []))
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
      setCatalog([])
    } finally { setBusy(false) }
  }

  const install = async (code) => {
    setBusy(true); setStatus(null)
    try {
      await systemService.installLang(code)
      await loadInstalled()
      setStatus({ ok: true, msg: `Sprachpaket „${code}" installiert. Zum Aktivieren auswählen.` })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setBusy(false) }
  }

  const importFile = (e) => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file) return
    setStatus(null)
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const pack = JSON.parse(ev.target.result)
        if (!pack.code || !pack.translations) throw new Error('Pack braucht code + translations')
        await systemService.importLang({ code: pack.code, name: pack.name, translations: pack.translations })
        await loadInstalled()
        setStatus({ ok: true, msg: `Sprachpaket „${pack.code}" importiert.` })
      } catch (e2) {
        setStatus({ ok: false, msg: e2.response?.data?.detail ?? e2.message })
      }
    }
    reader.readAsText(file)
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
        <p className="section-label">Sprache & Sprachpakete</p>
        <p className="text-[11px] text-surface-600 mt-0.5">
          Standard ist Deutsch. Weitere Sprachen lassen sich aus dem Server-Katalog laden oder als Datei importieren.
        </p>
      </div>

      {/* Active language */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[10px] text-surface-600 mr-1">Aktiv:</span>
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
          <p className="text-[10px] text-surface-600">Installierte Pakete</p>
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
        <button onClick={loadCatalog} disabled={busy} className="btn btn-secondary btn-sm">Katalog laden</button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={importFile} />
        <button onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm">Pack importieren</button>
      </div>

      {/* Catalog list */}
      {catalog && (
        <div className="space-y-1.5">
          {!catalog.length && <p className="text-xs text-surface-700">Keine Pakete im Katalog.</p>}
          {catalog.map((c) => (
            <div key={c.code} className="flex items-center gap-2 text-xs rounded-lg border border-surface-800/60 bg-surface-900/40 p-2">
              <span className="font-mono text-surface-300">{(c.code || '').toUpperCase()}</span>
              <span className="text-surface-500 flex-1 truncate">{c.name || c.code}</span>
              <button onClick={() => install(c.code)} disabled={busy} className="btn btn-ghost btn-sm">Installieren</button>
            </div>
          ))}
        </div>
      )}

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

/* ─── Marketplace connection (server URL + om4d_ token) ──────────── */
function MarketplaceSettings() {
  const [serverUrl, setServerUrl] = useState('')
  const [tokenSet, setTokenSet]   = useState(false)
  const [token, setToken]         = useState('')
  const [saving, setSaving]       = useState(false)
  const [status, setStatus]       = useState(null)  // {ok, msg}

  const load = () => systemService.getMarketplace()
    .then(r => { setServerUrl(r.data.server_url || ''); setTokenSet(!!r.data.token_set) })
    .catch(() => {})
  useEffect(() => { load() }, [])

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      const payload = { server_url: serverUrl }
      if (token) payload.token = token
      await systemService.saveMarketplace(payload)
      setToken(''); await load()
      setStatus({ ok: true, msg: 'Gespeichert.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  const test = async () => {
    setStatus(null)
    try {
      const r = await marketplaceService.me()
      const u = r.data?.username || r.data?.name || 'verbunden'
      setStatus({ ok: true, msg: `Verbunden als ${u}` })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    }
  }

  const clearToken = async () => {
    setSaving(true); setStatus(null)
    try {
      await systemService.saveMarketplace({ server_url: serverUrl, token: '' })
      await load(); setStatus({ ok: true, msg: 'Token entfernt.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">Marktplatz-Verbindung</p>
        <p className="text-[11px] text-surface-600 mt-0.5">
          Server für Profil-Marktplatz & Sprachpakete. Melde dich im Browser auf dem Server
          (Discord-Login) an, erstelle dort ein API-Token (om4d_…) und füge es hier ein.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-surface-600 block mb-0.5">Server-URL</label>
          <input type="text" value={serverUrl} onChange={e => setServerUrl(e.target.value)}
            placeholder="https://marketplace.alexsz.de" className="w-full text-xs font-mono" />
        </div>
        <div>
          <label className="text-[10px] text-surface-600 block mb-0.5">
            API-Token {tokenSet && <span className="text-emerald-600">· gesetzt</span>}
          </label>
          <input type="password" value={token} onChange={e => setToken(e.target.value)}
            placeholder={tokenSet ? '•••••••• (unverändert lassen)' : 'om4d_…'} className="w-full text-xs font-mono" />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">Speichern</button>
        <button onClick={test} className="btn btn-ghost btn-sm">Verbindung testen</button>
        {tokenSet && <button onClick={clearToken} disabled={saving} className="btn btn-ghost btn-sm text-red-400">Token entfernen</button>}
      </div>
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
  const [pollInterval,    setPollInterval]    = useState(20)
  const [minPrintMinutes, setMinPrintMinutes] = useState(0)
  const [useAms,          setUseAms]          = useState(true)
  const [homingFile,      setHomingFile]      = useState(null)
  const [homingBusy,      setHomingBusy]      = useState(false)
  const [loaded,          setLoaded]          = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [status,          setStatus]          = useState(null)
  const saveRef = useRef(null)

  useEffect(() => {
    autofarmService.getSettings()
      .then(r => {
        setPollInterval(r.data.poll_interval ?? 20)
        setMinPrintMinutes(r.data.min_print_minutes ?? 0)
        setUseAms(r.data.use_ams ?? true)
      }).catch(() => {}).finally(() => setLoaded(true))
    autofarmService.getHomingFileInfo()
      .then(r => setHomingFile(r.data)).catch(() => {})
  }, [])

  const save = async () => {
    setSaving(true); setStatus(null)
    try {
      await autofarmService.saveSettings({ poll_interval: pollInterval, min_print_minutes: minPrintMinutes, use_ams: useAms })
      setStatus({ ok: true, msg: 'Einstellungen gespeichert.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  const setupHoming = async () => {
    setHomingBusy(true)
    try {
      const r = await autofarmService.setupHomingFile()
      setHomingFile({ configured: true, file_id: r.data.file_id, filename: r.data.filename })
      setStatus({ ok: true, msg: 'Homing-Datei erstellt.' })
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setHomingBusy(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">Farm-Einstellungen</p>
        <p className="text-[11px] text-surface-600 mt-0.5">Drucker-Poll, Mindestdruckzeit, AMS, Homing-Datei</p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">Drucker-Poll (Sekunden)</label>
          <div className="flex items-center gap-2">
            <input type="number" min="1" max="600" value={pollInterval}
              onChange={e => setPollInterval(Math.max(1, Number(e.target.value)))}
              className="w-20 font-mono text-xs" />
            <span className="text-[10px] text-surface-700">1–600 s</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">Mindestdruckzeit (Minuten)</label>
          <div className="flex items-center gap-2">
            <input type="number" min="0" max="999" value={minPrintMinutes}
              onChange={e => setMinPrintMinutes(Math.max(0, Number(e.target.value)))}
              className="w-20 font-mono text-xs" />
            <span className="text-[10px] text-surface-700">{minPrintMinutes === 0 ? '(deaktiviert)' : 'min'}</span>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-xs text-surface-400 select-none">AMS verwenden</label>
        <button onClick={() => setUseAms(v => !v)}
          className={`relative w-9 h-5 rounded-full transition-colors ${useAms ? 'bg-blue-600' : 'bg-surface-700'}`}>
          <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useAms ? 'translate-x-4' : 'translate-x-0'}`} />
        </button>
      </div>
      <div className="border-t border-surface-800/40 pt-3 space-y-2">
        <p className="text-[10px] text-surface-400 font-medium">Homing-Datei (G28 + Z200)</p>
        <div className="flex items-center gap-2">
          {homingFile?.configured
            ? <span className="flex-1 text-[10px] font-mono text-emerald-400 truncate">✓ {homingFile.filename}</span>
            : <span className="flex-1 text-[10px] font-mono text-surface-600">Nicht konfiguriert</span>}
          <button onClick={setupHoming} disabled={homingBusy} className="btn btn-ghost btn-sm text-[10px]">
            {homingBusy ? '…' : homingFile?.configured ? '↺ Neu erstellen' : '+ Erstellen'}
          </button>
        </div>
        <p className="text-[9px] text-surface-700 font-mono">Generiert eine .3mf mit G28+Z200 — im Sequenzeditor als ⇫ Homing verwenden</p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">Speichern</button>
        {status && (
          <span className={`text-[11px] font-mono ${status.ok ? 'text-emerald-400' : 'text-red-400'}`}>{status.msg}</span>
        )}
      </div>
    </div>
  )
}

/* ─── Regal-Konfiguration ────────────────────────────────────────── */
function RegalKonfiguration() {
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
      setStatus({ ok: true, msg: 'Regal gespeichert.' })
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
    } catch (e) {
      setStatus({ ok: false, msg: e.response?.data?.detail ?? e.message })
    } finally { setSaving(false) }
  }

  return (
    <div className="card space-y-3">
      <div>
        <p className="section-label">Regal-Konfiguration</p>
        <p className="text-[11px] text-surface-600 mt-0.5">Größe, Fach-Höhen, Magazin-Fach und Platten-Anzahl pro Rack</p>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">Anzahl Racks</label>
          <input type="number" min="1" max="10" value={nr} onChange={e => handleNrChange(e.target.value)} className="w-full font-mono text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">Fächer/Rack</label>
          <input type="number" min="1" max="20" value={spr} onChange={e => setSpr(e.target.value)} className="w-full font-mono text-xs" />
        </div>
        <div>
          <label className="text-[10px] text-surface-500 block mb-1">Fach-Höhe (mm)</label>
          <input type="number" min="10" max="500" value={h} onChange={e => setH(e.target.value)} className="w-full font-mono text-xs" />
        </div>
      </div>
      <div>
        <label className="text-[10px] text-surface-500 block mb-1">
          Höhen-Toleranz (%) <span className="text-surface-700">— Sicherheitspuffer</span>
        </label>
        <div className="flex items-center gap-2">
          <input type="number" min="0" max="100" step="1" value={margin} onChange={e => setMargin(e.target.value)} className="w-20 font-mono text-xs" />
          <span className="text-[10px] text-surface-500">%</span>
          {h > 0 && <span className="text-[9px] text-surface-700 font-mono">z.B. 100 mm → {Math.round(100 * (1 + margin/100))} mm effektiv</span>}
        </div>
      </div>
      <div className="border-t border-surface-800/40 pt-2 space-y-2">
        <div className="flex items-center gap-2">
          <p className="text-[10px] text-surface-500 flex-1">Magazin-Fach</p>
          <span className="text-[9px] text-surface-700 font-mono">{'{stack_slot}'} = {magazineSlot}</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="number" min="1" max="99" value={magazineSlot}
            onChange={e => setMagazineSlot(e.target.value)} className="w-20 font-mono text-xs" />
          <span className="text-[10px] text-surface-600">Fach in jedem Rack (Standard: 7)</span>
        </div>
      </div>
      <div className="border-t border-surface-800/40 pt-2 space-y-2">
        <p className="text-[10px] text-surface-500">Platten pro Magazin <span className="text-surface-700">— aktueller Bestand</span></p>
        <p className="text-[9px] text-surface-700">Farm leert Rack 1 zuerst, dann 2, dann 3 usw.</p>
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
            = {magazineCounts.reduce((s, c) => s + (+c || 0), 0)} gesamt
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="btn btn-secondary btn-sm">Speichern</button>
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

function Configuration() {
  const [devices, setDevices]     = useState([])
  const [showForm, setShowForm]   = useState(false)
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await deviceService.createDevice({ ...form, port: +form.port, mqtt_port: +form.mqtt_port })
      setForm(INITIAL_FORM)
      setShowForm(false)
      await load()
    } catch (e) {
      setError(e.response?.data?.detail ?? 'Failed to add device')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this device?')) return
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

      {/* ── Farm-Einstellungen ───────────────────────────────────── */}
      <FarmSettings />

      {/* ── Regal-Konfiguration ──────────────────────────────────── */}
      <RegalKonfiguration />

      {/* ── Devices ──────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="section-label mb-0">Devices</p>
          <button onClick={() => setShowForm(v => !v)} className="btn btn-primary btn-sm">
            {showForm ? 'Cancel' : '+ Add Device'}
          </button>
        </div>

        {/* Add form */}
        {showForm && (
          <form onSubmit={handleSubmit} className="bg-surface-900 rounded-xl border border-surface-700 p-5 mb-4 space-y-4">
            {error && (
              <div className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-sm">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-surface-500 block mb-1">Device Name</label>
                <input name="name" value={form.name} onChange={handleChange} placeholder="e.g. Bambu Lab X1C" required />
              </div>
              <div>
                <label className="text-xs text-surface-500 block mb-1">Device Type</label>
                <select name="device_type" value={form.device_type} onChange={handleChange}>
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
                  <input name="serial_number" value={form.serial_number} onChange={handleChange} placeholder="00M09D..." required />
                </div>
                <div>
                  <label className="text-xs text-surface-500 block mb-1">Access Code</label>
                  <input name="access_code" type="password" value={form.access_code} onChange={handleChange} required />
                </div>
                <div className="col-span-2 flex items-center gap-2">
                  <input type="checkbox" name="use_tls" id="use_tls" checked={form.use_tls} onChange={handleChange} className="w-auto" />
                  <label htmlFor="use_tls" className="text-sm text-surface-400 cursor-pointer">Use TLS (recommended)</label>
                </div>
              </div>
            )}

            <div className="flex justify-end">
              <button type="submit" disabled={saving} className="btn btn-primary">
                {saving ? 'Saving...' : 'Add Device'}
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
                    <button onClick={() => handleDelete(device.id)} className="btn-icon" title="Delete device">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                      </svg>
                    </button>
                  </div>
                </div>
                {testResults[device.id] && <TestResultBar result={testResults[device.id]} />}
                {/* Kameras (zwei Streams: oben quer = Bambu, unten hochkant) */}
                <div className="mt-2 px-4 pb-3 space-y-2">
                  <p className="text-xs text-surface-500 font-medium">Kameras (AutoFarm)</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-surface-600 w-32 shrink-0">Oben (Bambu / quer)</span>
                    <input
                      type="text"
                      placeholder="http://192.168.1.50:8889/bambu  (WebRTC/HLS/MJPEG)"
                      value={webcamTopUrls[device.id] ?? ''}
                      onChange={e => setWebcamTopUrls(prev => ({ ...prev, [device.id]: e.target.value }))}
                      className="flex-1 text-xs font-mono py-1"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-surface-600 w-32 shrink-0">Unten (hochkant)</span>
                    <input
                      type="text"
                      placeholder="http://192.168.1.50:8889/stream  (WebRTC/HLS/MJPEG)"
                      value={webcamUrls[device.id] ?? ''}
                      onChange={e => setWebcamUrls(prev => ({ ...prev, [device.id]: e.target.value }))}
                      className="flex-1 text-xs font-mono py-1"
                    />
                  </div>

                  {/* Home-Assistant-Kamera (für die eingebaute X1C-Cam auf Firmware ≥01.11).
                      HA ist der eine Kamera-Client; die App zapft den Stream von HA ab. */}
                  <div className="mt-1 pt-2 border-t border-surface-800 space-y-2">
                    <p className="text-[11px] text-surface-500 font-medium">
                      🏠 X1C-Kamera über Home Assistant
                      <span className="text-surface-600 font-normal"> — für die eingebaute Cam (oben). Trägt sich beim Speichern automatisch als „Oben"-Kamera ein.</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-600 w-32 shrink-0">HA-URL</span>
                      <input type="text" placeholder="http://192.168.1.60:8123"
                        value={haCams[device.id]?.url ?? ''}
                        onChange={e => setHaCams(prev => ({ ...prev, [device.id]: { ...prev[device.id], url: e.target.value } }))}
                        className="flex-1 text-xs font-mono py-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-600 w-32 shrink-0">Entity-ID</span>
                      <input type="text" placeholder="camera.x1c_..._kamera"
                        value={haCams[device.id]?.entity ?? ''}
                        onChange={e => setHaCams(prev => ({ ...prev, [device.id]: { ...prev[device.id], entity: e.target.value } }))}
                        className="flex-1 text-xs font-mono py-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-surface-600 w-32 shrink-0">Token</span>
                      <input type="password" autoComplete="off"
                        placeholder={haCams[device.id]?.tokenSet ? '•••••• (gesetzt — leer lassen zum Behalten)' : 'Long-Lived Access Token aus HA'}
                        value={haCams[device.id]?.token ?? ''}
                        onChange={e => setHaCams(prev => ({ ...prev, [device.id]: { ...prev[device.id], token: e.target.value } }))}
                        className="flex-1 text-xs font-mono py-1" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={async () => {
                          setHaTest(prev => ({ ...prev, [device.id]: 'loading' }))
                          try {
                            const r = await printerService.haCameraTest(device.id)
                            setHaTest(prev => ({ ...prev, [device.id]: r.data }))
                          } catch (e) {
                            setHaTest(prev => ({ ...prev, [device.id]: { ok: false, detail: e.response?.data?.detail || String(e) } }))
                          }
                        }}
                        className="btn btn-ghost btn-sm text-xs">Testen</button>
                      {haTest[device.id] === 'loading'
                        ? <span className="text-[10px] text-surface-500">prüfe …</span>
                        : haTest[device.id]
                          ? <span className={`text-[10px] ${haTest[device.id].ok ? 'text-green-400' : 'text-red-400'}`}>{haTest[device.id].detail}</span>
                          : <span className="text-[10px] text-surface-600">erst speichern, dann testen</span>}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] text-surface-600">Typ wird automatisch erkannt — Port 8889 = WebRTC (&lt;1 s), 8888/.m3u8 = HLS, sonst MJPEG. Oben leer = eingebaute X1C-Kamera.</p>
                    <button
                      onClick={async () => {
                        setSavingWebcam(device.id)
                        try {
                          const ha = haCams[device.id] || {}
                          const payload = {
                            webcam_url:     webcamUrls[device.id] ?? '',
                            webcam_url_top: webcamTopUrls[device.id] ?? '',
                            ha_url:    (ha.url || '').trim(),
                            ha_camera: (ha.entity || '').trim(),
                          }
                          // Token nur senden, wenn der User etwas eingetippt hat (leer = behalten).
                          if ((ha.token || '').trim()) payload.ha_token = ha.token.trim()
                          await deviceSettingsService.updateSettings(device.id, payload)
                          if ((ha.token || '').trim())
                            setHaCams(prev => ({ ...prev, [device.id]: { ...prev[device.id], token: '', tokenSet: true } }))
                          window.dispatchEvent(new CustomEvent('printloom:cameraSettingsSaved'))
                        } catch(e) { console.error(e) }
                        finally { setSavingWebcam(null) }
                      }}
                      disabled={savingWebcam === device.id}
                      className="btn btn-ghost btn-sm flex-shrink-0 text-xs"
                    >
                      {savingWebcam === device.id ? '...' : 'Speichern'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <MarketplaceSettings />
      <LanguagePacks />
    </div>
  )
}

export default Configuration
