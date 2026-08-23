import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useLanguage, trProblem } from '../services/i18n'
import { controlService, rackManagerService, deviceService, printerService,
         autofarmService } from '../services/api'
import { confirmDialog } from '../services/confirm'
import { findPrinter } from '../services/printers'
import { PrinterBadge } from '../components/PrinterBadge'
import TeachIn from '../components/TeachIn'
import FarmRail from '../components/FarmRail'

/* ── Drucker-Tab ────────────────────────────────────────────────────────────────
   Der ganze Aufbau auf EINER Seite, von oben nach unten: erst die Schiene (was steht
   wo), dann je ein Abschnitt pro Drucker und pro Regal. Jeder Abschnitt hält genau
   die Werte, die zu diesem Modul gehören — und einen Test-Knopf daneben.

   Seit v1.1.9 hat jedes Modul seine EIGENEN, ABSOLUTEN Koordinaten (Backend:
   geometry.printers[] / geometry.rack_geo{}). Vorher gab es genau einen Drucker,
   dessen X als Basis gespeichert und beim Fahren um den Regal-Versatz verschoben
   wurde — das ließ sich weder auf zwei Drucker noch auf unterschiedlich gebaute
   Regale übertragen, und ein zusätzliches Regal verschob still den Drucker.

   Printloom sendet den G-code direkt aus diesen Koordinaten (nur OTTOEJECT_HOME
   bleibt Geräte-Macro). „Farm nutzt diese Position" (opt-in, je Operation und je
   Drucker) schaltet den App-G-code für die Auto-Farm frei — Standard AUS. */

// Reihenfolge = Wechselablauf. move_to_printer nutzt die Auswurf-Position als Bezug;
// place nutzt die Einlege-Position (load-Koordinaten). Jede Op hat eine EIGENE Geschwindigkeit.
const PRINTER_OPS = ['open_door', 'close_door', 'move_to_printer', 'eject', 'place']
const RACK_OPS = ['grab', 'store']
const SPEEDS = [25, 50, 100, 200, 300, 400, 500]

// Robuste Zahl: akzeptiert Komma-Dezimal (de), leer/ungültig → Default (nie NaN/null).
const num = (v, d = 0) => {
  const n = parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : d
}
const r1 = (n) => Math.round(n * 10) / 10

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

/* Ausklappbarer Abschnitt — die Seite ist einspaltig und wird sonst zu lang.
   Standardmäßig zu; was gerade bearbeitet wird, ist offen. */
function Section({ id, title, subtitle, badge, open, onToggle, children, tone = '' }) {
  const { tr } = useLanguage()
  return (
    <div id={id} className={`card p-3 space-y-2 ${tone}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between text-left gap-2">
        <span className="min-w-0">
          <span className="text-sm font-medium text-surface-200 flex items-center gap-2 flex-wrap">
            {title}{badge}
          </span>
          {subtitle && <span className="block text-[10px] text-surface-600 mt-0.5">{subtitle}</span>}
        </span>
        <span className="text-[11px] text-blue-400 shrink-0">
          {open ? tr('▾ ausblenden') : tr('▸ anzeigen')}
        </span>
      </button>
      {open && <div className="space-y-3 pt-1">{children}</div>}
    </div>
  )
}

/* ── Stresstest ──────────────────────────────────────────────────────────────
   Räumt die Magazine leer: eine Platte aus Magazin 1 holen, in ein gewürfeltes
   freies Fach legen, wiederholen, bis alle Magazine leer sind. Die zufälligen
   Ziele ergeben lauter unterschiedlich lange Wege statt derselben Strecke im
   Kreis — genau das stellt Riemen, Endschalter und die eingemessene Geometrie
   auf die Probe, ohne einen einzigen Druck zu starten.

   Die Dauer ist HOCHGERECHNET: das Backend erzeugt den G-code, den der Test
   wirklich fahren würde, und summiert Strecke ÷ Vorschub (plus Zuschlag fürs
   Beschleunigen). Keine Messung, aber auch keine geratene Zahl. */
function dauerText(sekunden, tr) {
  const s = Math.max(0, Math.round(sekunden || 0))
  if (s < 60) return tr('{0} s', s)
  const min = Math.floor(s / 60)
  if (min < 60) return tr('{0} min {1} s', min, s % 60)
  return tr('{0} h {1} min', Math.floor(min / 60), min % 60)
}

function StressTest({ open, onToggle, busy }) {
  const { tr } = useLanguage()
  const [plan, setPlan]   = useState(null)
  const [state, setState] = useState(null)
  const [msg, setMsg]     = useState('')
  // Umweg über den Drucker: bewusst AUS als Vorgabe. Er braucht einen erreichbaren
  // Drucker, fährt das Bett auf Z200 und öffnet die Tür — nichts davon soll
  // passieren, weil jemand nur den Regal-Lauf starten wollte.
  const [mitDrucker, setMitDrucker] = useState(false)
  const laeuft = !!state?.running

  const ladePlan = (mit = mitDrucker) => autofarmService.stressPlan(mit)
    .then(r => { setPlan(r.data); setMsg('') })
    .catch(e => setMsg(e.response?.data?.detail || e.message))

  // Die Schätzung hängt am Haken — beim Umschalten neu rechnen lassen.
  useEffect(() => { if (open) ladePlan(mitDrucker) }, [open, mitDrucker])   // eslint-disable-line react-hooks/exhaustive-deps

  // Während der Test läuft, den Fortschritt verfolgen — sonst nur einmal beim
  // Öffnen nachsehen (ein Poll für einen ruhenden Knopf wäre reine Dauerlast).
  useEffect(() => {
    if (!open) return
    let timer
    const tick = () => autofarmService.stressStatus()
      .then(r => {
        setState(r.data)
        timer = setTimeout(tick, r.data?.running ? 2000 : 15000)
      })
      .catch(() => { timer = setTimeout(tick, 15000) })
    tick()
    return () => clearTimeout(timer)
  }, [open])

  const start = async () => {
    const anzahl = plan?.moves?.length ?? 0
    const ok = await confirmDialog({
      title: tr('Stresstest starten?'),
      message: mitDrucker
        ? tr('{0} Platte(n) werden aus den Magazinen geholt, jede einzeln auf den Drucker gelegt, wieder heruntergenommen und dann in ein freies Fach gelegt — geschätzt {1}. Das Bett fährt vorher auf Z200; im Drucker darf nichts liegen. Danach sind die Magazine LEER und die Platten liegen verstreut; zurückräumen ist Handarbeit. Der Arm fährt durchgehend: steht jemand in der Anlage oder liegt etwas im Weg, jetzt nicht starten.',
                  anzahl, dauerText(plan?.seconds, tr))
        : tr('{0} Platte(n) werden aus den Magazinen geholt und über die freien Fächer verteilt — geschätzt {1}. Danach sind die Magazine LEER und die Platten liegen verstreut; zurückräumen ist Handarbeit. Der Arm fährt durchgehend: steht jemand in der Anlage oder liegt etwas im Weg, jetzt nicht starten.',
                  anzahl, dauerText(plan?.seconds, tr)),
      danger: true,
    })
    if (!ok) return
    try {
      const r = await autofarmService.stressStart({ include_printer: mitDrucker })
      // Gefahren wird der Wurf, den der Start zurückgibt — nicht der aus der
      // Vorschau. Also gleich den anzeigen.
      if (r.data?.moves) setPlan(r.data)
      setState({ running: true, done: 0, total: r.data?.moves?.length ?? anzahl })
      setMsg('')
    } catch (e) { setMsg(e.response?.data?.detail || e.message) }
  }

  const stopp = async () => {
    try { await autofarmService.stressStop(); setMsg(tr('Stoppt nach der laufenden Bewegung…')) }
    catch (e) { setMsg(e.response?.data?.detail || e.message) }
  }

  const anzahl = plan?.moves?.length ?? 0
  return (
    <Section id="sec-stress" title={tr('🏋 Stresstest (Dauerlauf)')}
      badge={laeuft
        ? <span className="badge badge-blue">{tr('{0}/{1}', state.done ?? 0, state.total ?? 0)}</span>
        : anzahl > 0
          ? <span className="badge badge-amber">{tr('{0} Platten', anzahl)}</span>
          : null}
      subtitle={plan
        ? (anzahl > 0
            ? (mitDrucker
                ? tr('{0} Platte(n) über den Drucker verteilen · geschätzt {1}', anzahl, dauerText(plan.seconds, tr))
                : tr('{0} Platte(n) aus den Magazinen verteilen · geschätzt {1}', anzahl, dauerText(plan.seconds, tr)))
            : plan.plate_count > 0
              ? tr('Kein freies Fach für die Platten — erst Fächer räumen.')
              : tr('Die Magazine sind leer — nichts zu verteilen.'))
        : tr('Magazine leerräumen und die Platten zufällig verteilen.')}
      open={open} onToggle={onToggle}>

      <p className="text-[10px] text-surface-500 leading-relaxed">
        {tr('Holt eine leere Platte aus Magazin 1, legt sie in ein zufälliges freies Fach und wiederholt das, bis alle Magazine leer sind. Weil die Ziele gewürfelt werden, entstehen lauter unterschiedlich lange Wege quer über die Schiene statt derselben Strecke im Kreis — der Test für Riemen, Endschalter, Wiederholgenauigkeit und die eingemessene Geometrie, ganz ohne Druck.')}
      </p>
      <p className="text-[10px] text-amber-400/80 leading-relaxed">
        {tr('⚠ Danach sind die Magazine LEER und die Platten liegen verteilt in den Fächern. Das ist das Ergebnis, kein Versehen — zurückräumen ist Handarbeit.')}
      </p>
      <p className="text-[10px] text-surface-600 leading-relaxed">
        {tr('Nicht als Ziel vergeben werden: Magazin-Fächer (dort steht der Stapel), gesperrte Fächer, belegte Fächer und Fächer unter einem hohen Druck — dort käme die Platte nicht herein.')}
      </p>

      <label className={`flex items-start gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
        mitDrucker ? 'border-blue-800/60 bg-blue-950/20' : 'border-surface-700/60 bg-surface-900/40'
      } ${laeuft ? 'opacity-50 pointer-events-none' : ''}`}>
        <input type="checkbox" className="mt-0.5" checked={mitDrucker}
          disabled={laeuft} onChange={e => setMitDrucker(e.target.checked)} />
        <span className="flex-1 min-w-0">
          <span className="block text-[11px] text-surface-200">{tr('Drucker einbeziehen')}</span>
          <span className="block text-[10px] text-surface-500 leading-relaxed">
            {tr('Jede Platte macht unterwegs den Umweg über den Drucker: auflegen, wieder herunternehmen, dann erst ins Fach. Damit hängen auch Anfahrt, Bett-Höhe, Auswerfen und Einlegen mit im Dauerlauf — der reine Regal-Lauf lässt genau das aus.')}
          </span>
          <span className="block text-[10px] text-amber-400/80 leading-relaxed mt-0.5">
            {tr('⚠ Das Bett fährt einmal zu Beginn auf Z200 und bleibt dort. Im Drucker darf nichts liegen, und er darf nicht drucken.')}
          </span>
          {plan?.has_door && (
            <span className="block text-[10px] text-surface-500 leading-relaxed mt-0.5">
              {tr('Die Tür geht einmal auf und am Ende wieder zu — nicht bei jeder Platte.')}
            </span>
          )}
        </span>
      </label>

      {plan?.moves?.length > 0 && (
        <div className="rounded-lg border border-surface-700/60 bg-surface-900/50 divide-y divide-surface-800/60 max-h-52 overflow-y-auto">
          {plan.moves.map((m, i) => (
            <div key={i} className="flex items-center gap-2 px-2.5 py-1.5 text-[11px] font-mono">
              <span className="text-surface-600 w-6 shrink-0">{i + 1}</span>
              <span className="text-surface-300">
                {m.from_magazine ? tr('Magazin R{0}', m.from_rack) : tr('Fach {0}', m.from)}
              </span>
              <span className="text-surface-600">→</span>
              <span className="text-blue-300">{m.to}</span>
            </div>
          ))}
        </div>
      )}

      {plan?.skipped?.length > 0 && (
        <p className="text-[10px] text-amber-400/80">
          {tr('{0} Platte(n) bleiben im Magazin liegen: {1}', plan.skipped.length,
              plan.skipped[0]?.reason || '')}
        </p>
      )}

      {laeuft && (
        <div className="px-3 py-2 rounded-lg bg-blue-950/40 border border-blue-800/60 space-y-1">
          <p className="text-[11px] text-blue-300 font-mono">
            {tr('{0}/{1} — {2}', state.done ?? 0, state.total ?? 0, state.step || '…')}
          </p>
          <div className="h-1 rounded bg-surface-800 overflow-hidden">
            <div className="h-full bg-blue-500 transition-all"
              style={{ width: `${Math.round(100 * (state.done || 0) / Math.max(1, state.total || 1))}%` }} />
          </div>
        </div>
      )}
      {state?.error && !laeuft && (
        <p className="text-[11px] text-red-400">{tr('Abgebrochen: {0}', state.error)}</p>
      )}
      {msg && <p className="text-[11px] text-amber-400">{msg}</p>}

      <div className="flex items-center gap-2 flex-wrap">
        {laeuft ? (
          <button onClick={stopp} className="btn btn-danger btn-sm text-[11px]">
            {tr('■ Stoppen')}
          </button>
        ) : (
          <button onClick={start} disabled={busy || anzahl === 0}
            className="btn btn-primary btn-sm text-[11px] disabled:opacity-50">
            {tr('▶ Stresstest starten')}
          </button>
        )}
        <button onClick={ladePlan} disabled={laeuft}
          className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('↻ Neu würfeln')}</button>
        {plan && (
          <span className="text-[10px] text-surface-600">
            {tr('{0} freie Fächer · weiteste Wege bis Regal {1}', plan.free_count, plan.farthest_rack)}
          </span>
        )}
      </div>
      <p className="text-[9px] text-surface-600">
        {tr('Die Ziele werden beim Start ausgewürfelt — die Liste oben zeigt eine mögliche Verteilung; gefahren wird der Wurf vom Startzeitpunkt. Die Dauer ist hochgerechnet: Printloom erzeugt den G-code, den der Test wirklich fährt, und rechnet Strecke ÷ Vorschub plus Zuschlag fürs Beschleunigen. Die echte Zeit hängt an deiner Klipper-Beschleunigung und liegt eher darüber.')}
      </p>
    </Section>
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
                 overrideVal, onLoadGcode, onChangeGcode, onClearGcode,
                 speedVal, onSpeed, onTeach, teachNode }) {
  const { tr } = useLanguage()
  const showGcode = typeof overrideVal === 'string'
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
            <span className="text-[10px] text-blue-300">{tr('⚙ Eigener G-code — Werte werden ignoriert')}</span>
            <button onClick={() => onClearGcode(op)} className="text-[10px] text-surface-500 hover:text-surface-300">{tr('✕ zurück zu Werten')}</button>
          </div>
          <textarea value={gval} onChange={e => onChangeGcode(op, e.target.value)} spellCheck={false} rows={8}
            className="w-full text-[11px] leading-snug font-mono bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 whitespace-pre" />
          <p className="text-[9px] text-surface-600">{tr('Wird 1:1 an den OTTOeject gesendet. „Test" fährt genau diesen G-code.')}</p>
          <p className="text-[9px] text-blue-400/80 leading-relaxed">
            {tr('Platzhalter für Regale/Fächer:')}{' '}
            <span className="font-mono text-blue-300">{'{rack_x} {slot_z} {mag_z} {y_engage} {y_pullback} {rack} {slot}'}</span>
            {' — '}{tr('EIN G-code fährt so jedes Regal (R1 am Drucker) und Fach korrekt an. Versätze gehen mit: {slot_z+25} ist die Fachhöhe plus 25 mm.')}
          </p>
        </div>
      ) : (
        <>
          {fields.length > 0 ? (
            <div className={`grid gap-2 ${fields.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
              {fields.map(f => (
                <NumField key={f.label} label={f.label} hint={f.hint} value={f.value}
                  onChange={f.onChange} />
              ))}
            </div>
          ) : (note && <p className="text-[10px] text-surface-500">{note}</p>)}
          {fields.length > 0 && note && <p className="text-[9px] text-surface-600">{note}</p>}
          <button onClick={() => onLoadGcode(op, extra)} className="text-[10px] text-blue-400 hover:text-blue-300">
            {tr('⚙ Eigenen G-code bearbeiten (Feinjustage)')}
          </button>
        </>
      )}

      <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-surface-800/50">
        <Toggle on={!!gcodeOn} onClick={() => onToggle(op)} color="bg-emerald-600" />
        <span className={`text-[11px] ${gcodeOn ? 'text-emerald-300' : 'text-surface-500'}`}>
          {gcodeOn ? tr('Farm nutzt diese Position ✓') : tr('Farm nutzt diese Position (aus → Geräte-Macro)')}
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
    <div className="rounded-lg border border-surface-800 bg-surface-900/40 p-3 space-y-2">
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between text-left">
        <span className="text-[12px] font-medium text-surface-300">{tr('⚙ Drucker-Einstellungen ({0})', printerName)}</span>
        <span className="text-[11px] text-blue-400">{open ? tr('▾ ausblenden') : tr('▸ anzeigen')}</span>
      </button>
      {!open ? (
        <p className="text-[10px] text-surface-600">
          {tr('KI-Erkennung, Geschwindigkeit, Auto-Recovery, Licht und Kalibrierung — direkt hier, ohne an den Drucker zu gehen.')}
        </p>
      ) : deviceId == null ? (
        <p className="text-[11px] text-surface-500">{tr('Diesem Drucker ist kein Gerät zugeordnet — oben auswählen.')}</p>
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

/* Druckbett auf Ziel-Z fahren und homen — gehört zum Drucker, nicht zum Arm.
   Z200 ist die Ladeposition für den Platten-Wechsel. */
function BedControls({ dev, busy, onGcode }) {
  const { tr } = useLanguage()
  const [z, setZ] = useState(200)
  return (
    <div className="flex items-center gap-2 flex-wrap rounded-lg border border-surface-800 bg-surface-900/40 p-2.5">
      <span className="text-[11px] text-surface-400">{tr('🖨 Druckbett')}</span>
      <label className="flex items-center gap-1">
        <span className="text-[10px] text-surface-500">Z</span>
        <input type="number" step="10" value={z} onChange={e => setZ(e.target.value)}
          disabled={busy} className="w-16 font-mono text-[11px] h-8 py-0 px-2" />
      </label>
      <button onClick={() => onGcode(dev.id, `G90\nG1 Z${Math.round(num(z, 200))} F3000`,
                                     tr('Drucker-Bett → Z{0}', Math.round(num(z, 200))))}
        disabled={busy} className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Bett fahren')}</button>
      <button onClick={() => setZ(200)} title={tr('Auf Ladeposition Z200 setzen')}
        className="text-[10px] text-blue-400 hover:text-blue-300">{tr('= Z200')}</button>
      <button onClick={() => onGcode(dev.id, 'G28', tr('Drucker-Bett homen'))} disabled={busy}
        title={tr('G28 an den Drucker — referenziert die Achsen neu')}
        className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('⌂ Bett homen')}</button>
      <span className="text-[9px] text-surface-600">{tr('Z200 = Ladeposition für den Platten-Wechsel. Drucker muss idle sein.')}</span>
    </div>
  )
}

/* ── Ein Drucker ────────────────────────────────────────────────────────────────
   Alles zu diesem Drucker an einer Stelle: welches Gerät, welches Modell, die fünf
   Positionen, je Operation Geschwindigkeit / eigener G-code / Farm-Freigabe. */
function PrinterSection({ p, index, dev, open, onToggle, onPatch,
                          models, busy, onTest, onLoadGcode, onGcodeText, onClearGcode,
                          teachOp, onTeach, onTeachApply, onTeachClose, geometry, onBedGcode }) {
  const { tr } = useLanguage()
  const model = models.find(m => m.id === p.model) || null
  const hasDoor = !!p.door
  const active = PRINTER_OPS.filter(o => p.use_gcode?.[o]).length

  const setPos = (key, axis, v) => onPatch({ [key]: { ...(p[key] || {}), [axis]: v } })
  const setDoor = (kind, axis, v) => onPatch({
    door: { ...(p.door || {}), [kind]: { ...((p.door || {})[kind] || {}), [axis]: v } } })
  const toggleOp = (op) => onPatch({ use_gcode: { ...(p.use_gcode || {}), [op]: !p.use_gcode?.[op] } })
  const setOpSpeed = (op, v) => {
    const n = { ...(p.speed_factors || {}) }
    if (v === '' || v == null) delete n[op]; else n[op] = +v
    onPatch({ speed_factors: n })
  }
  const ov = p.gcode_override || {}
  const opProps = (op) => ({
    overrideVal: (op in ov) ? (ov[op] ?? '') : undefined,
    onLoadGcode: (o) => onLoadGcode(p.id, o),
    onChangeGcode: (o, t) => onGcodeText(p.id, o, t),
    onClearGcode: (o) => onClearGcode(p.id, o),
    speedVal: p.speed_factors?.[op] ?? '', onSpeed: setOpSpeed,
    gcodeOn: p.use_gcode?.[op], onToggle: toggleOp,
    busy, onTest: (op2, label) => onTest(op2, label, { printer: p.id }),
    extra: { printer: p.id },
  })
  const xyz = (key) => [
    { label: tr('X'), value: (p[key] || {}).x, onChange: v => setPos(key, 'x', v) },
    { label: tr('Y'), value: (p[key] || {}).y, onChange: v => setPos(key, 'y', v) },
    { label: tr('Z'), value: (p[key] || {}).z, onChange: v => setPos(key, 'z', v) },
  ]
  const doorFields = (kind) => [
    { label: tr('X'), value: (p.door?.[kind] || {}).x, onChange: v => setDoor(kind, 'x', v) },
    { label: tr('Y'), value: (p.door?.[kind] || {}).y, onChange: v => setDoor(kind, 'y', v) },
    { label: tr('Z'), value: (p.door?.[kind] || {}).z, onChange: v => setDoor(kind, 'z', v) },
    { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: (p.door?.[kind] || {}).d,
      onChange: v => setDoor(kind, 'd', v) },
  ]

  return (
    <Section
      id={`sec-${p.id}`}
      open={open} onToggle={onToggle}
      title={<>
        <span className="shrink-0 opacity-80"><PrinterBadge enclosed={p.enclosed} size={22} /></span>
        {tr('Drucker {0}', String(index + 1).padStart(2, '0'))} · {p.name || tr('Ohne Namen')}
        <span className="badge badge-blue font-mono">X {r1(num((p.eject || {}).x))}</span>
        {active > 0
          ? <span className="badge badge-green">{tr('{0}× Farm', active)}</span>
          : <span className="badge">{tr('Geräte-Macros')}</span>}
      </>}
      subtitle={tr('Tür, Anfahrt, Auswerfen und Einlegen für diesen Drucker.')}>

      {/* Kopf: Name und Modell gehören dem GERÄT (Konfiguration → Geräte) — hier nur
          angezeigt, damit dieselbe Angabe nicht an zwei Stellen gepflegt wird. Ohne
          zugeordnetes Gerät (noch keins angelegt) sind beide hier änderbar. */}
      {dev ? (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className="text-surface-400">{tr('Gerät')}:</span>
          <span className="text-surface-200">{dev.name}</span>
          {model && <span className="text-surface-500">· {model.label}</span>}
          <span className="text-[9px] text-surface-600">
            {tr('Name und Modell werden unter Konfiguration → Geräte gepflegt.')}
          </span>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="text-[11px] text-surface-400">{tr('Name')}</span>
            <input type="text" value={p.name || ''} onChange={e => onPatch({ name: e.target.value })}
              className="w-full text-sm mt-0.5" />
          </label>
          <label className="block">
            <span className="text-[11px] text-surface-400">{tr('Modell')}</span>
            <select value={p.model || ''} className="w-full text-sm mt-0.5"
              onChange={e => onPatch({ model: e.target.value })}>
              <option value="">{tr('— unbekannt —')}</option>
              {models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <Toggle on={!!p.enclosed} onClick={() => onPatch({ enclosed: !p.enclosed })} />
          <span className="text-[11px] text-surface-400">{tr('Geschlossen (mit Tür)')}</span>
        </label>
        {p.enclosed && !hasDoor && (
          /* Startwerte relativ zur Auswurf-Position, im Abstand des X1C (eject 425 →
             Tür 104/103). Das ist ein Anfang zum Einmessen, kein fertiger Wert. */
          <button onClick={() => onPatch({ door: { open: { x: r1(num(p.eject?.x) - 321), y: 319, z: 105, d: 370 },
                                                   close: { x: r1(num(p.eject?.x) - 322), y: 322, z: 105, d: 375 } } })}
            className="text-[11px] text-blue-400 hover:text-blue-300">{tr('+ Tür-Positionen anlegen')}</button>
        )}
        {hasDoor && (
          <button onClick={() => onPatch({ door: null })}
            className="text-[11px] text-surface-500 hover:text-red-400">{tr('Tür-Positionen entfernen')}</button>
        )}
        {model?.preset && (
          <button onClick={() => onPatch({ __preset: model.preset })}
            title={tr('Y/Z und Tür-Form der Modell-Vorlage übernehmen; die eingemessene X bleibt')}
            className="text-[11px] text-blue-400 hover:text-blue-300">{tr('⤓ Werte aus Modell-Vorlage')}</button>
        )}
      </div>
      {p.model && !model?.preset && (
        <p className="text-[10px] text-surface-500">
          {tr('Für dieses Modell gibt es keine fertige Vorlage — die Positionen einmessen (📐 an jeder Karte).')}
        </p>
      )}
      {dev == null && (
        <p className="text-[10px] text-amber-400/90">
          {tr('Noch kein Drucker unter Konfiguration → Geräte angelegt. Einmessen und Testen geht trotzdem; Druckstatus, Bett und Drucker-Einstellungen brauchen das Gerät. Sobald es angelegt ist, gehören diese Werte dazu.')}
        </p>
      )}

      {/* Positionen */}
      <div className="grid gap-3 md:grid-cols-2">
        {hasDoor && (
          <OpCard op="open_door" icon="🚪" title={tr('Tür öffnen')} {...opProps('open_door')}
            note={tr('X/Y/Z = ERSTER Fahrpunkt der Bewegung. Der Rest der Türbewegung folgt daraus (Pin = Bogenradius).')}
            fields={doorFields('open')} />
        )}
        {hasDoor && (
          <OpCard op="close_door" icon="🚪" title={tr('Tür schließen')} {...opProps('close_door')}
            note={tr('X/Y/Z = ERSTER Fahrpunkt (dort greift der Arm die OFFENE Tür — Bogen-Seite). Die Schließform folgt automatisch (Pin = Bogenradius).')}
            fields={doorFields('close')} />
        )}
        <OpCard op="move_to_printer" icon="➡" title={tr('Vor Drucker fahren')} {...opProps('move_to_printer')}
          onTeach={onTeach}
          teachNode={teachOp === `${p.id}:move` && (
            <TeachIn title={tr('Anfahr-Position')} axes={['x', 'y', 'z']}
              hint={tr('Vor den Drucker fahren und so justieren, wie der Arm ansetzen soll.')}
              onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry, printer: p.id })}
              onApply={pos => onTeachApply('move', pos)} onClose={onTeachClose} />
          )}
          note={tr('Sichere Anfahrt vor den Drucker — eigene Start-Position. Ohne eigene Werte gilt die Auswurf-Position.')}
          fields={['x', 'y', 'z'].map(ax => ({
            label: tr(ax.toUpperCase()),
            value: (p.move || p.eject || {})[ax],
            onChange: v => onPatch({ move: { ...(p.move || p.eject || {}), [ax]: v } }),
          }))} />
        <OpCard op="eject" icon="⬆" title={tr('Platte auswerfen')} {...opProps('eject')}
          onTeach={onTeach}
          teachNode={teachOp === `${p.id}:eject` && (
            <TeachIn title={tr('Auswurf-Start')} axes={['x', 'y', 'z']}
              hint={tr('Der Greifer muss genau an der Platte im Drucker ansetzen. Erst anfahren, dann justieren.')}
              onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry, printer: p.id })}
              onApply={pos => onTeachApply('eject', pos)} onClose={onTeachClose} />
          )}
          fields={xyz('eject')} />
        <OpCard op="place" icon="⬇" title={tr('Platte einlegen (Place)')} {...opProps('place')}
          onTeach={onTeach}
          teachNode={teachOp === `${p.id}:load` && (
            <TeachIn title={tr('Einlege-Position')} axes={['x', 'y', 'z']}
              hint={tr('Position, an der die Platte im Drucker abgesetzt wird.')}
              onApproach={() => controlService.runOp({ op: 'move_to_printer', geometry, printer: p.id })}
              onApply={pos => onTeachApply('load', pos)} onClose={onTeachClose} />
          )}
          fields={xyz('load')} />
      </div>

      {!p.enclosed && (
        <p className="text-[10px] text-surface-600">
          {tr('{0} ist offen (ohne Tür) — Tür-Aktionen entfallen. In der Farm-Sequenz die Tür-Schritte weglassen (Sequenz-Editor).', p.name)}
        </p>
      )}

      {/* Druckbett fahren/homen + Drucker-Einstellungen — beides braucht die
          MQTT-Verbindung, also ein zugeordnetes Bambu-Gerät. */}
      {dev && <BedControls dev={dev} busy={busy} onGcode={onBedGcode} />}
      {dev && <PrinterSettingsPanel deviceId={dev.id} printerName={p.name || dev.name}
        canCalibrate={model ? model.calibration : undefined} />}
    </Section>
  )
}

/* ── Ein Regal ──────────────────────────────────────────────────────────────────
   X/Y/Höhe des ersten Fachs und der Fach-Abstand gehören zum Regal, nicht zur Anlage:
   seit v1.1.9 dürfen unterschiedlich gebaute Regale nebeneinander stehen. */
function RackSection({ nr, geo, open, onToggle, onPatch, printers, slots, magazineSlot,
                       magazineCount, busy, onTest, onMagazine, teachOn, onTeach, onTeachApply,
                       onTeachClose, geometry, push }) {
  const { tr } = useLanguage()
  const [slot, setSlot] = useState(1)
  const x = num(geo.x)
  const tooClose = push > 0 && x - push < 0
  const owner = printers.find(p => p.id === geo.printer)

  return (
    <Section
      id={`sec-rack-${nr}`}
      open={open} onToggle={onToggle}
      tone={tooClose ? 'border-red-800/60' : ''}
      title={<>
        <span className="text-base leading-none">▤</span>
        {tr('Regal {0}', nr)}{geo.name ? ` · ${geo.name}` : ''}
        <span className="badge badge-blue font-mono">X {r1(x)}</span>
        {nr === 1 && <span className="badge">{tr('am Drucker')}</span>}
        {tooClose && <span className="badge badge-red">{tr('zu dicht am Endschalter')}</span>}
      </>}
      subtitle={tr('{0} Fächer · Höhe Fach 1 {1} mm · Abstand {2} mm', slots,
                   r1(num(geo.first_z)), r1(num(geo.slot_gap)))}>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <NumField label={tr('X-Position (mm)')} hint={tr('absolut auf der Schiene')}
          value={geo.x} onChange={v => onPatch({ x: v })} />
        <NumField label={tr('Y-Engage (mm)')} hint={tr('wie weit der Arm ins Fach fährt')}
          value={geo.y_engage} onChange={v => onPatch({ y_engage: v })} />
        <NumField label={tr('Höhe Fachboden 1 (mm)')} hint={tr('first_z_flat')}
          value={geo.first_z} onChange={v => onPatch({ first_z: v })} />
        <NumField label={tr('Fach-Abstand (mm)')} hint={tr('Z-Schritt = +30')}
          value={geo.slot_gap} onChange={v => onPatch({ slot_gap: v })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="text-[11px] text-surface-400">{tr('Name (optional)')}</span>
          <input type="text" value={geo.name || ''} onChange={e => onPatch({ name: e.target.value })}
            placeholder={tr('Regal {0}', nr)} className="w-full text-sm mt-0.5" />
        </label>
        <label className="block">
          <span className="text-[11px] text-surface-400">{tr('Gehört zu Drucker')}</span>
          <select value={geo.printer || ''} className="w-full text-sm mt-0.5"
            onChange={e => onPatch({ printer: e.target.value || null })}>
            <option value="">{tr('— alle Drucker —')}</option>
            {printers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
      </div>
      <p className="text-[9px] text-surface-600">
        {tr('Die Zuordnung entscheidet, wo die Farm die fertigen Platten dieses Druckers einlagert und woher sie leere holt. „Alle Drucker" = gemeinsamer Pool.')}
      </p>
      {tooClose && (
        <p className="text-[10px] text-red-400">
          {tr('X {0} mm liegt näher am Endschalter als der Andruck-Weg ({1} mm) — Greifen und Ablegen gehen hier nicht, nur Anfahren. Regal weiter weg stellen oder den Andruck-Weg verkleinern.', r1(x), push)}
        </p>
      )}

      {/* Einmessen + Test */}
      <div className="flex items-center justify-between pt-1 border-t border-surface-800/50">
        <span className="text-[11px] text-surface-500">{tr('Einmessen & Test')}</span>
        <button onClick={onTeach} className="text-[11px] text-blue-400 hover:text-blue-300">
          {teachOn ? tr('✕ Einmessen schließen') : tr('📐 Regal einmessen')}
        </button>
      </div>
      {teachOn && (
        <TeachIn title={tr('Regal {0}, Fach 1', nr)} axes={['x', 'y', 'z']}
          hint={tr('Der Greifer soll genau vor Fach 1 dieses Regals stehen. Daraus folgen X, Y-Engage und die Höhe von Fachboden 1; die übrigen Fächer rechnet Printloom aus dem Fach-Abstand.')}
          onApproach={() => controlService.runOp({ op: 'approach', geometry, rack: nr, slot: 1 })}
          onApply={onTeachApply} onClose={onTeachClose} />
      )}
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[11px] text-surface-400">{tr('Fach')}</span>
          <input type="number" min={1} max={magazineSlot || slots} value={slot}
            onChange={e => setSlot(+e.target.value)} className="w-16 text-sm font-mono mt-0.5" />
        </label>
        <button onClick={() => onTest('approach', tr('R{0} Fach {1} anfahren…', nr, slot), { rack: nr, slot })}
          disabled={busy} className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('→ Anfahren')}</button>
        <button onClick={() => onTest('grab', tr('Greifen…'), { rack: nr, slot })}
          disabled={busy} className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Greifen testen')}</button>
        <button onClick={() => onTest('store', tr('Ablegen…'), { rack: nr, slot })}
          disabled={busy} className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Ablegen testen')}</button>
        {magazineSlot > 0 && (
          <button onClick={onMagazine} disabled={busy || magazineCount <= 0}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 flex items-center gap-1.5"
            title={magazineCount <= 0 ? tr('Magazin leer — im Rack Manager auffüllen')
                                      : tr('Platte aus Magazin R{0} holen (NOLIFT, Fach {1})', nr, magazineSlot)}>
            <span>{tr('▶ Magazin')}</span>
            <span className={`font-mono text-[10px] px-1.5 py-0.5 rounded ${magazineCount > 0 ? 'bg-emerald-950/60 text-emerald-300' : 'bg-red-950/60 text-red-400'}`}>{magazineCount}</span>
          </button>
        )}
      </div>
      <p className="text-[9px] text-surface-600">
        {tr('„Anfahren" fährt nur vors Fach (greift nicht). Magazin = oberstes Fach ({0}) wird ohne Anheben gegriffen; die Entnahme zählt den Bestand runter.', magazineSlot || '—')}
        {owner ? ' ' + tr('Zugeordnet: {0}.', owner.name) : ''}
      </p>
    </Section>
  )
}

export default function Drucker() {
  const { tr } = useLanguage()

  // ── Zustand: ein Block je Drucker, ein Block je Regal (Backend liefert beides
  //    ausgeschrieben, siehe motion.expand) + die gemeinsamen Werte ──
  const [printers, setPrinters] = useState([])
  const [rackGeo, setRackGeo]   = useState({})
  const [storage, setStorage]   = useState({ x_unclamp: 43, y_engage: 335, first_z_flat: 7,
                                             slot_gap: 25, y_pullback_limit: 5, rack_x_gap: 250 })
  const [plate, setPlate]       = useState('256')       // 256 → pullback 5, 220 → 30
  const [clampPush, setClampPush]   = useState(30)      // Klemm-Andruck-Weg (mm)
  // Magnet-Greifer: Z-Wege statt X-Klemmweg. Welcher Satz Felder gilt, hängt am
  // verbauten Greifer — beide gleichzeitig zu zeigen wäre für jeden Aufbau die
  // Hälfte Lärm, denn eine Anlage hat immer nur einen Greifarm.
  const [gripper,   setGripper]     = useState('standard')
  const [magLift,    setMagLift]    = useState(15)   // Anheben über Fachhöhe (Greifen)
  const [magStoreZ,  setMagStoreZ]  = useState(35)   // Einfahrhöhe über Fachhöhe (Ablegen)
  const [magRelease, setMagRelease] = useState(5)    // Absenken UNTER Fachhöhe (Ablösen)
  const [magYClear,  setMagYClear]  = useState(42)   // Y-Vorposition vor dem Fach
  const [magStoreX,  setMagStoreX]  = useState(0)    // X-Versatz beim Ablegen
  const [magYTravel, setMagYTravel] = useState(280)  // Y, auf der X ausgerichtet wird
  const [magYRetr,   setMagYRetr]   = useState(25)   // Y-Rückzug nach dem Greifen
  const [magMagLift, setMagMagLift] = useState(5)    // Anheben am Magazin (Achse endet dicht darüber)
  const [magMagClear, setMagMagClear] = useState(33) // Y-Vorposition vor dem Magazin
  const [magYMin,    setMagYMin]    = useState(25)   // kleinste Y MIT Platte
  const [magYBack,   setMagYBack]   = useState(2)    // Ablegen: so weit vor y_engage
  const [speedFactor, setSpeedFactor] = useState(100)   // globaler M220-Vorschub in %
  const [useGcode, setUseGcode] = useState({})          // NUR Regal-Ops (grab/store)
  const [gcodeOverride, setGcodeOverride] = useState({})// NUR Regal-Ops
  const [speedFactors, setSpeedFactors] = useState({})  // NUR Regal-Ops
  const [limits, setLimits]     = useState({})

  // Regalzahl / Fächer / Magazin-Fach: EINE Quelle = Configuration → Rack Configuration.
  const [rackCfg, setRackCfg] = useState({ num_racks: 3, slots_per_rack: 6, magazine_slot: 7 })
  const [rackReady, setRackReady] = useState(false)
  const [devices, setDevices] = useState([])
  const [devicesReady, setDevicesReady] = useState(false)
  const [models, setModels]   = useState([])

  const [openSec, setOpenSec] = useState(null)   // welcher Abschnitt ist offen
  const [teachOp, setTeachOp] = useState(null)
  const [check, setCheck]     = useState(null)
  const [limitsBusy, setLimitsBusy] = useState(false)
  const [limitsMsg, setLimitsMsg]   = useState('')
  const [jog, setJog] = useState({ busy: false, msg: '', err: false })
  const [lastScript, setLastScript] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [gcodeLine, setGcodeLine]   = useState('')
  // Δ-Korrekturen des Alt-Modells unverändert mitschleifen: sobald ein Regal seinen
  // eigenen X-Wert hat, sind sie wirkungslos — für ein SPÄTER dazugestelltes Regal
  // (noch ohne eigene Werte) sind sie aber genau die richtige Vorbelegung.
  const [rackXTrim, setRackXTrim] = useState({})

  const numRacks = +rackCfg.num_racks || 1
  const magazineSlot = +rackCfg.magazine_slot || 0
  const yPullback = plate === '220' ? 30 : 5
  const rackList = useMemo(() => Array.from({ length: numRacks }, (_, i) => i + 1), [numRacks])

  const toggleSec = (id) => setOpenSec(s => (s === id ? null : id))
  const jumpTo = (id) => {
    setOpenSec(id)
    setTimeout(() => document.getElementById(`sec-${id}`)?.scrollIntoView(
      { behavior: 'smooth', block: 'start' }), 30)
  }

  // Werte eines Regals — fehlt der Block noch (frisch dazugestelltes Regal), gelten
  // die gemeinsamen Werte; die X kommt dann aus der alten Abstands-Formel.
  const rackOf = (nr) => {
    const g = rackGeo[String(nr)] || {}
    return {
      x: g.x ?? r1(num(storage.x_unclamp) + (numRacks - nr) * num(storage.rack_x_gap)
                 + num(rackXTrim[String(nr)], 0)),
      y_engage: g.y_engage ?? storage.y_engage,
      first_z: g.first_z ?? storage.first_z_flat,
      slot_gap: g.slot_gap ?? storage.slot_gap,
      printer: g.printer ?? null,
      name: g.name ?? '',
    }
  }

  const patchPrinter = (id, patch) => setPrinters(ps => ps.map(p => {
    if (p.id !== id) return p
    // Modell-Vorlage: Y/Z und die Tür-Form übernehmen, die eingemessene X halten
    // (die Vorlage kennt den Standort dieser Anlage nicht).
    if (patch.__preset) {
      const t = findPrinter(patch.__preset)
      if (!t) return p
      const off = num(p.eject?.x) - t.eject.x
      const sh = (n) => n ? { ...n, x: r1(n.x + off) } : null
      return { ...p, enclosed: t.enclosed,
               eject: { ...t.eject, x: r1(num(p.eject?.x)) },
               load: sh(t.load), move: sh(t.move || t.eject),
               door: t.door ? { open: sh(t.door.open), close: sh(t.door.close) } : null }
    }
    return { ...p, ...patch }
  }))
  const patchRack = (nr, patch) => setRackGeo(m => ({
    ...m, [String(nr)]: { ...rackOf(nr), ...m[String(nr)], ...patch } }))

  /* Wie viele Drucker es gibt, steht in der Geräteliste (Konfiguration → Geräte) —
     genau wie die Regalzahl in der Rack-Konfiguration steht. Dieser Tab legt also
     keine Drucker an, sondern füllt für jedes angelegte Gerät die Positionen. Ein
     eigener „+ Drucker"-Knopf hier wäre eine zweite Stelle für dieselbe Angabe. */
  const seedPrinter = (base, dev, i) => {
    // Irgendwo muss ein neuer Drucker anfangen: 400 mm weiter Richtung Home als der
    // vorherige — übereinander wäre garantiert falsch. Eingemessen wird er ohnehin.
    const shift = (o) => (o ? { ...o, x: r1(num(o.x) - 400) } : null)
    return {
      id: `printer-${dev?.id ?? i + 1}`,
      name: dev?.name || tr('Drucker {0}', String(i + 1).padStart(2, '0')),
      model: dev?.model || '', preset: '', device_id: dev?.id ?? null,
      enclosed: base?.enclosed ?? true,
      eject: shift(base?.eject) || { x: 425, y: 340, z: 17.5 },
      load: shift(base?.load) || { x: 425, y: 340, z: 17.5 },
      move: shift(base?.move || base?.eject) || { x: 425, y: 340, z: 17.5 },
      door: base?.door ? { open: shift(base.door.open), close: shift(base.door.close) } : null,
      use_gcode: {}, gcode_override: {}, speed_factors: {},
    }
  }

  /* Blöcke auf die Geräteliste abgleichen: je Gerät einer, in Gerätereihenfolge.
     Blöcke zu inzwischen gelöschten Geräten bleiben HINTEN stehen (nicht angezeigt) —
     wer ein Gerät versehentlich löscht und neu anlegt, verliert sonst die
     eingemessenen Positionen. Gibt unverändert dieselbe Referenz zurück, sonst
     würde der Effekt unten sich selbst immer wieder auslösen. */
  const reconcile = (ps, devs) => {
    if (!devs.length) return ps
    const taken = new Set()
    const out = []
    for (const [i, d] of devs.entries()) {
      let idx = ps.findIndex((p, k) => !taken.has(k) && p.device_id === d.id)
      if (idx < 0) idx = ps.findIndex((p, k) => !taken.has(k) && p.device_id == null)
      if (idx < 0) { out.push(seedPrinter(out[out.length - 1] || ps[0], d, i)); continue }
      taken.add(idx)
      const p = ps[idx]
      out.push(p.device_id === d.id && p.name === d.name && (p.model || '') === (d.model || '')
        ? p
        // Name und Modell gehören dem Gerät — hier stünden sie sonst ein zweites Mal.
        : { ...p, device_id: d.id, name: d.name, model: d.model || p.model || '' })
    }
    const next = [...out, ...ps.filter((_, k) => !taken.has(k))]
    return (next.length === ps.length && next.every((p, i) => p === ps[i])) ? ps : next
  }

  useEffect(() => {
    if (!hydrated.current || !printers.length || !devicesReady) return
    setPrinters(ps => reconcile(ps, devices))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devices, printers, devicesReady])

  // Angezeigt (und gespeichert) wird ein Block je Gerät; ohne jedes Gerät genau einer,
  // damit sich die Anlage auch vor dem Anlegen des Druckers einmessen lässt.
  const shownPrinters = useMemo(() => (
    devices.length ? printers.slice(0, devices.length) : printers.slice(0, 1)
  ), [printers, devices.length])

  // Regale, die auf einen nicht mehr vorhandenen Drucker zeigen, wieder freigeben —
  // sonst hinge die Zuordnung an einer ID, die es nicht mehr gibt.
  useEffect(() => {
    if (!devicesReady || !shownPrinters.length) return
    const ids = new Set(shownPrinters.map(p => p.id))
    setRackGeo(m => {
      const bad = Object.entries(m).filter(([, v]) => v?.printer && !ids.has(v.printer))
      if (!bad.length) return m
      return Object.fromEntries(Object.entries(m).map(
        ([k, v]) => [k, v?.printer && !ids.has(v.printer) ? { ...v, printer: null } : v]))
    })
  }, [shownPrinters, devicesReady])

  // ── Geometrie: EINE Quelle für Live-G-code UND (opt-in) die Farm ──
  const geometry = useMemo(() => ({
    printer_id: shownPrinters[0]?.preset || '',
    printer_name: shownPrinters[0]?.name || '',
    enclosed: !!shownPrinters[0]?.enclosed,
    // Gespeichert wird genau ein Block je angelegtem Gerät. Ein Block ohne Gerät
    // (gelöschter Drucker) fällt damit weg — sonst stünde er weiter in der Farm-
    // Übersicht und in der Prüfung, obwohl es das Gerät nicht mehr gibt.
    printers: shownPrinters.map(p => ({
      ...p,
      eject: { x: num(p.eject?.x), y: num(p.eject?.y), z: num(p.eject?.z) },
      load: { x: num(p.load?.x), y: num(p.load?.y), z: num(p.load?.z) },
      move: p.move ? { x: num(p.move.x), y: num(p.move.y), z: num(p.move.z) } : null,
      door: p.door ? {
        open: { x: num(p.door.open?.x), y: num(p.door.open?.y), z: num(p.door.open?.z), d: num(p.door.open?.d) },
        close: { x: num(p.door.close?.x), y: num(p.door.close?.y), z: num(p.door.close?.z), d: num(p.door.close?.d) },
      } : null,
    })),
    rack_geo: Object.fromEntries(rackList.map(nr => {
      const g = rackOf(nr)
      return [String(nr), { x: num(g.x), y_engage: num(g.y_engage), first_z: num(g.first_z),
                            slot_gap: num(g.slot_gap), printer: g.printer || null,
                            ...(g.name ? { name: g.name } : {}) }]
    })),
    storage: {
      x_unclamp: num(storage.x_unclamp), y_engage: num(storage.y_engage),
      first_z_flat: num(storage.first_z_flat), slot_gap: num(storage.slot_gap),
      y_pullback_limit: yPullback, rack_x_gap: num(storage.rack_x_gap),
    },
    rack_x_trim: { ...rackXTrim },
    use_gcode: { ...useGcode },
    gcode_override: gcodeOverride,
    speed_factor: num(speedFactor, 100) || 100,
    speed_factors: { ...speedFactors },
    clamp_push_mm: num(clampPush, 30),
    gripper,
    magnet_lift_mm:     num(magLift, 15),
    magnet_store_z_mm:  num(magStoreZ, 35),
    magnet_release_mm:  num(magRelease, 5),
    magnet_y_clear_mm:  num(magYClear, 42),
    magnet_store_x_mm:  num(magStoreX, 0),
    magnet_y_travel_mm:  num(magYTravel, 280),
    magnet_y_retract_mm: num(magYRetr, 25),
    magnet_mag_lift_mm:  num(magMagLift, 5),
    magnet_mag_y_clear_mm: num(magMagClear, 33),
    magnet_y_min_loaded_mm: num(magYMin, 25),
    magnet_store_y_back_mm: num(magYBack, 2),
    machine_limits: { ...limits },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [shownPrinters, rackGeo, rackList, storage, yPullback, useGcode, gcodeOverride,
       speedFactor, speedFactors, clampPush, gripper, magLift, magStoreZ, magRelease, magYClear,
       magStoreX, magYTravel, magYRetr, magMagLift, magMagClear, magYMin, magYBack,
       limits, rackXTrim])

  // Persistenz: gespeicherte Geometrie beim Laden übernehmen (einmal), Änderungen debounced speichern
  const isMagnet = gripper === 'magnet'
  /* Andruck-Weg, wie er AN DEN REGALEN wirkt. Der Magnet-Greifer fährt beim
     Greifen und Ablegen nicht mehr in X — dort ist der Weg also 0, auch wenn für
     Auswurf/Einlegen am Drucker weiter 30 mm gelten. Ohne diese Trennung meldeten
     Regal-Karte und Schienen-Übersicht „zu dicht am Endschalter" für eine
     Bewegung, die es gar nicht mehr gibt (dieselbe Unterscheidung wie in
     geometry_check.py). */
  const rackPush = isMagnet ? 0 : num(clampPush, 30)

  const hydrated = useRef(false)
  useEffect(() => {
    controlService.getGeometry().then(r => {
      const g = r?.data?.geometry
      if (!g) return
      // Das Backend liefert die volle Form (ein Block je Drucker/Regal, absolute
      // Werte) — die Umrechnung des Alt-Modells passiert dort, an genau einer Stelle.
      setPrinters(Array.isArray(g.printers) && g.printers.length ? g.printers : [])
      if (g.rack_geo && typeof g.rack_geo === 'object') setRackGeo(g.rack_geo)
      if (g.storage) setStorage(s => ({ ...s, ...g.storage }))
      if (g.rack_x_trim && typeof g.rack_x_trim === 'object') setRackXTrim(g.rack_x_trim)
      setPlate((g.storage?.y_pullback_limit >= 30) ? '220' : '256')
      if (g.speed_factor != null) setSpeedFactor(g.speed_factor)
      if (g.speed_factors) setSpeedFactors(g.speed_factors)
      if (g.clamp_push_mm != null) setClampPush(g.clamp_push_mm)
      if (g.gripper) setGripper(g.gripper)
      if (g.magnet_lift_mm != null) setMagLift(g.magnet_lift_mm)
      if (g.magnet_store_z_mm != null) setMagStoreZ(g.magnet_store_z_mm)
      if (g.magnet_release_mm != null) setMagRelease(g.magnet_release_mm)
      if (g.magnet_y_clear_mm != null) setMagYClear(g.magnet_y_clear_mm)
      if (g.magnet_mag_lift_mm != null) setMagMagLift(g.magnet_mag_lift_mm)
      if (g.magnet_mag_y_clear_mm != null) setMagMagClear(g.magnet_mag_y_clear_mm)
      if (g.magnet_store_x_mm != null) setMagStoreX(g.magnet_store_x_mm)
      if (g.magnet_y_travel_mm != null) setMagYTravel(g.magnet_y_travel_mm)
      if (g.magnet_y_retract_mm != null) setMagYRetr(g.magnet_y_retract_mm)
      if (g.magnet_y_min_loaded_mm != null) setMagYMin(g.magnet_y_min_loaded_mm)
      if (g.magnet_store_y_back_mm != null) setMagYBack(g.magnet_store_y_back_mm)
      if (g.machine_limits && typeof g.machine_limits === 'object') setLimits(g.machine_limits)
      if (g.use_gcode) {
        // Migration: die Einlege-Op hieß früher „load", jetzt „place" (Alias).
        const ug = { ...g.use_gcode }
        if (ug.load != null && ug.place == null) ug.place = ug.load
        setUseGcode(ug)
      }
      if (g.gcode_override) setGcodeOverride({ ...g.gcode_override })
    }).catch(() => {}).finally(() => { hydrated.current = true })
  }, [])
  useEffect(() => {
    // Erst speichern, wenn ALLES geladen ist: Geometrie, Regalzahl und Geräteliste.
    // Sonst würde eine noch geratene Regalzahl die übrigen Regal-Blöcke wegschreiben
    // — oder eine noch leere Geräteliste den zweiten Drucker.
    if (!hydrated.current || !printers.length || !rackReady || !devicesReady) return
    // Speichern liefert die Plausibilitätsprüfung mit zurück (Achsgrenzen) — so sieht
    // der Nutzer sofort, wenn ein Wert eine Bewegung aus der Achse fahren würde.
    const t = setTimeout(() => {
      controlService.putGeometry(geometry)
        .then(r => setCheck(r?.data?.check || null))
        .catch(() => {})
    }, 600)
    return () => clearTimeout(t)
  }, [geometry, printers.length, rackReady, devicesReady])

  // Regalzahl / Fächer / Magazin-Fach global aus der Rack-Konfiguration (Configuration).
  useEffect(() => {
    const load = () => rackManagerService.getAll().then(r => {
      const d = r?.data || {}
      setRackCfg({
        num_racks: d.num_racks ?? 3, slots_per_rack: d.slots_per_rack ?? 6, magazine_slot: d.magazine_slot ?? 7,
        magazine_counts: Array.isArray(d.magazine_counts) ? d.magazine_counts : [],
      })
      setRackReady(true)
    }).catch(() => setRackReady(true))
    load()
    window.addEventListener('printloom:rackConfigSaved', load)
    return () => window.removeEventListener('printloom:rackConfigSaved', load)
  }, [])

  // Geräte + Modell-Liste (Konfiguration → Geräte). Der Drucker-Tab legt keine
  // Geräte an — er zeigt einen Abschnitt JE angelegtem Drucker und füllt dessen
  // Positionen. Deshalb auf Änderungen horchen: wer drüben einen zweiten Drucker
  // anlegt, soll ihn hier sofort sehen.
  useEffect(() => {
    const load = () => deviceService.listDevices()
      .then(r => setDevices((r?.data || []).filter(d => d.device_type === 'bambu_lab')
        .map(d => ({ id: d.id, name: d.name, model: d.model || '' }))))
      .catch(() => {})
      .finally(() => setDevicesReady(true))
    load()
    deviceService.listModels().then(r => setModels(r.data?.models || [])).catch(() => {})
    window.addEventListener('printloom:devicesChanged', load)
    return () => window.removeEventListener('printloom:devicesChanged', load)
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
  // runterzählen: die nächste Entnahme greift dann automatisch tiefer richtig
  // (Durchbiegung: Stapel liegt pro Platte ~1 mm tiefer).
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

  // G-code-Zeile direkt an den OTTOeject senden (Kalibrierung).
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

  // Druckerbett fahren/homen — nur mit zugeordnetem Bambu-Gerät (MQTT).
  const bedGcode = async (deviceId, gcode, label) => {
    if (deviceId == null || jog.busy) return
    setJog({ busy: true, msg: label, err: false })
    try {
      await printerService.sendGcode(deviceId, gcode)
      setJog({ busy: false, msg: tr('✓ {0}', label), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
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

  // Geschwindigkeit setzen → M220 sofort an den OTTOeject schicken.
  const applySpeed = (v) => {
    setSpeedFactor(v)
    sendOp('speed', tr('Geschwindigkeit {0}%', v), {}, { ...geometry, speed_factor: v })
  }

  // G-code der Operation aus den aktuellen WERTEN laden → Startpunkt zum Bearbeiten.
  // Den evtl. schon gesetzten Override dieser Op vorher entfernen, damit die Vorlage
  // immer die BERECHNETE Bewegung ist (sonst käme der bestehende Override zurück).
  const loadPrinterGcode = (pid, op) => {
    const p = printers.find(x => x.id === pid)
    if (!p) return
    const { [op]: _drop, ...rest } = p.gcode_override || {}
    const geo = { ...geometry, printers: geometry.printers.map(
      x => x.id === pid ? { ...x, gcode_override: rest } : x) }
    controlService.previewOp({ op, geometry: geo, printer: pid })
      .then(r => setPrinterGcode(pid, op, r?.data?.script || ''))
      .catch(() => setPrinterGcode(pid, op, ''))
  }
  const setPrinterGcode = (pid, op, text) => setPrinters(ps => ps.map(
    p => p.id === pid ? { ...p, gcode_override: { ...(p.gcode_override || {}), [op]: text } } : p))
  const clearPrinterGcode = (pid, op) => setPrinters(ps => ps.map(p => {
    if (p.id !== pid) return p
    const n = { ...(p.gcode_override || {}) }; delete n[op]
    return { ...p, gcode_override: n }
  }))
  // Regal-Operationen als VORLAGE MIT PLATZHALTERN laden ({rack_x}, {slot_z+25} …).
  // Die konkrete Vorschau eines Fachs wäre als Startpunkt unbrauchbar: ein daraus
  // bearbeiteter G-code führe jedes Regal und jedes Fach an dieselbe Stelle. So
  // bleibt „Regal 1 Fach 3" Sache von Printloom, und nur die Bewegung danach
  // gehört dir.
  const loadRackGcode = (op) => {
    controlService.previewOp({ op, geometry, rack: 1, slot: 1, template: true })
      .then(r => setGcodeOverride(m => ({ ...m, [op]: r?.data?.script || '' })))
      .catch(() => setGcodeOverride(m => ({ ...m, [op]: '' })))
  }

  const activeFarm = shownPrinters.reduce((n, p) => n + PRINTER_OPS.filter(o => p.use_gcode?.[o]).length, 0)
    + RACK_OPS.filter(o => useGcode[o]).length

  // Einmessen: Drucker-Positionen sind seit v1.1.9 absolut — die Ist-Position wandert
  // also 1:1 ins Feld (früher musste der Regal-Versatz herausgerechnet werden).
  const applyTeachPrinter = (pid, key) => (pos) => {
    patchPrinter(pid, { [key]: { x: r1(pos.x), y: r1(pos.y), z: r1(pos.z) } })
    setTeachOp(null)
  }
  const applyTeachRack = (nr) => (pos) => {
    patchRack(nr, { x: r1(pos.x), y_engage: r1(pos.y), first_z: r1(pos.z) })
    setTeachOp(null)
  }

  return (
    <div className="space-y-4 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Drucker & Regale')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          {tr('Der ganze Aufbau auf einer Seite: was steht wo auf der Schiene, und welche Position fährt der Arm dort an.')}
        </p>
      </div>

      {/* ── Einleitung: wozu dieser Tab da ist ── */}
      <div className="card p-3 space-y-2">
        <p className="text-[12px] text-surface-300">
          {tr('Der OTTOeject fährt auf EINER Schiene an allen Modulen entlang. Jedes Modul — jeder Drucker und jedes Regal — hat hier seinen eigenen Abschnitt mit seiner eigenen Position in mm. Was in einem Abschnitt steht, fährt der Arm genau so; es gibt keine zweite Stelle, an der dieselbe Zahl noch einmal steht.')}
        </p>
        <ol className="text-[11px] text-surface-500 space-y-1 list-decimal list-inside">
          <li>{tr('Referenzfahrt — danach kennt der Arm seinen Nullpunkt (rechts).')}</li>
          <li>{tr('Abschnitt aufklappen, mit 📐 einmessen oder Werte eintippen, mit „▶ Test" prüfen.')}</li>
          <li>{tr('Erst wenn eine Bewegung sauber läuft: „Farm nutzt diese Position" einschalten.')}</li>
        </ol>
        <p className="text-[11px] text-amber-300 rounded-lg border border-amber-800/50 bg-amber-950/30 px-3 py-2">
          {tr('⚠ Falsche Werte können den Arm gegen den Drucker fahren. Jede Operation erst einzeln testen — Printloom prüft vorher nur, ob eine Bewegung die Achse verlässt, nicht ob sie mechanisch passt.')}
        </p>
      </div>

      {/* ── Schiene ganz oben: der Überblick über den Aufbau ── */}
      <div className="card p-3">
        <FarmRail
          racks={rackList.map(nr => {
            const g = rackOf(nr)
            const owner = shownPrinters.find(p => p.id === g.printer)
            return { nr, x: r1(num(g.x)), name: g.name, printerName: owner?.name || '' }
          })}
          printers={shownPrinters.map(p => ({ id: p.id, name: p.name, x: r1(num(p.eject?.x)) }))}
          limitX={+limits.x || 0} push={rackPush}
          activeId={openSec} onSelect={(id) => jumpTo(id)} />
      </div>

      {/* ── Werkzeuge: Referenzfahrt, Tempo, direkter G-code, Bett ── */}
      <div className="card p-3 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={homeOtto} disabled={jog.busy}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('⌂ Referenzfahrt')}</button>
          <span className="text-[11px] text-surface-400 ml-2">{tr('Geschwindigkeit (global)')}</span>
          {SPEEDS.map(v => (
            <button key={v} onClick={() => applySpeed(v)} disabled={jog.busy}
              className={`text-[11px] px-2 py-1 rounded border transition-colors disabled:opacity-50 ${(+speedFactor || 100) === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>{v}%</button>
          ))}
          <span className="text-[9px] text-surface-600">{tr('M220-Fallback · pro Operation eigene Geschwindigkeit einstellbar')}</span>
          <span className="text-[10px] text-surface-500 ml-auto">
            {activeFarm === 0
              ? tr('Farm nutzt aktuell die Geräte-Macros (keine App-Position aktiv).')
              : tr('Farm nutzt {0} App-Position(en). Rest über Geräte-Macros.', activeFarm)}
          </span>
        </div>
        <div className="flex items-center gap-2 pt-1 border-t border-surface-800/50">
          <input type="text" value={gcodeLine} onChange={e => setGcodeLine(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendGcodeLine() }}
            placeholder={tr('G-code direkt an den OTTOeject — z. B. G1 X100 F6000')}
            className="flex-1 font-mono text-[11px] h-8 py-0 px-2" disabled={jog.busy} />
          <button onClick={sendGcodeLine} disabled={jog.busy || !gcodeLine.trim()}
            className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('▶ Senden')}</button>
        </div>
        <p className="text-[9px] text-surface-600">
          {tr('Wird 1:1 an Klipper geschickt (Enter = Senden). Vorher homen; RACK=-Nummern werden automatisch in die Geräte-Zählung übersetzt.')}
        </p>
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

      {/* ── Drucker: einer je angelegtem Gerät ── */}
      <div className="flex items-center justify-between px-1">
        <p className="section-label">{tr('Drucker')}</p>
        <span className="text-[10px] text-surface-600">
          {devices.length
            ? tr('{0} Drucker — Anzahl in Konfiguration → Geräte', devices.length)
            : tr('Noch kein Drucker angelegt — Konfiguration → Geräte')}
        </span>
      </div>
      {shownPrinters.map((p, i) => (
        <PrinterSection key={p.id} p={p} index={i}
          dev={devices.find(d => d.id === p.device_id) || null}
          open={openSec === p.id} onToggle={() => toggleSec(p.id)}
          onPatch={patch => patchPrinter(p.id, patch)}
          models={models} busy={jog.busy} onTest={sendOp}
          onLoadGcode={loadPrinterGcode} onGcodeText={setPrinterGcode} onClearGcode={clearPrinterGcode}
          teachOp={teachOp}
          onTeach={(op) => setTeachOp(t => {
            const key = `${p.id}:${op === 'move_to_printer' ? 'move' : op === 'place' ? 'load' : op}`
            return t === key ? null : key
          })}
          onTeachApply={(key, pos) => applyTeachPrinter(p.id, key)(pos)}
          onTeachClose={() => setTeachOp(null)} geometry={geometry} onBedGcode={bedGcode} />
      ))}
      {!printers.length && (
        <p className="text-[11px] text-surface-500 px-1">{tr('Geometrie wird geladen …')}</p>
      )}

      {/* ── Regale ── */}
      <div className="flex items-center justify-between px-1 pt-1">
        <p className="section-label">{tr('Regale')}</p>
        <span className="text-[10px] text-surface-600">
          {tr('{0} Regale · {1} Fächer · Magazin-Fach {2} — Anzahl in Konfiguration → Rack Configuration',
              numRacks, rackCfg.slots_per_rack, magazineSlot || '—')}
        </span>
      </div>
      {rackList.map(nr => (
        <RackSection key={nr} nr={nr} geo={rackOf(nr)}
          open={openSec === `rack-${nr}`} onToggle={() => toggleSec(`rack-${nr}`)}
          onPatch={patch => patchRack(nr, patch)} printers={shownPrinters}
          slots={rackCfg.slots_per_rack} magazineSlot={magazineSlot}
          magazineCount={Math.max(0, +(rackCfg.magazine_counts?.[nr - 1] ?? 0))}
          busy={jog.busy} onTest={sendOp} onMagazine={() => grabFromMagazine(nr)}
          teachOn={teachOp === `rack-${nr}`}
          onTeach={() => setTeachOp(t => (t === `rack-${nr}` ? null : `rack-${nr}`))}
          onTeachApply={applyTeachRack(nr)} onTeachClose={() => setTeachOp(null)}
          geometry={geometry} push={rackPush} />
      ))}

      {/* ── Gemeinsame Werte: gelten für den GREIFER, nicht für ein einzelnes Modul ── */}
      <Section id="sec-common" title={tr('🔧 Greifer & Platte (für alle Module)')}
        subtitle={isMagnet
          ? tr('Magnet · Anheben {0} mm · Ablegen +{1}/−{2} mm · Platte {3} mm', num(magLift, 15), num(magStoreZ, 35), num(magRelease, 5), plate)
          : tr('Andruck-Weg {0} mm · Platte {1} mm', num(clampPush, 30), plate)}
        open={openSec === 'common'} onToggle={() => toggleSec('common')}>
        <div className="grid gap-2 sm:grid-cols-2">
          {isMagnet ? (
            <div className="grid grid-cols-2 gap-2 sm:col-span-2">
              <NumField label={tr('Anheben (mm)')} hint={tr('Greifen: über Fachhöhe')}
                value={magLift} onChange={setMagLift} />
              <NumField label={tr('Einfahrhöhe (mm)')} hint={tr('Ablegen: über Fachhöhe')}
                value={magStoreZ} onChange={setMagStoreZ} />
              <NumField label={tr('Ablöse-Tiefe (mm)')} hint={tr('Ablegen: UNTER Fachhöhe')}
                value={magRelease} onChange={setMagRelease} />
              <NumField label={tr('Y-Vorposition (mm)')} hint={tr('Abstand vor dem Fach')}
                value={magYClear} onChange={setMagYClear} />
              <NumField label={tr('X-Versatz Ablegen (mm)')} hint={tr('0 = wie beim Greifen')}
                value={magStoreX} onChange={setMagStoreX} />
              <NumField label={tr('Reise-Y (mm)')} hint={tr('Greifen: hier wird X ausgerichtet')}
                value={magYTravel} onChange={setMagYTravel} />
              <NumField label={tr('Y-Rückzug (mm)')} hint={tr('Greifen: mit Platte heraus')}
                value={magYRetr} onChange={setMagYRetr} />
              <NumField label={tr('Anheben Magazin (mm)')} hint={tr('kleiner — die Achse endet darüber')}
                value={magMagLift} onChange={setMagMagLift} />
              <NumField label={tr('Y-Vorposition Magazin (mm)')} hint={tr('Abstand vor dem Magazin')}
                value={magMagClear} onChange={setMagMagClear} />
              <NumField label={tr('Y-Minimum mit Platte (mm)')} hint={tr('nie weiter zurück, wenn beladen')}
                value={magYMin} onChange={setMagYMin} />
              <NumField label={tr('Ablege-Abstand (mm)')} hint={tr('so weit vor dem Greif-Y absetzen')}
                value={magYBack} onChange={setMagYBack} />
            </div>
          ) : (
            <NumField label={tr('Andruck-Weg (mm)')} hint={tr('Greifer-Andruck · 0 = kein Griff!')}
              value={clampPush} onChange={setClampPush} />
          )}
          <div>
            <span className="text-[11px] text-surface-400">{tr('Plattengröße')}</span>
            <div className="flex items-center gap-1.5 mt-1">
              {['256', '220'].map(v => (
                <button key={v} onClick={() => setPlate(v)}
                  className={`text-[11px] px-2 py-1 rounded border ${plate === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500'}`}>{v} mm</button>
              ))}
              <span className="text-[9px] text-surface-600">{tr('bestimmt den Rückzugs-Y ({0} mm)', yPullback)}</span>
            </div>
          </div>
        </div>
        <p className="text-[9px] text-surface-600">
          {isMagnet
            ? tr('Magnet-Greifer: beim GREIFEN fährt der Arm auf Fachhöhe unter die Platte und hebt sie an. Beim ABLEGEN kommt er höher herein und senkt sich UNTER die Fachhöhe — dabei bleibt die Platte liegen und löst sich vom Magneten. Kein Weg nach links/rechts; der Andruck-Weg gilt nur noch für Auswurf und Einlegen am Drucker.')
            : tr('Andruck-Weg: der Arm fährt beim Greifen/Ablegen um diesen Weg über die X hinaus, um den Greifer in die Halterung zu drücken (Auswerfen/Einlegen: +, Greifen/Ablegen: −). Original 30. ACHTUNG: Genau diese Bewegung IST der Griff — bei 0 hakt der Greifer nicht ein, der Arm fährt vor und kommt leer zurück.')}
        </p>
        {isMagnet && (
          <p className="text-[9px] text-surface-600">
            {tr('Die Startwerte stammen aus Messungen: Lagerfach (Regal 3 Fach 1, Höhe 15 mm) Greifen Y280 → Z15 → Y300 → Y342 → Z30 → Y25, Ablegen X/Z zusammen → Y300 → Y340 → Z10 → Y300. Magazin (Höhe 345 mm) X/Y/Z in einem Zug → Y328 → Z350 → Y25 — dort wird nur wenig angehoben, weil die Achse dicht darüber endet, und die Höhe bleibt fest, egal wie voll das Magazin ist. Am Drucker fährt der Magnet eigene Wege — auch dort ohne Andruck. Weicht dein Aufbau ab, sind das die Stellschrauben.')}
          </p>
        )}

        {/* Greifen/Ablegen: eigener G-code + Farm-Freigabe. Gilt für ALLE Regale —
            die Bewegung ist dieselbe, nur die Koordinaten kommen aus dem Regal. */}
        <div className="pt-1 border-t border-surface-800/50 space-y-2">
          <p className="text-[11px] text-surface-400">{tr('Greifen & Ablegen (alle Regale)')}</p>
          {RACK_OPS.map(op => (
            <div key={op} className="space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <Toggle on={!!useGcode[op]} color="bg-emerald-600"
                  onClick={() => setUseGcode(m => ({ ...m, [op]: !m[op] }))} />
                <span className={`text-[11px] ${useGcode[op] ? 'text-emerald-300' : 'text-surface-500'}`}>
                  {op === 'grab' ? tr('Farm: Greifen als App-G-code') : tr('Farm: Ablegen als App-G-code')}
                </span>
                <SpeedSelect value={speedFactors[op] ?? ''} onChange={v => setSpeedFactors(m => {
                  const n = { ...m }; if (v === '' || v == null) delete n[op]; else n[op] = +v; return n
                })} />
                {typeof gcodeOverride[op] === 'string' ? (
                  <button onClick={() => setGcodeOverride(m => { const n = { ...m }; delete n[op]; return n })}
                    className="text-[10px] text-surface-500 hover:text-surface-300">{tr('✕ zurück zu Werten')}</button>
                ) : (
                  <button onClick={() => loadRackGcode(op)}
                    title={tr('Lädt die eingebaute Bewegung als Vorlage — mit Platzhaltern, damit sie für jedes Regal und Fach gilt')}
                    className="text-[10px] text-blue-400 hover:text-blue-300">{tr('⚙ Eigenen G-code bearbeiten (Feinjustage)')}</button>
                )}
              </div>
              {typeof gcodeOverride[op] === 'string' && (
                <textarea value={gcodeOverride[op]} spellCheck={false} rows={8}
                  onChange={e => setGcodeOverride(m => ({ ...m, [op]: e.target.value }))}
                  className="w-full text-[11px] leading-snug font-mono bg-surface-900/70 border border-surface-700/60 rounded-lg p-2 whitespace-pre" />
              )}
            </div>
          ))}
          <p className="text-[9px] text-blue-400/80 leading-relaxed">
            {tr('Platzhalter für Regale/Fächer:')}{' '}
            <span className="font-mono text-blue-300">{'{rack_x} {slot_z} {mag_z} {y_engage} {y_pullback} {rack} {slot}'}</span>
            {' — '}{tr('EIN G-code fährt so jedes Regal (R1 am Drucker) und Fach korrekt an. Versätze gehen mit: {slot_z+25} ist die Fachhöhe plus 25 mm.')}
          </p>
        </div>
      </Section>

      {/* ── Plausibilität & Achsgrenzen ── */}
      <Section id="sec-check" title={<>
          {tr('🛡 Plausibilität & Achsgrenzen')}
          {check && (check.errors?.length
            ? <span className="badge badge-red">{tr('{0} Fehler', check.errors.length)}</span>
            : check.warnings?.length
              ? <span className="badge badge-amber">{tr('{0} Hinweise', check.warnings.length)}</span>
              : <span className="badge badge-green">{tr('geprüft')}</span>)}
        </>}
        subtitle={tr('Prüft jede Bewegung aller Drucker und Regale, bevor sie gesendet wird.')}
        open={openSec === 'check'} onToggle={() => toggleSec('check')}>
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
            {trProblem(p)}
          </div>
        ))}
        {check?.warnings?.map((p, i) => (
          <div key={`w${i}`} className="px-3 py-2 rounded-lg bg-amber-950/30 border border-amber-800/60 text-[11px] text-amber-300">
            {trProblem(p)}
          </div>
        ))}
        {check && !check.errors?.length && !check.warnings?.length && (
          <p className="text-[11px] text-emerald-400">{tr('✓ Alle Bewegungen liegen innerhalb der Achsen.')}</p>
        )}
        <p className="text-[9px] text-surface-600">
          {tr('Geprüft werden alle Operationen über alle Drucker, Regale und das erste/letzte Fach — dort liegen die Extremwerte. Ob eine Position mechanisch passt (z. B. genau vor dem Fach), kann nur das Einmessen zeigen.')}
        </p>
      </Section>

      {/* ── Dauerlauf: die eingestellte Geometrie unter Last ── */}
      <StressTest open={openSec === 'stress'} onToggle={() => toggleSec('stress')} busy={jog.busy} />

      <p className="text-[10px] text-surface-600 px-1">
        {tr('Printloom speichert diese Werte und sendet den G-code direkt (nur OTTOEJECT_HOME bleibt Geräte-Macro). Für die Auto-Farm wirken sie erst, wenn „Farm nutzt diese Position" für die jeweilige Operation aktiv ist — sonst fährt die Farm weiter die Geräte-Macros.')}
      </p>
    </div>
  )
}
