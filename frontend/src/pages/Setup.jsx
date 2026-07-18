import React, { useState, useEffect } from 'react'
import { deviceService, rackManagerService, autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { TIMEZONES } from './Configuration'
import SetupHealth from '../components/SetupHealth'
import RackPreview from '../components/RackPreview'

export const SETUP_DONE_KEY = 'ottomat3d_setup_done'

const STEPS = ['Willkommen', 'Drucker', 'OTTOeject', 'Regal', 'Kalibrierung']

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

export default function Setup({ setCurrentPage }) {
  const { tr } = useLanguage()
  const [step, setStep] = useState(0)

  // Step 0 — Zeitzone (2.1): Basis für Betriebszeiten/Uhrzeiten. Container läuft i. d. R.
  // in UTC → ohne Zeitzone würde die Farm zur falschen Uhrzeit starten.
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const [tz, setTz] = useState(browserTz)

  // Step 1 — printer
  const [devices, setDevices]   = useState([])
  const [pForm, setPForm]       = useState({ name: 'Bambu X1C', ip_address: '', serial_number: '', access_code: '' })
  const [pSaving, setPSaving]   = useState(false)
  const [pErr, setPErr]         = useState(null)
  const [pTest, setPTest]       = useState(null)   // Bambu-Testergebnis
  const [pTesting, setPTesting] = useState(false)

  // Step 2 — klipper / OTTOeject (eigenes Gerät, wie der Drucker)
  const [kForm, setKForm]       = useState({ name: 'OTTOeject', ip_address: '', port: 7125 })
  const [kSaving, setKSaving]   = useState(false)
  const [kErr, setKErr]         = useState(null)
  const [kTest, setKTest]       = useState(null)
  const [kTesting, setKTesting] = useState(false)

  // Step 3 — rack
  const [nr, setNr]   = useState(3)
  const [spr, setSpr] = useState(6)
  const [h, setH]     = useState(50)
  const [rSaving, setRSaving] = useState(false)

  // Step 4 — homing
  const [homing, setHoming]   = useState(null)
  const [hBusy, setHBusy]     = useState(false)

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

  useEffect(() => {
    deviceService.listDevices().then(r => setDevices(r.data ?? [])).catch(() => {})
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
    if (step === 3) {
      rackManagerService.getAll().then(r => {
        const d = r.data ?? {}
        if (d.num_racks) setNr(d.num_racks)
        if (d.slots_per_rack) setSpr(d.slots_per_rack)
        if (d.slot_height_mm) setH(d.slot_height_mm)
      }).catch(() => {})
    }
    if (step === 4) {
      autofarmService.getHomingFileInfo().then(r => setHoming(r.data)).catch(() => {})
    }
  }, [step])

  const next = () => setStep(s => Math.min(STEPS.length - 1, s + 1))
  const prev = () => setStep(s => Math.max(0, s - 1))

  const finish = () => {
    localStorage.setItem(SETUP_DONE_KEY, '1')
    setCurrentPage?.('dashboard')
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
      })
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
      await rackManagerService.updateConfig({ num_racks: +nr, slots_per_rack: +spr, slot_height_mm: +h })
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
          <button onClick={finish} className="text-[11px] text-surface-600 hover:text-surface-300">{tr('Überspringen →')}</button>
        </div>
        <p className="text-xs text-surface-500 mb-5">{tr('Drucker · OTTOeject · Regal · Kalibrierung in einem Durchlauf.')}</p>

        <StepDots step={step} />

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              {tr('Willkommen bei')} <span className="font-semibold text-surface-100">Printloom</span>{tr('! Dieser Assistent richtet die Farm in vier Schritten ein. Du kannst jeden Schritt überspringen und später in der Konfiguration ändern.')}
            </p>
            <ul className="text-xs text-surface-500 space-y-1.5 list-disc pl-5">
              <li>{tr('Bambu-Drucker verbinden (IP, Seriennummer, Access-Code)')}</li>
              <li>{tr('OTTOeject/Klipper-Erreichbarkeit prüfen')}</li>
              <li>{tr('Regal konfigurieren (Anzahl, Fächer, Fachhöhe)')}</li>
              <li>{tr('Homing-Datei für den Auswurf erstellen')}</li>
            </ul>

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

        {/* ── Step 1: Printer ── */}
        {step === 1 && (
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
                        <button key={i} onClick={() => setPForm(f => ({ ...f, name: b.name || f.name, ip_address: b.ip || '', serial_number: b.serial || '' }))}
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

        {/* ── Step 2: OTTOeject / Klipper ── */}
        {step === 2 && (
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

        {/* ── Step 3: Rack ── */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">{tr('Wie ist dein Regal aufgebaut?')}</p>
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
            <RackPreview numRacks={nr} slotsPerRack={spr} slotHeightMm={h} />
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={saveRack} disabled={rSaving} className="btn-primary text-sm disabled:opacity-50">
                {rSaving ? tr('Speichere…') : tr('Regal speichern →')}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Homing / Calibration ── */}
        {step === 4 && (
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

            {/* 2.9 — Einrichtungs-Checkliste: was ist bereit, was fehlt noch */}
            <div className="border-t border-surface-800 pt-3">
              <p className="text-xs font-medium text-surface-300 mb-2">{tr('Einrichtungs-Status')}</p>
              <SetupHealth />
            </div>

            <p className="text-[10px] text-surface-600">
              {tr('Feinkalibrierung (Greifer-Offsets, Sequenzen) machst du danach unter')} <span className="text-surface-400">{tr('Steuerung')}</span> {tr('und im')} <span className="text-surface-400">{tr('Sequenz-Editor')}</span>.
            </p>
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">{tr('← Zurück')}</button>
              <button onClick={finish} className="btn-primary text-sm">{tr('Fertig ✓')}</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
