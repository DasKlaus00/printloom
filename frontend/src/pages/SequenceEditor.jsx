import React, { useState, useEffect } from 'react'
import { DEFAULT_SEQ_NEW, DEFAULT_SEQ_NEXT } from '../services/sequenceData'
import { autofarmService, controlService } from '../services/api'
import { useLanguage, tr as translate, currentLang } from '../services/i18n'

// Printloom-eigene Operationen (Drucker-Tab-Geometrie → G-code) — frei in Sequenzen
// nutzbar wie Makros. Fallback, falls das /app-ops-Backend (noch) nicht da ist.
const APP_OP_FALLBACK = [
  { key: 'open_door',       label_de: 'Tür öffnen',         label_en: 'Open door' },
  { key: 'close_door',      label_de: 'Tür schließen',      label_en: 'Close door' },
  { key: 'move_to_printer', label_de: 'Vor Drucker fahren', label_en: 'Move to printer' },
  { key: 'eject',           label_de: 'Auswerfen',          label_en: 'Eject plate' },
  { key: 'place',           label_de: 'Einlegen',           label_en: 'Place plate' },
  { key: 'grab',            label_de: 'Platte holen',       label_en: 'Grab from rack' },
  { key: 'grab_magazine',   label_de: 'Aus Magazin holen',  label_en: 'Grab from magazine' },
  { key: 'store',           label_de: 'Platte ablegen',     label_en: 'Store to rack' },
]
let _appOpsCache = null
function useAppOps() {
  const [ops, setOps] = useState(_appOpsCache || APP_OP_FALLBACK)
  useEffect(() => {
    if (_appOpsCache) return
    controlService.listAppOps()
      .then(r => { const o = r?.data?.ops; if (Array.isArray(o) && o.length) { _appOpsCache = o; setOps(o) } })
      .catch(() => {})
  }, [])
  return ops
}
/* Das Backend liefert zu jeder Operation label_de UND label_en mit — bisher wurde
   immer label_de genommen, die englische Bezeichnung lag ungenutzt herum. Für
   andere Sprachen greift tr() auf den deutschen Quelltext als Schlüssel. */
const opLabel = (o) => {
  if (!o) return ''
  return (currentLang() === 'en' && o.label_en) ? o.label_en : translate(o.label_de || '')
}
const appOpLabel = (ops, key) => opLabel(ops.find(o => o.key === key)) || key

// FastAPI-Fehler robust in Text wandeln: `detail` kann ein String, eine Pydantic-
// Validierungsliste [{type,loc,msg,…}] oder ein Objekt sein. NIE direkt rendern —
// ein Objekt als React-Child löst „Minified React error #31" aus.
function errText(e) {
  const d = e?.response?.data?.detail
  if (typeof d === 'string') return d
  if (Array.isArray(d)) return d.map(x => x?.msg || (typeof x === 'string' ? x : JSON.stringify(x))).join('; ')
  if (d && typeof d === 'object') return d.msg || JSON.stringify(d)
  return e?.message || translate('Fehler')
}

const TYPE_META = {
  macro:          { label: 'OTTOeject Makro',  icon: '▶',    color: 'text-violet-400',  bg: 'bg-violet-950/20',  border: 'border-violet-900/40' },
  app_op:         { label: 'Printloom-Op',     icon: '◆',    color: 'text-fuchsia-400', bg: 'bg-fuchsia-950/20', border: 'border-fuchsia-900/40' },
  klipper_gcode:  { label: 'OTTOeject GCode',  icon: '⌘',    color: 'text-teal-400',    bg: 'bg-teal-950/20',    border: 'border-teal-900/40'   },
  gcode:          { label: 'Bambu GCode',      icon: '</>',  color: 'text-blue-400',    bg: 'bg-blue-950/20',    border: 'border-blue-900/40'   },
  bambu_move:     { label: 'Bambu Position Z', icon: '↕',    color: 'text-cyan-400',    bg: 'bg-cyan-950/20',    border: 'border-cyan-900/40'   },
  send_homing_file:{ label: 'Bambu Homing',    icon: '⌂',    color: 'text-indigo-400',  bg: 'bg-indigo-950/20',  border: 'border-indigo-900/40'  },
  wait_homing:    { label: 'Auf Z200 warten',  icon: '⌂⏳',  color: 'text-indigo-400',  bg: 'bg-indigo-950/20',  border: 'border-indigo-900/40'  },
  send_file:      { label: 'Druckdatei senden',icon: '↑',    color: 'text-emerald-400', bg: 'bg-emerald-950/20', border: 'border-emerald-900/50' },
  wait_print:     { label: 'Auf Druckende warten', icon: '⏳', color: 'text-sky-400',   bg: 'bg-sky-950/20',    border: 'border-sky-900/50'   },
  wait_cool:      { label: 'Auf Abkühlung warten', icon: '❄', color: 'text-sky-300',  bg: 'bg-sky-950/20',    border: 'border-sky-900/40'   },
  delay:          { label: 'Wartezeit',        icon: '⏱',   color: 'text-amber-400',   bg: 'bg-amber-950/20',   border: 'border-amber-900/40'  },
  // ── Legacy types (still rendered for old sequences, but not offered in the add menu) ──
  wait_bambu_idle:{ label: 'Bambu IDLE (alt)', icon: '◎',    color: 'text-cyan-400',    bg: 'bg-cyan-950/20',    border: 'border-cyan-900/40'   },
  send_file_fixed:{ label: 'Feste Datei',      icon: '⇪',    color: 'text-indigo-400',  bg: 'bg-indigo-950/20',  border: 'border-indigo-900/40'  },
  wait_pause:        { label: 'Warten (PAUSE)',  icon: '⏸',   color: 'text-yellow-400', bg: 'bg-yellow-950/20', border: 'border-yellow-900/40' },
  wait_print_failed: { label: 'Warten (FAILED)', icon: '✗',   color: 'text-red-400',    bg: 'bg-red-950/20',    border: 'border-red-900/40'   },
  clear_error:       { label: 'Fehler quit.',    icon: '⚠',   color: 'text-orange-400', bg: 'bg-orange-950/20', border: 'border-orange-900/40'},
}

// Curated building blocks offered in the "+ add step" menu (legacy types omitted).
// First Start: kein send_file/wait_print (das ist Sache des Zyklus), dafür Homing + Z200-Warten.
// Zyklus: kein Homing-Paar (gehört in den First Start) — hält beide Menüs klar und kurz.
const ADD_TYPES = ['macro', 'app_op', 'klipper_gcode', 'gcode', 'bambu_move', 'send_homing_file', 'wait_homing', 'send_file', 'wait_print', 'wait_cool', 'delay']
const FIRST_ADD_TYPES = ['macro', 'app_op', 'klipper_gcode', 'gcode', 'bambu_move', 'send_homing_file', 'wait_homing', 'delay']
const CYCLE_ADD_TYPES = ['macro', 'app_op', 'klipper_gcode', 'gcode', 'bambu_move', 'send_file', 'wait_print', 'wait_cool', 'delay']

// Griff-Schritt (Platte aus Regal/Magazin holen) — für den Übergabe-Marker:
// holt der First Start bereits eine Platte, überspringt der Zyklus GENAU diesen Schritt beim 1. Job.
const isGrabStep = (s) => !s.disabled && (
  (s.type === 'macro' && /GRAB_FROM_RACK|GRAB_FROM_SLOT_/i.test(s.value || '')) ||
  (s.type === 'app_op' && ['grab', 'grab_magazine'].includes(s.value))
)

/* ─── Individual step block ──────────────────────────────────── */
function StepBlock({ step, idx, total, onChange, onMove, onDelete, onTogglePar, onToggleDisabled,
                     onDragStart, onDragEnd, onDragOver, onDrop, isDragOver, onRun,
                     allowPrep = false, handover = false }) {
  const { tr } = useLanguage()
  const appOps = useAppOps()
  const [open, setOpen] = useState(false)
  const [running, setRunning] = useState(false)
  const isDisabled = !!step.disabled
  const canRun = (step.type === 'macro' || step.type === 'klipper_gcode' || step.type === 'app_op') && step.value
  const meta  = TYPE_META[step.type] ?? TYPE_META.macro
  const fixed = false

  return (
    <div
      onDragOver={e => { e.preventDefault(); onDragOver?.(step.id) }}
      onDrop={e    => { e.preventDefault(); onDrop?.(step.id) }}
    >
      {/* Drop indicator line */}
      {isDragOver && <div className="h-0.5 bg-blue-500 rounded-full mx-1 mb-1" />}
      {/* Handover marker: where First Start hands over into the cycle (job 1) */}
      {handover && (
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[9px] font-mono text-emerald-500/90 select-none"
          title={tr('First Start hat die Platte schon geholt und wartet vor dem Drucker (Tür offen). Beim 1. Job überspringt der Zyklus deshalb alles bis einschließlich diesem Griff und macht direkt danach weiter. Ab Job 2 läuft der Zyklus komplett — der Griff ist KEINE Dopplung.')}>
          <span className="flex-1 border-t border-dashed border-emerald-800/60" />
          <span>⇢ {tr('Job 1 überspringt alles bis inkl. diesem Griff (First Start übergibt) — ab Job 2 läuft der Zyklus komplett')}</span>
          <span className="w-4 border-t border-dashed border-emerald-800/60" />
        </div>
      )}
      <div className={`rounded-lg border transition-colors ${
        isDisabled
          ? 'border-surface-700/50 bg-surface-900/40'
          : `${meta.bg} ${meta.border}`
      }`}>
        {/* Header row */}
        <div className="flex items-center gap-1.5 px-2.5 py-2">
          {/* Type icon */}
          <span className={`text-[11px] font-mono w-4 text-center shrink-0 select-none ${isDisabled ? 'text-surface-700' : meta.color}`}>
            {meta.icon}
          </span>

          {/* Label */}
          {/* Die Bezeichnung ist gespeicherte Sequenz-Daten (deutsch angelegt) und
              bleibt es auch — übersetzt wird nur die ANZEIGE. Das Eingabefeld unten
              zeigt weiter den echten gespeicherten Text. */}
          <span className={`text-xs font-mono flex-1 min-w-0 truncate ${isDisabled ? 'text-surface-700 line-through' : meta.color}`}>
            {tr(step.label)}
          </span>

          {/* Disabled badge */}
          {isDisabled && (
            <span className="text-[8px] font-mono text-surface-600 border border-surface-700/60 px-1 rounded shrink-0 select-none">OFF</span>
          )}

          {/* Inline preview */}
          {step.type === 'delay' && (
            <span className="text-[10px] text-surface-500 font-mono shrink-0">{step.seconds}s</span>
          )}
          {step.type === 'wait_bambu_idle' && (
            <span className="text-[10px] text-surface-500 font-mono shrink-0">max {step.seconds || 120}s</span>
          )}
          {!open && (step.type === 'macro' || step.type === 'gcode') && step.value && (
            <span className="text-[9px] text-surface-700 font-mono truncate max-w-[110px] shrink-0">
              {step.value.replace(/\n/g, ' · ')}
            </span>
          )}
          {!open && step.type === 'app_op' && step.value && (
            <span className="text-[9px] text-fuchsia-700 font-mono truncate max-w-[130px] shrink-0">
              {appOpLabel(appOps, step.value)}
            </span>
          )}
          {step.type === 'send_file_fixed' && step.value && (
            <span className="text-[10px] text-surface-500 font-mono shrink-0">ID {step.value}</span>
          )}

          {/* Parallel badge */}
          {step.parallel && (
            <span className="text-[9px] font-mono text-blue-400 border border-blue-800/60 px-1 rounded shrink-0 select-none">∥</span>
          )}

          {/* Pre-position badge (never for wait_print/send_file) */}
          {step.prep && !['wait_print', 'send_file', 'wait_homing'].includes(step.type) && (
            <span className="text-[9px] font-mono text-blue-400 border border-blue-800/60 px-1 rounded shrink-0 select-none"
              title={tr('Wird ~1 Min vor Druckende vorgezogen')}>⏱</span>
          )}

          {/* Homing runs in the background (nowait) badge */}
          {step.type === 'send_homing_file' && !!step.nowait && (
            <span className="text-[9px] font-mono text-indigo-400 border border-indigo-800/60 px-1 rounded shrink-0 select-none"
              title={tr('Wartet nicht — Drucker homet im Hintergrund („Auf Z200 warten" holt das Ergebnis ab)')}>⏩</span>
          )}

          {!fixed && (
            <div className="flex items-center gap-0 shrink-0 ml-1">
              {/* Single-step run button */}
              {canRun && (
                <button
                  onClick={async e => {
                    e.stopPropagation()
                    if (running) return
                    setRunning(true)
                    try { await onRun?.(step) } finally { setRunning(false) }
                  }}
                  title={tr('Einzeln ausführen: {0}', step.value)}
                  disabled={running}
                  className={`w-6 h-5 flex items-center justify-center text-[11px] rounded transition-colors select-none border ${
                    running
                      ? 'text-blue-400 border-blue-700/60 bg-blue-900/20 animate-pulse'
                      : 'text-emerald-500 border-emerald-800/60 hover:bg-emerald-900/20'
                  }`}
                >▶</button>
              )}
              {/* Disable/enable toggle */}
              <button
                onClick={e => { e.stopPropagation(); onToggleDisabled?.(step.id) }}
                title={isDisabled ? tr('Schritt aktivieren') : tr('Schritt deaktivieren')}
                className={`w-6 h-5 flex items-center justify-center text-[10px] font-mono rounded transition-colors select-none border ${
                  isDisabled
                    ? 'text-surface-600 border-surface-700/40 hover:text-emerald-400 hover:border-emerald-800/60'
                    : 'text-surface-400 border-surface-700/30 hover:text-red-400 hover:border-red-800/60'
                }`}
              >{isDisabled ? 'off' : 'on'}</button>
              <button
                onClick={() => onTogglePar(step.id)}
                title={tr('Parallel mit vorherigem Schritt ausführen')}
                className={`w-5 h-5 flex items-center justify-center text-[10px] rounded transition-colors select-none ${
                  step.parallel ? 'text-blue-400 bg-blue-900/40' : 'text-surface-700 hover:text-surface-400'
                }`}
              >∥</button>
              <button
                onClick={() => setOpen(v => !v)}
                className="w-5 h-5 flex items-center justify-center text-[10px] text-surface-700 hover:text-surface-400 select-none"
                title={tr('Bearbeiten')}
              >{open ? '△' : '▽'}</button>
              <button
                onClick={() => onMove(step.id, -1)} disabled={idx === 0}
                className="w-5 h-5 flex items-center justify-center text-[11px] text-surface-700 hover:text-surface-300 disabled:opacity-20 select-none"
                title={tr('Nach oben')}
              >▲</button>
              <button
                onClick={() => onMove(step.id, 1)} disabled={idx === total - 1}
                className="w-5 h-5 flex items-center justify-center text-[11px] text-surface-700 hover:text-surface-300 disabled:opacity-20 select-none"
                title={tr('Nach unten')}
              >▼</button>
              <button
                onClick={() => onDelete(step.id)}
                className="w-5 h-5 flex items-center justify-center text-[11px] text-surface-700 hover:text-red-400 select-none"
                title={tr('Löschen')}
              >×</button>
            </div>
          )}

          {/* Drag handle — right edge */}
          {!fixed && (
            <div
              draggable={true}
              onDragStart={e => { e.stopPropagation(); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text', String(step.id)); onDragStart?.(step.id) }}
              onDragEnd={e => { e.stopPropagation(); onDragEnd?.() }}
              title={tr('Schritt verschieben')}
              className="flex items-center justify-center w-5 h-7 cursor-grab active:cursor-grabbing select-none border-l border-surface-700/30 ml-1 pl-1 text-surface-700 hover:text-surface-400 shrink-0"
            >
              <svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor">
                <circle cx="2" cy="2"  r="1.2"/><circle cx="6" cy="2"  r="1.2"/>
                <circle cx="2" cy="7"  r="1.2"/><circle cx="6" cy="7"  r="1.2"/>
                <circle cx="2" cy="12" r="1.2"/><circle cx="6" cy="12" r="1.2"/>
              </svg>
            </div>
          )}
        </div>

        {/* Expanded edit area */}
        {open && (
          <div className="px-2.5 pb-2.5 pt-2 space-y-2 border-t border-surface-800/40">
            <div>
              <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Bezeichnung')}</label>
              <input
                type="text"
                value={step.label}
                onChange={e => onChange(step.id, { label: e.target.value })}
                className="w-full text-xs font-mono"
              />
            </div>

            {step.type === 'send_homing_file' && (
              <div className="space-y-1 py-1">
                <p className="text-[10px] text-indigo-600 font-mono">
                  {tr('Sendet G28 + schnelles Z200 (F3000) als Mini-Druck — die Datei wird automatisch frisch erzeugt.')}
                </p>
                <label className="flex items-center gap-1.5 text-[10px] text-surface-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={!!step.nowait}
                    onChange={e => onChange(step.id, { nowait: e.target.checked })}
                  />
                  {tr('⏩ Nicht warten — Drucker homet im Hintergrund, OTTOeject arbeitet parallel weiter (danach Schritt „Auf Z200 warten" einplanen!)')}
                </label>
              </div>
            )}

            {step.type === 'wait_cool' && (
              <div className="space-y-2">
                <p className="text-[10px] text-sky-600/90 leading-relaxed">
                  {tr('Wartet, bis die Druckplatte abgekühlt ist. Der Magnet-Greifer hält eine warme Platte nicht — der Arm führe los, die Platte bliebe im Drucker liegen und er käme leer zurück, ohne dass es auffällt. Gehört VOR den Auswurf.')}
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Zieltemperatur (°C)')}</label>
                    <input
                      type="number" min="0" max="120" value={step.value ?? ''}
                      onChange={e => onChange(step.id, { value: e.target.value })}
                      placeholder="30" className="w-24 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Zeitlimit (s)')}</label>
                    <input
                      type="number" min="0" value={step.seconds ?? ''}
                      onChange={e => onChange(step.id, { seconds: e.target.value })}
                      placeholder="1800" className="w-24 text-xs font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-surface-700 flex-1 min-w-[12rem] leading-relaxed">
                    {tr('Leer = Vorgabe (30 °C / 30 min). Läuft das Zeitlimit ab, geht es TROTZDEM weiter — ein Zyklus, der ewig steht, wäre schlimmer. Im Verlauf steht dann, mit welcher Temperatur.')}
                  </p>
                </div>
              </div>
            )}

            {step.type === 'wait_homing' && (
              <p className="text-[10px] text-indigo-600 font-mono py-1">
                {tr('Wartet, bis der im Hintergrund gestartete Homing-Druck fertig ist (Bett wirklich auf Z200) — gehört ans Ende des First Start, wenn beim Homing-Schritt „Nicht warten" aktiv ist.')}
              </p>
            )}

            {step.type === 'send_file_fixed' && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-surface-600 block mb-0.5">
                    {tr('Datei-ID')}
                    <span className="text-surface-700 ml-1">{tr('· Dateiliste → ID der hochgeladenen Homing-.3mf')}</span>
                  </label>
                  <input
                    type="number" min="1" value={step.value || ''}
                    onChange={e => onChange(step.id, { value: e.target.value })}
                    placeholder={tr('z.B. 3')}
                    className="w-32 text-xs font-mono"
                  />
                </div>
                <p className="text-[10px] text-indigo-700 font-mono">
                  {tr('Sendet diese Datei als echten Druckjob → Bambu meldet FINISH wenn fertig. Danach wait_print für zuverlässige Z200-Erkennung.')}
                </p>
              </div>
            )}

            {(step.type === 'macro' || step.type === 'gcode' || step.type === 'klipper_gcode') && (
              <div>
                <label className="text-[10px] text-surface-600 block mb-0.5">
                  {step.type === 'macro' ? tr('Makro-Name') : step.type === 'klipper_gcode' ? tr('GCode (an OTTOeject)') : tr('G-Code (an Bambu)')}
                  {step.type === 'macro' && (
                    <span className="text-surface-700 ml-1">· {'{rack}'}/{'{slot}'} = {tr('Ziel')} · {'{stack_rack}'}/{'{stack_slot}'} = {tr('Vorrat')}</span>
                  )}
                  {step.type === 'klipper_gcode' && (
                    <span className="text-teal-700 ml-1">{tr('· blockiert bis Position erreicht — kein Delay nötig')}</span>
                  )}
                </label>
                <textarea
                  value={step.value}
                  onChange={e => onChange(step.id, { value: e.target.value })}
                  rows={step.value.includes('\n') ? 3 : 1}
                  placeholder={
                    step.type === 'macro'         ? 'z.B. GRAB_FROM_RACK RACK={rack} SLOT={slot}' :
                    step.type === 'klipper_gcode' ? 'G28\nG1 Z200 F3000' :
                    'G1 Z200 F3000'
                  }
                  className="w-full text-xs font-mono resize-none"
                />
              </div>
            )}

            {step.type === 'app_op' && (
              <div>
                <label className="text-[10px] text-surface-600 block mb-0.5">
                  {tr('Printloom-Operation')}
                  <span className="text-surface-700 ml-1">{tr('· immer als Printloom-G-code (Drucker-Tab)')}</span>
                </label>
                <select
                  value={step.value || ''}
                  onChange={e => onChange(step.id, { value: e.target.value })}
                  className="w-full text-xs font-mono"
                >
                  {appOps.map(o => (
                    <option key={o.key} value={o.key}>{opLabel(o)} — {o.key}</option>
                  ))}
                </select>
                <p className="text-[10px] text-fuchsia-700 font-mono mt-1">
                  {tr('Nutzt Position & Geschwindigkeit aus dem Drucker-Tab. Bei „Platte holen/ablegen" liefert die Farm Regal/Fach automatisch.')}
                </p>
              </div>
            )}

            {step.type === 'delay' && (
              <div>
                <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Wartezeit')}</label>
                <div className="flex items-center gap-2">
                  <input
                    type="number" min="0" max="600" value={step.seconds}
                    onChange={e => onChange(step.id, { seconds: Math.max(0, Number(e.target.value)) })}
                    className="w-24 text-xs font-mono"
                  />
                  <span className="text-xs text-surface-600">{tr('Sekunden')}</span>
                </div>
              </div>
            )}

            {step.type === 'bambu_move' && (
              <div className="space-y-2">
                <div className="flex items-center gap-3">
                  <div>
                    <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Z-Höhe (mm)')}</label>
                    <input
                      type="number" min="0" max="256" value={step.z ?? 200}
                      onChange={e => onChange(step.id, { z: Math.max(0, Number(e.target.value)) })}
                      className="w-24 text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Feed (mm/min)')}</label>
                    <input
                      type="number" min="60" max="6000" value={step.feed ?? 3000}
                      onChange={e => onChange(step.id, { feed: Math.max(60, Number(e.target.value)) })}
                      className="w-24 text-xs font-mono"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-cyan-700 font-mono">
                  {tr('Sendet G1 Z{0} F{1} + M400 als Mini-Druck und wartet, bis der Drucker FINISH meldet — also wirklich in Position ist (kein blinder Timer).', step.z ?? 200, step.feed ?? 3000)}
                </p>
              </div>
            )}

            {step.type === 'wait_bambu_idle' && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Mindestdauer G28+Z200')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="5" max="120" value={step.seconds || 50}
                      onChange={e => onChange(step.id, { seconds: Math.max(5, Number(e.target.value)) })}
                      className="w-24 text-xs font-mono"
                    />
                    <span className="text-xs text-surface-600">{tr('Sekunden')}</span>
                  </div>
                </div>
                <p className="text-[10px] text-cyan-700 font-mono">
                  {tr('Wartet die verbleibende Zeit bis G28+Z200 fertig ist. Zeit der Zwischenschritte (Homen, Tür, Platte holen) wird automatisch abgezogen.')}
                </p>
              </div>
            )}

            {step.type === 'wait_pause' && (
              <div className="space-y-2">
                <div>
                  <label className="text-[10px] text-surface-600 block mb-0.5">{tr('Timeout')}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number" min="30" max="600" value={step.seconds || 120}
                      onChange={e => onChange(step.id, { seconds: Math.max(30, Number(e.target.value)) })}
                      className="w-24 text-xs font-mono"
                    />
                    <span className="text-xs text-surface-600">{tr('Sekunden')}</span>
                  </div>
                </div>
                <p className="text-[10px] text-yellow-700 font-mono">
                  {tr('Pollt MQTT bis gcode_state == PAUSE (= M400 U1 fertig, Drucker auf Z200 geparkt). Crash-Schutz: bei FAILED oder Timeout → Platte NICHT einlegen, Sequenz abgebrochen.')}
                </p>
              </div>
            )}

            {/* Pre-position toggle — run ~1 min before print end. Only offered in the
                CYCLE card (allowPrep): in First Start there is no print to run ahead of.
                NEVER for wait_print/send_file/wait_homing: pre-positioning the "wait"
                steps would pull the wait out of the flow and eject mid-print. */}
            {allowPrep && !['wait_print', 'send_file', 'wait_homing'].includes(step.type) && (
              <label className="flex items-center gap-2 cursor-pointer select-none pt-1 border-t border-surface-800/30">
                <input
                  type="checkbox"
                  checked={!!step.prep}
                  onChange={e => onChange(step.id, { prep: e.target.checked })}
                  className="accent-blue-500"
                />
                <span className="text-[10px] text-surface-500">
                  {tr('⏱ Vor Druckende vorziehen — startet ~1 Min vor Druckende (OTTOeject schon mal in Position)')}
                </span>
              </label>
            )}

          </div>
        )}
      </div>
    </div>
  )
}

/* ─── Default values when adding a new step ──────────────────── */
const TYPE_DEFAULTS = {
  gcode:          { label: 'Bambu G-Code',         value: '',                 seconds: 0   },
  klipper_gcode:  { label: 'Klipper GCode',        value: 'G1 Z200 F3000',   seconds: 0   },
  macro:          { label: 'Makro',                value: '',                 seconds: 0   },
  app_op:         { label: 'Printloom-Op',         value: 'eject',            seconds: 0   },
  wait_bambu_idle:{ label: 'Warte Z200',            value: '',                 seconds: 50  },
  wait_cool:      { label: 'Auf Abkühlung warten', value: '30',        seconds: 1800 },
  delay:          { label: 'Wartezeit',            value: '',                 seconds: 5   },
  send_homing_file:{ label: 'Homing senden',       value: '',                 seconds: 180 },
  wait_homing:    { label: 'Auf Z200 warten (Homing-Ende)', value: '',        seconds: 180 },
  bambu_move:     { label: 'Bambu Position Z',     value: '',  z: 200, feed: 3000, seconds: 120 },
  send_file:      { label: 'Datei senden',         value: '',                 seconds: 0   },
  send_file_fixed:{ label: 'Feste Datei (ID)',     value: '',                 seconds: 0   },
  wait_print:        { label: 'Auf Druckende warten',   value: '', seconds: 0   },
  wait_pause:        { label: 'Warte auf PAUSE (Z200)', value: '', seconds: 120 },
  wait_print_failed: { label: 'Auf Druckfehler warten', value: '', seconds: 0   },
  clear_error:       { label: 'Fehler quittieren',      value: '', seconds: 0   },
}

/* ─── Sequence card ───────────────────────────────────────────── */
function SequenceCard({ title, desc, steps, setSteps, defaults, showSlot = true,
                        allowPrep = false, addTypes = ADD_TYPES, handoverId = null, footer = null }) {
  const { tr } = useLanguage()
  const [draggingId, setDraggingId] = useState(null)
  const [dragOverId, setDragOverId] = useState(null)

  const move = (id, dir) => setSteps(prev => {
    const i = prev.findIndex(s => s.id === id)
    if (i < 0 || (dir < 0 && i === 0) || (dir > 0 && i === prev.length - 1)) return prev
    const next = [...prev]
    ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
    return next
  })

  const change         = (id, upd) => setSteps(prev => prev.map(s => s.id === id ? { ...s, ...upd } : s))
  const remove         = (id)      => setSteps(prev => prev.filter(s => s.id !== id))
  const togglePar      = (id)      => setSteps(prev => prev.map(s => s.id === id ? { ...s, parallel: !s.parallel } : s))
  const toggleDisabled = (id)      => setSteps(prev => prev.map(s => s.id === id ? { ...s, disabled: !s.disabled } : s))

  const dragStart = (id) => setDraggingId(id)
  const dragEnd   = ()   => { setDraggingId(null); setDragOverId(null) }
  const dragOver  = (id) => { if (id !== draggingId) setDragOverId(id) }
  const drop      = (targetId) => {
    if (!draggingId || draggingId === targetId) { dragEnd(); return }
    setSteps(prev => {
      const fi = prev.findIndex(s => s.id === draggingId)
      const ti = prev.findIndex(s => s.id === targetId)
      if (fi < 0 || ti < 0) return prev
      const next = [...prev]
      const [item] = next.splice(fi, 1)
      next.splice(ti, 0, item)
      return next
    })
    dragEnd()
  }

  const add = (type) => {
    const maxId = steps.reduce((m, s) => Math.max(m, s.id), 0)
    setSteps(prev => [...prev, { id: maxId + 1, type, parallel: false, optional: false, ...TYPE_DEFAULTS[type] }])
  }

  const [runFeedback, setRunFeedback] = useState(null)
  const runStep = async (step) => {
    try {
      let r
      if (step.type === 'macro') {
        // Platzhalter mit Test-Standardwerten füllen und als rohes Klipper-Gcode
        // senden — so laufen ALLE Sequenz-Makros (auch parametrierte wie
        // GRAB_FROM_RACK/MOVE_TO_PRINTER), nicht nur die feste Allowlist von /macro.
        const g = String(step.value)
          .replace(/\{rack\}/g, '1').replace(/\{slot\}/g, '1')
          .replace(/\{stack_rack\}/g, '1').replace(/\{stack_slot\}/g, '7')
        r = await controlService.sendKlipperGcode(g)
      } else if (step.type === 'klipper_gcode') {
        r = await controlService.sendKlipperGcode(step.value)
      } else if (step.type === 'app_op') {
        // Printloom-Op live testen — Backend lädt die gespeicherte Drucker-Geometrie.
        r = await controlService.runOp({ op: step.value })
      }
      // Das Backend kehrt zurück, sobald die Bewegung GESTARTET ist (blockiert nicht bis
      // zum Ende der langen Fahrt) — running=true heißt „läuft noch auf der Maschine".
      const running = !!r?.data?.running
      setRunFeedback({ ok: true, msg: running ? translate('▶ {0} — läuft…', step.value) : `✓ ${step.value}` })
    } catch (e) {
      setRunFeedback({ ok: false, msg: errText(e) })
    }
    setTimeout(() => setRunFeedback(null), 3000)
  }

  // Build parallel execution groups (same logic as backend _exec_sequence)
  const groups = []
  steps.forEach((step, idx) => {
    if (step.parallel && groups.length > 0) {
      groups[groups.length - 1].push({ step, idx })
    } else {
      groups.push([{ step, idx }])
    }
  })

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex items-start justify-between">
        <div>
          <p className="section-label">{title}</p>
          {desc && <p className="text-[11px] text-surface-600 mt-0.5">{desc}</p>}
        </div>
        <button
          onClick={() => setSteps(defaults)}
          className="text-xs text-surface-700 hover:text-surface-400 shrink-0 ml-2 mt-0.5"
        >{tr('↺ Standard')}</button>
      </div>
      {runFeedback && (
        <div className={`text-[11px] font-mono px-2 py-1 rounded border ${runFeedback.ok ? 'text-emerald-400 border-emerald-900/50 bg-emerald-950/20' : 'text-red-400 border-red-900/50 bg-red-950/20'}`}>
          {runFeedback.msg}
        </div>
      )}

      <div>
        {steps.length === 0 && (
          <p className="text-xs text-surface-700 py-4 text-center">{tr('Keine Schritte — über + Hinzufügen ergänzen')}</p>
        )}
        {groups.map((group, gi) => (
          <div key={gi}>
            {/* Flow arrow between sequential steps */}
            {gi > 0 && (
              <div className="flex justify-center my-1.5">
                <div className="flex flex-col items-center">
                  <div className="w-px h-2.5 bg-surface-700/40" />
                  <svg width="7" height="4" viewBox="0 0 7 4" fill="currentColor" className="text-surface-700/40">
                    <path d="M3.5 4L0 0h7z"/>
                  </svg>
                </div>
              </div>
            )}
            {group.length > 1 ? (
              /* Parallel group — wrapped in blue box */
              <div className="rounded-lg border border-blue-900/30 bg-blue-950/5 overflow-hidden">
                <div className="px-2.5 py-1 bg-blue-950/20 flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-blue-500 font-semibold select-none">{tr('∥ gleichzeitig')}</span>
                  <span className="text-[9px] text-blue-700">{tr('{0} Schritte', group.length)}</span>
                </div>
                <div className="p-1 space-y-1">
                  {group.map(({ step, idx }) => (
                    <StepBlock key={step.id} step={step} idx={idx} total={steps.length}
                      onChange={change} onMove={move} onDelete={remove}
                      onTogglePar={togglePar} onToggleDisabled={toggleDisabled}
                      onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}
                      isDragOver={dragOverId === step.id} onRun={runStep}
                      allowPrep={allowPrep} handover={step.id === handoverId} />
                  ))}
                </div>
              </div>
            ) : (
              /* Single sequential step */
              <StepBlock key={group[0].step.id} step={group[0].step} idx={group[0].idx} total={steps.length}
                onChange={change} onMove={move} onDelete={remove}
                onTogglePar={togglePar} onToggleDisabled={toggleDisabled}
                onDragStart={dragStart} onDragEnd={dragEnd} onDragOver={dragOver} onDrop={drop}
                isDragOver={dragOverId === group[0].step.id} onRun={runStep}
                allowPrep={allowPrep} handover={group[0].step.id === handoverId} />
            )}

          </div>
        ))}
      </div>

      {footer}

      {/* Add step buttons */}
      <div className="flex items-center gap-1.5 flex-wrap border-t border-surface-800/50 pt-2.5">
        <span className="text-[10px] text-surface-700 mr-0.5">{tr('+ Hinzufügen:')}</span>
        {addTypes.map(type => {
          const meta = TYPE_META[type]
          return (
            <button
              key={type}
              onClick={() => add(type)}
              className={`flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded border transition-opacity hover:opacity-70 select-none ${meta.color} ${meta.border} bg-transparent`}
            >
              <span>{meta.icon}</span>
              <span>{tr(meta.label)}</span>
            </button>
          )
        })}
      </div>

      {showSlot && (
        <p className="text-[10px] text-surface-700 font-mono -mt-1">
          {'{rack}'}/{'{slot}'} → {tr('Ziel-Fach des Jobs')} &nbsp;·&nbsp; {'{stack_rack}'}/{'{stack_slot}'} → {tr('Vorrat-Stapel (aus Regal-Einstellungen)')}
          <br />{tr('R1 = Regal am Drucker — RACK=… wird beim Senden automatisch in die Geräte-Zählung übersetzt (Geräte-Macro zählt vom Homing-Punkt rechts)')}
        </p>
      )}
    </div>
  )
}

/* ─── Page ────────────────────────────────────────────────────── */
function SequenceEditor() {
  const { tr } = useLanguage()
  const [newSteps,  setNewSteps]  = useState(DEFAULT_SEQ_NEW)
  const [nextSteps, setNextSteps] = useState(DEFAULT_SEQ_NEXT)
  const [importErr, setImportErr] = useState(null)
  const [loaded,    setLoaded]    = useState(false)
  const [isMagnet,  setIsMagnet]  = useState(false)
  const importRef = React.useRef()
  const saveRef   = React.useRef(null)

  // Welcher Greifer ist verbaut? Nur der Magnet braucht den Abkühl-Schritt —
  // beim Klemm-Greifer wäre der Hinweis unten reiner Lärm.
  useEffect(() => {
    controlService.getGeometry()
      .then(r => setIsMagnet(
        (r?.data?.geometry?.gripper_motion || r?.data?.geometry?.gripper || '') === 'magnet'))
      .catch(() => {})
  }, [])

  useEffect(() => {
    // Migration: strip the prep flag from steps where it's nonsensical (wait_print/
    // send_file/wait_homing) and drop per-step conditions (Feature entfernt — sie
    // machten den Ablauf unvorhersehbar). Cleans up sequences saved before.
    const sanitize = (steps) => {
      let changed = false
      const out = steps.map(s => {
        let t = s
        if (t.prep && ['wait_print', 'send_file', 'wait_homing'].includes(t.type)) {
          changed = true
          t = { ...t, prep: false }
        }
        if (t.condition) {
          changed = true
          const { condition, ...rest } = t
          t = rest
        }
        return t
      })
      return { out, changed }
    }
    autofarmService.getSequences()
      .then(r => {
        const d = r.data
        const rawNew  = Array.isArray(d.seq_new)  ? (d.seq_new.length  ? d.seq_new  : DEFAULT_SEQ_NEW)  : DEFAULT_SEQ_NEW
        const rawNext = Array.isArray(d.seq_next) ? (d.seq_next.length ? d.seq_next : DEFAULT_SEQ_NEXT) : DEFAULT_SEQ_NEXT
        const a = sanitize(rawNew), b = sanitize(rawNext)
        const sNew = a.out, sNext = b.out
        setNewSteps(sNew)
        setNextSteps(sNext)
        if (!d.seq_new?.length || a.changed || b.changed) {
          autofarmService.saveSequences({ seq_new: sNew, seq_next: sNext })
            .catch(() => {})
        }
      })
      .catch(() => {})
      .finally(() => setLoaded(true))
  }, [])

  useEffect(() => {
    if (!loaded) return
    clearTimeout(saveRef.current)
    saveRef.current = setTimeout(() => {
      autofarmService.saveSequences({ seq_new: newSteps, seq_next: nextSteps })
        .catch(() => {})
    }, 600)
    return () => clearTimeout(saveRef.current)
  }, [newSteps, nextSteps, loaded])

  const exportConfig = () => {
    const data = {
      version: '1',
      exported: new Date().toISOString(),
      seq_new:  newSteps,
      seq_next: nextSteps,
    }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `printloom_sequences_${new Date().toISOString().slice(0,10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Übergabe First Start → Zyklus: holt der First Start eine Platte, wird der erste
  // Griff-Schritt des Zyklus beim 1. Job übersprungen — genau dort sitzt der Marker.
  // Fehlt der Zyklus-Griff dagegen ganz (oder ist er deaktiviert), holt die Farm ab
  // Job 2 KEINE neue Platte mehr → deutliche Warnung statt Marker.
  const firstStartGrabs = newSteps.some(isGrabStep)
  const cycleGrabs = nextSteps.some(isGrabStep)
  const handoverId = firstStartGrabs ? (nextSteps.find(isGrabStep)?.id ?? null) : null

  /* Steht der Abkühl-Schritt vor dem Auswurf? Der Magnet hält eine warme Platte
     nicht — fehlt der Schritt, kommt der Arm leer zurück, ohne dass es auffällt.
     Bestandsanlagen haben ihre eigenen Sequenzen; ein neuer Standard-Schritt
     erreicht sie nicht von allein. Deshalb hier ein Hinweis statt stiller Hoffnung. */
  const ejectIdx = nextSteps.findIndex(x => !x.disabled &&
    ((x.type === 'app_op' && x.value === 'eject') ||
     (x.type === 'macro' && /EJECT_FROM_PRINTER/i.test(x.value || ''))))
  const coolIdx = nextSteps.findIndex(x => !x.disabled && x.type === 'wait_cool')
  const coolMissing = isMagnet && ejectIdx >= 0 && (coolIdx < 0 || coolIdx > ejectIdx)

  const importConfig = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportErr(null)
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result)
        if (!data.seq_new || !data.seq_next)
          throw new Error(tr('Ungültiges Format — seq_new / seq_next fehlen'))
        setNewSteps(data.seq_new)
        setNextSteps(data.seq_next)
      } catch (err) {
        setImportErr(err.message)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-surface-100 mb-1">{tr('Sequenz-Editor')}</h2>
          <p className="text-sm text-surface-500">
            {tr('Ablauf des Auto Farms anpassen — Reihenfolge, Zeiten und Parallelausführung. Änderungen werden sofort gespeichert und beim nächsten Lauf verwendet.')}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <input ref={importRef} type="file" accept=".json" className="hidden" onChange={importConfig} />
          <button
            onClick={() => importRef.current?.click()}
            className="btn btn-ghost btn-sm"
            title={tr('Sequenzen aus JSON-Datei laden')}
          >{tr('↑ Import')}</button>
          <button
            onClick={exportConfig}
            className="btn btn-ghost btn-sm"
            title={tr('Alle Sequenzen als JSON-Datei speichern')}
          >{tr('↓ Export')}</button>
        </div>
      </div>

      {importErr && (
        <div className="px-4 py-2.5 rounded-lg bg-red-950/40 border border-red-800 text-red-300 text-sm">
          {tr('Import fehlgeschlagen: {0}', importErr)}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <SequenceCard
          title={tr('▶ First Start — einmal beim Start-Knopf')}
          desc={tr('Läuft genau einmal beim Farm-Start. Standard: Drucker homet im Hintergrund auf Z200, währenddessen holt das OTTOeject schon die erste Platte und wartet vor dem Drucker — der Zyklus überspringt seinen Griff dann automatisch.')}
          steps={newSteps}
          setSteps={setNewSteps}
          defaults={DEFAULT_SEQ_NEW}
          addTypes={FIRST_ADD_TYPES}
          footer={firstStartGrabs ? (
            <p className="text-[10px] font-mono text-emerald-500/90 -mt-1 select-none">
              ⇢ {tr('Endet mit Platte im Greifer vor dem Drucker — Job 1 startet im Zyklus direkt HINTER dem Griff (alles davor entfällt).')}
            </p>
          ) : null}
        />
        <SequenceCard
          title={tr('↻ Zyklus — jeder Job')}
          desc={tr('Wiederkehrender Ablauf für JEDEN Job. ⏱-markierte Schritte starten ~1 Min vor Druckende.')}
          steps={nextSteps}
          setSteps={setNextSteps}
          defaults={DEFAULT_SEQ_NEXT}
          addTypes={CYCLE_ADD_TYPES}
          allowPrep
          handoverId={handoverId}
          footer={coolMissing ? (
            <p className="text-[10px] font-mono text-sky-300 bg-sky-950/20 border border-sky-900/40 rounded px-2 py-1.5 -mt-1">
              ❄ {tr('Magnet-Greifer verbaut, aber vor dem Auswerfen wird nicht abgekühlt. Die Magnete halten eine warme Druckplatte nicht — der Arm fährt los, die Platte bleibt im Drucker liegen und er kommt leer zurück, ohne dass es auffällt. Bitte „Auf Abkühlung warten" vor den Auswurf setzen.')}
            </p>
          ) : !cycleGrabs ? (
            <p className="text-[10px] font-mono text-amber-400 bg-amber-950/20 border border-amber-900/40 rounded px-2 py-1.5 -mt-1">
              ⚠ {tr('Kein aktiver Griff-Schritt im Zyklus — ab Job 2 wird KEINE neue Platte geholt! Der Zyklus-Griff ist keine Dopplung zum First Start: Job 1 überspringt ihn automatisch, ab Job 2 holt er die Platte. Bitte „Platte holen" wieder einfügen (Makro GRAB_FROM_RACK oder Printloom-Op „Aus Magazin holen").')}
            </p>
          ) : null}
        />
      </div>

      {/* Legend */}
      <div className="card">
        <p className="section-label mb-3">{tr('Legende')}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {[
            ['</>',  'Bambu GCode',   'blue-400',    'G-Code an Bambu Lab via MQTT — fire-and-forget, kein Completion-Feedback'],
            ['⌘',    'Klipper GCode', 'teal-400',    'Raw GCode an OTTOeject (Klipper) — blockiert bis Position erreicht, kein Delay nötig'],
            ['▶',    'Makro',         'violet-400',  'OTTOeject-Makro — {rack} = Rack-Nr, {slot} = Fach-Nr (z.B. GRAB_FROM_RACK RACK={rack} SLOT={slot})'],
            ['◆',    'Printloom-Op',  'fuchsia-400', 'Printloom-eigene Operation (Tür, Auswurf, Einlegen, Greifen …) aus dem Drucker-Tab — immer als App-G-code, Position & Geschwindigkeit dort einstellbar'],
            ['⌂',    'Bambu Homing',  'indigo-400',  'Sendet G28 + schnelles Z200 als Mini-Druck (Datei wird automatisch erzeugt) — mit ⏩ homet der Drucker im Hintergrund weiter'],
            ['⌂⏳',  'Auf Z200 warten','indigo-400', 'Holt das Ergebnis des im Hintergrund gestarteten Homings ab — Bett sicher auf Z200, dann geht es weiter'],
            ['↕',    'Bambu Position Z','cyan-400',  'Bett per Roh-G-Code auf Z fahren (schnell, ohne Druck-Vorbereitung)'],
            ['↑',    'Senden',        'emerald-400', 'Aktuelle Job-Druckdatei an den Bambu Lab senden'],
            ['⏳',   'Warten',        'sky-400',     'Per MQTT-Polling auf Druckende warten (FINISH) — hier läuft der 1-min Vorstart'],
            ['⏱',   'Vorziehen',     'blue-400',    'Badge am Schritt: startet ~1 Min vor Druckende (nur im Zyklus wählbar) — z.B. Homen + vor Drucker fahren'],
            ['⇢',    'Übergabe',      'emerald-500', 'Grüne Marke im Zyklus: hier übergibt der First Start — der Griff des 1. Jobs wird übersprungen (Platte schon im Greifer)'],
            ['∥',    'Parallel',      'blue-400',    'Schritt gleichzeitig mit dem vorigen Schritt ausführen'],
            ['on/off','Aktiv/Inaktiv', 'surface-400', 'on = Schritt aktiv · off = deaktiviert (wird beim Ausführen übersprungen, bleibt in der Liste)'],
            ['⠿',    'Drag-Handle',   'surface-400', 'Rechts am Schritt — Klicken und Ziehen zum freien Verschieben in der Liste'],
          ].map(([icon, label, color, desc]) => (
            <div key={label} className="flex items-start gap-2 text-xs">
              <span className={`font-mono w-5 text-center shrink-0 mt-0.5 text-${color}`}>{icon}</span>
              <div className="min-w-0">
                <span className={`font-medium text-${color}`}>{tr(label)}</span>
                <span className="text-surface-600 ml-1.5">{tr(desc)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default SequenceEditor
