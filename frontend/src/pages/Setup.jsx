import React, { useState, useEffect } from 'react'
import { deviceService, controlService, rackManagerService, autofarmService } from '../services/api'

export const SETUP_DONE_KEY = 'ottomat3d_setup_done'

const STEPS = ['Willkommen', 'Drucker', 'OTTOeject', 'Regal', 'Kalibrierung']

function StepDots({ step }) {
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
            <span className={`text-[9px] ${i === step ? 'text-blue-300' : 'text-surface-600'}`}>{label}</span>
          </div>
          {i < STEPS.length - 1 && <div className={`flex-1 h-px ${i < step ? 'bg-emerald-700' : 'bg-surface-800'}`} />}
        </React.Fragment>
      ))}
    </div>
  )
}

export default function Setup({ setCurrentPage }) {
  const [step, setStep] = useState(0)

  // Step 1 — printer
  const [devices, setDevices]   = useState([])
  const [pForm, setPForm]       = useState({ name: 'Bambu X1C', ip_address: '', serial_number: '', access_code: '' })
  const [pSaving, setPSaving]   = useState(false)
  const [pErr, setPErr]         = useState(null)

  // Step 2 — klipper / OTTOeject
  const [klipper, setKlipper]   = useState(null)   // {ok, state}
  const [klipperBusy, setKBusy] = useState(false)

  // Step 3 — rack
  const [nr, setNr]   = useState(3)
  const [spr, setSpr] = useState(6)
  const [h, setH]     = useState(50)
  const [rSaving, setRSaving] = useState(false)

  // Step 4 — homing
  const [homing, setHoming]   = useState(null)
  const [hBusy, setHBusy]     = useState(false)

  const bambu = devices.find(d => d.device_type === 'bambu_lab')

  useEffect(() => {
    deviceService.listDevices().then(r => setDevices(r.data ?? [])).catch(() => {})
  }, [])

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
      next()
    } catch (e) {
      setPErr(e.response?.data?.detail ?? e.message)
    } finally { setPSaving(false) }
  }

  const checkKlipper = async () => {
    setKBusy(true)
    try {
      const r = await controlService.getKlipperInfo()
      const state = r.data?.state ?? r.data?.result?.state ?? 'unknown'
      setKlipper({ ok: String(state).toLowerCase() === 'ready', state })
    } catch (e) {
      setKlipper({ ok: false, state: e.response?.data?.detail ?? 'nicht erreichbar' })
    } finally { setKBusy(false) }
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
          <h1 className="text-lg font-semibold text-surface-100">Setup-Assistent</h1>
          <button onClick={finish} className="text-[11px] text-surface-600 hover:text-surface-300">Überspringen →</button>
        </div>
        <p className="text-xs text-surface-500 mb-5">Drucker · OTTOeject · Regal · Kalibrierung in einem Durchlauf.</p>

        <StepDots step={step} />

        {/* ── Step 0: Welcome ── */}
        {step === 0 && (
          <div className="space-y-4">
            <p className="text-sm text-surface-300">
              Willkommen bei <span className="font-semibold text-surface-100">Printloom</span>! Dieser Assistent richtet
              die Farm in vier Schritten ein. Du kannst jeden Schritt überspringen und später in der Konfiguration ändern.
            </p>
            <ul className="text-xs text-surface-500 space-y-1.5 list-disc pl-5">
              <li>Bambu-Drucker verbinden (IP, Seriennummer, Access-Code)</li>
              <li>OTTOeject/Klipper-Erreichbarkeit prüfen</li>
              <li>Regal konfigurieren (Anzahl, Fächer, Fachhöhe)</li>
              <li>Homing-Datei für den Auswurf erstellen</li>
            </ul>
            <div className="flex justify-end pt-2">
              <button onClick={next} className="btn-primary text-sm">Los geht's →</button>
            </div>
          </div>
        )}

        {/* ── Step 1: Printer ── */}
        {step === 1 && (
          <div className="space-y-3">
            {bambu ? (
              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-300">
                ✓ Drucker bereits konfiguriert: <span className="font-mono">{bambu.name}</span> ({bambu.ip_address})
              </div>
            ) : (
              <>
                <p className="text-xs text-surface-500">Bambu Lab Drucker verbinden. Access-Code &amp; Seriennummer findest du am Druckerdisplay unter Einstellungen → WLAN.</p>
                <div className="space-y-2">
                  <input className="w-full text-sm" placeholder="Name (z. B. Bambu X1C)" value={pForm.name}
                    onChange={e => setPForm(f => ({ ...f, name: e.target.value }))} />
                  <input className="w-full text-sm" placeholder="IP-Adresse (192.168.1.100)" value={pForm.ip_address}
                    onChange={e => setPForm(f => ({ ...f, ip_address: e.target.value }))} />
                  <input className="w-full text-sm" placeholder="Seriennummer (00M09D...)" value={pForm.serial_number}
                    onChange={e => setPForm(f => ({ ...f, serial_number: e.target.value }))} />
                  <input className="w-full text-sm" type="password" placeholder="Access-Code" value={pForm.access_code}
                    onChange={e => setPForm(f => ({ ...f, access_code: e.target.value }))} />
                </div>
                {pErr && <p className="text-xs text-red-400">{pErr}</p>}
              </>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">← Zurück</button>
              {bambu
                ? <button onClick={next} className="btn-primary text-sm">Weiter →</button>
                : <button onClick={createPrinter} disabled={pSaving || !pForm.ip_address || !pForm.access_code} className="btn-primary text-sm disabled:opacity-50">
                    {pSaving ? 'Speichere…' : 'Drucker speichern →'}
                  </button>}
            </div>
          </div>
        )}

        {/* ── Step 2: OTTOeject / Klipper ── */}
        {step === 2 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">
              Das OTTOeject läuft über Klipper/Moonraker. Prüfe hier die Verbindung — die Adresse wird serverseitig
              (Umgebungsvariable / Steuerung) gesetzt.
            </p>
            <button onClick={checkKlipper} disabled={klipperBusy} className="btn-secondary text-sm">
              {klipperBusy ? 'Prüfe…' : 'Verbindung prüfen'}
            </button>
            {klipper && (
              <div className={`rounded-lg px-4 py-3 text-sm border ${
                klipper.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300' : 'bg-amber-950/40 border-amber-800 text-amber-300'
              }`}>
                {klipper.ok ? '✓ Klipper bereit' : `⚠ Status: ${klipper.state} — du kannst später in der Steuerung erneut prüfen.`}
              </div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">← Zurück</button>
              <button onClick={next} className="btn-primary text-sm">Weiter →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Rack ── */}
        {step === 3 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">Wie ist dein Regal aufgebaut?</p>
            <div className="grid grid-cols-3 gap-3">
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">Regale</span>
                <input type="number" min="1" max="9" className="w-full text-sm" value={nr} onChange={e => setNr(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">Fächer/Regal</span>
                <input type="number" min="1" max="20" className="w-full text-sm" value={spr} onChange={e => setSpr(e.target.value)} />
              </label>
              <label className="space-y-1">
                <span className="text-[10px] text-surface-500">Fachhöhe (mm)</span>
                <input type="number" min="10" max="300" className="w-full text-sm" value={h} onChange={e => setH(e.target.value)} />
              </label>
            </div>
            <p className="text-[10px] text-surface-600">Gesamt: {(+nr) * (+spr)} Fächer · bis {h} mm Objekthöhe je Fach</p>
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">← Zurück</button>
              <button onClick={saveRack} disabled={rSaving} className="btn-primary text-sm disabled:opacity-50">
                {rSaving ? 'Speichere…' : 'Regal speichern →'}
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Homing / Calibration ── */}
        {step === 4 && (
          <div className="space-y-3">
            <p className="text-xs text-surface-500">
              Für den Auswurf braucht die Farm eine Homing-Datei (G28 + Z200), die vor dem Greifen an den Drucker gesendet wird.
            </p>
            {homing?.configured ? (
              <div className="bg-emerald-950/40 border border-emerald-800 rounded-lg px-4 py-3 text-sm text-emerald-300">
                ✓ Homing-Datei vorhanden{homing.filename ? `: ${homing.filename}` : ''}
              </div>
            ) : (
              <button onClick={createHoming} disabled={hBusy} className="btn-secondary text-sm">
                {hBusy ? 'Erstelle…' : 'Homing-Datei erstellen'}
              </button>
            )}
            {homing?.error && <p className="text-xs text-red-400">{homing.error}</p>}
            <p className="text-[10px] text-surface-600">
              Feinkalibrierung (Greifer-Offsets, Sequenzen) machst du danach unter <span className="text-surface-400">Steuerung</span> und im <span className="text-surface-400">Sequenz-Editor</span>.
            </p>
            <div className="flex justify-between pt-2">
              <button onClick={prev} className="btn-secondary text-sm">← Zurück</button>
              <button onClick={finish} className="btn-primary text-sm">Fertig ✓</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
