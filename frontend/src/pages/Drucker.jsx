import React, { useState, useMemo, useEffect, useRef } from 'react'
import { useLanguage } from '../services/i18n'
import { controlService } from '../services/api'
import { PRINTERS, CUSTOM_PRINTER } from '../services/printers'
import { PrinterBadge } from '../components/PrinterBadge'

/* ── Drucker-Tab ────────────────────────────────────────────────────────────────
   Ein Drucker pro Printloom. Modell wählen → Positionen je Aufgabe (Tür auf/zu,
   Auswurf, Einlegen, Greifen/Ablegen) einstellen und LIVE testen. Printloom sendet
   den G-code direkt aus diesen Koordinaten (nur OTTOEJECT_HOME bleibt Geräte-Macro).
   „Farm nutzt diese Position" (opt-in, je Operation) schaltet den App-G-code für die
   Auto-Farm frei — Standard AUS (Farm nutzt bis dahin die Geräte-Macros). */

const OPS = ['open_door', 'close_door', 'eject', 'load', 'grab', 'store']

function NumField({ label, hint, value, onChange, step = 1, min, max }) {
  return (
    <label className="block">
      <span className="text-[11px] text-surface-400">{label}</span>
      {hint && <span className="block text-[9px] text-surface-600">{hint}</span>}
      <input type="number" step={step} min={min} max={max} value={value}
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

/* Operations-Karte (Modul-Ebene → Eingabefelder verlieren beim Tippen nicht den Fokus).
   Felder + Live-Test + opt-in „Farm nutzt diese Position". */
function OpCard({ op, icon, title, fields, extra, note, busy, gcodeOn, onTest, onToggle }) {
  const { tr } = useLanguage()
  return (
    <div className="card p-3 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-surface-200">{icon} {title}</p>
        <button onClick={() => onTest(op, tr('{0}…', title), extra)} disabled={busy}
          className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('▶ Test')}</button>
      </div>
      <div className={`grid gap-2 ${fields.length >= 4 ? 'grid-cols-4' : 'grid-cols-3'}`}>
        {fields.map(f => (
          <NumField key={f.label} label={f.label} hint={f.hint} value={f.value}
            step={f.step} onChange={f.onChange} />
        ))}
      </div>
      {note && <p className="text-[9px] text-surface-600">{note}</p>}
      <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-surface-800/50">
        <Toggle on={!!gcodeOn} onClick={() => onToggle(op)} color="bg-emerald-600" />
        <span className={`text-[11px] ${gcodeOn ? 'text-emerald-300' : 'text-surface-500'}`}>
          {gcodeOn ? tr('Farm nutzt diese Position ✓') : tr('Farm nutzt diese Position (aus → Geräte-Macro)')}
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
  const [doorOpen,  setDoorOpen]  = useState({ x: 104, y: 319, z: 105, d: 370 })
  const [doorClose, setDoorClose] = useState({ x: 103, y: 322, z: 105, d: 375 })

  // Regal / Greifen
  const [xUnclamp, setX]  = useState(43)
  const [yEngage,  setY]  = useState(335)
  const [firstZ, setFirstZ] = useState(7)
  const [gap, setGap]     = useState(25)
  const [rackGap, setRackGap] = useState(250)
  const [racks, setRacks] = useState(1)
  const [storageSlots, setStorageSlots] = useState(6)
  const [magazine, setMagazine] = useState(true)
  const [plate, setPlate] = useState('256')          // 256 → pullback 5, 220 → 30
  const [printerScales, setPrinterScales] = useState(true)

  // Opt-in: welche Operationen die Farm als App-G-code statt Geräte-Macro fährt
  const [useGcode, setUseGcode] = useState(
    () => Object.fromEntries(OPS.map(o => [o, false]))
  )
  const toggleGcode = (op) => setUseGcode(m => ({ ...m, [op]: !m[op] }))

  const [testRack, setTestRack] = useState(1)
  const [testSlot, setTestSlot] = useState(1)
  const [regalOpen, setRegalOpen] = useState(false)
  const [jog, setJog] = useState({ busy: false, msg: '', err: false })
  const [lastScript, setLastScript] = useState('')
  const [showScript, setShowScript] = useState(false)

  const hasDoor = enclosed && !!(doorOpen && doorClose)
  const yPullback = plate === '220' ? 30 : 5
  const magazineSlot = magazine ? (+storageSlots || 1) + 1 : 0

  const pickPrinter = (p) => {
    setPrinterId(p.id); setPrinterName(p.name); setEnclosed(p.enclosed)
    setEject({ ...p.eject }); setLoad({ ...p.load })
    // Ohne Tür-Preset (z. B. AD5X) die Tür leeren, sonst blieben alte Werte → falsche Tür-Karten.
    setDoorOpen(p.door ? { ...p.door.open } : null)
    setDoorClose(p.door ? { ...p.door.close } : null)
  }

  // ── Geometrie: EINE Quelle für Live-G-code UND (opt-in) die Farm ──
  const geometry = useMemo(() => ({
    printer_id: printerId, printer_name: printerName, enclosed,
    racks: +racks || 1, storage_slots: +storageSlots || 1, magazine,
    storage: {
      x_unclamp: +xUnclamp, y_engage: +yEngage, first_z_flat: +firstZ,
      slot_gap: +gap, y_pullback_limit: yPullback, rack_x_gap: +rackGap || 0,
    },
    printer: {
      eject: { x: +eject.x, y: +eject.y, z: +eject.z },
      load:  { x: +load.x,  y: +load.y,  z: +load.z },
      door: hasDoor ? { open: { ...doorOpen }, close: { ...doorClose } } : null,
      x_scales_with_racks: printerScales,
    },
    use_gcode: { ...useGcode },
  }), [printerId, printerName, enclosed, racks, storageSlots, magazine, xUnclamp, yEngage,
       firstZ, gap, yPullback, rackGap, eject, load, doorOpen, doorClose, hasDoor, printerScales, useGcode])

  // Persistenz: gespeicherte Geometrie beim Laden übernehmen (einmal), Änderungen debounced speichern
  const hydrated = useRef(false)
  useEffect(() => {
    controlService.getGeometry().then(r => {
      const g = r?.data?.geometry
      if (g && g.printer_id) {
        setPrinterId(g.printer_id); setPrinterName(g.printer_name || g.printer_id)
        setEnclosed(!!g.enclosed)
        setRacks(g.racks || 1); setStorageSlots(g.storage_slots || 6); setMagazine(!!g.magazine)
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
        // Tür aus dem Speicher übernehmen; fehlt sie (offener/türloser Drucker) → leeren.
        setDoorOpen(p.door?.open || null)
        setDoorClose(p.door?.close || null)
        setPrinterScales(p.x_scales_with_racks !== false)
        if (g.use_gcode) setUseGcode(m => ({ ...m, ...g.use_gcode }))
      }
    }).catch(() => {}).finally(() => { hydrated.current = true })
  }, [])
  useEffect(() => {
    if (!hydrated.current) return
    const t = setTimeout(() => { controlService.putGeometry(geometry).catch(() => {}) }, 600)
    return () => clearTimeout(t)
  }, [geometry])

  // ── Live: OTTOeject-Operation aus der AKTUELLEN Geometrie senden ──
  const sendOp = async (op, label, extra = {}) => {
    if (jog.busy) return
    setJog({ busy: true, msg: label, err: false })
    try {
      const r = await controlService.runOp({ op, geometry, ...extra })
      if (r?.data?.script) setLastScript(r.data.script)
      setJog({ busy: false, msg: tr('✓ {0}', label), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }
  const homeOtto = () => sendOp('home', tr('Referenzfahrt…'))

  const activeCount = OPS.filter(o => useGcode[o]).length

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
                <span className="block text-[9px] text-surface-600">{p.door ? tr('geschlossen · mit Tür') : tr('offen · ohne Tür')}</span>
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
                  {activeCount === 0
                    ? tr('Farm nutzt aktuell die Geräte-Macros (keine App-Position aktiv).')
                    : tr('Farm nutzt {0} App-Position(en). Rest über Geräte-Macros.', activeCount)}
                </p>
              </div>
              <button onClick={homeOtto} disabled={jog.busy}
                className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50 shrink-0">{tr('⌂ Referenzfahrt')}</button>
            </div>
            <p className="text-[10px] text-surface-600">
              {tr('Immer erst Referenzfahrt (OTTOEJECT_HOME), dann eine Operation testen. Printloom sendet den G-code direkt aus den Werten unten.')}
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

          {/* Operations-Karten */}
          <div className="grid gap-3 md:grid-cols-2">
            {hasDoor && (
              <OpCard op="open_door" icon="🚪" title={tr('Tür öffnen')}
                busy={jog.busy} gcodeOn={useGcode.open_door} onTest={sendOp} onToggle={toggleGcode}
                fields={[
                  { label: tr('Start-X'), value: doorOpen.x, onChange: v => setDoorOpen({ ...doorOpen, x: +v }) },
                  { label: tr('Y'), value: doorOpen.y, onChange: v => setDoorOpen({ ...doorOpen, y: +v }) },
                  { label: tr('Z'), step: 0.5, value: doorOpen.z, onChange: v => setDoorOpen({ ...doorOpen, z: +v }) },
                  { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: doorOpen.d, onChange: v => setDoorOpen({ ...doorOpen, d: +v }) },
                ]} />
            )}
            {hasDoor && (
              <OpCard op="close_door" icon="🚪" title={tr('Tür schließen')}
                busy={jog.busy} gcodeOn={useGcode.close_door} onTest={sendOp} onToggle={toggleGcode}
                fields={[
                  { label: tr('Start-X'), value: doorClose.x, onChange: v => setDoorClose({ ...doorClose, x: +v }) },
                  { label: tr('Y'), value: doorClose.y, onChange: v => setDoorClose({ ...doorClose, y: +v }) },
                  { label: tr('Z'), step: 0.5, value: doorClose.z, onChange: v => setDoorClose({ ...doorClose, z: +v }) },
                  { label: tr('Pin-Abst.'), hint: tr('d_to_pin'), value: doorClose.d, onChange: v => setDoorClose({ ...doorClose, d: +v }) },
                ]} />
            )}
            <OpCard op="eject" icon="⬆" title={tr('Platte auswerfen')}
              busy={jog.busy} gcodeOn={useGcode.eject} onTest={sendOp} onToggle={toggleGcode}
              fields={[
                { label: tr('Start-X'), value: eject.x, onChange: v => setEject({ ...eject, x: +v }) },
                { label: tr('Y'), value: eject.y, onChange: v => setEject({ ...eject, y: +v }) },
                { label: tr('Z'), step: 0.5, value: eject.z, onChange: v => setEject({ ...eject, z: +v }) },
              ]} />
            <OpCard op="load" icon="⬇" title={tr('Platte einlegen')}
              busy={jog.busy} gcodeOn={useGcode.load} onTest={sendOp} onToggle={toggleGcode}
              fields={[
                { label: tr('Start-X'), value: load.x, onChange: v => setLoad({ ...load, x: +v }) },
                { label: tr('Y'), value: load.y, onChange: v => setLoad({ ...load, y: +v }) },
                { label: tr('Z'), step: 0.5, value: load.z, onChange: v => setLoad({ ...load, z: +v }) },
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
                <div className="grid grid-cols-3 gap-2">
                  <NumField label={tr('Start-X (Regal 1)')} hint={tr('x_unclamp')} value={xUnclamp} onChange={setX} />
                  <NumField label={tr('Y-Engage')} value={yEngage} onChange={setY} />
                  <NumField label={tr('Höhe Fach 1 (mm)')} hint={tr('first_z_flat')} step={0.5} value={firstZ} onChange={setFirstZ} />
                  <NumField label={tr('Fach-Abstand (mm)')} hint={tr('Z-Schritt = +30')} value={gap} onChange={setGap} />
                  <NumField label={tr('Regal-Versatz X (mm)')} hint={tr('rack_x_gap')} value={rackGap} onChange={setRackGap} />
                  <NumField label={tr('Regale')} value={racks} min={1} max={9} onChange={setRacks} />
                  <NumField label={tr('Lager-Fächer/Regal')} value={storageSlots} min={1} max={12} onChange={setStorageSlots} />
                </div>
                <div className="flex flex-wrap items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <Toggle on={magazine} onClick={() => setMagazine(v => !v)} color="bg-amber-600" />
                    <span className="text-[11px] text-surface-300">{tr('Magazin-Fach (oben, frische Platten)')}</span>
                  </label>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-surface-400">{tr('Platte')}</span>
                    {[['256', '256'], ['220', '220']].map(([v, lbl]) => (
                      <button key={v} onClick={() => setPlate(v)}
                        className={`text-[11px] px-2 py-1 rounded border ${plate === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500'}`}>{lbl}</button>
                    ))}
                  </div>
                  {(+racks || 1) > 1 && (
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <Toggle on={printerScales} onClick={() => setPrinterScales(v => !v)} />
                      <span className="text-[11px] text-surface-300">{tr('Drucker hinter letztem Regal')}</span>
                    </label>
                  )}
                </div>

                {/* Test Greifen / Ablegen */}
                <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-surface-800/50">
                  <label className="block">
                    <span className="text-[11px] text-surface-400">{tr('Regal')}</span>
                    <input type="number" min={1} max={racks} value={testRack}
                      onChange={e => setTestRack(+e.target.value)} className="w-16 text-sm font-mono mt-0.5" />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-surface-400">{tr('Fach')}</span>
                    <input type="number" min={1} max={magazineSlot || storageSlots} value={testSlot}
                      onChange={e => setTestSlot(+e.target.value)} className="w-16 text-sm font-mono mt-0.5" />
                  </label>
                  <button onClick={() => sendOp('approach', tr('Fach anfahren…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                    className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('→ Anfahren')}</button>
                  <button onClick={() => sendOp('grab', tr('Greifen…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                    className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Greifen testen')}</button>
                  <button onClick={() => sendOp('store', tr('Ablegen…'), { rack: testRack, slot: testSlot })} disabled={jog.busy}
                    className="btn btn-secondary btn-sm text-[11px] disabled:opacity-50">{tr('▶ Ablegen testen')}</button>
                </div>
                <p className="text-[9px] text-surface-600">{tr('„Anfahren" fährt nur vors Fach (greift nicht). Magazin = oberstes Fach ({0}) wird ohne Anheben gegriffen.', magazineSlot || '—')}</p>

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
