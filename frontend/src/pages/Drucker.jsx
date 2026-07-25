import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useLanguage } from '../services/i18n'
import { controlService, rackManagerService, deviceService, printerService } from '../services/api'
import { PRINTERS, CUSTOM_PRINTER } from '../services/printers'
import { PrinterBadge } from '../components/PrinterBadge'
import TeachIn from '../components/TeachIn'

/* ── Drucker-Tab ────────────────────────────────────────────────────────────────
   Ein Drucker pro Printloom. Modell wählen → Positionen je Aufgabe (Tür auf/zu,
   Auswurf, Einlegen, Greifen/Ablegen) einstellen und LIVE testen. Printloom sendet
   den G-code direkt aus diesen Koordinaten (nur OTTOEJECT_HOME bleibt Geräte-Macro).
   „Farm nutzt diese Position" (opt-in, je Operation) schaltet den App-G-code für die
   Auto-Farm frei — Standard AUS (Farm nutzt bis dahin die Geräte-Macros). */

// Reihenfolge = Wechselablauf. move_to_printer nutzt die Auswurf-Position als Bezug;
// place nutzt die Einlege-Position (load-Koordinaten). Jede Op hat eine EIGENE Geschwindigkeit.
const OPS = ['open_door', 'close_door', 'move_to_printer', 'eject', 'place', 'grab', 'store']
const SPEEDS = [25, 50, 100, 200, 300, 400, 500]

// Robuste Zahl: akzeptiert Komma-Dezimal (de), leer/ungültig → Default (nie NaN/null).
const num = (v, d = 0) => {
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : d
}

// Textfeld mit Dezimal-Tastatur — akzeptiert „17,5" UND „17.5" (type=number würde das
// Komma verwerfen → leeres Feld / NaN). Umgewandelt wird erst beim Bauen der Geometrie.
function NumField({ label, hint, value, onChange }) {
  return (
    <label className="block">
      <span className="text-[11px] text-surface-400">{label}</span>
      {hint && <span className="block text-[9px] text-surface-600">{hint}</span>}
      <input type="text" inputMode="decimal" value={value ?? ''}
        onChange={e => onChange(e.target.value)} className="w-full text-sm font-mono mt-0.5" />
    </label>
  )
}

function Toggle({ on, onClick, color = 'bg-blue-600' }) {
  return (
    <button type="button" onClick={onClick}
      className={`relative w-9 h-5 rounded-full transition-colors shrink-0 ${on ? color : 'bg-surface-700'}`}>
      <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : 'translate-x-0'}`} />
    </button>
  )
}

/* Geschwindigkeit PRO Operation (M220). Leer = globaler Standard. So lässt sich der
   Wechsel feinjustieren: z. B. Anfahrt 400 %, Auswurf 200 %, Einlegen 150 %. */
function SpeedSelect({ value, onChange }) {
  const { tr } = useLanguage()
  return (
    <select value={value ?? ''} onChange={e => onChange(e.target.value)}
      title={tr('Geschwindigkeit dieser Operation (M220)')}
      className="text-[11px] bg-surface-900/70 border border-surface-700/60 rounded px-1 py-1 text-surface-300">
      <option value="">{tr('Speed: global')}</option>
      {SPEEDS.map(s => <option key={s} value={s}>{s}%</option>)}
    </select>
  )
}

/* Operations-Karte (Modul-Ebene → Eingabefelder verlieren beim Tippen nicht den Fokus).
   Entweder X/Y/Z-Werte ODER (Feinjustage) ein eigener, editierbarer G-code. */
function OpCard({ op, icon, title, fields = [], extra, note, busy, gcodeOn, onTest, onToggle,
                 overrideVal, canOverride, gcodeOnly, onLoadGcode, onChangeGcode, onClearGcode, effHint,
                 speedVal, onSpeed, onTeach, teachNode }) {
  const { tr } = useLanguage()
  const showGcode = gcodeOnly || typeof overrideVal === 'string'
  const gval = overrideVal ?? ''
  return (
    <div className={`card p-3 space-y-2.5 ${showGcode ? 'border-blue-700/50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-surface-200 min-w-0 truncate">{icon} {title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <SpeedSelect value={speedVal} onChange={v => onSpeed(op, v)} />
          {/* Einmessen statt Zahlen raten: anfahren, mit den Pfeilen justieren,
              „Hierher übernehmen" schreibt die Ist-Position in die Felder. */}
          {onTeach && (
            <button onClick={() => onTeach(op)} disabled={busy} title={tr('Position einmessen')}
              className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">📐</button>
          )}
          <button onClick={() => onTest(op, tr('{0}…', title), extra)} disabled={busy}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Test')}</button>
        </div>
      </div>

      {teachNode}

      {showGcode ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-blue-300">
              {gcodeOnly ? tr('⚙ G-code dieser Operation') : tr('⚙ Eigener G-code — Werte werden ignoriert')}
            </span>
            {gcodeOnly
              ? <button onClick={() => onLoadGcode(op, extra)} className="text-[10px] text-surface-500 hover:text-surface-300">{tr('⤓ Vorlage laden')}</button>
              : <button onClick={() => onClearGcode(op)} className="text-[10px] text-surface-500 hover:text-surface-300">{tr('✕ zurück zu Werten')}</button>}
          </div>
          <textarea value={gval} onChange={e => onChangeGcode(op, e.target.value)} spellCheck={false} rows={8}
            placeholder={gcodeOnly ? tr('Eigener G-code für diese Operation … („Vorlage laden" füllt einen Startpunkt)') : ''}
            className="w-full text-[11px] leading-snug font-mono bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 whitespace-pre" />
          <p className="text-[9px] text-surface-600">{tr('Wird 1:1 an den OTTOeject gesendet. „Test" fährt genau diesen G-code.')}</p>
          <p className="text-[9px] text-blue-400/80 leading-relaxed">
            {tr('Platzhalter für Regale/Fächer:')}{' '}
            <span className="font-mono text-blue-300">{'{rack_x} {slot_z} {mag_z} {y_engage} {y_pullback} {rack} {slot}'}</span>
            {' — '}{tr('EIN G-code fährt so jedes Regal (R1 am Drucker) und Fach korrekt an.')}
          </p>
        </div>
      ) : (
        <>
          {fields.length > 0 ? (
            <div className={`grid gap-2 ${fields.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {fields.map(f => (
                <NumField key={f.label} label={f.label} hint={f.hint} value={f.value}
                  step={f.step} onChange={f.onChange} />
              ))}
            </div>
          ) : (note && <p className="text-[10px] text-surface-500">{note}</p>)}
          {effHint && <p className="text-[10px] text-blue-300">{effHint}</p>}
          {fields.length > 0 && note && <p className="text-[9px] text-surface-600">{note}</p>}
          {canOverride && (
            <button onClick={() => onLoadGcode(op, extra)} className="text-[10px] text-blue-400 hover:text-blue-300">
              {tr('⚙ Eigenen G-code bearbeiten (Feinjustage)')}
            </button>
          )}
        </>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-surface-800/50">
        <Toggle on={!!gcodeOn} onClick={() => onToggle(op)} color="bg-emerald-600" />
        <span className={`text-[11px] ${gcodeOn ? 'text-emerald-300' : 'text-surface-500'}`}>
          {gcodeOnly
            ? (gcodeOn ? tr('Farm nutzt diesen G-code ✓') : tr('Farm nutzt diesen G-code (aus → Geräte-Macro)'))
            : (gcodeOn ? tr('Farm nutzt diese Position ✓') : tr('Farm nutzt diese Position (aus → Geräte-Macro)'))}
        </span>
      </label>
    </div>
  )
}

/* ── Drucker-Einstellungen (Bambu Lab) ──────────────────────────────────────────
   Alles, was man sonst am Drucker-Display einstellt: KI-/Kamera-Erkennung,
   Druckgeschwindigkeit, Auto-Recovery, Kammerlicht + die große Kalibrierung.
   Zustand kommt aus dem MQTT-Push-Report; unbekannte Felder zeigen „—" statt
   einen Zustand zu erfinden. */
const XCAM_SETTINGS = [
  { key: 'first_layer_inspector',      label: 'Erste Schicht prüfen',
    desc: 'Kamera prüft die erste Schicht und hält den Druck bei Fehlern an.' },
  { key: 'spaghetti_detector',         label: 'Spaghetti-Erkennung',
    desc: 'Erkennt Fehldrucke („Spaghetti") und hält den Druck an.' },
  { key: 'buildplate_marker_detector', label: 'Bauplatten-Erkennung',
    desc: 'Prüft per Marker, ob die richtige Druckplatte eingelegt ist.' },
  { key: 'printing_monitor',           label: 'KI-Drucküberwachung',
    desc: 'Allgemeine KI-Überwachung des Drucks.' },
]

const SPEED_OPTIONS = [
  { lvl: 1, label: 'Leise' },
  { lvl: 2, label: 'Standard' },
  { lvl: 3, label: 'Sport' },
  { lvl: 4, label: 'Ludicrous' },
]

const CALIB_OPTIONS = [
  { key: 'bed_leveling',             label: 'Bett-Nivellierung' },
  { key: 'vibration_compensation',   label: 'Vibrations-Kompensation' },
  { key: 'motor_noise_cancellation', label: 'Motorgeräusch-Abgleich' },
]

function PrinterSettingsPanel({ deviceId, printerName, canCalibrate }) {
  const { tr } = useLanguage()
  const [open, setOpen]     = useState(false)
  const [s, setS]           = useState(null)     // gelesene Einstellungen
  const [online, setOnline] = useState(null)
  const [busy, setBusy]     = useState(null)     // key der gerade gesetzt wird
  const [msg, setMsg]       = useState(null)     // { text, err }
  const [calib, setCalib]   = useState(() => CALIB_OPTIONS.map(o => o.key))
  const [calibBusy, setCalibBusy] = useState(false)

  const load = async () => {
    if (deviceId == null) return
    try {
      const r = await printerService.getSettings(deviceId)
      setOnline(!!r.data?.online)
      setS(r.data?.settings ?? {})
    } catch (e) {
      setOnline(false)
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    }
  }
  useEffect(() => { if (open) load() /* eslint-disable-next-line */ }, [open, deviceId])

  const apply = async (key, value) => {
    setBusy(key); setMsg(null)
    // optimistisch umschalten, bei Fehler zurückdrehen
    const prev = s?.[key]
    setS(o => ({ ...o, [key]: value }))
    try {
      await printerService.setSettings(deviceId, { [key]: value })
      setMsg({ text: tr('✓ Übernommen'), err: false })
      setTimeout(load, 1500)   // Drucker meldet den neuen Zustand kurz danach
    } catch (e) {
      setS(o => ({ ...o, [key]: prev }))
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    } finally { setBusy(null) }
  }

  const runCalibration = async () => {
    if (!calib.length) return
    setCalibBusy(true); setMsg(null)
    try {
      const r = await printerService.calibrate(deviceId, calib)
      setMsg({ text: r.data?.message || tr('Kalibrierung gestartet'), err: false })
    } catch (e) {
      setMsg({ text: e.response?.data?.detail ?? e.message, err: true })
    } finally { setCalibBusy(false) }
  }

  const TriState = ({ value, onToggle, disabled }) => (
    value == null ? (
      <span className="text-[10px] text-surface-600 w-9 text-center shrink-0" title={tr('Drucker hat diesen Wert noch nicht gemeldet')}>—</span>
    ) : (
      <Toggle on={!!value} onClick={() => !disabled && onToggle(!value)} color="bg-emerald-600" />
    )
  )

  return (
    <div className="card p-3 space-y-2">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-sm font-medium text-surface-200">{tr('⚙ Drucker-Einstellungen ({0})', printerName)}</span>
        <span className="text-[11px] text-blue-400">{open ? tr('▾ ausblenden') : tr('▸ anzeigen')}</span>
      </button>
      {!open ? (
        <p className="text-[10px] text-surface-600">
          {tr('KI-Erkennung, Geschwindigkeit, Auto-Recovery, Licht und Kalibrierung — direkt hier, ohne an den Drucker zu gehen.')}
        </p>
      ) : deviceId == null ? (
        <p className="text-[11px] text-surface-500">{tr('Kein Bambu-Drucker unter „Geräte" angelegt.')}</p>
      ) : (
        <div className="space-y-3">
          {online === false && (
            <p className="text-[11px] text-amber-400">
              {tr('Drucker nicht erreichbar — Einstellungen können nicht gelesen werden. Setzen wird erst nach dem Verbinden wirksam.')}
            </p>
          )}

          {/* Kamera-/KI-Erkennung */}
          <div className="space-y-1.5">
            <p className="text-[11px] font-medium text-surface-300">{tr('Erkennung (Kamera / KI)')}</p>
            {XCAM_SETTINGS.map(row => (
              <div key={row.key} className="flex items-start gap-2">
                <TriState value={s?.[row.key]} disabled={busy === row.key}
                  onToggle={v => apply(row.key, v)} />
                <div className="min-w-0">
                  <p className="text-[11px] text-surface-300">{tr(row.label)}</p>
                  <p className="text-[9px] text-surface-600">{tr(row.desc)}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Geschwindigkeit + Auto-Recovery + Licht */}
          <div className="pt-2 border-t border-surface-800/50 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-surface-400">{tr('Druckgeschwindigkeit')}</span>
              {SPEED_OPTIONS.map(o => (
                <button key={o.lvl} onClick={() => apply('speed_level', o.lvl)} disabled={busy === 'speed_level'}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${
                    s?.speed_level === o.lvl ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                                             : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>
                  {tr(o.label)}
                </button>
              ))}
              {s?.speed_level == null && <span className="text-[9px] text-surface-600">{tr('(aktuell unbekannt)')}</span>}
            </div>
            <div className="flex items-start gap-2">
              <TriState value={s?.auto_recovery} disabled={busy === 'auto_recovery'}
                onToggle={v => apply('auto_recovery', v)} />
              <div>
                <p className="text-[11px] text-surface-300">{tr('Auto-Recovery bei Schrittverlust')}</p>
                <p className="text-[9px] text-surface-600">{tr('Druckt nach einem Schrittverlust weiter statt abzubrechen.')}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <TriState value={s?.chamber_light} disabled={busy === 'chamber_light'}
                onToggle={v => apply('chamber_light', v)} />
              <div>
                <p className="text-[11px] text-surface-300">{tr('Kammerlicht')}</p>
                <p className="text-[9px] text-surface-600">{tr('Beleuchtung im Bauraum (wird für die Kamera automatisch eingeschaltet).')}</p>
              </div>
            </div>
            {(s?.nozzle_diameter || s?.nozzle_type) && (
              <p className="text-[9px] text-surface-600 font-mono">
                {tr('Düse')}: {s.nozzle_type || '?'} · {s.nozzle_diameter || '?'} mm
              </p>
            )}
          </div>

          {/* Kalibrierung — nur bei Modellen, die sie per MQTT annehmen (X1-Serie).
              Vorher stand der Knopf auch beim P1S/A1 da und tat schlicht nichts. */}
          {canCalibrate !== false && (
            <div className="pt-2 border-t border-surface-800/50 space-y-1.5">
              <p className="text-[11px] font-medium text-surface-300">{tr('Kalibrierung (X1-Serie)')}</p>
              <p className="text-[9px] text-surface-600">
                {tr('Alle drei zusammen dauern ~16 Minuten und blockieren den Drucker. Nur starten, wenn nichts läuft — die Farm sollte gestoppt sein.')}
              </p>
              <div className="flex items-center gap-3 flex-wrap">
                {CALIB_OPTIONS.map(o => (
                  <label key={o.key} className="flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" checked={calib.includes(o.key)}
                      onChange={e => setCalib(c => e.target.checked ? [...c, o.key] : c.filter(k => k !== o.key))} />
                    <span className="text-[11px] text-surface-400">{tr(o.label)}</span>
                  </label>
                ))}
              </div>
              <button onClick={runCalibration} disabled={calibBusy || !calib.length}
                className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">
                {calibBusy ? tr('Starte…') : tr('▶ Kalibrierung starten')}
              </button>
            </div>
          )}
          {canCalibrate === false && (
            <p className="pt-2 border-t border-surface-800/50 text-[10px] text-surface-600">
              {tr('{0} nimmt keine Kalibrierung über Printloom entgegen — die läuft am Drucker selbst.', printerName)}
            </p>
          )}

          {msg && (
            <p className={`text-[11px] font-mono ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>
          )}
          <div className="flex items-center gap-2">
            <button onClick={load} className="text-[10px] text-blue-400 hover:text-blue-300">{tr('⟳ Zustand neu lesen')}</button>
            <span className="text-[9px] text-surface-600">
              {tr('„—" = der Drucker hat den Wert noch nicht gemeldet. Nicht jedes Modell unterstützt jede Option.')}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Drucker() {
  const { tr } = useLanguage()

  const [printerId, setPrinterId] = useState('x1c')
  const [printerName, setPrinterName] = useState('Bambu Lab X1C')
  const [enclosed, setEnclosed] = useState(true)
  const [eject, setEject] = useState({ x: 425, y: 340, z: 17.5 })
  const [load,  setLoad]  = useState({ x: 425, y: 340, z: 17.5 })
  const [moveTo, setMoveTo] = useState({ x: 425, y: 340, z: 17.5 })  // „Vor Drucker fahren" — eigene Anfahr-Position (Fallback: eject)
  const [doorOpen,  setDoorOpen]  = useState({ x: 104, y: 319, z: 105, d: 370 })
  const [doorClose, setDoorClose] = useState({ x: 103, y: 322, z: 105, d: 375 })

  // Regal / Greifen — nur PHYSISCHE mm-Werte (Regalzahl/Fächer/Magazin: global aus Konfiguration)
  const [xUnclamp, setX]  = useState(43)
  const [yEngage,  setY]  = useState(335)
  const [firstZ, setFirstZ] = useState(7)
  const [gap, setGap]     = useState(25)
  const [rackGap, setRackGap] = useState(250)
  const [plate, setPlate] = useState('256')          // 256 → pullback 5, 220 → 30
  const [clampPush, setClampPush] = useState(30)      // Klemm-Andruck-Weg (mm): eject/load +push, grab/store −push
  const [speedFactor, setSpeedFactor] = useState(100) // globaler M220-Vorschub in % (100–500) — Fallback
  const [speedFactors, setSpeedFactors] = useState({}) // { op: % } — Geschwindigkeit PRO Operation
  const setOpSpeed = (op, v) => setSpeedFactors(m => {
    const n = { ...m }
    if (v === '' || v == null) delete n[op]; else n[op] = +v
    return n
  })

  // Regalzahl / Fächer / Magazin-Fach: EINE Quelle = Configuration → Rack Configuration.
  const [rackCfg, setRackCfg] = useState({ num_racks: 3, slots_per_rack: 6, magazine_slot: 7 })

  // Opt-in: welche Operationen die Farm als App-G-code statt Geräte-Macro fährt
  const [useGcode, setUseGcode] = useState(
    () => Object.fromEntries(OPS.map(o => [o, false]))
  )
  const toggleGcode = (op) => setUseGcode(m => ({ ...m, [op]: !m[op] }))

  // Eigener G-code je Operation (Feinjustage) — überschreibt die berechnete Bewegung.
  const [gcodeOverride, setGcodeOverride] = useState({})   // { op: "G1 ..." }
  const setGcodeText = (op, text) => setGcodeOverride(m => ({ ...m, [op]: text }))
  const clearGcode = (op) => setGcodeOverride(m => { const n = { ...m }; delete n[op]; return n })

  const [testRack, setTestRack] = useState(1)
  const [testSlot, setTestSlot] = useState(1)
  const [rackXTrim, setRackXTrim] = useState({})   // {"2": -1.5, …} X-Korrektur je Regal (mm)
  const [regalOpen, setRegalOpen] = useState(false)
  // Achsgrenzen des Geräts ({} = unbekannt) + Prüfergebnis der Geometrie. Solange die
  // Grenzen fehlen, wird nur „unter 0" geprüft — deshalb der Knopf „vom Gerät holen".
  const [limits, setLimits]       = useState({})
  const [check, setCheck]         = useState(null)
  const [limitsBusy, setLimitsBusy] = useState(false)
  const [limitsMsg, setLimitsMsg] = useState('')
  const [checkOpen, setCheckOpen] = useState(false)
  const [jog, setJog] = useState({ busy: false, msg: '', err: false })
  const [lastScript, setLastScript] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [gcodeLine, setGcodeLine] = useState('')
  const [bambuId, setBambuId] = useState(null)   // verbundener Bambu-Drucker (für „Bett → Z")
  const [bedZ, setBedZ] = useState(200)          // Ziel-Z des Druckerbetts (Ladeposition = 200)
  // Modell des angelegten Druckers + Registry (printer_models). Damit weiß die Seite,
  // ob es eine Tür gibt, ob Kalibrierung geht und welche Geometrie-Vorlage passt —
  // statt das aus der gewählten Vorlage zu erraten.
  const [deviceModel, setDeviceModel] = useState('')
  const [modelList, setModelList]     = useState([])

  const hasDoor = enclosed && !!(doorOpen && doorClose)
  const yPullback = plate === '220' ? 30 : 5
  const numRacks = +rackCfg.num_racks || 1
  const magazineSlot = +rackCfg.magazine_slot || 0

  const pickPrinter = (p) => {
    setPrinterId(p.id); setPrinterName(p.name); setEnclosed(p.enclosed)
    setEject({ ...p.eject }); setLoad({ ...p.load })
    setMoveTo(p.move ? { ...p.move } : { ...p.eject })   // Anfahr-Position: Preset oder = eject
    // Ohne Tür-Preset (z. B. AD5X) die Tür leeren, sonst blieben alte Werte → falsche Tür-Karten.
    setDoorOpen(p.door ? { ...p.door.open } : null)
    setDoorClose(p.door ? { ...p.door.close } : null)
  }

  // ── Geometrie: EINE Quelle für Live-G-code UND (opt-in) die Farm ──
  // Regalzahl/Fächer/Magazin bewusst NICHT hier — die überlagert das Backend global
  // aus der Rack-Konfiguration (apply_rack_config). Hier nur Drucker + physische mm.
  const geometry = useMemo(() => {
    const nd = (o) => ({ x: num(o.x), y: num(o.y), z: num(o.z), d: num(o.d) })
    return {
      printer_id: printerId, printer_name: printerName, enclosed,
      storage: {
        x_unclamp: num(xUnclamp), y_engage: num(yEngage), first_z_flat: num(firstZ),
        slot_gap: num(gap), y_pullback_limit: yPullback, rack_x_gap: num(rackGap),
      },
      printer: {
        eject: { x: num(eject.x), y: num(eject.y), z: num(eject.z) },
        load:  { x: num(load.x),  y: num(load.y),  z: num(load.z) },
        move:  { x: num(moveTo.x), y: num(moveTo.y), z: num(moveTo.z) },
        door: hasDoor ? { open: nd(doorOpen), close: nd(doorClose) } : null,
      },
      use_gcode: { ...useGcode },
      gcode_override: gcodeOverride,
      speed_factor: num(speedFactor, 100) || 100,
      speed_factors: { ...speedFactors },
      rack_x_trim: { ...rackXTrim },
      clamp_push_mm: num(clampPush, 30),
      machine_limits: { ...limits },
    }
  }, [printerId, printerName, enclosed, xUnclamp, yEngage,
      firstZ, gap, yPullback, rackGap, eject, load, moveTo, doorOpen, doorClose, hasDoor, useGcode, gcodeOverride, speedFactor, speedFactors, rackXTrim, clampPush, limits])

  // Persistenz: gespeicherte Geometrie beim Laden übernehmen (einmal), Änderungen debounced speichern
  const hydrated = useRef(false)
  useEffect(() => {
    controlService.getGeometry().then(r => {
      const g = r?.data?.geometry
      if (g && g.printer_id) {
        setPrinterId(g.printer_id); setPrinterName(g.printer_name || g.printer_id)
        setEnclosed(!!g.enclosed)
        const s = g.storage || {}
        if (s.first_z_flat != null) setFirstZ(s.first_z_flat)
        if (s.slot_gap != null) setGap(s.slot_gap)
        if (s.x_unclamp != null) setX(s.x_unclamp)
        if (s.y_engage != null) setY(s.y_engage)
        if (s.rack_x_gap != null) setRackGap(s.rack_x_gap)
        setPlate((s.y_pullback_limit >= 30) ? '220' : '256')
        const p = g.printer || {}
        if (p.eject) setEject(p.eject)
        if (p.load) setLoad(p.load)
        // Eigene Anfahr-Position; Altbestand ohne „move" → von eject seeden.
        setMoveTo(p.move ? { ...p.move } : (p.eject ? { ...p.eject } : { x: 425, y: 340, z: 17.5 }))
        // Tür aus dem Speicher übernehmen; fehlt sie (offener/türloser Drucker) → leeren.
        setDoorOpen(p.door?.open || null)
        setDoorClose(p.door?.close || null)
        if (g.speed_factor != null) setSpeedFactor(g.speed_factor)
        if (g.speed_factors) setSpeedFactors(g.speed_factors)
        if (g.rack_x_trim) setRackXTrim(g.rack_x_trim)
        if (g.clamp_push_mm != null) setClampPush(g.clamp_push_mm)
        if (g.machine_limits && typeof g.machine_limits === 'object') setLimits(g.machine_limits)
        if (g.use_gcode) {
          // Migration: die Einlege-Op hieß früher „load", jetzt „place" (Alias) —
          // alte Aktivierung übernehmen, damit die Farm-Position nicht still ausgeht.
          const ug = { ...g.use_gcode }
          if (ug.load != null && ug.place == null) ug.place = ug.load
          setUseGcode(m => ({ ...m, ...ug }))
        }
        if (g.gcode_override) {
          const ov = { ...g.gcode_override }
          if (typeof ov.load === 'string' && ov.place == null) ov.place = ov.load
          setGcodeOverride(ov)
        }
      }
    }).catch(() => {}).finally(() => { hydrated.current = true })
  }, [])
  useEffect(() => {
    if (!hydrated.current) return
    // Speichern liefert die Plausibilitätsprüfung mit zurück (Achsgrenzen) — so sieht
    // der Nutzer sofort, wenn ein Wert eine Bewegung aus der Achse fahren würde,
    // statt es erst beim Testen von Klipper zu erfahren.
    const t = setTimeout(() => {
      controlService.putGeometry(geometry)
        .then(r => setCheck(r?.data?.check || null))
        .catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [geometry])

  // ── Einmessen (Phase 2.1) ──
  // Statt Zahlen zu raten: hinfahren, mit den Pfeilen justieren, Ist-Position
  // übernehmen. Drucker-Positionen werden OHNE Regal-Versatz gespeichert (die
  // Maschinen-X ist Basis + xOff) — beim Übernehmen also zurückrechnen.
  const [teachOp, setTeachOp] = useState(null)
  const toggleTeach = (op) => setTeachOp(t => (t === op ? null : op))

  const applyTeachPrinter = (setter) => (pos) => {
    setter(s => ({ ...s, x: r1(pos.x - xOff), y: r1(pos.y), z: r1(pos.z) }))
    setTeachOp(null)
  }
  // Regal: gemessen wird Fach 1 in Regal 1. Daraus folgen Start-X (abzüglich des
  // Regal-Versatzes, s. slot_position), Y-Engage und die Höhe von Fach 1.
  const applyTeachRack = (pos) => {
    setX(r1(pos.x - xOff))
    setY(r1(pos.y))
    setFirstZ(r1(pos.z))
    setTeachOp(null)
  }

  // Achsgrenzen vom Gerät holen (Klipper toolhead.axis_maximum) → in die Geometrie.
  const fetchLimits = async () => {
    setLimitsBusy(true); setLimitsMsg('')
    try {
      const r = await controlService.getAxisLimits()
      const l = r?.data?.limits || {}
      setLimits(l)
      setLimitsMsg(tr('✓ Vom Gerät: X {0} · Y {1} · Z {2} mm', l.x ?? '—', l.y ?? '—', l.z ?? '—'))
    } catch (e) {
      setLimitsMsg(e?.response?.data?.detail || e?.message || tr('Fehler'))
    } finally { setLimitsBusy(false) }
  }

  // Regalzahl / Fächer / Magazin-Fach global aus der Rack-Konfiguration (Configuration).
  useEffect(() => {
    const load = () => rackManagerService.getAll().then(r => {
      const d = r?.data || {}
      setRackCfg({
        num_racks: d.num_racks ?? 3, slots_per_rack: d.slots_per_rack ?? 6, magazine_slot: d.magazine_slot ?? 7,
        magazine_counts: Array.isArray(d.magazine_counts) ? d.magazine_counts : [],
      })
    }).catch(() => {})
    load()
    window.addEventListener('printloom:rackConfigSaved', load)
    return () => window.removeEventListener('printloom:rackConfigSaved', load)
  }, [])

  // ── Live: OTTOeject-Operation aus der AKTUELLEN Geometrie senden ──
  const sendOp = async (op, label, extra = {}, geomOverride = null) => {
    if (jog.busy) return
    setJog({ busy: true, msg: label, err: false })
    try {
      const r = await controlService.runOp({ op, geometry: geomOverride || geometry, ...extra })
      if (r?.data?.script) setLastScript(r.data.script)
      setJog({ busy: false, msg: tr('✓ {0}', label), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }
  const homeOtto = () => sendOp('home', tr('Referenzfahrt…'))

  // Platte aus dem Magazin eines Regals holen (NOLIFT) — danach den Bestand
  // runterzählen: die nächste Entnahme greift dann automatisch tiefer/höher
  // richtig (Durchbiegung: Stapel liegt pro Platte ~1 mm tiefer).
  const grabFromMagazine = async (r) => {
    if (jog.busy) return
    setJog({ busy: true, msg: tr('Magazin R{0} — Platte holen…', r), err: false })
    try {
      const res = await controlService.runOp({ op: 'grab_magazine', geometry, rack: r })
      if (res?.data?.script) setLastScript(res.data.script)
      const t = await rackManagerService.takeFromMagazine(r).catch(() => null)
      if (Array.isArray(t?.data?.magazine_counts)) {
        setRackCfg(c => ({ ...c, magazine_counts: t.data.magazine_counts }))
      }
      setJog({ busy: false, msg: tr('✓ Magazin R{0}', r), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }

  // G-code-Zeile direkt an den OTTOeject senden (Kalibrierung). Läuft über
  // /klipper/gcode → RACK=-Nummern werden automatisch in die Geräte-Zählung
  // gespiegelt; die Antwort kommt beim Bewegungsstart zurück.
  const sendGcodeLine = async () => {
    const g = gcodeLine.trim()
    if (!g || jog.busy) return
    setJog({ busy: true, msg: tr('G-code senden…'), err: false })
    try {
      const r = await controlService.sendKlipperGcode(g)
      if (r?.data?.gcode) setLastScript(r.data.gcode)
      setJog({ busy: false, msg: tr('✓ Gesendet: {0}', g), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }

  // Verbundenen Bambu-Drucker ermitteln (für „Bett → Z" — bewegt den X1C, nicht den OTTOeject).
  // Dazu sein MODELL: davon hängen Tür, Kalibrierung und die passende Geometrie-Vorlage ab.
  useEffect(() => {
    deviceService.listDevices()
      .then(r => {
        const b = (r?.data || []).find(d => d.device_type === 'bambu_lab')
        if (b) { setBambuId(b.id); setDeviceModel(b.model || '') }
      })
      .catch(() => {})
    deviceService.listModels().then(r => setModelList(r.data?.models || [])).catch(() => {})
  }, [])

  // Druckerbett auf Ziel-Z fahren (absolut). Z200 = Ladeposition für den Platten-Wechsel.
  const moveBedZ = async () => {
    if (bambuId == null || jog.busy) return
    const z = Math.round(num(bedZ, 200))
    setJog({ busy: true, msg: tr('Drucker-Bett → Z{0}…', z), err: false })
    try {
      await printerService.sendGcode(bambuId, `G90\nG1 Z${z} F3000`)
      setJog({ busy: false, msg: tr('✓ Bett → Z{0}', z), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }

  // Druckbett homen (G28) — der Drucker referenziert seine Achsen neu. Nötig, wenn
  // die Z-Position nach manuellem Verschieben nicht mehr stimmt (sonst fährt „Bett → Z"
  // auf eine falsche Höhe).
  const homeBed = async () => {
    if (bambuId == null || jog.busy) return
    setJog({ busy: true, msg: tr('Drucker-Bett homen…'), err: false })
    try {
      await printerService.sendGcode(bambuId, 'G28')
      setJog({ busy: false, msg: tr('✓ Bett gehomt (G28)'), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }

  // Geschwindigkeit setzen → M220 sofort an den OTTOeject schicken (und für Ops speichern).
  const applySpeed = (v) => {
    setSpeedFactor(v)
    sendOp('speed', tr('Geschwindigkeit {0}%', v), {}, { ...geometry, speed_factor: v })
  }

  // G-code der Operation aus den aktuellen WERTEN laden → Startpunkt zum Bearbeiten.
  // Den evtl. schon gesetzten Override dieser Op vorher entfernen, damit die Vorlage
  // immer die berechnete Bewegung ist (sonst käme der bestehende Override zurück).
  const loadGcodeForEdit = async (op, extra = {}) => {
    try {
      const { [op]: _drop, ...restOv } = gcodeOverride
      const geo = { ...geometry, gcode_override: restOv }
      const r = await controlService.previewOp({ op, geometry: geo, ...extra })
      setGcodeOverride(m => ({ ...m, [op]: r?.data?.script || '' }))
    } catch {
      setGcodeOverride(m => ({ ...m, [op]: '' }))
    }
  }

  const activeCount = OPS.filter(o => useGcode[o]).length
  // „Custom Printer" = ausschließlich eigener G-code je Operation, KEINE Start-Positionen.
  // Named Printer = Positions-Werte MIT optionalem eigenem G-code je Op (Feinjustage).
  const isCustom = printerId === CUSTOM_PRINTER.id
  // Direkte Drucker-Steuerung (Bett fahren/homen, Einstellungen) geht nur bei Bambu Lab —
  // nur dafür hat Printloom eine Verbindung (MQTT). Bei Fremdmodellen (Creality, Elegoo,
  // Anycubic, Flashforge, Custom) wird die Sektion ausgeblendet statt tote Knöpfe zu zeigen.
  // Maßgeblich ist das MODELL des angelegten Geräts; die Vorlagen-ID ist nur der
  // Rückfall für Installationen, bei denen noch kein Modell gesetzt ist.
  const modelInfo    = modelList.find(m => m.id === deviceModel) || null
  const isBambuModel = deviceModel
    ? true                                   // im Geräte-Formular gibt es nur Bambu-Modelle
    : ['x1c', 'p1s', 'p1p', 'a1'].includes(printerId)
  // Passt die gewählte Geometrie-Vorlage zum angelegten Drucker? Ein X1C-Preset auf
  // einem P1S fährt sonst an die falsche Stelle — das ist ein teurer Fehler.
  const presetMismatch = modelInfo?.preset && printerId !== CUSTOM_PRINTER.id
    && printerId !== modelInfo.preset
  const modelNoPreset  = !!deviceModel && modelInfo && !modelInfo.preset
  const bedControlReady = isBambuModel && bambuId != null
  // Custom Printer: reiner G-code-Editor je Op. Named Printer: Positions-Felder +
  // Knopf „Eigenen G-code bearbeiten"; sobald ein Override existiert, zeigt die Karte
  // den Editor (Override hat dann Vorrang, siehe Backend). „✕ zurück zu Werten" löscht ihn.
  const opGcodeProps = (op) => isCustom
    ? { gcodeOnly: true, overrideVal: gcodeOverride[op] ?? '', onLoadGcode: loadGcodeForEdit, onChangeGcode: setGcodeText, onClearGcode: clearGcode }
    : { canOverride: true, overrideVal: (op in gcodeOverride) ? (gcodeOverride[op] ?? '') : undefined,
        onLoadGcode: loadGcodeForEdit, onChangeGcode: setGcodeText, onClearGcode: clearGcode }
  // Drucker sitzt hinter dem letzten Regal → eject/load/Tür-X wandern mit der Regalzahl.
  const xOff = numRacks > 1 ? (numRacks - 1) * num(rackGap) : 0
  // Drucker-nahe Ops (Tür, eject, place, move_to_printer): X wird als ABSOLUTER
  // Maschinenwert eingegeben (inkl. Regal-Versatz). Gespeichert wird die Basis
  // (Wert − Versatz), damit die Bewegung bei anderer Regalzahl stimmt. Y/Z sind
  // ohnehin absolut (Backend nutzt sie 1:1).
  const r1 = (n) => Math.round(n * 10) / 10
  const absXField = (st, setSt) => ({
    label: tr('Start-X'),
    value: xOff ? r1(num(st.x) + xOff) : st.x,
    onChange: xOff
      ? (v => { const e = parseFloat(v); if (Number.isNaN(e)) return; setSt({ ...st, x: r1(e - xOff) }) })
      : (v => setSt({ ...st, x: v })),
  })
  const absHint = (st) => xOff
    ? tr('Absoluter Start-X an der Maschine · Basis {0} + Regal-Versatz {1}', Math.round(num(st.x)), Math.round(xOff))
    : null

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Drucker')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          {tr('Modell wählen, Positionen je Aufgabe einstellen und live testen — ohne Klipper-Config zu bearbeiten.')}
        </p>
      </div>

      {/* Sicherheits-Hinweis */}
      <div className="rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-300">
        {tr('⚠ Erst jede Operation per „Test" prüfen und die Position feinjustieren. Falsche Werte können den Arm gegen den Drucker fahren. Danach je Operation „Farm nutzt diese Position" aktivieren.')}
      </div>

      <div className="grid gap-4 lg:grid-cols-[260px_1fr] items-start">
        {/* ── Links: Modell wählen ── */}
        <div className="card p-3 space-y-1.5 self-start">
          <p className="section-label">{tr('1 · Drucker-Modell')}</p>
          {/* Angelegtes Gerät kennt sein Modell (Konfiguration → Geräte). Passt die
              gewählte Vorlage nicht dazu, fährt der Arm an die falsche Stelle. */}
          {presetMismatch && (
            <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-2.5 py-2 text-[10px] text-amber-300 space-y-1.5">
              <p>{tr('Dein angelegter Drucker ist ein {0} — hier ist eine andere Vorlage gewählt. Die Positionen passen dann nicht.', modelInfo.label)}</p>
              <button onClick={() => {
                const p = [...PRINTERS, CUSTOM_PRINTER].find(x => x.id === modelInfo.preset)
                if (p) pickPrinter(p)
              }} className="text-blue-300 hover:text-blue-200 underline">{tr('Passende Vorlage wählen')}</button>
            </div>
          )}
          {modelNoPreset && (
            <p className="rounded-lg border border-surface-700 bg-surface-900/60 px-2.5 py-2 text-[10px] text-surface-400">
              {tr('Für {0} gibt es keine fertige Vorlage — die Positionen einmessen (📐 an jeder Karte).', modelInfo.label)}
            </p>
          )}
          {[...PRINTERS, CUSTOM_PRINTER].map(p => (
            <button key={p.id} onClick={() => pickPrinter(p)}
              className={`w-full flex items-center gap-2 text-left px-2.5 py-1.5 rounded-lg border text-sm transition-colors ${
                printerId === p.id ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                                   : 'border-surface-700 text-surface-400 hover:border-surface-600 hover:text-surface-200'}`}>
              <span className="shrink-0 opacity-80"><PrinterBadge enclosed={p.enclosed} size={26} /></span>
              <span className="min-w-0">
                <span className="block truncate">{p.name}</span>
                <span className="block text-[9px] text-surface-600">
                  {p.custom ? tr('nur eigener G-code') : (p.door ? tr('geschlossen · mit Tür') : tr('offen · ohne Tür'))}
                </span>
              </span>
            </button>
          ))}
        </div>

        {/* ── Rechts: Referenz + Operationen ── */}
        <div className="space-y-4 self-start">
          {/* Referenzfahrt + Status */}
          <div className="card p-3 space-y-2">
            <div className="flex items-center gap-3">
              <div className="shrink-0 rounded-md border border-blue-800/50 bg-blue-950/30 p-1" title={printerName}>
                <PrinterBadge enclosed={enclosed} size={40} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-surface-200 truncate">{printerName}</p>
                <p className="text-[10px] text-surface-600">
                  {isCustom
                    ? (activeCount === 0
                        ? tr('Custom Printer: eigener G-code je Operation — noch keine Op für die Farm aktiv.')
                        : tr('Custom Printer: Farm nutzt {0} eigene G-code-Operation(en). Rest über Geräte-Macros.', activeCount))
                    : (activeCount === 0
                        ? tr('Farm nutzt aktuell die Geräte-Macros (keine App-Position aktiv).')
                        : tr('Farm nutzt {0} App-Position(en). Rest über Geräte-Macros.', activeCount))}
                </p>
              </div>
              <button onClick={homeOtto} disabled={jog.busy}
                className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('⌂ Referenzfahrt')}</button>
            </div>
            <p className="text-[10px] text-surface-600">
              {isCustom
                ? tr('Immer erst Referenzfahrt (OTTOEJECT_HOME), dann eine Operation testen. Custom Printer: jede Operation fährt ausschließlich deinen eigenen G-code unten — keine Start-Positionen.')
                : tr('Immer erst Referenzfahrt (OTTOEJECT_HOME), dann eine Operation testen. Printloom sendet den G-code direkt aus den Werten unten.')}
            </p>
            <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-surface-800/50">
              <span className="text-[11px] text-surface-400">{tr('Geschwindigkeit (global)')}</span>
              {SPEEDS.map(v => (
                <button key={v} onClick={() => applySpeed(v)} disabled={jog.busy}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${(+speedFactor || 100) === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>{v}%</button>
              ))}
              <span className="text-[9px] text-surface-600">{tr('M220-Fallback · pro Operation oben eigene Geschwindigkeit einstellbar')}</span>
            </div>
            {/* Direkter G-code an den OTTOeject (Kalibrierung) */}
            <div className="pt-1 border-t border-surface-800/50 space-y-1">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={gcodeLine}
                  onChange={e => setGcodeLine(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendGcodeLine() }}
                  placeholder={tr('G-code direkt an den OTTOeject — z. B. G1 X100 F6000')}
                  className="flex-1 font-mono text-[11px] h-8 py-0 px-2"
                  disabled={jog.busy}
                />
                <button onClick={sendGcodeLine} disabled={jog.busy || !gcodeLine.trim()}
                  className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('▶ Senden')}</button>
              </div>
              <p className="text-[9px] text-surface-600">
                {tr('Wird 1:1 an Klipper geschickt (Enter = Senden). Vorher homen; RACK=-Nummern werden automatisch in die Geräte-Zählung übersetzt.')}
              </p>
            </div>
            {/* Druckerbett auf Ziel-Z fahren + homen. Nur für Bambu-Modelle — bei
                Fremdmodellen hat Printloom keine Druckerverbindung. */}
            {isBambuModel ? (
              <div className="pt-1 border-t border-surface-800/50 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[11px] text-surface-400">{tr('🖨 Druckbett')}</span>
                  <label className="flex items-center gap-1">
                    <span className="text-[10px] text-surface-500">Z</span>
                    <input type="number" step="10" value={bedZ} onChange={e => setBedZ(e.target.value)}
                      disabled={jog.busy || !bedControlReady}
                      className="w-16 font-mono text-[11px] h-8 py-0 px-2" />
                  </label>
                  <button onClick={moveBedZ} disabled={jog.busy || !bedControlReady}
                    className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('▶ Bett fahren')}</button>
                  <button onClick={() => { setBedZ(200); }} disabled={jog.busy}
                    title={tr('Auf Ladeposition Z200 setzen')}
                    className="text-[10px] text-blue-400 hover:text-blue-300">{tr('= Z200')}</button>
                  <button onClick={homeBed} disabled={jog.busy || !bedControlReady}
                    title={tr('G28 an den Drucker — referenziert die Achsen neu')}
                    className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('⌂ Bett homen')}</button>
                </div>
                <p className="text-[9px] text-surface-600">
                  {!bedControlReady
                    ? tr('Kein Bambu-Drucker unter „Geräte" angelegt — Bett-Steuerung nicht verfügbar.')
                    : tr('„Bett fahren" setzt das Bett absolut auf die Ziel-Z (G90/G1 Z), Z200 = Ladeposition für den Platten-Wechsel. „Bett homen" (G28) referenziert die Achsen neu — danach stimmt die Z-Höhe wieder. Drucker muss idle sein.')}
                </p>
              </div>
            ) : (
              <div className="pt-1 border-t border-surface-800/50">
                <p className="text-[9px] text-surface-600">
                  {tr('{0}: Printloom kann diesen Drucker nicht direkt steuern (nur Bambu Lab über MQTT) — Bett-Fahrt, Homing und Drucker-Einstellungen entfallen. Der OTTOeject wird normal bedient.', printerName)}
                </p>
              </div>
            )}
            {jog.msg && (
              <p className={`text-[11px] font-mono ${jog.err ? 'text-red-400' : jog.busy ? 'text-amber-400' : 'text-emerald-400'}`}>{jog.msg}</p>
            )}
            {lastScript && (
              <div className="pt-1">
                <button onClick={() => setShowScript(s => !s)} className="text-[10px] text-blue-400 hover:text-blue-300">
                  {showScript ? tr('▾ Gesendeten G-code ausblenden') : tr('▸ Gesendeten G-code der letzten Aktion')}
                </button>
                {showScript && (
                  <pre className="mt-1 text-[10px] leading-snug font-mono text-surface-300 bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 overflow-auto max-h-64 whitespace-pre">{lastScript}</pre>
                )}
              </div>
            )}
          </div>

          {/* Drucker-Einstellungen — nur für Bambu-Modelle (nur die kann Printloom
              per MQTT erreichen). Direkt unter den Controls, wie gewünscht. */}
          {isBambuModel && <PrinterSettingsPanel deviceId={bambuId} printerName={printerName}
            canCalibrate={modelInfo ? modelInfo.calibration : undefined} />}

          {/* Operations-Karten */}
          <div className="grid gap-3 md:grid-cols-2">
            {hasDoor && (
              <OpCard op="open_door" icon="🚪" title={tr('Tür öffnen')}
                busy={jog.busy} gcodeOn={useGcode.open_door} onTest={sendOp} onToggle={toggleGcode}
                speedVal={speedFactors.open_door ?? ''} onSpeed={setOpSpeed}
                {...opGcodeProps('open_door')}
                effHint={absHint(doorOpen)}
                note={tr('Start-X/Y/Z = ERSTER Fahrpunkt der Bewegung. Der Rest der Türbewegung folgt daraus (Pin = Bogenradius).')}
                fields={[
                  absXField(doorOpen, setDoorOpen),
                  { label: tr('Start-Y'), value: doorOpen.y, onChange: v => setDoorOpen({ ...doorOpen, y: v }) },
                  { label: tr('Start-Z'), step: 0.5, value: doorOpen.z, onChange: v => setDoorOpen({ ...doorOpen, z: v }) },
                  { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: doorOpen.d, onChange: v => setDoorOpen({ ...doorOpen, d: v }) },
                ]} />
            )}
            {hasDoor && (
              <OpCard op="close_door" icon="🚪" title={tr('Tür schließen')}
                busy={jog.busy} gcodeOn={useGcode.close_door} onTest={sendOp} onToggle={toggleGcode}
                speedVal={speedFactors.close_door ?? ''} onSpeed={setOpSpeed}
                {...opGcodeProps('close_door')}
                effHint={absHint(doorClose)}
                note={tr('Start-X/Y/Z = ERSTER Fahrpunkt (dort greift der Arm die OFFENE Tür — Bogen-Seite, z. B. X~1036 Y~18). Die Schließform folgt automatisch (Pin = Bogenradius).')}
                fields={[
                  absXField(doorClose, setDoorClose),
                  { label: tr('Start-Y'), value: doorClose.y, onChange: v => setDoorClose({ ...doorClose, y: v }) },
                  { label: tr('Start-Z'), step: 0.5, value: doorClose.z, onChange: v => setDoorClose({ ...doorClose, z: v }) },
                  { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: doorClose.d, onChange: v => setDoorClose({ ...doorClose, d: v }) },
                ]} />
            )}
            <OpCard op="move_to_printer" icon="➡" title={tr('Vor Drucker fahren')}
              busy={jog.busy} gcodeOn={useGcode.move_to_printer} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.move_to_printer ?? ''} onSpeed={setOpSpeed}
              onTeach={toggleTeach}
              teachNode={teachOp === 'move_to_printer' && (
                <TeachIn title={tr('Anfahr-Position')} axes={['x', 'y', 'z']}
                  hint={tr('Vor den Drucker fahren und so justieren, wie der Arm ansetzen soll.')}
                  onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry })}
                  onApply={applyTeachPrinter(setMoveTo)} onClose={() => setTeachOp(null)} />
              )}
              {...opGcodeProps('move_to_printer')}
              effHint={absHint(moveTo)}
              note={tr('Sichere Anfahrt vor den Drucker — eigene Start-Position. Standard = Auswurf-Position; hier fein justierbar.')}
              fields={[
                absXField(moveTo, setMoveTo),
                { label: tr('Start-Y'), value: moveTo.y, onChange: v => setMoveTo({ ...moveTo, y: v }) },
                { label: tr('Start-Z'), step: 0.5, value: moveTo.z, onChange: v => setMoveTo({ ...moveTo, z: v }) },
              ]} />
            <OpCard op="eject" icon="⬆" title={tr('Platte auswerfen')}
              busy={jog.busy} gcodeOn={useGcode.eject} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.eject ?? ''} onSpeed={setOpSpeed}
              onTeach={toggleTeach}
              teachNode={teachOp === 'eject' && (
                <TeachIn title={tr('Auswurf-Start')} axes={['x', 'y', 'z']}
                  hint={tr('Der Greifer muss genau an der Platte im Drucker ansetzen. Erst anfahren, dann justieren.')}
                  onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry })}
                  onApply={applyTeachPrinter(setEject)} onClose={() => setTeachOp(null)} />
              )}
              {...opGcodeProps('eject')}
              effHint={absHint(eject)}
              fields={[
                absXField(eject, setEject),
                { label: tr('Start-Y'), value: eject.y, onChange: v => setEject({ ...eject, y: v }) },
                { label: tr('Start-Z'), step: 0.5, value: eject.z, onChange: v => setEject({ ...eject, z: v }) },
              ]} />
            <OpCard op="place" icon="⬇" title={tr('Platte einlegen (Place)')}
              busy={jog.busy} gcodeOn={useGcode.place} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.place ?? ''} onSpeed={setOpSpeed}
              onTeach={toggleTeach}
              teachNode={teachOp === 'place' && (
                <TeachIn title={tr('Einlege-Position')} axes={['x', 'y', 'z']}
                  hint={tr('Position, an der die Platte im Drucker abgesetzt wird.')}
                  onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry })}
                  onApply={applyTeachPrinter(setLoad)} onClose={() => setTeachOp(null)} />
              )}
              {...opGcodeProps('place')}
              effHint={absHint(load)}
              fields={[
                absXField(load, setLoad),
                { label: tr('Start-Y'), value: load.y, onChange: v => setLoad({ ...load, y: v }) },
                { label: tr('Start-Z'), step: 0.5, value: load.z, onChange: v => setLoad({ ...load, z: v }) },
              ]} />
          </div>

          {!hasDoor && (
            <p className="text-[10px] text-surface-600">
              {tr('{0} ist offen (ohne Tür) — Tür-Aktionen entfallen. In der Farm-Sequenz die Tür-Schritte weglassen (Sequenz-Editor).', printerName)}
            </p>
          )}

          {/* ── Regal & Greifen (Greifen/Ablegen) ── */}
          <div className="card p-3 space-y-2">
            <button onClick={() => setRegalOpen(o => !o)} className="w-full flex items-center justify-between text-left">
              <span className="text-sm font-medium text-surface-200">{tr('📦 Regal & Greifen')}</span>
              <span className="text-[11px] text-blue-400">{regalOpen ? tr('▾ ausblenden') : tr('▸ anzeigen')}</span>
            </button>
            {regalOpen && (
              <div className="space-y-3 pt-1">
                <p className="text-[10px] text-surface-500">
                  {tr('Physische Regal-Positionen (mm). Regalzahl ({0}), Fächer/Regal ({1}) & Magazin-Fach ({2}) kommen global aus der Konfiguration → Rack Configuration.', numRacks, rackCfg.slots_per_rack, magazineSlot || '—')}
                </p>
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-surface-500">{tr('Positionen')}</span>
                  <button onClick={() => toggleTeach('rack')}
                    className="text-[11px] text-blue-400 hover:text-blue-300">
                    {teachOp === 'rack' ? tr('✕ Einmessen schließen') : tr('📐 Regal einmessen')}
                  </button>
                </div>
                {teachOp === 'rack' && (
                  <TeachIn title={tr('Regal 1, Fach 1')} axes={['x', 'y', 'z']}
                    hint={tr('Der Greifer soll genau vor Fach 1 des ERSTEN Regals stehen (Regal 1 = am Drucker). Daraus folgen Start-X, Y-Engage und die Höhe von Fach 1; die übrigen Fächer/Regale rechnet Printloom aus Fach-Abstand und Regal-Versatz.')}
                    onApproach={() => controlService.runOp({ op: 'approach', geometry, rack: 1, slot: 1 })}
                    onApply={applyTeachRack} onClose={() => setTeachOp(null)} />
                )}
                <div className="grid grid-cols-3 gap-2">
                  <NumField label={tr('Start-X (Regal 1)')} hint={tr('x_unclamp')} value={xUnclamp} onChange={setX} />
                  <NumField label={tr('Y-Engage')} value={yEngage} onChange={setY} />
                  <NumField label={tr('Höhe Fach 1 (mm)')} hint={tr('first_z_flat')} step={0.5} value={firstZ} onChange={setFirstZ} />
                  <NumField label={tr('Fach-Abstand (mm)')} hint={tr('Z-Schritt = +30')} value={gap} onChange={setGap} />
                  <NumField label={tr('Regal-Versatz X (mm)')} hint={tr('rack_x_gap · pro Regal')} value={rackGap} onChange={setRackGap} />
                  <NumField label={tr('Andruck-Weg (mm)')} hint={tr('Greifer-Andruck · 0 = Greifpunkt = Start-X')} value={clampPush} onChange={setClampPush} />
                </div>
                <p className="text-[9px] text-surface-600">
                  {tr('Andruck-Weg: der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original 30. Auf 0 stellen, wenn der Greifer genau bei Start-X fassen soll.')}
                </p>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-surface-400">{tr('Platte')}</span>
                  {[['256', '256'], ['220', '220']].map(([v, lbl]) => (
                    <button key={v} onClick={() => setPlate(v)}
                      className={`text-[11px] px-2 py-1 rounded border ${plate === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500'}`}>{lbl}</button>
                  ))}
                </div>

                {/* ── X-Position je Regal: absolute Werte, gespeichert als Korrektur (rack_x_trim) ── */}
                {numRacks > 1 && (
                  <div className="pt-1 border-t border-surface-800/50 space-y-1.5">
                    <p className="text-[11px] text-surface-400">{tr('X-Position je Regal (mm)')}</p>
                    <div className="flex flex-wrap gap-2">
                      {/* Drucker ganz links: setzt Auswurf-/Einlege-/Anfahr-Start-X gemeinsam
                          (absoluter Maschinen-X inkl. Regal-Versatz, wie in den Op-Karten). */}
                      <label className="block">
                        <span className="text-[10px] text-blue-300 font-mono flex items-center gap-1">
                          🖨 {tr('Drucker')}
                        </span>
                        <div className="flex items-center gap-1 mt-0.5">
                          <input type="number" step="0.5"
                            value={r1(num(eject.x) + xOff)}
                            onChange={e => {
                              const v = parseFloat(e.target.value)
                              if (Number.isNaN(v)) return
                              const b = r1(v - xOff)
                              setEject(s => ({ ...s, x: b }))
                              setLoad(s => ({ ...s, x: b }))
                              setMoveTo(s => ({ ...s, x: b }))
                            }}
                            title={tr('Drucker-X — setzt „Vor Drucker fahren“, „Platte auswerfen“ und „Platte einlegen“ gemeinsam')}
                            className="w-24 text-sm font-mono border-blue-700/50" />
                          <button
                            onClick={() => sendOp('move_to_printer', tr('Vor Drucker fahren…'))}
                            disabled={jog.busy}
                            title={tr('Vor den Drucker fahren (Test)')}
                            className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">→</button>
                        </div>
                      </label>
                      {/* schmaler Trenner zwischen Drucker und Regalen */}
                      <div className="w-px self-stretch bg-surface-700/50 mx-0.5" aria-hidden="true" />
                      {Array.from({ length: numRacks }, (_, i) => i + 1).map(r => {
                        const base = num(xUnclamp) + (numRacks - r) * num(rackGap)
                        const trim = +(rackXTrim[String(r)] ?? 0) || 0
                        const eff  = Math.round((base + trim) * 10) / 10
                        return (
                          <label key={r} className="block">
                            <span className="text-[10px] text-surface-500 font-mono flex items-center gap-1">
                              R{r}{r === 1 ? tr(' · am Drucker') : ''}
                              {trim !== 0 && (
                                <>
                                  <span className="text-blue-400">Δ{trim > 0 ? '+' : ''}{trim}</span>
                                  <button
                                    onClick={() => setRackXTrim(m => { const n = { ...m }; delete n[String(r)]; return n })}
                                    title={tr('Korrektur zurücksetzen (wieder Standard-Berechnung)')}
                                    className="text-surface-600 hover:text-red-400">✕</button>
                                </>
                              )}
                            </span>
                            <div className="flex items-center gap-1 mt-0.5">
                              <input type="number" step="0.5" value={eff}
                                onChange={e => {
                                  const v = parseFloat(e.target.value)
                                  if (Number.isNaN(v)) return
                                  const t = Math.round((v - base) * 10) / 10
                                  setRackXTrim(m => {
                                    if (t === 0) { const n = { ...m }; delete n[String(r)]; return n }
                                    return { ...m, [String(r)]: t }
                                  })
                                }}
                                className={`w-24 text-sm font-mono ${trim !== 0 ? 'border-blue-700/60' : ''}`} />
                              <button
                                onClick={() => sendOp('approach', tr('R{0} anfahren…', r), { rack: r, slot: 1 })}
                                disabled={jog.busy}
                                title={tr('Fach 1 dieses Regals anfahren (greift nicht)')}
                                className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">→</button>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                    <p className="text-[9px] text-surface-600">
                      {tr('🖨 Drucker (ganz links) = Start-X von „Vor Drucker fahren“, „Platte auswerfen“ und „Platte einlegen“ gemeinsam (absoluter Maschinen-X). Regale: Standard = Start-X + Regal-Versatz; ein geänderter Wert wird als Δ-Korrektur pro Regal gespeichert und gilt für alle Fächer & das Magazin dieses Regals — auch im eigenen G-code über den Platzhalter für die Regal-X-Position. Ändert sich Start-X/Versatz, wandert die Korrektur mit.')}
                    </p>
                  </div>
                )}

                {/* Test Greifen / Ablegen */}
                <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-surface-800/50">
                  <label className="block">
                    <span className="text-[11px] text-surface-400">{tr('Regal')}</span>
                    <input type="number" min={1} max={numRacks} value={testRack}
                      onChange={e => setTestRack(+e.target.value)} className="w-16 text-sm font-mono mt-0.5" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-surface-400">{tr('Fach')}</span>
                    <input type="number" min={1} max={magazineSlot || rackCfg.slots_per_rack} value={testSlot}
                      onChange={e => setTestSlot(+e.target.value)} className="w-16 text-sm font-mono mt-0.5" />
                  </label>
                  <button onClick={() => sendOp('approach', tr('Fach anfahren…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                    className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('→ Anfahren')}</button>
                  <div className="flex items-center gap-1">
                    <SpeedSelect value={speedFactors.grab ?? ''} onChange={v => setOpSpeed('grab', v)} />
                    <button onClick={() => sendOp('grab', tr('Greifen…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                      className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Greifen testen')}</button>
                  </div>
                  <div className="flex items-center gap-1">
                    <SpeedSelect value={speedFactors.store ?? ''} onChange={v => setOpSpeed('store', v)} />
                    <button onClick={() => sendOp('store', tr('Ablegen…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                      className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Ablegen testen')}</button>
                  </div>
                </div>
                <p className="text-[9px] text-surface-600">{tr('„Anfahren" fährt nur vors Fach (greift nicht). Magazin = oberstes Fach ({0}) wird ohne Anheben gegriffen.', magazineSlot || '—')}</p>

                {/* Magazin je Regal: Platte holen + Restbestand */}
                {magazineSlot > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-surface-800/50">
                    <span className="text-[11px] text-surface-400">{tr('Magazin:')}</span>
                    {Array.from({ length: numRacks }, (_, i) => i + 1).map(r => {
                      const cnt = Math.max(0, +(rackCfg.magazine_counts?.[r - 1] ?? 0))
                      return (
                        <button key={r} onClick={() => grabFromMagazine(r)} disabled={jog.busy || cnt <= 0}
                          className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 flex items-center gap-1.5"
                          title={cnt <= 0
                            ? tr('Magazin leer — im Rack Manager auffüllen')
                            : tr('Platte aus Magazin R{0} holen (NOLIFT, Fach {1})', r, magazineSlot)}>
                          <span>{tr('▶ Magazin R{0}', r)}</span>
                          <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${cnt > 0 ? 'bg-emerald-950/60 text-emerald-300' : 'bg-red-950/60 text-red-400'}`}>{cnt}</span>
                        </button>
                      )
                    })}
                    <span className="text-[9px] text-surface-600">
                      {tr('Zahl = Platten im Magazin · Entnahme zählt automatisch runter (Z greift je Platte 1 mm tiefer — Durchbiegung)')}
                    </span>
                  </div>
                )}

                {/* opt-in grab/store */}
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-surface-800/50">
                  {[['grab', tr('Greifen')], ['store', tr('Ablegen')]].map(([op, lbl]) => (
                    <label key={op} className="flex items-center gap-2 cursor-pointer select-none">
                      <Toggle on={!!useGcode[op]} onClick={() => toggleGcode(op)} color="bg-emerald-600" />
                      <span className={`text-[11px] ${useGcode[op] ? 'text-emerald-300' : 'text-surface-500'}`}>
                        {tr('Farm: {0} als App-G-code', lbl)}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* ── Plausibilität & Achsgrenzen ──
              Printloom rechnet die Bewegungen aus diesen Werten. Sind die Achsgrenzen
              bekannt, wird eine Bewegung, die aus der Achse fährt, gar nicht gesendet —
              sonst bricht Klipper sie mitten im Ablauf ab (womöglich mit Platte im
              Greifer). Ohne Grenzen wird nur „unter 0 mm" geprüft (Endschalter). */}
          <div className="card p-3 space-y-2">
            <button onClick={() => setCheckOpen(o => !o)} className="w-full flex items-center justify-between text-left">
              <span className="text-sm font-medium text-surface-200 flex items-center gap-2">
                {tr('🛡 Plausibilität & Achsgrenzen')}
                {check && (check.errors?.length
                  ? <span className="badge badge-red">{tr('{0} Fehler', check.errors.length)}</span>
                  : check.warnings?.length
                    ? <span className="badge badge-amber">{tr('{0} Hinweise', check.warnings.length)}</span>
                    : <span className="badge badge-green">{tr('geprüft')}</span>)}
              </span>
              <span className="text-[11px] text-blue-400">{checkOpen ? tr('▾ ausblenden') : tr('▸ anzeigen')}</span>
            </button>
            {checkOpen && (
              <div className="space-y-3 pt-1">
                <p className="text-[10px] text-surface-500">
                  {tr('Achsgrenzen des OTTOeject (mm). Sind sie bekannt, prüft Printloom jede Bewegung VOR dem Senden und verweigert sie, wenn sie aus der Achse fährt. Leer = unbekannt → es wird nur geprüft, ob eine Bewegung unter 0 mm fährt.')}
                </p>
                <div className="flex flex-wrap items-end gap-2">
                  {['x', 'y', 'z'].map(a => (
                    <label key={a} className="block">
                      <span className="text-[11px] text-surface-400 font-mono">{a.toUpperCase()} max</span>
                      <input type="number" step="1" min="0" value={limits[a] ?? ''}
                        placeholder={tr('unbekannt')}
                        onChange={e => {
                          const v = parseFloat(e.target.value)
                          setLimits(m => {
                            const n = { ...m }
                            if (Number.isNaN(v) || v <= 0) delete n[a]; else n[a] = v
                            return n
                          })
                        }}
                        className="w-24 text-sm font-mono mt-0.5" />
                    </label>
                  ))}
                  <button onClick={fetchLimits} disabled={limitsBusy}
                    className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">
                    {limitsBusy ? tr('Lese…') : tr('⤓ Grenzen vom Gerät holen')}
                  </button>
                  {Object.keys(limits).length > 0 && (
                    <button onClick={() => { setLimits({}); setLimitsMsg('') }}
                      className="btn btn-ghost btn-sm text-[11px]">{tr('Leeren')}</button>
                  )}
                </div>
                {limitsMsg && <p className="text-[11px] font-mono text-surface-400">{limitsMsg}</p>}

                {check?.errors?.map((p, i) => (
                  <div key={`e${i}`} className="px-3 py-2 rounded-lg bg-red-950/40 border border-red-800 text-[11px] text-red-300">
                    {p.message}
                  </div>
                ))}
                {check?.warnings?.map((p, i) => (
                  <div key={`w${i}`} className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/60 text-[11px] text-amber-300">
                    {p.message}
                  </div>
                ))}
                {check && !check.errors?.length && !check.warnings?.length && (
                  <p className="text-[11px] text-emerald-400">{tr('✓ Alle Bewegungen liegen innerhalb der Achsen.')}</p>
                )}
                <p className="text-[9px] text-surface-600">
                  {tr('Geprüft werden alle Operationen über alle Regale und das erste/letzte Fach — dort liegen die Extremwerte. Ob eine Position mechanisch passt (z. B. genau vor dem Fach), kann nur das Einmessen zeigen.')}
                </p>
              </div>
            )}
          </div>

          <p className="text-[10px] text-surface-600 px-1">
            {tr('Printloom speichert diese Werte und sendet den G-code direkt (nur OTTOEJECT_HOME bleibt Geräte-Macro). Für die Auto-Farm wirken sie erst, wenn „Farm nutzt diese Position" für die jeweilige Operation aktiv ist — sonst fährt die Farm weiter die Geräte-Macros.')}
          </p>
        </div>
      </div>
    </div>
  )
}
