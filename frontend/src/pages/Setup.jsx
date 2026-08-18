import React, { useState, useEffect } from 'react'
import { deviceService, rackManagerService, autofarmService, controlService } from '../services/api'
import { useLanguage, setLanguage, availableLanguages, trProblem } from '../services/i18n'
import { TIMEZONES } from './Configuration'
import { PRINTERS } from '../services/printers'
import SetupHealth from '../components/SetupHealth'
import RackPreview from '../components/RackPreview'
import FirstCalibration from '../components/FirstCalibration'
import { COMPONENT_GROUPS, derivedConfig, loadComponents, saveComponents,
         pitchToGap, gapToPitch, VENDOR_LABEL } from '../services/hardware'

export const SETUP_DONE_KEY = 'ottomat3d_setup_done'

const STEPS = ['Willkommen', 'Komponenten', 'Drucker', 'OTTOeject', 'Regal', 'Kalibrierung', 'Einmessen']

function StepDots({ step }) {
  const { tr } = useLanguage()
  return (
    <div className="flex items-center gap-2 mb-6">
      {STEPS.map((label, i) => (
        <React.Fragment key={label}>
          <div className="flex flex-col items-center gap-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-mono border transition-colors ${
              i < step  ? 'bg-emerald-600 border-emerald-500 text-white'
              : i === step ? 'bg-blue-600 border-blue-500 text-white'
              : 'border-surface-700 text-surface-600'
            }`}>{i < step ? '✓' : i + 1}</div>
            <span className={`text-[9px] ${i === step ? 'text-blue-300' : 'text-surface-600'}`}>{tr(label)}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-emerald-700' : 'bg-surface-800'}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}

/* Ergebnis des Trockenlaufs: Schrittliste mit Ziel-Fach und Achs-Problemen.
   Bewusst kompakt — es geht um „passt das?", nicht um eine G-code-Anzeige. */
function DryRunResult({ dry, tr }) {
  if (dry.error) return <p className="text-xs text-red-400">{tr(dry.error)}</p>
  const errs = dry.errors ?? []
  // Fach-Angaben baut die Oberfläche selbst aus Regal/Fach — das Backend kennt die
  // eingestellte Sprache nicht (siehe trProblem in services/i18n).
  const slotText = (rack, slot, fallback) =>
    (rack != null && slot != null) ? tr('R{0} Fach {1}', rack, slot) : (fallback || '')
  return (
    <div className="space-y-2">
      <div className="text-[11px] text-surface-400 font-mono">
        {tr('Quelle')}: {slotText(dry.start?.source_rack, dry.start?.source_slot, dry.start?.source)} ·{' '}
        {tr('Ziel-Fach')}: {dry.start?.target_slot || '—'} ·{' '}
        {tr('{0} Platten bereit', dry.start?.plates_available ?? 0)}
      </div>
      {(dry.warnings ?? []).map((w, i) => (
        <p key={i} className="text-[11px] text-amber-300">⚠ {trProblem(w)}</p>
      ))}
      {errs.length > 0 && (
        <div className="rounded-lg border border-red-800 bg-red-950/30 p-2 space-y-1">
          {errs.map((e, i) => <p key={i} className="text-[11px] text-red-300">{trProblem(e)}</p>)}
        </div>
      )}
      <ol className="space-y-0.5">
        {(dry.steps ?? []).map((s, i) => (
          <li key={i} className="flex items-center gap-2 text-[11px]">
            <span className="font-mono text-surface-700 w-6 text-right">{i + 1}</span>
            <span className={s.problems?.length ? 'text-red-300' : 'text-surface-300'}>{tr(s.label)}</span>
            {(s.target || s.target_rack != null) && (
              <span className="font-mono text-surface-600">
                {slotText(s.target_rack, s.target_slot, s.target)}
              </span>
            )}
            {s.note && <span className="text-surface-600">· {tr(s.note)}</span>}
          </li>
        ))}
      </ol>
      {!errs.length && (dry.steps ?? []).length > 0 && (
        <p className="text-[11px] text-emerald-400">{tr('✓ Kein Schritt würde aus der Achse fahren.')}</p>
      )}
    </div>
  )
}

export default function Setup({ setCurrentPage }) {
  const { tr, lang } = useLanguage()
  const [step, setStep] = useState(0)

  // Step 0 — Zeitzone (2.1): Basis für Betriebszeiten/Uhrzeiten. Container läuft i. d. R.
  // in UTC → ohne Zeitzone würde die Farm zur falschen Uhrzeit starten.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [tz, setTz] = useState(browserTz)

  // Step 1 — verbaute Komponenten (bestimmen die Grundkonfiguration)
  const [components, setComponents] = useState(loadComponents)
  const [cSaving, setCSaving]       = useState(false)
  const [cErr, setCErr]             = useState(null)

  // Step 2 — printer
  const [devices, setDevices]   = useState([])
  const [pForm, setPForm]       = useState({ name: 'Bambu X1C', model: '', ip_address: '', serial_number: '', access_code: '' })
  // Modelle aus dem Backend (printer_models): bestimmt Kamera-Protokoll + Fähigkeiten.
  const [models, setModels]     = useState([])
  const [pSaving, setPSaving]   = useState(false)
  const [pErr, setPErr]         = useState(null)
  const [pTest, setPTest]       = useState(null)   // Bambu-Testergebnis
  const [pTesting, setPTesting] = useState(false)

  // Step 3 — klipper / OTTOeject (eigenes Gerät, wie der Drucker)
  const [kForm, setKForm]       = useState({ name: 'OTTOeject', ip_address: '', port: 7125 })
  const [kSaving, setKSaving]   = useState(false)
  const [kErr, setKErr]         = useState(null)
  const [kTest, setKTest]       = useState(null)
  const [kTesting, setKTesting] = useState(false)

  // Step 4 — rack
  const [nr, setNr]   = useState(3)
  const [spr, setSpr] = useState(6)
  const [h, setH]     = useState(50)
  const [pitch, setPitch] = useState(55)      // gemessener Z-Abstand Fach→Fach (slot_gap+30)
  const [magSlot, setMagSlot] = useState(7)   // 0 = kein Magazin
  const [rSaving, setRSaving] = useState(false)

  // Step 5 — homing, Achsgrenzen, Trockenlauf
  const [homing, setHoming]   = useState(null)
  const [hBusy, setHBusy]     = useState(false)
  const [limitsBusy, setLimitsBusy] = useState(false)
  const [limitsMsg, setLimitsMsg]   = useState('')
  const [limitsErr, setLimitsErr]   = useState(false)
  const [dry, setDry]         = useState(null)
  const [dryBusy, setDryBusy] = useState(false)

  // Achsgrenzen aus Klipper lesen und in die Geometrie schreiben (read-modify-write,
  // damit die übrigen Werte stehen bleiben).
  const fetchLimits = async () => {
    setLimitsBusy(true); setLimitsMsg(''); setLimitsErr(false)
    try {
      const l = (await controlService.getAxisLimits())?.data?.limits || {}
      const cur = (await controlService.getGeometry())?.data?.geometry || {}
      await controlService.putGeometry({ ...cur, machine_limits: l })
      setLimitsMsg(tr('✓ X {0} · Y {1} · Z {2} mm', l.x ?? '—', l.y ?? '—', l.z ?? '—'))
    } catch (e) {
      setLimitsErr(true)
      setLimitsMsg(e?.response?.data?.detail || e?.message || tr('Fehler'))
    } finally { setLimitsBusy(false) }
  }

  const runDry = async () => {
    setDryBusy(true); setDry(null)
    try {
      setDry((await autofarmService.dryRun({ which: 'both' }))?.data || null)
    } catch (e) {
      setDry({ error: e?.response?.data?.detail || e?.message || tr('Fehler') })
    } finally { setDryBusy(false) }
  }

  // Netzwerk-Suche (gilt für Schritt 1 Drucker + Schritt 2 OTTOeject)
  const [discovering, setDiscovering] = useState(false)
  const [discovered, setDiscovered]   = useState(null)   // { bambu:[], klipper:[], docker_bridge } | null
  const [scanSubnet, setScanSubnet]   = useState('')

  const runDiscover = async (subnet) => {
    const s = (typeof subnet === 'string' ? subnet : '').trim()
    setDiscovering(true); setDiscovered(null)
    try {
      const r = await deviceService.discover(s || undefined)
      setDiscovered(r.data ?? { bambu: [], klipper: [] })
    } catch (e) {
      setDiscovered({ bambu: [], klipper: [], error: e.response?.data?.detail ?? e.message })
    } finally { setDiscovering(false) }
  }

  // Docker-Bridge-Hinweis + Subnetz-Eingabe (in beiden Suchschritten gleich)
  const DockerBridgeHint = () => discovered?.docker_bridge ? (
    <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 space-y-2">
      <p className="text-[11px] text-amber-300">
        {tr('Printloom läuft in einem Docker-Bridge-Netz und sieht dein LAN nicht automatisch. Gib dein LAN-Subnetz ein und suche erneut — oder nutze „network_mode: host".')}
      </p>
      <div className="flex items-center gap-2">
        <input type="text" value={scanSubnet} onChange={e => setScanSubnet(e.target.value)}
          placeholder="192.168.1" className="text-xs font-mono py-1 w-32" />
        <button onClick={() => runDiscover(scanSubnet)} disabled={discovering || !scanSubnet.trim()}
          className="btn-secondary text-xs disabled:opacity-50">{tr('Erneut suchen')}</button>
      </div>
    </div>
  ) : null

  const bambu = devices.find(d => d.device_type === 'bambu_lab')
  const klipperDev = devices.find(d => d.device_type === 'klipper')

  /* Verbaute Komponenten aus der GEOMETRIE übernehmen (serverseitig, gilt für alle
     Geräte). localStorage ist nur noch Vorbelegung für den Erstlauf: sonst zeigte ein
     zweites Gerät „Standard-Halterung / Standard-Greifer", während die Anlage längst
     anders gebaut ist — und der Assistent würde beim Übernehmen die echte Auswahl
     überschreiben. */
  useEffect(() => {
    controlService.getGeometry().then(r => {
      const g = r?.data?.geometry || {}
      setComponents(c => ({
        ...c,
        ...(g.holder ? { holder: g.holder } : {}),
        ...(g.gripper ? { gripper: g.gripper } : {}),
        // Magazin-Fach 0 = kein Magazin → „alle Fächer sind Lagerfächer"
        ...(g.magazine_slot != null ? { topSlot: +g.magazine_slot ? 'magazine' : 'storage' } : {}),
      }))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    deviceService.listDevices().then(r => setDevices(r.data ?? [])).catch(() => {})
    deviceService.listModels().then(r => setModels(r.data?.models || [])).catch(() => {})
    // Gespeicherte Zeitzone laden; sonst die Browser-Zone vorbelegen und gleich sichern.
    autofarmService.getSettings().then(r => {
      const stored = r.data?.timezone || ''
      setTz(stored || browserTz)
      if (!stored && browserTz) autofarmService.saveSettings({ timezone: browserTz }).catch(() => {})
    }).catch(() => {})
  }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  const saveTz = (z) => {
    setTz(z)
    autofarmService.saveSettings({ timezone: z }).catch(() => {})
  }

  // Load rack config + homing info lazily when reaching those steps
  useEffect(() => {
    if (step === 4) {
      rackManagerService.getAll().then(r => {
        const d = r.data ?? {}
        if (d.num_racks) setNr(d.num_racks)
        if (d.slots_per_rack) setSpr(d.slots_per_rack)
        if (d.slot_height_mm) setH(d.slot_height_mm)
        if (d.magazine_slot != null) setMagSlot(d.magazine_slot)
      }).catch(() => {})
      controlService.getGeometry().then(r => {
        const g = r?.data?.geometry?.storage
        if (g?.slot_gap != null) setPitch(gapToPitch(g.slot_gap))
      }).catch(() => {})
    }
    if (step === 5) {
      autofarmService.getHomingFileInfo().then(r => setHoming(r.data)).catch(() => {})
    }
  }, [step])

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1))
  const prev = () => setStep(s => Math.max(0, s - 1))

  // Abschluss führt direkt auf die Drucker-Seite (dort werden die Positionen je
  // Operation eingestellt) — das ist der nächste sinnvolle Schritt nach dem Setup.
  const finish = () => {
    localStorage.setItem(SETUP_DONE_KEY, '1')
    setCurrentPage?.('drucker')
  }

  const skip = () => {
    localStorage.setItem(SETUP_DONE_KEY, '1')
    setCurrentPage?.('dashboard')
  }

  // Komponenten-Auswahl → Grundkonfiguration schreiben (Rack-Konfig + Geometrie).
  // Die abgeleiteten Werte landen auch in den Regal-Feldern (Schritt „Regal"),
  // wo sie nachjustiert werden können.
  const applyComponents = async () => {
    setCErr(null); setCSaving(true)
    const cfg = derivedConfig(components)
    try {
      saveComponents(components)
      const racks = +nr || 3
      await rackManagerService.updateConfig({
        num_racks: racks,
        slots_per_rack: cfg.slots_per_rack,
        slot_height_mm: cfg.slot_height_mm,
        magazine_slot: cfg.magazine_slot,
        magazine_defaults: Array(racks).fill(cfg.plates_per_rack),
      })
      // slot_gap + Halterung sitzen in der Geometrie → lesen, patchen, zurückschreiben
      // (putGeometry ersetzt die Datei, deshalb nie blind ein Teilobjekt senden).
      await writeSlotGap(cfg.slot_gap, { holder: cfg.holder_id,
                                   gripper: cfg.gripper_id,
                                   gripper_motion: cfg.gripper_motion })
      setSpr(cfg.slots_per_rack); setH(cfg.slot_height_mm)
      setPitch(cfg.pitch); setMagSlot(cfg.magazine_slot)
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      next()
    } catch (e) {
      setCErr(e.response?.data?.detail ?? e.message)
    } finally { setCSaving(false) }
  }

  // Bauart-Paket (Phase 2.4): aus dem gewählten Modell folgen Geometrie-Vorlage
  // (Anfahr-Positionen, Tür ja/nein) und die passende Sequenz. Bisher musste der
  // Nutzer die Vorlage auf der Drucker-Seite selbst noch einmal auswählen — und
  // bei einem offenen Drucker die Tür-Schritte von Hand abschalten.
  /* Fach-Abstand schreiben. Seit v1.1.9 kann JEDES Regal einen eigenen haben
     (geometry.rack_geo) — im Einrichten wird bewusst der gemeinsame Wert für alle
     Regale gesetzt: hier baut man eine Anlage aus gleichen Regalen auf. Wer später
     ein anders gebautes Regal dazustellt, ändert dessen Wert im Drucker-Tab. */
  const writeSlotGap = async (gap, extra) => {
    const g = (await controlService.getGeometry())?.data?.geometry
    if (!g) return
    const rg = { ...(g.rack_geo || {}) }
    for (const k of Object.keys(rg)) rg[k] = { ...rg[k], slot_gap: gap }
    await controlService.putGeometry({
      ...g, ...(extra || {}), rack_geo: rg, storage: { ...(g.storage || {}), slot_gap: gap },
    })
  }

  const applyPrinterPackage = async (modelId) => {
    const m = models.find(x => x.id === modelId)
    if (!m) return
    const preset = m.preset ? PRINTERS.find(p => p.id === m.preset) : null
    if (preset) {
      try {
        const cur = (await controlService.getGeometry())?.data?.geometry || {}
        // Seit v1.1.9 stehen die Drucker-Positionen ABSOLUT im Block `printers[0]`
        // (vorher als Basis in `printer`, die beim Fahren um den Regal-Versatz
        // verschoben wurde). Die Vorlage kennt nur die Basis — deshalb hier denselben
        // Versatz einrechnen, damit der Vorschlag so aussieht wie bisher. Eingemessen
        // wird er ohnehin noch (Drucker-Tab → 📐).
        const off = (Math.max(1, +(cur.racks || 1)) - 1) * (+(cur.storage?.rack_x_gap) || 0)
        const abs = (p) => ({ ...p, x: Math.round((p.x + off) * 10) / 10 })
        const first = (Array.isArray(cur.printers) && cur.printers[0]) || {}
        await controlService.putGeometry({
          ...cur,
          printer_id: preset.id, printer_name: preset.name, enclosed: preset.enclosed,
          printers: [{
            ...first,
            id: first.id || 'printer-1', name: preset.name, preset: preset.id,
            model: modelId, enclosed: preset.enclosed,
            eject: abs(preset.eject), load: abs(preset.load), move: abs(preset.eject),
            door: preset.door ? { open: abs(preset.door.open), close: abs(preset.door.close) } : null,
          }, ...(Array.isArray(cur.printers) ? cur.printers.slice(1) : [])],
        })
      } catch { /* Vorlage ist Komfort — Setup darf daran nicht scheitern */ }
    }
    // Offener Drucker → Tür-Schritte aus den Sequenzen nehmen (sie würden „keine
    // Tür konfiguriert" fahren und nur Zeit kosten).
    if (!m.enclosed) {
      try {
        const d = (await autofarmService.getSequences())?.data || {}
        const strip = (arr) => (Array.isArray(arr) ? arr : []).filter(
          s => !(s.type === 'app_op' && String(s.value || '').includes('door')))
        const seq_new = strip(d.seq_new), seq_next = strip(d.seq_next)
        if (seq_new.length || seq_next.length) {
          await autofarmService.saveSequences({ seq_new, seq_next })
        }
      } catch { /* dito */ }
    }
  }

  const createPrinter = async () => {
    setPErr(null); setPSaving(true)
    try {
      await deviceService.createDevice({
        name: pForm.name || 'Bambu X1C',
        device_type: 'bambu_lab',
        ip_address: pForm.ip_address,
        port: 8883, mqtt_port: 8883, use_tls: true,
        serial_number: pForm.serial_number,
        access_code: pForm.access_code,
        model: pForm.model || '',
      })
      if (pForm.model) await applyPrinterPackage(pForm.model)
      const r = await deviceService.listDevices()
      setDevices(r.data ?? [])
      window.dispatchEvent(new CustomEvent('printloom:devicesChanged'))
      next()
    } catch (e) {
      setPErr(e.response?.data?.detail ?? e.message)
    } finally { setPSaving(false) }
  }

  const testBambu = async () => {
    if (!bambu) return
    setPTesting(true); setPTest(null)
    try {
      const r = await deviceService.testDevice(bambu.id)
      setPTest(r.data)
    } catch (e) {
      setPTest({ success: false, message: e.response?.data?.detail ?? e.message })
    } finally { setPTesting(false) }
  }

  const createKlipper = async () => {
    setKErr(null); setKSaving(true)
    try {
      await deviceService.createDevice({
        name: kForm.name || 'OTTOeject',
        device_type: 'klipper',
        ip_address: kForm.ip_address,
        port: +kForm.port || 7125,
      })
      const r = await deviceService.listDevices()
      setDevices(r.data ?? [])
      window.dispatchEvent(new CustomEvent('printloom:devicesChanged'))
    } catch (e) {
      setKErr(e.response?.data?.detail ?? e.message)
    } finally { setKSaving(false) }
  }

  const testKlipper = async () => {
    if (!klipperDev) return
    setKTesting(true); setKTest(null)
    try {
      const r = await deviceService.testDevice(klipperDev.id)
      setKTest(r.data)
    } catch (e) {
      setKTest({ success: false, message: e.response?.data?.detail ?? e.message })
    } finally { setKTesting(false) }
  }

  const saveRack = async () => {
    setRSaving(true)
    try {
      await rackManagerService.updateConfig({
        num_racks: +nr, slots_per_rack: +spr, slot_height_mm: +h, magazine_slot: +magSlot,
      })
      // Fach-Abstand in die Geometrie (read-modify-write, s. applyComponents)
      await writeSlotGap(pitchToGap(pitch))
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      next()
    } catch (e) {
      // non-fatal — let the user proceed
      next()
    } finally { setRSaving(false) }
  }

  const createHoming = async () => {
    setHBusy(true)
    try {
      await autofarmService.setupHomingFile()
      const r = await autofarmService.getHomingFileInfo()
      setHoming(r.data)
    } catch (e) {
      setHoming({ configured: false, error: e.response?.data?.detail ?? e.message })
    } finally { setHBusy(false) }
  }

  return (
    <div className="max-w-xl mx-auto">
      <div className="card p-6">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-lg font-semibold text-surface-100">{tr('Setup-Assistent')}</h1>
          <button onClick={skip} className="text-[11px] text-surface-600 hover:text-surface-300">{tr('Überspringen →')}</button>
        </div>
        <p className="text-xs text-surface-500 mb-5">{tr('Komponenten · Drucker · OTTOeject · Regal · Kalibrierung · Einmessen in einem Durchlauf.')}</p>

        <StepDots step={step} />

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              {tr('Willkommen bei')} <span className="font-semibold text-surface-100">Printloom</span>{tr('! Dieser Assistent richtet die Farm in einem Durchlauf ein. Du kannst jeden Schritt überspringen und später in der Konfiguration ändern.')}
            </p>
            <ul className="text-xs text-surface-500 space-y-1.5 list-disc pl-5">
              <li>{tr('Verbaute Komponenten wählen (daraus kommt die Grundkonfiguration)')}</li>
              <li>{tr('Bambu-Drucker verbinden (IP, Seriennummer, Access-Code)')}</li>
              <li>{tr('OTTOeject/Klipper-Erreichbarkeit prüfen')}</li>
              <li>{tr('Regal konfigurieren (Anzahl, Fächer, Fachhöhe)')}</li>
              <li>{tr('Homing-Datei für den Auswurf erstellen')}</li>
              <li>{tr('Positionen einmessen — geführt, Station für Station')}</li>
            </ul>

            {/* Sprache ganz zuerst: alles Folgende soll schon in der eigenen Sprache
                dastehen. Umschalten lädt die Seite neu (setLanguage) — deshalb hier
                oben, wo noch nichts eingegeben wurde. */}
            <div className="border border-surface-700 rounded-lg p-3 bg-surface-900/50">
              <label className="text-xs font-medium text-surface-300 block mb-1">🌐 {tr('Sprache')}</label>
              <p className="text-[10px] text-surface-600 mb-2">{tr('Gilt für die ganze Oberfläche. Später jederzeit unter „System" änderbar.')}</p>
              <select value={lang} onChange={e => { if (e.target.value !== lang) setLanguage(e.target.value) }}
                className="w-full text-sm">
                {availableLanguages().map(l => (
                  <option key={l.code} value={l.code}>{l.name}{l.builtin ? '' : ' ·'}</option>
                ))}
              </select>
            </div>

            {/* 2.1: Zeitzone gleich am Anfang — Basis für Betriebszeiten & Uhrzeiten */}
            <div className="border border-surface-700 rounded-lg p-3 bg-surface-900/50">
              <label className="text-xs font-medium text-surface-300 block mb-1">🕒 {tr('Zeitzone')}</label>
              <p className="text-[10px] text-surface-600 mb-2">{tr('Maßgeblich für Betriebszeiten & angezeigte Uhrzeiten. Der Server läuft sonst in UTC — die Farm würde zur falschen Uhrzeit starten.')}</p>
              <select value={tz} onChange={e => saveTz(e.target.value)} className="w-full text-sm">
                {(TIMEZONES.includes(tz) ? TIMEZONES : [tz, ...TIMEZONES]).map(z => (
                  <option key={z} value={z}>{z}{z === browserTz ? tr(' (erkannt)') : ''}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end pt-2">
              <button onClick={next} className="btn-primary text-sm">{tr("Los geht's →")}</button>
            </div>
          </div>
        )}

        {/* ── Step 1: Verbaute Komponenten → Grundkonfiguration ── */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-xs text-surface-500">
              {tr('Was hast du gebaut? Daraus setzt Printloom die Grundkonfiguration (Fächer je Regal, Magazin, Fach-Abstand). Alles bleibt danach änderbar.')}
            </p>

            <label className="block border border-surface-700 rounded-lg p-3 bg-surface-900/50">
              <span className="text-xs font-medium text-surface-300">{tr('Anzahl Regale')}</span>
              <p className="text-[10px] text-surface-600 mb-1.5">{tr('Wie viele Regal-Türme stehen neben dem Drucker? (Regal 1 = direkt am Drucker)')}</p>
              <input type="number" min="1" max="10" value={nr} onChange={e => setNr(e.target.value)}
                className="w-24 text-sm" />
            </label>

            {COMPONENT_GROUPS.map(group => (
              <div key={group.id} className="space-y-2">
                <div>
                  <p className="text-xs font-medium text-surface-300">{tr(group.title)}</p>
                  <p className="text-[10px] text-surface-600">{tr(group.hint)}</p>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {group.options.map(opt => {
                    const active = (components[group.id] ?? group.options[0].id) === opt.id
                    // „soon" = gebaut, aber noch nicht vermessen. Bewusst SICHTBAR und
                    // gesperrt statt versteckt: der Aufbau existiert, nur die Maße fehlen.
                    const soon = !!opt.soon && !active
                    return (
                      <button key={opt.id} type="button" disabled={soon}
                        aria-disabled={soon}
                        title={soon ? tr('Noch in Arbeit — diese Bauform lässt sich noch nicht auswählen.') : undefined}
                        onClick={() => { if (!soon) setComponents(c => ({ ...c, [group.id]: opt.id })) }}
                        className={`text-left rounded-lg border p-3 transition-colors ${
                          soon   ? 'border-surface-800 bg-surface-900/20 opacity-50 cursor-not-allowed'
                          : active ? 'border-blue-600 bg-blue-950/40'
                          : 'border-surface-700 bg-surface-900/40 hover:border-surface-600'}`}>
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className={`w-3.5 h-3.5 rounded-full border shrink-0 ${
                            active ? 'border-blue-400 bg-blue-500' : 'border-surface-600'}`} />
                          <span className={`text-sm font-medium ${active ? 'text-blue-200' : 'text-surface-300'}`}>{tr(opt.name)}</span>
                          {opt.vendor && (
                            <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 border ${
                              opt.vendor === 'ottomat3d'
                                ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-400'
                                : 'border-violet-800/60 bg-violet-950/40 text-violet-300'}`}>
                              {VENDOR_LABEL[opt.vendor]}
                            </span>
                          )}
                          {soon ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-950/40 border border-amber-800/60 text-amber-400 shrink-0">
                              {tr('In Arbeit')}
                            </span>
                          ) : opt.badge && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-400 shrink-0">{tr(opt.badge)}</span>
                          )}
                        </div>
                        <p className="text-[10px] leading-relaxed text-surface-500">{tr(opt.desc)}</p>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            {/* Ergebnis-Vorschau: genau die Werte, die gespeichert werden */}
            {(() => {
              const cfg = derivedConfig(components)
              return (
                <div className="rounded-lg border border-surface-700 bg-surface-950/60 px-3 py-2 space-y-1">
                  <p className="text-[10px] text-surface-500">{tr('Daraus folgt:')}</p>
                  <p className="text-[11px] font-mono text-surface-300">
                    {tr('{0} Regale × {1} Lagerfächer', +nr || 3, cfg.slots_per_rack)}
                    {' · '}
                    {cfg.magazine_slot
                      ? tr('Magazin = Fach {0}', cfg.magazine_slot)
                      : tr('kein Magazin')}
                    {' · '}{tr('Z-Schritt {0} mm', cfg.pitch)}
                    {' · '}{tr('Fachhöhe {0} mm', cfg.slot_height_mm)}
                  </p>
                  <p className="text-[10px] text-surface-500">
                    {cfg.with_magazine
                      ? tr('Nachschub: {0} leere Platten je Magazin (später änderbar).', cfg.plates_per_rack)
                      : tr('Start-Bestückung: {0} Fächer je Regal mit leerer Platte. Die Farm greift von OBEN nach unten und legt den fertigen Druck in dasselbe Fach zurück.', cfg.plates_per_rack)}
                  </p>
                </div>
              )
            })()}

            <div className="rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2">
              <p className="text-[11px] text-amber-300">
                {tr('⚠ Der Z-Schritt (Fach zu Fach) bestimmt, wo der Arm zugreift. Miss ihn am eigenen Regal nach und korrigiere ihn im Schritt „Regal" — ein falscher Wert lässt den Arm ins Blech fahren.')}
              </p>
            </div>

            {cErr && <p className="text-xs text-red-400">{cErr}</p>}
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={applyComponents} disabled={cSaving} className="btn-primary text-sm disabled:opacity-50">
                {cSaving ? tr('Speichere…') : tr('Übernehmen →')}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Printer ── */}
        {step === 2 && (
          <div className="space-y-3">
            {bambu ? (
              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-300">
                {tr('✓ Drucker bereits konfiguriert:')} <span className="font-mono">{bambu.name}</span> ({bambu.ip_address})
              </div>
            ) : (
              <>
                <p className="text-xs text-surface-500">{tr('Bambu Lab Drucker verbinden. Access-Code & Seriennummer findest du am Druckerdisplay unter Einstellungen → WLAN.')}</p>

                {/* Netzwerk-Suche: findet X1C per SSDP inkl. IP + Seriennummer */}
                <div className="border border-surface-700 rounded-lg p-3 bg-surface-900/50 space-y-2">
                  <button onClick={() => runDiscover()} disabled={discovering} className="btn-secondary text-sm disabled:opacity-50">
                    {discovering ? tr('Suche im Netzwerk…') : tr('🔍 Drucker im Netzwerk suchen')}
                  </button>
                  {discovered && (
                    <div className="space-y-1.5">
                      {discovered.error && <p className="text-[11px] text-amber-400">{tr('Suche fehlgeschlagen')}: {discovered.error}</p>}
                      <DockerBridgeHint />
                      {!discovered.error && !discovered.docker_bridge && !discovered.bambu?.length && (
                        <p className="text-[11px] text-surface-600">{tr('Kein Bambu gefunden — bitte manuell eintragen. (In Docker-Bridge-Netzen kommt SSDP nicht an.)')}</p>
                      )}
                      {discovered.bambu?.map((b, i) => (
                        <button key={i} onClick={() => setPForm(f => ({ ...f, name: b.name || f.name, ip_address: b.ip || '', serial_number: b.serial || '', model: b.model_id || f.model }))}
                          className="w-full text-left px-3 py-1.5 rounded-lg bg-surface-950 border border-surface-800 hover:border-blue-700 transition-colors">
                          <span className="text-sm text-surface-200">🖨 {b.name || 'Bambu Lab'} <span className="font-mono text-xs text-surface-500">· {b.ip}</span></span>
                          <span className="block text-[10px] font-mono text-surface-600">{b.serial ? `S/N: ${b.serial}` : tr('Seriennummer manuell nötig')}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <p className="text-[10px] text-surface-600">{tr('Access-Code wird nie mitgesendet — den trägst du selbst ein.')}</p>
                </div>

                <div className="space-y-2">
                  <input className="w-full text-sm" placeholder={tr('Name (z. B. Bambu X1C)')} value={pForm.name}
                    onChange={e => setPForm(f => ({ ...f, name: e.target.value }))} />
                  {/* Modell: davon hängt das Kamera-Protokoll ab (X1-Serie RTSP, P1/A1
                      Port 6000). Ohne Angabe erkennt Printloom es selbst. */}
                  <select className="w-full text-sm" value={pForm.model}
                    onChange={e => setPForm(f => ({ ...f, model: e.target.value }))}>
                    <option value="">{tr('Modell wählen (optional — wird sonst erkannt)')}</option>
                    {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select>
                  <input className="w-full text-sm" placeholder={tr('IP-Adresse (192.168.1.100)')} value={pForm.ip_address}
                    onChange={e => setPForm(f => ({ ...f, ip_address: e.target.value }))} />
                  <input className="w-full text-sm" placeholder={tr('Seriennummer (z. B. 00M…)')} value={pForm.serial_number}
                    onChange={e => setPForm(f => ({ ...f, serial_number: e.target.value }))} />
                  <input className="w-full text-sm" type="password" placeholder={tr('Access-Code')} value={pForm.access_code}
                    onChange={e => setPForm(f => ({ ...f, access_code: e.target.value }))} />
                </div>
                {pErr && <p className="text-xs text-red-400">{pErr}</p>}
              </>
            )}
            {bambu && (
              <div className="space-y-2">
                <button onClick={testBambu} disabled={pTesting} className="btn-secondary text-sm">
                  {pTesting ? tr('Teste…') : tr('🔌 Verbindung testen')}
                </button>
                {pTest && (
                  <div className={`rounded-lg px-4 py-3 text-sm border ${pTest.success ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-amber-950/40 border-amber-800 text-amber-300'}`}>
                    {pTest.success ? tr('✓ Verbindung erfolgreich') : `⚠ ${pTest.message || tr('Verbindung fehlgeschlagen')}`}
                    {pTest.mqtt && (
                      <div className="text-[11px] mt-1 opacity-80">
                        MQTT: {pTest.mqtt.connected ? '✓' : '✗'} · FTP: {pTest.ftp?.connected ? '✓' : '✗'}
                        {pTest.ftp?.message ? ` (${pTest.ftp.message})` : ''}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              {bambu
                ? <button onClick={next} className="btn-primary text-sm">{tr('Weiter →')}</button>
                : <button onClick={createPrinter} disabled={pSaving || !pForm.ip_address || !pForm.access_code} className="btn-primary text-sm disabled:opacity-50">
                    {pSaving ? tr('Speichere…') : tr('Drucker speichern →')}
                  </button>}
            </div>
          </div>
        )}

        {/* ── Step 3: OTTOeject / Klipper ── */}
        {step === 3 && (
          <div className="space-y-3">
            {klipperDev ? (
              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-300">
                {tr('✓ OTTOeject konfiguriert:')} <span className="font-mono">{klipperDev.name}</span> ({klipperDev.ip_address}:{klipperDev.port})
              </div>
            ) : (
              <>
                <p className="text-xs text-surface-500">
                  {tr('Das OTTOeject läuft über Klipper/Moonraker. Gib die Moonraker-Adresse an (Standard-Port 7125).')}
                </p>

                {/* Netzwerk-Suche: findet Moonraker per Port-Scan inkl. Hostname */}
                <div className="border border-surface-700 rounded-lg p-3 bg-surface-900/50 space-y-2">
                  <button onClick={() => runDiscover()} disabled={discovering} className="btn-secondary text-sm disabled:opacity-50">
                    {discovering ? tr('Suche im Netzwerk…') : tr('🔍 OTTOeject im Netzwerk suchen')}
                  </button>
                  {discovered && (
                    <div className="space-y-1.5">
                      {discovered.error && <p className="text-[11px] text-amber-400">{tr('Suche fehlgeschlagen')}: {discovered.error}</p>}
                      <DockerBridgeHint />
                      {!discovered.error && !discovered.docker_bridge && !discovered.klipper?.length && (
                        <p className="text-[11px] text-surface-600">{tr('Kein Klipper/Moonraker gefunden — bitte manuell eintragen.')}</p>
                      )}
                      {discovered.klipper?.map((k, i) => (
                        <button key={i} onClick={() => setKForm(f => ({ ...f, name: k.hostname || f.name, ip_address: k.ip || '', port: k.port || 7125 }))}
                          className="w-full text-left px-3 py-1.5 rounded-lg bg-surface-950 border border-surface-800 hover:border-blue-700 transition-colors">
                          <span className="text-sm text-surface-200">🦾 {k.hostname || 'Klipper / OTTOeject'} <span className="font-mono text-xs text-surface-500">· {k.ip}:{k.port}</span></span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <input className="w-full text-sm" placeholder={tr('Name (z. B. OTTOeject)')} value={kForm.name}
                    onChange={e => setKForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="w-full text-sm" placeholder={tr('IP-Adresse (192.168.1.101)')} value={kForm.ip_address}
                    onChange={e => setKForm(f => ({ ...f, ip_address: e.target.value }))} />
                  <input className="w-full text-sm" type="number" placeholder={tr('Port (7125)')} value={kForm.port}
                    onChange={e => setKForm(f => ({ ...f, port: e.target.value }))} />
                </div>
                {kErr && <p className="text-xs text-red-400">{kErr}</p>}
              </>
            )}
            {klipperDev && (
              <div className="space-y-2">
                <button onClick={testKlipper} disabled={kTesting} className="btn-secondary text-sm">
                  {kTesting ? tr('Teste…') : tr('🔌 Verbindung testen')}
                </button>
                {kTest && (
                  <div className={`rounded-lg px-4 py-3 text-sm border ${kTest.success ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-amber-950/40 border-amber-800 text-amber-300'}`}>
                    {kTest.success ? tr('✓ OTTOeject erreichbar') : `⚠ ${kTest.message || tr('nicht erreichbar')}`}
                  </div>
                )}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              {klipperDev
                ? <button onClick={next} className="btn-primary text-sm">{tr('Weiter →')}</button>
                : <button onClick={createKlipper} disabled={kSaving || !kForm.ip_address} className="btn-primary text-sm disabled:opacity-50">
                    {kSaving ? tr('Speichere…') : tr('OTTOeject speichern →')}
                  </button>}
            </div>
          </div>
        )}

        {/* ── Step 4: Rack ── */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">{tr('Aus den Komponenten vorbelegt — hier fein justieren.')}</p>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">{tr('Regale')}</span>
                <input type="number" min="1" max="9" className="w-full text-sm" value={nr} onChange={e => setNr(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">{tr('Fächer/Regal')}</span>
                <input type="number" min="1" max="20" className="w-full text-sm" value={spr} onChange={e => setSpr(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">{tr('Fachhöhe (mm)')}</span>
                <input type="number" min="10" max="300" className="w-full text-sm" value={h} onChange={e => setH(e.target.value)} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">{tr('Z-Schritt Fach→Fach (mm)')}</span>
                <input type="number" min="5" max="300" className="w-full text-sm" value={pitch} onChange={e => setPitch(e.target.value)} />
                <span className="block text-[9px] text-surface-600">{tr('Gemessener Abstand von Fach zu Fach (Standard 55, Kompakt 25)')}</span>
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">{tr('Magazin-Fach (0 = keins)')}</span>
                <input type="number" min="0" max="20" className="w-full text-sm" value={magSlot} onChange={e => setMagSlot(e.target.value)} />
                <span className="block text-[9px] text-surface-600">{tr('Fach mit dem Stapel leerer Platten')}</span>
              </label>
            </div>
            <RackPreview numRacks={nr} slotsPerRack={spr} slotHeightMm={h} />
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={saveRack} disabled={rSaving} className="btn-primary text-sm disabled:opacity-50">
                {rSaving ? tr('Speichere…') : tr('Regal speichern →')}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Homing / Kalibrierung ──
            Stand bis v1.0.163 fälschlich auf `step === 4` (aus der Zeit vor dem
            Komponenten-Schritt): Schritt 4 zeigte Regal UND Homing untereinander,
            der letzte Schritt blieb leer. */}
        {step === 5 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">
              {tr('Für den Auswurf braucht die Farm eine Homing-Datei (G28 + Z200), die vor dem Greifen an den Drucker gesendet wird.')}
            </p>
            {homing?.configured ? (
              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-300">
                {tr('✓ Homing-Datei vorhanden')}{homing.filename ? `: ${homing.filename}` : ''}
              </div>
            ) : (
              <button onClick={createHoming} disabled={hBusy} className="btn-secondary text-sm">
                {hBusy ? tr('Erstelle…') : tr('Homing-Datei erstellen')}
              </button>
            )}
            {homing?.error && <p className="text-xs text-red-400">{homing.error}</p>}

            {/* Achsgrenzen: einmal vom Gerät holen — danach verweigert Printloom
                jede Bewegung, die aus der Achse fahren würde, VOR dem Senden. */}
            <div className="border-t border-surface-800 pt-3 space-y-2">
              <p className="text-xs font-medium text-surface-300">{tr('Achsgrenzen des OTTOeject')}</p>
              <p className="text-[10px] text-surface-600">
                {tr('Einmal vom Gerät holen: danach wird jede Bewegung vorher geprüft und eine, die aus der Achse fährt, gar nicht erst gesendet.')}
              </p>
              <div className="flex items-center gap-2">
                <button onClick={fetchLimits} disabled={limitsBusy} className="btn-secondary text-sm disabled:opacity-50">
                  {limitsBusy ? tr('Lese…') : tr('⤓ Grenzen vom Gerät holen')}
                </button>
                {limitsMsg && <span className={`text-[11px] font-mono ${limitsErr ? 'text-red-400' : 'text-emerald-400'}`}>{limitsMsg}</span>}
              </div>
            </div>

            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={next} className="btn-primary text-sm">{tr('Weiter zum Einmessen →')}</button>
            </div>
          </div>
        )}

        {/* ── Step 6: Geführtes Einmessen ──
            Eigener Schritt und nicht unten an die Kalibrierung gehängt: Homing-Datei
            und Achsgrenzen sind die VORAUSSETZUNG (ohne sie kein geprüftes Jog), das
            Einmessen die Arbeit danach. In einem Schritt wäre es eine lange Wand. */}
        {step === 6 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">
              {tr('Jetzt die echten Positionen: Regal 1 als Anker, dann Magazin, äußerstes Regal und Drucker. Printloom fährt hin, du justierst nach.')}
            </p>

            <FirstCalibration numRacks={+nr || 1} magazineSlot={+magSlot || 0} />

            {/* Trockenlauf: die Sequenz durchspielen, ohne etwas zu senden. */}
            <div className="border-t border-surface-800 pt-3 space-y-2">
              <p className="text-xs font-medium text-surface-300">{tr('Trockenlauf')}</p>
              <p className="text-[10px] text-surface-600">
                {tr('Spielt die Sequenz Schritt für Schritt durch, OHNE etwas an Drucker oder OTTOeject zu senden — zeigt, welches Fach getroffen würde und ob eine Bewegung aus der Achse fährt.')}
              </p>
              <button onClick={runDry} disabled={dryBusy} className="btn-secondary text-sm disabled:opacity-50">
                {dryBusy ? tr('Läuft…') : tr('▶ Trockenlauf starten')}
              </button>
              {dry && <DryRunResult dry={dry} tr={tr} />}
            </div>

            {/* 2.9 — Einrichtungs-Checkliste: was ist bereit, was fehlt noch */}
            <div className="border-t border-surface-800 pt-3">
              <p className="text-xs font-medium text-surface-300 mb-2">{tr('Einrichtungs-Status')}</p>
              <SetupHealth />
            </div>

            <p className="text-[10px] text-surface-600">
              {tr('Feinjustage, Tür und Greif-Test danach im Drucker-Tab — dorthin führt der Knopf unten. Sequenzen im')} <span className="text-surface-400">{tr('Sequenz-Editor')}</span>.
            </p>
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={finish} className="btn-primary text-sm">{tr('🖨 Drucker einrichten →')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
