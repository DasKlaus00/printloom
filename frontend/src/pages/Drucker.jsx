import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useLanguage } from '../services/i18n'
import { controlService, rackManagerService } from '../services/api'
import { PRINTERS, CUSTOM_PRINTER } from '../services/printers'
import { PrinterBadge } from '../components/PrinterBadge'

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
                 speedVal, onSpeed }) {
  const { tr } = useLanguage()
  const showGcode = gcodeOnly || typeof overrideVal === 'string'
  const gval = overrideVal ?? ''
  return (
    <div className={`card p-3 space-y-2.5 ${showGcode ? 'border-blue-700/50' : ''}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-surface-200 min-w-0 truncate">{icon} {title}</p>
        <div className="flex items-center gap-1.5 shrink-0">
          <SpeedSelect value={speedVal} onChange={v => onSpeed(op, v)} />
          <button onClick={() => onTest(op, tr('{0}…', title), extra)} disabled={busy}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Test')}</button>
        </div>
      </div>

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
  const [jog, setJog] = useState({ busy: false, msg: '', err: false })
  const [lastScript, setLastScript] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [gcodeLine, setGcodeLine] = useState('')

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
        // „Tür schließen" zieht die Position automatisch von „Tür öffnen" → close = open.
        door: hasDoor ? { open: nd(doorOpen), close: nd(doorOpen) } : null,
      },
      use_gcode: { ...useGcode },
      gcode_override: gcodeOverride,
      speed_factor: num(speedFactor, 100) || 100,
      speed_factors: { ...speedFactors },
      rack_x_trim: { ...rackXTrim },
    }
  }, [printerId, printerName, enclosed, xUnclamp, yEngage,
      firstZ, gap, yPullback, rackGap, eject, load, moveTo, doorOpen, doorClose, hasDoor, useGcode, gcodeOverride, speedFactor, speedFactors, rackXTrim])

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
    const t = setTimeout(() => { controlService.putGeometry(geometry).catch(() => {}) }, 600)
    return () => clearTimeout(t)
  }, [geometry])

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

  // Geschwindigkeit setzen → M220 sofort an den OTTOeject schicken (und für Ops speichern).
  const applySpeed = (v) => {
    setSpeedFactor(v)
    sendOp('speed', tr('Geschwindigkeit {0}%', v), {}, { ...geometry, speed_factor: v })
  }

  // G-code der Operation aus den aktuellen Werten laden → Startpunkt zum Bearbeiten.
  const loadGcodeForEdit = async (op, extra = {}) => {
    try {
      const r = await controlService.previewOp({ op, geometry, ...extra })
      setGcodeOverride(m => ({ ...m, [op]: r?.data?.script || '' }))
    } catch {
      setGcodeOverride(m => ({ ...m, [op]: '' }))
    }
  }

  const activeCount = OPS.filter(o => useGcode[o]).length
  // „Custom Printer" = ausschließlich eigener G-code je Operation, KEINE Start-Positionen.
  // Named Printer = nur Positions-Werte (fein justierbar), KEIN G-code-Editor.
  const isCustom = printerId === CUSTOM_PRINTER.id
  // G-code-Editor je Op nur beim Custom Printer; bei den Named Printern gibt es
  // keinen Override (Positions-Werte sind maßgeblich, siehe Backend-Gate).
  const opGcodeProps = (op) => isCustom
    ? { gcodeOnly: true, overrideVal: gcodeOverride[op] ?? '', onLoadGcode: loadGcodeForEdit, onChangeGcode: setGcodeText, onClearGcode: clearGcode }
    : {}
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

          {/* Operations-Karten */}
          <div className="grid gap-3 md:grid-cols-2">
            {hasDoor && (
              <OpCard op="open_door" icon="🚪" title={tr('Tür öffnen')}
                busy={jog.busy} gcodeOn={useGcode.open_door} onTest={sendOp} onToggle={toggleGcode}
                speedVal={speedFactors.open_door ?? ''} onSpeed={setOpSpeed}
                {...opGcodeProps('open_door')}
                effHint={absHint(doorOpen)}
                note={tr('Diese Position steuert auch „Tür schließen".')}
                fields={[
                  absXField(doorOpen, setDoorOpen),
                  { label: tr('Y'), value: doorOpen.y, onChange: v => setDoorOpen({ ...doorOpen, y: v }) },
                  { label: tr('Start-Z'), step: 0.5, value: doorOpen.z, onChange: v => setDoorOpen({ ...doorOpen, z: v }) },
                  { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: doorOpen.d, onChange: v => setDoorOpen({ ...doorOpen, d: v }) },
                ]} />
            )}
            {hasDoor && (
              <OpCard op="close_door" icon="🚪" title={tr('Tür schließen')}
                busy={jog.busy} gcodeOn={useGcode.close_door} onTest={sendOp} onToggle={toggleGcode}
                speedVal={speedFactors.close_door ?? ''} onSpeed={setOpSpeed}
                {...opGcodeProps('close_door')}
                note={tr('Position wird automatisch von „Tür öffnen" übernommen — hier nichts einzustellen. Nur „Test" & eigene Geschwindigkeit.')}
                fields={[]} />
            )}
            <OpCard op="move_to_printer" icon="➡" title={tr('Vor Drucker fahren')}
              busy={jog.busy} gcodeOn={useGcode.move_to_printer} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.move_to_printer ?? ''} onSpeed={setOpSpeed}
              {...opGcodeProps('move_to_printer')}
              effHint={absHint(moveTo)}
              note={tr('Sichere Anfahrt vor den Drucker — eigene Start-Position. Standard = Auswurf-Position; hier fein justierbar.')}
              fields={[
                absXField(moveTo, setMoveTo),
                { label: tr('Y'), value: moveTo.y, onChange: v => setMoveTo({ ...moveTo, y: v }) },
                { label: tr('Start-Z'), step: 0.5, value: moveTo.z, onChange: v => setMoveTo({ ...moveTo, z: v }) },
              ]} />
            <OpCard op="eject" icon="⬆" title={tr('Platte auswerfen')}
              busy={jog.busy} gcodeOn={useGcode.eject} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.eject ?? ''} onSpeed={setOpSpeed}
              {...opGcodeProps('eject')}
              effHint={absHint(eject)}
              fields={[
                absXField(eject, setEject),
                { label: tr('Y'), value: eject.y, onChange: v => setEject({ ...eject, y: v }) },
                { label: tr('Start-Z'), step: 0.5, value: eject.z, onChange: v => setEject({ ...eject, z: v }) },
              ]} />
            <OpCard op="place" icon="⬇" title={tr('Platte einlegen (Place)')}
              busy={jog.busy} gcodeOn={useGcode.place} onTest={sendOp} onToggle={toggleGcode}
              speedVal={speedFactors.place ?? ''} onSpeed={setOpSpeed}
              {...opGcodeProps('place')}
              effHint={absHint(load)}
              fields={[
                absXField(load, setLoad),
                { label: tr('Y'), value: load.y, onChange: v => setLoad({ ...load, y: v }) },
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
                <div className="grid grid-cols-3 gap-2">
                  <NumField label={tr('Start-X (Regal 1)')} hint={tr('x_unclamp')} value={xUnclamp} onChange={setX} />
                  <NumField label={tr('Y-Engage')} value={yEngage} onChange={setY} />
                  <NumField label={tr('Höhe Fach 1 (mm)')} hint={tr('first_z_flat')} step={0.5} value={firstZ} onChange={setFirstZ} />
                  <NumField label={tr('Fach-Abstand (mm)')} hint={tr('Z-Schritt = +30')} value={gap} onChange={setGap} />
                  <NumField label={tr('Regal-Versatz X (mm)')} hint={tr('rack_x_gap · pro Regal')} value={rackGap} onChange={setRackGap} />
                </div>
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
                      {tr('Standard = Start-X + Regal-Versatz. Ein geänderter Wert wird als Δ-Korrektur pro Regal gespeichert und gilt für alle Fächer & das Magazin dieses Regals — auch im eigenen G-code über den Platzhalter für die Regal-X-Position. Ändert sich Start-X/Versatz, wandert die Korrektur mit.')}
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

          <p className="text-[10px] text-surface-600 px-1">
            {tr('Printloom speichert diese Werte und sendet den G-code direkt (nur OTTOEJECT_HOME bleibt Geräte-Macro). Für die Auto-Farm wirken sie erst, wenn „Farm nutzt diese Position" für die jeweilige Operation aktiv ist — sonst fährt die Farm weiter die Geräte-Macros.')}
          </p>
        </div>
      </div>
    </div>
  )
}
