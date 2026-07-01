import React, { useState, useMemo } from 'react'
import { useLanguage } from '../services/i18n'
import { controlService } from '../services/api'
import RackDiagram, { PrinterBadge } from '../components/RackDiagram'

/* ── Drucker-Presets (aus OTTOmat3D printer_calibration_variables.cfg) ──────────
   eject/load: Arm-Positionen am Drucker (x = „Abstand zum Drucker"); door: Tür-Macro.
   Die Printloom-Farm-Sequenz ruft IMMER die festen Namen EJECT_FROM_BAMBULAB_X_ONE_C /
   LOAD_ONTO_BAMBULAB_X_ONE_C / OPEN_DOOR_BAMBU_X_ONE_C / CLOSE_DOOR_BAMBU_X_ONE_C auf —
   unabhängig vom Modell. Daher steckt das Modell nur in Werten/Beschriftung, nicht im Namen. */
const PRINTERS = [
  { id: 'x1c',   name: 'Bambu Lab X1C',          enclosed:true,  eject:{x:442,y:319,z:21},   load:{x:425,y:340,z:17.5}, door:{open:{x:104,y:319,z:105,d:370}, close:{x:103,y:322,z:105,d:375}} },
  { id: 'p1s',   name: 'Bambu Lab P1S',          enclosed:true,  eject:{x:412,y:323,z:20},   load:{x:412,y:323,z:20},   door:{open:{x:97,y:303,z:112,d:372},  close:{x:97,y:303,z:112,d:372}} },
  { id: 'p1p',   name: 'Bambu Lab P1P',          enclosed:false, eject:{x:417,y:334,z:15},   load:{x:417,y:334,z:15},   door:null },
  { id: 'a1',    name: 'Bambu Lab A1',           enclosed:false, eject:{x:418,y:318,z:2},    load:{x:418,y:318,z:2},    door:null },
  { id: 'k1c',   name: 'Creality K1C',           enclosed:true,  eject:{x:411,y:329,z:33.5}, load:{x:411,y:329,z:33.5}, door:{open:{x:101,y:321,z:160,d:347}, close:{x:101,y:321,z:160,d:347}} },
  { id: 'cc',    name: 'Elegoo Centauri Carbon', enclosed:true,  eject:{x:423,y:345,z:40},   load:{x:423,y:345,z:40},   door:{open:{x:102,y:326,z:160,d:382}, close:{x:102,y:326,z:160,d:382}} },
  { id: 'kobra', name: 'Anycubic Kobra S1',      enclosed:true,  eject:{x:421,y:344,z:12},   load:{x:421,y:344,z:12},   door:{open:{x:95,y:325,z:138,d:405},  close:{x:95,y:325,z:138,d:405}} },
  { id: 'ad5x',  name: 'Flashforge AD5X',        enclosed:true,  eject:{x:422,y:316,z:10},   load:{x:422,y:316,z:10},   door:null },
]

// Standard-Werte (aus slots.cfg)
const DEFAULTS = { x_unclamp: 43, y_engage: 335, first_z_flat: 7, slot_gap: 25, rack_x_gap: 250 }

/* ── slots.cfg — SKALIERBARE Regal-Kalibrierung ─────────────────────────────────
   Keine Pro-Fach-Macros mehr. Position wird mathematisch aus RACK+SLOT berechnet:
     X = global_x_unclamp + (rack-1)*global_rack_x_gap + rack_x_trim[rack]
     Z = global_first_z_flat + (slot-1)*(global_slot_gap+30) + rack_z_trim[rack]
   → Ein zusätzliches Regal verschiebt automatisch alles um eine Regalbreite (global_rack_x_gap).
   Aufruf wie von der Farm: GRAB_FROM_RACK RACK=2 SLOT=5  /  STORE_TO_RACK RACK=3 SLOT=1. */
function genSlotsCfg(s) {
  const L = []
  const dict = () => '{' + Array.from({ length: s.racks }, (_, i) => `${i + 1}: 0`).join(', ') + '}'
  L.push('; |---- OTTOmat3D slots.cfg — SKALIERBARE REGAL-KALIBRIERUNG (Printloom-Konfigurator) ----|')
  L.push(`; |---- ${s.racks} REGAL(E) x ${s.slots} ETAGEN${s.magazineSlot ? ` · MAGAZIN = ETAGE ${s.magazineSlot} (NOLIFT)` : ''} ----|`)
  L.push('')
  L.push('[gcode_macro _GLOBAL_VARS]')
  L.push(`variable_global_x_unclamp: ${s.x_unclamp}        ; X-LAGE ZUM ENTKLEMMEN DER PLATTE (REGAL 1)`)
  L.push(`variable_global_y_engage: ${s.y_engage}        ; Y-TIEFE, IN DER DIE PLATTE IN DIE GABEL GLEITET`)
  L.push(`variable_global_first_z_flat: ${s.first_z_flat}      ; Z-HOEHE ETAGE 1 (PLATTE EBEN ZUR GABEL)`)
  L.push(`variable_global_slot_gap: ${s.slot_gap}         ; ABSTAND (mm) ZWISCHEN DEN ETAGEN  (effektiv +30 im Helper)`)
  L.push(`variable_global_y_pullback_limit: ${s.y_pullback}  ; 5/10 FUER 256x256, 30 FUER 220x220`)
  L.push(`variable_global_rack_x_gap: ${s.rack_x_gap}      ; <-- X-VERSATZ (mm) PRO REGAL NACH RECHTS  (AUSMESSEN!)`)
  L.push(`variable_magazine_slot: ${s.magazineSlot || 0}        ; OBERSTE ETAGE = MAGAZIN (frische Platten, automatisch NOLIFT). 0 = keins`)
  L.push('gcode: ;')
  L.push('')
  L.push('; |---- OEFFENTLICHE MACROS ----|')
  L.push('; AUFRUF:  GRAB_FROM_RACK RACK=2 SLOT=5   /   STORE_TO_RACK RACK=3 SLOT=1')
  L.push(`; RACK 1-${s.racks}, SLOT 1-${s.slots}`)
  L.push('')
  L.push('[gcode_macro GRAB_FROM_RACK]')
  L.push('description: Platte aus Regal/Etage holen, z.B. GRAB_FROM_RACK RACK=2 SLOT=5 (NOLIFT=1 optional)')
  L.push('gcode:')
  L.push('    {% set rack = params.RACK|int %}')
  L.push('    {% set slot = params.SLOT|int %}')
  L.push('    {% set mag = printer["gcode_macro _GLOBAL_VARS"].magazine_slot|int %}')
  L.push('    ; Magazin-Etage automatisch ohne Anheben greifen (oder per NOLIFT=1 erzwingen)')
  L.push('    {% set nolift = 1 if (mag > 0 and slot == mag) else params.NOLIFT|default(0)|int %}')
  L.push("    {% set grab_macro = '_GRAB_FROM_SLOT_NOLIFT' if nolift == 1 else '_GRAB_FROM_SLOT' %}")
  L.push('    M117 Grab rack {rack} slot {slot}...')
  L.push('    _DO_SLOT_OPERATION RACK={rack} SLOT_NUMBER={slot} OPERATION_MACRO={grab_macro} X_UNCLAMP_OFFSET=0 Z_FLAT_OFFSET=0')
  L.push('')
  L.push('[gcode_macro STORE_TO_RACK]')
  L.push('description: Platte in Regal/Etage ablegen, z.B. STORE_TO_RACK RACK=3 SLOT=1')
  L.push('gcode:')
  L.push('    {% set rack = params.RACK|int %}')
  L.push('    {% set slot = params.SLOT|int %}')
  L.push('    M117 Store rack {rack} slot {slot}...')
  L.push('    _DO_SLOT_OPERATION RACK={rack} SLOT_NUMBER={slot} OPERATION_MACRO=_STORE_TO_SLOT X_UNCLAMP_OFFSET=0 Z_FLAT_OFFSET=0')
  L.push('')
  L.push('; |---- SLOT-OPERATION (HELPER, mathematisch — nicht pro Fach) ----|')
  L.push('[gcode_macro _DO_SLOT_OPERATION]')
  L.push('variable_global_x_unclamp: 0')
  L.push('variable_global_y_engage: 0')
  L.push('variable_global_first_z_flat: 0')
  L.push('variable_global_slot_gap: 0')
  L.push('variable_global_y_pullback_limit: 0')
  L.push('description: Helper macro to perform slot operations')
  L.push('gcode:')
  L.push('    {% set rack = params.RACK|default(1)|int %}')
  L.push('    {% set slot_number = params.SLOT_NUMBER|int %}')
  L.push('    {% set operation_macro = params.OPERATION_MACRO|string %}   ; _GRAB_FROM_SLOT / _GRAB_FROM_SLOT_NOLIFT / _STORE_TO_SLOT')
  L.push('    {% set x_unclamp_offset = params.X_UNCLAMP_OFFSET|default(0)|int %}')
  L.push('    {% set z_flat_offset = params.Z_FLAT_OFFSET|default(0)|int %}')
  L.push('')
  L.push('    ; Optionale Feinkorrektur PRO REGAL (0 = keine). Nur bei Bedarf anpassen:')
  L.push(`    {% set rack_x_trim = ${dict()} %}`)
  L.push(`    {% set rack_z_trim = ${dict()} %}`)
  L.push('')
  L.push('    {% set rack_x_gap = printer["gcode_macro _GLOBAL_VARS"].global_rack_x_gap %}')
  L.push('    ; X = Basis + Etagen-Feinjust. + Regalversatz + Regal-Feinkorrektur')
  L.push('    {% set x_unclamp = printer["gcode_macro _GLOBAL_VARS"].global_x_unclamp')
  L.push('                       + x_unclamp_offset')
  L.push('                       + ((rack-1) * rack_x_gap)')
  L.push('                       + rack_x_trim[rack] %}')
  L.push('    {% set y_engage = printer["gcode_macro _GLOBAL_VARS"].global_y_engage %}')
  L.push('    {% set slot_gap = printer["gcode_macro _GLOBAL_VARS"].global_slot_gap + 30 %}')
  L.push('    {% set z_flat = printer["gcode_macro _GLOBAL_VARS"].global_first_z_flat')
  L.push('                    + ((slot_number-1) * slot_gap)')
  L.push('                    + z_flat_offset')
  L.push('                    + rack_z_trim[rack] %}')
  L.push('    {% set y_pullback_limit = printer["gcode_macro _GLOBAL_VARS"].global_y_pullback_limit %}')
  L.push('')
  L.push('    M117 Op rack {rack} slot {slot_number}...')
  L.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_x_unclamp VALUE={x_unclamp}')
  L.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_y_engage VALUE={y_engage}')
  L.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_z_flat VALUE={z_flat}')
  L.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_y_pullback_limit VALUE={y_pullback_limit}')
  L.push('    {operation_macro}')
  L.push('    M400')
  L.push('')
  L.push('; |---- GRAB OHNE LIFT (oberste Etage / Magazin) ----|')
  L.push('[gcode_macro _GRAB_FROM_SLOT_NOLIFT]')
  L.push('variable_otto_x_unclamp: 0')
  L.push('variable_otto_y_engage: 0')
  L.push('variable_otto_z_flat: 0')
  L.push('variable_otto_y_pullback_limit: 0')
  L.push('description: Platte greifen und gerade rausziehen, OHNE Anheben')
  L.push('gcode:')
  L.push('    {% set x_unclamp = printer["gcode_macro _GRAB_FROM_SLOT_NOLIFT"].otto_x_unclamp %}')
  L.push('    {% set x_middle = x_unclamp - 30 %}')
  L.push('    {% set y_engage = printer["gcode_macro _GRAB_FROM_SLOT_NOLIFT"].otto_y_engage %}')
  L.push('    {% set z_flat = printer["gcode_macro _GRAB_FROM_SLOT_NOLIFT"].otto_z_flat %}')
  L.push('    {% set y_pullback_limit = printer["gcode_macro _GRAB_FROM_SLOT_NOLIFT"].otto_y_pullback_limit %}')
  L.push('')
  L.push('    G1 X{x_unclamp} Y280 Z{z_flat} F4000')
  L.push('    M400')
  L.push('    ; SLIDE ARM TOWARDS RACK')
  L.push('    G1 Y{y_engage-35} F4000')
  L.push('    M400')
  L.push('    G1 Y{y_engage-25} F600')
  L.push('    M400')
  L.push('    G1 Y{y_engage} F300')
  L.push('    M400')
  L.push('    ; LOCK GRABBER INTO PLATE BRACKET')
  L.push('    G1 X{x_middle} F800')
  L.push('    M400')
  L.push('    ; PULL OUT BED (OHNE LIFT — horizontal auf z_flat)')
  L.push('    M117 Picking up new bed (no lift)...')
  L.push('    G1 Y250 F1000')
  L.push('    M400')
  L.push('    G1 Y{y_pullback_limit} F2000')
  L.push('    M400')
  return L.join('\n')
}

/* ── printer_calibration_variables.cfg ──────────────────────────────────────────
   Feste Macro-Namen (…_X_ONE_C) — exakt die, die die Printloom-Farm-Sequenz aufruft. */
function genPrinterCfg(p, e, l) {
  const out = []
  out.push(`; |---- OTTOmat3D printer_calibration_variables.cfg — ${p.name} (Printloom-Konfigurator) ----|`)
  out.push('; Feste Macro-Namen (…_X_ONE_C): die Printloom-Farm-Sequenz ruft genau diese auf.')
  out.push('')
  out.push('[gcode_macro EJECT_FROM_BAMBULAB_X_ONE_C]')
  out.push(`description: 'Eject build plate from ${p.name} (without homing)'`)
  out.push('gcode:')
  out.push(`    {% set x_unclamp = ${e.x} %}`)
  out.push(`    {% set y_engage = ${e.y} %}`)
  out.push(`    {% set z_flat = ${e.z} %}`)
  out.push(`    M117 'Removing build plate from ${p.name}...'`)
  out.push('    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_x_unclamp VALUE={x_unclamp}')
  out.push('    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_y_engage VALUE={y_engage}')
  out.push('    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_z_flat VALUE={z_flat}')
  out.push('    _EJECT_FROM_PRINTER')
  out.push('    M400')
  out.push('')
  out.push('[gcode_macro LOAD_ONTO_BAMBULAB_X_ONE_C]')
  out.push(`description: 'Load a build plate onto ${p.name}'`)
  out.push('gcode:')
  out.push(`    {% set x_unclamp = ${l.x} %}`)
  out.push(`    {% set y_engage = ${l.y} %}`)
  out.push(`    {% set z_flat = ${l.z} %}`)
  out.push(`    M117 'Moving build plate to Printer: ${p.name}'`)
  out.push('    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_x_unclamp VALUE={x_unclamp}')
  out.push('    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_y_engage VALUE={y_engage}')
  out.push('    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_z_flat VALUE={z_flat}')
  out.push('    _LOAD_ONTO_PRINTER')
  out.push('    M400')
  if (p.door) {
    for (const [kind, d, verb] of [['OPEN', p.door.open, 'Opening'], ['CLOSE', p.door.close, 'Closing']]) {
      out.push('')
      out.push(`[gcode_macro ${kind}_DOOR_BAMBU_X_ONE_C]`)
      out.push(`description: '${verb} ${p.name} Door'`)
      out.push('gcode:')
      out.push(`    {% set x_start = ${d.x} %}`)
      out.push(`    {% set y_start = ${d.y} %}`)
      out.push(`    {% set z_engage = ${d.z} %}`)
      out.push(`    {% set d_to_pin_dist = ${d.d} %} ; Abstand Tür-Drehpunkt → Armspitze`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_x_start VALUE={x_start}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_y_start VALUE={y_start}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_z_engage VALUE={z_engage}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_d_to_pin_dist VALUE={d_to_pin_dist}`)
      out.push(`    M117 '${verb} ${p.name} Door'`)
      out.push(`    _${kind}_DOOR`)
      out.push('    M400')
    }
  } else {
    out.push('')
    out.push(`; (${p.name} hat kein Tür-Macro — OPEN/CLOSE_DOOR entfallen. Türschritte in der Sequenz weglassen.)`)
  }
  return out.join('\n')
}

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

export default function Konfigurator() {
  const { tr } = useLanguage()
  const [printerId, setPrinterId] = useState('x1c')
  const [racks, setRacks]   = useState(1)
  const [storage, setStorage] = useState(6)         // Lager-Fächer pro Regal
  const [firstZ, setFirstZ] = useState(DEFAULTS.first_z_flat)
  const [gap, setGap]       = useState(DEFAULTS.slot_gap)
  const [xUnclamp, setX]    = useState(DEFAULTS.x_unclamp)
  const [yEngage, setY]     = useState(DEFAULTS.y_engage)
  const [rackGap, setRackGap] = useState(DEFAULTS.rack_x_gap)   // global_rack_x_gap (Regal-Raster)
  const [rackWidth, setRackWidth] = useState(DEFAULTS.rack_x_gap - 20)  // Regalbreite (nur fürs Bau-Schema)
  const [plate, setPlate]   = useState('256')       // 256 → pullback 5, 220 → 30
  const [magazine, setMagazine] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [copied, setCopied] = useState('')
  const [jog, setJog] = useState({ busy: false, msg: '', err: false })

  const printer = PRINTERS.find(p => p.id === printerId) ?? PRINTERS[0]
  // Drucker-Positionen lokal überschreibbar (Abstand zum Drucker = eject.x)
  const [eject, setEject] = useState(printer.eject)
  const [load,  setLoad]  = useState(printer.load)
  // Bei Druckerwechsel die Positionen neu aus dem Preset setzen
  React.useEffect(() => { setEject(printer.eject); setLoad(printer.load) }, [printerId])  // eslint-disable-line

  const slots = (+storage || 1) + (magazine ? 1 : 0)
  const magazineSlot = magazine ? slots : null
  const yPullback = plate === '220' ? 30 : 5
  const slotStepZ = (+gap || 0) + 30

  const slotsCfg = useMemo(() => genSlotsCfg({
    x_unclamp: +xUnclamp, y_engage: +yEngage, first_z_flat: +firstZ, slot_gap: +gap,
    y_pullback: yPullback, rack_x_gap: +rackGap, slots, racks: +racks || 1, magazineSlot,
  }), [xUnclamp, yEngage, firstZ, gap, yPullback, rackGap, slots, racks, magazineSlot])
  const printerCfg = useMemo(() => genPrinterCfg(printer, eject, load), [printer, eject, load])

  const copy = (text, which) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(''), 1500) })
  }
  const download = (text, name) => {
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
    URL.revokeObjectURL(a.href)
  }

  // ── Live: ein Fach am echten OTTOeject anfahren (gleiche Mathematik wie slots.cfg) ──
  const sendG = async (gcode, label) => {
    setJog({ busy: true, msg: label, err: false })
    try {
      await controlService.sendKlipperGcode(gcode)
      setJog({ busy: false, msg: tr('✓ {0}', label), err: false })
    } catch (e) {
      const detail = e?.response?.data?.detail || e?.message || tr('Fehler')
      setJog({ busy: false, msg: detail, err: true })
    }
  }
  const homeOtto = () => sendG('OTTOEJECT_HOME', tr('Referenzfahrt…'))
  const approachSlot = (rack, slot) => {
    if (jog.busy) return
    const x = (+xUnclamp) + (rack - 1) * (+rackGap || 0)
    const z = (+firstZ) + (slot - 1) * slotStepZ
    // Sicher: vor das Fach fahren (Y zurückgezogen), in Fachhöhe — greift NICHT.
    sendG(`G90\nG1 X${x} Y280 Z${z} F3000`, tr('Regal {0} · Fach {1} anfahren…', rack, slot))
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Konfigurator')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">{tr('Drucker & Regal einrichten → fertige Klipper-Config für die OTTOeject')}</p>
      </div>

      {/* Drucker + Regal nebeneinander oben */}
      <div className="grid gap-4 lg:grid-cols-[240px_1fr] items-start">
        {/* ── Links: Drucker wählen ── */}
        <div className="card p-3 space-y-1.5 self-start">
          <p className="section-label">{tr('1 · Drucker')}</p>
          {PRINTERS.map(p => (
            <button key={p.id} onClick={() => setPrinterId(p.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border text-sm transition-colors ${
                printerId === p.id ? 'border-blue-600 bg-blue-950/40 text-blue-200'
                                   : 'border-surface-700 text-surface-400 hover:border-surface-600 hover:text-surface-200'}`}>
              {p.name}
              <span className="block text-[9px] text-surface-600">{p.door ? tr('mit Tür-Macro') : tr('ohne Tür')}</span>
            </button>
          ))}
        </div>

        {/* ── Mitte: Regal/Magazin + Live-Vorschau ── */}
        <div className="card p-4 space-y-3 self-start">
          <p className="section-label">{tr('2 · Regal & Magazin')}</p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={tr('Regale (Schränke)')} value={racks} min={1} max={9} onChange={setRacks} />
            <NumField label={tr('Lager-Fächer je Regal')} value={storage} min={1} max={12} onChange={setStorage} />
            <NumField label={tr('Höhe Fach 1 (mm)')} hint={tr('global_first_z_flat')} value={firstZ} step={0.5} onChange={setFirstZ} />
            <NumField label={tr('Fach-Abstand (mm)')} hint={tr('global_slot_gap · Z-Schritt = +30')} value={gap} step={1} onChange={setGap} />
            <NumField label={tr('Regal-Versatz X (mm)')} hint={tr('global_rack_x_gap · Raster Anfang→Anfang')} value={rackGap} step={1} onChange={setRackGap} />
            <NumField label={tr('Regalbreite (mm)')} hint={tr('nur fürs Bau-Schema · lichte Weite = Raster − 20')} value={rackWidth} step={1} onChange={setRackWidth} />
          </div>

          <label className="flex items-center gap-2 cursor-pointer select-none">
            <button type="button" onClick={() => setMagazine(v => !v)}
              className={`relative w-9 h-5 rounded-full transition-colors ${magazine ? 'bg-amber-600' : 'bg-surface-700'}`}>
              <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${magazine ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
            <span className="text-sm text-surface-300">{tr('Magazin-Fach (oben, für frische Platten)')}</span>
          </label>

          <div>
            <span className="text-[11px] text-surface-400 block mb-1">{tr('Plattengröße')}</span>
            <div className="flex gap-2">
              {[['256', '256 × 256'], ['220', '220 × 220']].map(([v, lbl]) => (
                <button key={v} onClick={() => setPlate(v)}
                  className={`flex-1 text-xs px-2 py-1.5 rounded-lg border ${plate === v ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500'}`}>{lbl}</button>
              ))}
            </div>
          </div>

          {/* Drucker-Positionen (Abstand zum Drucker) */}
          <button onClick={() => setAdvanced(a => !a)} className="text-[11px] text-blue-400 hover:text-blue-300">
            {advanced ? tr('▾ Drucker-Positionen ausblenden') : tr('▸ Drucker-Positionen (Abstand zum Drucker) …')}
          </button>
          {advanced && (
            <div className="grid grid-cols-3 gap-2 p-2 rounded-lg bg-surface-900/60 border border-surface-700/60">
              <NumField label={tr('Auswurf X')} hint={tr('Abstand z. Drucker')} value={eject.x} onChange={v => setEject({ ...eject, x: +v })} />
              <NumField label={tr('Auswurf Y')} value={eject.y} onChange={v => setEject({ ...eject, y: +v })} />
              <NumField label={tr('Auswurf Z')} value={eject.z} step={0.5} onChange={v => setEject({ ...eject, z: +v })} />
              <NumField label={tr('Einlegen X')} value={load.x} onChange={v => setLoad({ ...load, x: +v })} />
              <NumField label={tr('Einlegen Y')} value={load.y} onChange={v => setLoad({ ...load, y: +v })} />
              <NumField label={tr('Einlegen Z')} value={load.z} step={0.5} onChange={v => setLoad({ ...load, z: +v })} />
              <NumField label={tr('X-Unclamp')} value={xUnclamp} onChange={setX} />
              <NumField label={tr('Y-Engage')} value={yEngage} onChange={setY} />
            </div>
          )}

          {/* Live-Vorschau: Schema mit Drucker-Piktogramm + Abständen, Fächer anklickbar → anfahren */}
          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-wide text-surface-600 mb-1">{tr('Vorschau')}</p>
            <RackDiagram printerName={printer.name} enclosed={printer.enclosed}
              numRacks={racks} slotsPerRack={slots} magazineSlot={magazineSlot}
              slotStepMm={slotStepZ} rackGapMm={+rackGap || 0} rackWidthMm={+rackWidth || 0}
              printerGapMm={Math.round(Math.abs((+load.x) - (+xUnclamp)))}
              onSlotClick={approachSlot} busy={jog.busy} />
            <p className="text-[10px] text-surface-600 mt-1">
              {tr('Drucker: {0} · {1} Fächer/Regal{2} · Fach 1 @ {3} mm · Schritt {4} mm', printer.name, slots, magazine ? tr(' (inkl. Magazin)') : '', firstZ, slotStepZ)}
            </p>
          </div>

          {/* Live-Aktionen am echten OTTOeject */}
          <div className="pt-2 border-t border-surface-700/50 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] text-surface-400">{tr('Live-Aktionen (OTTOeject)')}</p>
              <button onClick={homeOtto} disabled={jog.busy}
                className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('⌂ Referenzfahrt')}</button>
            </div>
            <p className="text-[10px] text-surface-600">
              {tr('Erst Referenzfahrt. Dann im Bild ein Fach anklicken (Arm fährt davor, greift nicht) oder eine Drucker-Aktion wählen.')}
            </p>
            <div className="flex items-center gap-2">
              <div className="shrink-0 rounded-md border border-blue-800/50 bg-blue-950/30 p-1" title={printer.name}>
                <PrinterBadge enclosed={printer.enclosed} size={38} />
              </div>
              <div className="grid grid-cols-2 gap-1.5 flex-1">
                {printer.door && <button onClick={() => sendG('OPEN_DOOR_BAMBU_X_ONE_C', tr('Tür öffnen…'))} disabled={jog.busy} className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('🚪 Tür öffnen')}</button>}
                {printer.door && <button onClick={() => sendG('CLOSE_DOOR_BAMBU_X_ONE_C', tr('Tür schließen…'))} disabled={jog.busy} className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('🚪 Tür schließen')}</button>}
                <button onClick={() => sendG('EJECT_FROM_BAMBULAB_X_ONE_C', tr('Platte rausholen…'))} disabled={jog.busy} className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('⬆ Platte rausholen')}</button>
                <button onClick={() => sendG('LOAD_ONTO_BAMBULAB_X_ONE_C', tr('Platte einlegen…'))} disabled={jog.busy} className="btn btn-ghost btn-sm text-[11px] disabled:opacity-50">{tr('⬇ Platte einlegen')}</button>
              </div>
            </div>
            {!printer.door && <p className="text-[9px] text-surface-600">{tr('{0} hat kein Tür-Macro — Tür-Aktionen entfallen.', printer.name)}</p>}
            {jog.msg && <p className={`text-[10px] font-mono ${jog.err ? 'text-red-400' : jog.busy ? 'text-amber-400' : 'text-emerald-400'}`}>{jog.msg}</p>}
            <p className="text-[9px] text-surface-600">{tr('Drucker-Aktionen brauchen die aufgespielte printer_calibration_variables.cfg + eine Referenzfahrt.')}</p>
          </div>
        </div>

      </div>

      {/* ── Generierte Config: volle Breite darunter, beide Dateien nebeneinander ── */}
      <div className="space-y-2">
        <div className="grid gap-4 lg:grid-cols-2">
          {[
            { title: 'slots.cfg', text: slotsCfg, key: 'slots', file: 'slots.cfg' },
            { title: 'printer_calibration_variables.cfg', text: printerCfg, key: 'printer', file: 'printer_calibration_variables.cfg' },
          ].map(c => (
            <div key={c.key} className="card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="section-label mb-0 truncate">{c.title}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => copy(c.text, c.key)} className="btn btn-ghost btn-sm text-xs">{copied === c.key ? tr('✓ Kopiert') : tr('Kopieren')}</button>
                  <button onClick={() => download(c.text, c.file)} className="btn btn-ghost btn-sm text-xs">{tr('↓ Download')}</button>
                </div>
              </div>
              <pre className="text-[10px] leading-snug font-mono text-surface-300 bg-surface-900/70 border border-surface-700/60 rounded-lg p-2.5 overflow-auto max-h-[32rem] whitespace-pre">{c.text}</pre>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-surface-600 px-1">
          {tr('Beide Dateien in den Klipper-Config-Ordner der OTTOeject legen (neben ottoeject_macros.cfg, in printer.cfg per [include slots.cfg] einbinden) und Klipper neu starten. Ein zusätzliches Regal verschiebt automatisch alles um „Regal-Versatz X".')}
        </p>
      </div>
    </div>
  )
}
