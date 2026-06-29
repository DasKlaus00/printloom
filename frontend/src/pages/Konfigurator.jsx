import React, { useState, useMemo } from 'react'
import { useLanguage } from '../services/i18n'
import RackPreview from '../components/RackPreview'

/* ── Drucker-Presets (aus OTTOmat3D printer_calibration_variables.cfg) ──────────
   eject/load: Arm-Positionen am Drucker (x = „Abstand zum Drucker"); door: Tür-Macro. */
const PRINTERS = [
  { id: 'x1c',   name: 'Bambu Lab X1C',          macro: 'BAMBULAB_X_ONE_C',     eject:{x:442,y:319,z:21},   load:{x:425,y:340,z:17.5}, door:{open:{x:104,y:319,z:105,d:370}, close:{x:103,y:322,z:105,d:375}} },
  { id: 'p1s',   name: 'Bambu Lab P1S',          macro: 'BAMBULAB_P_ONE_S',     eject:{x:412,y:323,z:20},   load:{x:412,y:323,z:20},   door:{open:{x:97,y:303,z:112,d:372},  close:{x:97,y:303,z:112,d:372}} },
  { id: 'p1p',   name: 'Bambu Lab P1P',          macro: 'BAMBULAB_P_ONE_P',     eject:{x:417,y:334,z:15},   load:{x:417,y:334,z:15},   door:null },
  { id: 'a1',    name: 'Bambu Lab A1',           macro: 'BAMBULAB_A_ONE',       eject:{x:418,y:318,z:2},    load:{x:418,y:318,z:2},    door:null },
  { id: 'k1c',   name: 'Creality K1C',           macro: 'CREALITY_K_ONE_C',     eject:{x:411,y:329,z:33.5}, load:{x:411,y:329,z:33.5}, door:{open:{x:101,y:321,z:160,d:347}, close:{x:101,y:321,z:160,d:347}} },
  { id: 'cc',    name: 'Elegoo Centauri Carbon', macro: 'ELEGOO_CC',            eject:{x:423,y:345,z:40},   load:{x:423,y:345,z:40},   door:{open:{x:102,y:326,z:160,d:382}, close:{x:102,y:326,z:160,d:382}} },
  { id: 'kobra', name: 'Anycubic Kobra S1',      macro: 'ANYCUBIC_KOBRA_S_ONE', eject:{x:421,y:344,z:12},   load:{x:421,y:344,z:12},   door:{open:{x:95,y:325,z:138,d:405},  close:{x:95,y:325,z:138,d:405}} },
  { id: 'ad5x',  name: 'Flashforge AD5X',        macro: 'FLASHFORGE_AD_FIVE_X', eject:{x:422,y:316,z:10},   load:{x:422,y:316,z:10},   door:null },
]

// Standard-Storage-Werte (aus storage_calibration_variables.cfg)
const DEFAULTS = { x_unclamp: 31, y_engage: 318, first_z_flat: 11, slot_gap: 25 }

/* ── Config-Generatoren ────────────────────────────────────────────────────── */
function genStorageCfg(s) {
  const lines = []
  lines.push('; |---- OTTOmat3D STORAGE CALIBRATION — erzeugt vom Printloom-Konfigurator ----|')
  lines.push('[gcode_macro _GLOBAL_VARS]')
  lines.push(`variable_global_x_unclamp: ${s.x_unclamp} ; X zum Entriegeln der Plattenhalterung`)
  lines.push(`variable_global_y_engage: ${s.y_engage} ; Y-Tiefe, bis die Platte in die Gabel rutscht`)
  lines.push(`variable_global_first_z_flat: ${s.first_z_flat} ; Z-Höhe von Fach 1 (Anfangshöhe)`)
  lines.push(`variable_global_slot_gap: ${s.slot_gap} ; Abstand zwischen den Fächern (Z-Schritt = slot_gap + 30)`)
  lines.push(`variable_global_y_pullback_limit: ${s.y_pullback} ; 10 = 256x256-Platte, 30 = 220x220`)
  lines.push('gcode:')
  for (let n = 1; n <= s.slots; n++) {
    const mag = n === s.magazineSlot
    lines.push('')
    lines.push(`; |---- FACH ${n}${mag ? '  (MAGAZIN — Quelle für frische Platten)' : ''} ----|`)
    lines.push(`[gcode_macro GRAB_FROM_SLOT_${n}]`)
    lines.push(`description: Platte aus Fach ${n} holen`)
    lines.push('gcode:')
    lines.push(`    M117 Grabbing bed from slot ${n}...`)
    lines.push(`    _DO_SLOT_OPERATION SLOT_NUMBER=${n} OPERATION_MACRO=_GRAB_FROM_SLOT X_UNCLAMP_OFFSET=0 Z_FLAT_OFFSET=0`)
    lines.push('')
    lines.push(`[gcode_macro STORE_TO_SLOT_${n}]`)
    lines.push(`description: Platte in Fach ${n} ablegen`)
    lines.push('gcode:')
    lines.push(`    M117 Storing to slot ${n}...`)
    lines.push(`    _DO_SLOT_OPERATION SLOT_NUMBER=${n} OPERATION_MACRO=_STORE_TO_SLOT X_UNCLAMP_OFFSET=0 Z_FLAT_OFFSET=0`)
  }
  lines.push('')
  lines.push('; |---- SLOT-OPERATION HELPER (nicht ändern) ----|')
  lines.push('[gcode_macro _DO_SLOT_OPERATION]')
  lines.push('variable_global_x_unclamp: 0')
  lines.push('variable_global_y_engage: 0')
  lines.push('variable_global_first_z_flat: 0')
  lines.push('variable_global_slot_gap: 0')
  lines.push('variable_global_y_pullback_limit: 0')
  lines.push('description: Helper macro to perform slot operations')
  lines.push('gcode:')
  lines.push('    {% set slot_number = params.SLOT_NUMBER|int %}')
  lines.push('    {% set operation_macro = params.OPERATION_MACRO|string %}')
  lines.push('    {% set x_unclamp_offset = params.X_UNCLAMP_OFFSET|int %}')
  lines.push('    {% set z_flat_offset = params.Z_FLAT_OFFSET|int %}')
  lines.push('    {% set x_unclamp = printer["gcode_macro _GLOBAL_VARS"].global_x_unclamp + x_unclamp_offset %}')
  lines.push('    {% set y_engage = printer["gcode_macro _GLOBAL_VARS"].global_y_engage %}')
  lines.push('    {% set slot_gap = printer["gcode_macro _GLOBAL_VARS"].global_slot_gap + 30 %}')
  lines.push('    {% set z_flat = printer["gcode_macro _GLOBAL_VARS"].global_first_z_flat + ((slot_number-1)*slot_gap) + z_flat_offset %}')
  lines.push('    {% set y_pullback_limit = printer["gcode_macro _GLOBAL_VARS"].global_y_pullback_limit %}')
  lines.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_x_unclamp VALUE={x_unclamp}')
  lines.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_y_engage VALUE={y_engage}')
  lines.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_z_flat VALUE={z_flat}')
  lines.push('    SET_GCODE_VARIABLE MACRO={operation_macro} VARIABLE=otto_y_pullback_limit VALUE={y_pullback_limit}')
  lines.push('    {operation_macro}')
  lines.push('    M400')
  return lines.join('\n')
}

function genPrinterCfg(p, e, l) {
  const M = p.macro
  const out = []
  out.push(`; |---- OTTOmat3D PRINTER CALIBRATION (${p.name}) — Printloom-Konfigurator ----|`)
  out.push(`[gcode_macro EJECT_FROM_${M}]`)
  out.push(`description: 'Eject build plate from ${p.name} (without homing)'`)
  out.push('gcode:')
  out.push(`    {% set x_unclamp = ${e.x} %}`)
  out.push(`    {% set y_engage = ${e.y} %}`)
  out.push(`    {% set z_flat = ${e.z} %}`)
  out.push(`    M117 'Removing build plate from ${p.name}...'`)
  if (p.door) out.push(`    OPEN_DOOR_${M}`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_x_unclamp VALUE={x_unclamp}`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_y_engage VALUE={y_engage}`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_EJECT_FROM_PRINTER VARIABLE=otto_z_flat VALUE={z_flat}`)
  out.push('    _EJECT_FROM_PRINTER')
  out.push('    M400')
  out.push('')
  out.push(`[gcode_macro LOAD_ONTO_${M}]`)
  out.push(`description: 'Load a build plate onto ${p.name}'`)
  out.push('gcode:')
  out.push(`    {% set x_unclamp = ${l.x} %}`)
  out.push(`    {% set y_engage = ${l.y} %}`)
  out.push(`    {% set z_flat = ${l.z} %}`)
  out.push(`    M117 'Moving build plate to Printer: ${p.name}'`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_x_unclamp VALUE={x_unclamp}`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_y_engage VALUE={y_engage}`)
  out.push(`    SET_GCODE_VARIABLE MACRO=_LOAD_ONTO_PRINTER VARIABLE=otto_z_flat VALUE={z_flat}`)
  out.push('    _LOAD_ONTO_PRINTER')
  out.push('    M400')
  if (p.door) out.push(`    CLOSE_DOOR_${M}`)
  if (p.door) {
    for (const [kind, d] of [['OPEN', p.door.open], ['CLOSE', p.door.close]]) {
      out.push('')
      out.push(`[gcode_macro ${kind}_DOOR_${M}]`)
      out.push(`description: '${kind === 'OPEN' ? 'Opening' : 'Closing'} ${p.name} Door'`)
      out.push('gcode:')
      out.push(`    {% set x_start = ${d.x} %}`)
      out.push(`    {% set y_start = ${d.y} %}`)
      out.push(`    {% set z_engage = ${d.z} %}`)
      out.push(`    {% set d_to_pin_dist = ${d.d} %} ; Abstand Tür-Drehpunkt zur Armspitze`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_x_start VALUE={x_start}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_y_start VALUE={y_start}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_z_engage VALUE={z_engage}`)
      out.push(`    SET_GCODE_VARIABLE MACRO=_${kind}_DOOR VARIABLE=door_d_to_pin_dist VALUE={d_to_pin_dist}`)
      out.push(`    _${kind}_DOOR`)
      out.push('    M400')
    }
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
  const [plate, setPlate]   = useState('256')       // 256 → pullback 10, 220 → 30
  const [magazine, setMagazine] = useState(true)
  const [advanced, setAdvanced] = useState(false)
  const [copied, setCopied] = useState('')

  const printer = PRINTERS.find(p => p.id === printerId) ?? PRINTERS[0]
  // Drucker-Positionen lokal überschreibbar (Abstand zum Drucker = eject.x)
  const [eject, setEject] = useState(printer.eject)
  const [load,  setLoad]  = useState(printer.load)
  // Bei Druckerwechsel die Positionen neu aus dem Preset setzen
  React.useEffect(() => { setEject(printer.eject); setLoad(printer.load) }, [printerId])  // eslint-disable-line

  const slots = (+storage || 1) + (magazine ? 1 : 0)
  const magazineSlot = magazine ? slots : null
  const yPullback = plate === '220' ? 30 : 10
  const slotStepZ = (+gap || 0) + 30

  const storageCfg = useMemo(() => genStorageCfg({
    x_unclamp: +xUnclamp, y_engage: +yEngage, first_z_flat: +firstZ, slot_gap: +gap,
    y_pullback: yPullback, slots, magazineSlot,
  }), [xUnclamp, yEngage, firstZ, gap, yPullback, slots, magazineSlot])
  const printerCfg = useMemo(() => genPrinterCfg(printer, eject, load), [printer, eject, load])

  const copy = (text, which) => {
    navigator.clipboard?.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(''), 1500) })
  }
  const download = (text, name) => {
    const blob = new Blob([text], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Konfigurator')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">{tr('Drucker & Regal einrichten → fertige Klipper-Config für die OTTOeject')}</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_1.1fr]">
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

        {/* ── Mitte: Regal/Magazin + Live-Bild ── */}
        <div className="card p-4 space-y-3 self-start">
          <p className="section-label">{tr('2 · Regal & Magazin')}</p>
          <div className="grid grid-cols-2 gap-3">
            <NumField label={tr('Regale (Schränke)')} value={racks} min={1} max={9} onChange={setRacks} />
            <NumField label={tr('Lager-Fächer je Regal')} value={storage} min={1} max={12} onChange={setStorage} />
            <NumField label={tr('Höhe Fach 1 (mm)')} hint={tr('global_first_z_flat')} value={firstZ} step={0.5} onChange={setFirstZ} />
            <NumField label={tr('Fach-Abstand (mm)')} hint={tr('global_slot_gap · Z-Schritt = +30')} value={gap} step={1} onChange={setGap} />
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

          {/* Live-Bild */}
          <div className="pt-1">
            <p className="text-[10px] uppercase tracking-wide text-surface-600 mb-1">{tr('Vorschau')}</p>
            <RackPreview numRacks={racks} slotsPerRack={slots} slotHeightMm={slotStepZ} magazineSlot={magazineSlot} />
            <p className="text-[10px] text-surface-600 mt-1">
              {tr('Drucker: {0} · {1} Fächer/Regal{2} · Fach 1 @ {3} mm · Schritt {4} mm', printer.name, slots, magazine ? tr(' (inkl. Magazin)') : '', firstZ, slotStepZ)}
            </p>
          </div>
        </div>

        {/* ── Rechts: generierte Config ── */}
        <div className="space-y-3 self-start">
          {[
            { title: tr('storage_calibration_variables.cfg'), text: storageCfg, key: 'storage', file: 'storage_calibration_variables.cfg' },
            { title: tr('printer_calibration_variables.cfg'), text: printerCfg, key: 'printer', file: 'printer_calibration_variables.cfg' },
          ].map(c => (
            <div key={c.key} className="card p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="section-label mb-0 truncate">{c.title}</p>
                <div className="flex items-center gap-1.5 shrink-0">
                  <button onClick={() => copy(c.text, c.key)} className="btn btn-ghost btn-sm text-xs">{copied === c.key ? tr('✓ Kopiert') : tr('Kopieren')}</button>
                  <button onClick={() => download(c.text, c.file)} className="btn btn-ghost btn-sm text-xs">{tr('↓ Download')}</button>
                </div>
              </div>
              <pre className="text-[10px] leading-snug font-mono text-surface-300 bg-surface-900/70 border border-surface-700/60 rounded-lg p-2.5 overflow-auto max-h-72 whitespace-pre">{c.text}</pre>
            </div>
          ))}
          <p className="text-[10px] text-surface-600 px-1">
            {tr('Diese beiden Dateien in den Klipper-Config-Ordner der OTTOeject legen (neben ottoeject_macros.cfg) und Klipper neu starten. Feinjustierung pro Fach danach in „Steuerung".')}
          </p>
        </div>
      </div>
    </div>
  )
}
