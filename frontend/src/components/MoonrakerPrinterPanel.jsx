import React, { useState, useCallback, useEffect } from 'react'
import { printerService, fileService } from '../services/api'
import { apiError } from '../services/apiError'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { useAutoRefresh, usePageActive } from '../services/useAutoRefresh'
import { TOP_COVER_MODES, actionsFor, stateLabel, klippyDown, fmt } from '../services/moonrakerUi'

/* Snapmaker U1 (seit v1.1.83) — Zustand, Köpfe, Einstellungen, Druck, Kamera.
   Gegenstück zum Bambu-Panel im Drucker-Tab: Welches Panel erscheint, entscheidet
   der Gerätetyp. Die Befehle baut das Backend (moonraker_printer.build_setting);
   hier wird nur gewählt und angezeigt. */

const NumSet = ({ label, unit, value, onChange, onSet, busy, min, max, tr }) => (
  <div className="flex items-center gap-1.5">
    <span className="text-[11px] text-surface-400 w-28 shrink-0">{label}</span>
    <input type="number" min={min} max={max} value={value} onChange={e => onChange(e.target.value)}
      className="text-xs" style={{ width: '5.5rem' }} />
    <span className="text-[10px] text-surface-500">{unit}</span>
    <button type="button" onClick={onSet} disabled={busy || value === ''}
      className="btn-secondary text-xs disabled:opacity-50">{tr('Setzen')}</button>
  </div>
)

export default function MoonrakerPrinterPanel({ device }) {
  const { tr } = useLanguage()
  const [data, setData]   = useState(null)   // {online, settings, capabilities, state}
  const [err, setErr]     = useState('')
  const [msg, setMsg]     = useState(null)   // {text, err}
  const [busy, setBusy]   = useState('')
  const [inp, setInp]     = useState({})     // Eingabefelder
  const [files, setFiles] = useState(null)   // Dateien auf dem Drucker
  const [lib, setLib]     = useState([])     // .gcode aus der Bibliothek
  const [libId, setLibId] = useState('')
  const [cam, setCam]     = useState(false)
  const [camT, setCamT]   = useState(0)

  const load = useCallback(async () => {
    try {
      const r = await printerService.getSettings(device.id)
      setData(r.data)
      setErr('')
    } catch (e) { setErr(apiError(e)) }
  }, [device.id])
  useAutoRefresh(load, 5000)

  // Kamera: ein Einzelbild alle 5 s — nur eingeschaltet und auf sichtbarer Seite.
  const active = usePageActive()
  useEffect(() => {
    if (!cam || !active) return undefined
    setCamT(Date.now())
    const id = setInterval(() => setCamT(Date.now()), 5000)
    return () => clearInterval(id)
  }, [cam, active])

  const s = data?.state || {}
  const caps = data?.capabilities || {}
  const label = stateLabel(s)
  const can = actionsFor(s.print_state)
  const field = (k, fallback) => (inp[k] ?? (fallback ?? ''))
  const setField = (k) => (v) => setInp(o => ({ ...o, [k]: v }))

  const run = async (key, fn, okText) => {
    setBusy(key); setMsg(null)
    try {
      await fn()
      setMsg({ text: okText || tr('✓ Übernommen'), err: false })
      setTimeout(load, 1200)
    } catch (e) {
      setMsg({ text: apiError(e), err: true })
    } finally { setBusy('') }
  }
  const apply = (key, value) => run(key, () => printerService.setSettings(device.id, { [key]: value }))
  const applyNum = (key) => {
    const v = Number(inp[key])
    if (inp[key] === '' || inp[key] == null || !Number.isFinite(v)) return
    apply(key, v)
  }
  const action = async (a) => {
    if (a === 'cancel' && !(await confirmDialog({
      title: tr('Druck abbrechen?'), message: tr('Der laufende Druck auf {0} wird abgebrochen. Das lässt sich nicht fortsetzen.', device.name),
      confirmLabel: tr('Abbrechen') }))) return
    run(a, () => printerService.moonrakerAction(device.id, a))
  }
  const loadFiles = () => run('files', async () => {
    const [r, l] = await Promise.all([printerService.moonrakerFiles(device.id), fileService.listFiles()])
    setFiles(r.data?.files || [])
    setLib((l.data?.files || []).filter(f => f.file_type === '.gcode'))
  }, tr('✓ Dateien geladen'))
  const startFile = async (path) => {
    if (!(await confirmDialog({ title: tr('Druck starten?'), message: tr('{0} startet „{1}“.', device.name, path),
      confirmLabel: tr('Drucken') }))) return
    run('print', () => printerService.moonrakerPrint(device.id, path), tr('✓ Druck gestartet'))
  }
  const sendLib = async () => {
    const f = lib.find(x => String(x.id) === String(libId))
    if (!f || !(await confirmDialog({ title: tr('Druck starten?'),
      message: tr('„{0}“ wird auf {1} geladen und sofort gedruckt.', f.original_filename, device.name),
      confirmLabel: tr('Senden & drucken') }))) return
    run('send', () => printerService.sendFile(device.id, f.id), tr('✓ Druck gestartet'))
  }

  if (!data) return <p className="text-xs text-surface-500">{err || tr('Lade…')}</p>

  return (
    <div className="space-y-3">
      {/* Zustand */}
      {data.online === false ? (
        <p className="text-[11px] text-amber-400">
          {s.message || tr('Drucker nicht erreichbar — IP und Port unter Konfiguration → Geräte prüfen.')}
        </p>
      ) : (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`badge ${klippyDown(s) || s.print_state === 'error' ? 'badge-red'
              : s.print_state === 'printing' ? 'badge-blue' : ''}`}>
              {klippyDown(s) ? tr('Klipper: {0}', s.klippy_state) : tr(label)}
            </span>
            {s.subtask_name && <span className="text-[11px] font-mono text-surface-400 truncate">{s.subtask_name}</span>}
            {s.progress != null && <span className="text-[11px] text-surface-300">{fmt(s.progress, ' %')}</span>}
            {s.remaining_min != null && <span className="text-[11px] text-surface-500">{tr('noch ~{0} min', s.remaining_min)}</span>}
            {s.layer != null && s.total_layers != null && (
              <span className="text-[11px] text-surface-500">{tr('Schicht {0}/{1}', s.layer, s.total_layers)}</span>
            )}
          </div>
          {s.klippy_message && klippyDown(s) && (
            <p className="text-[11px] text-red-400">{s.klippy_message}</p>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn-secondary text-xs disabled:opacity-50" disabled={!can.pause || !!busy}
              onClick={() => action('pause')}>{tr('⏸ Pausieren')}</button>
            <button className="btn-secondary text-xs disabled:opacity-50" disabled={!can.resume || !!busy}
              onClick={() => action('resume')}>{tr('▶ Fortsetzen')}</button>
            <button className="btn-danger text-xs disabled:opacity-50" disabled={!can.cancel || !!busy}
              onClick={() => action('cancel')}>{tr('■ Abbrechen')}</button>
          </div>
        </div>
      )}

      {/* Köpfe T0–T3 */}
      {(s.tools || []).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] font-medium text-surface-300">{tr('Köpfe')}</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {s.tools.map(t => (
              <div key={t.index} className={`rounded border p-2 space-y-1 ${s.active_tool === t.index
                ? 'border-blue-700 bg-blue-950/30' : 'border-surface-700'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-mono text-surface-200">{t.label}{s.active_tool === t.index ? ` · ${tr('aktiv')}` : ''}</span>
                  <span className="text-[11px] font-mono text-surface-300">{fmt(t.temp, '°')} / {fmt(t.target, '°')}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[11px] text-surface-400 min-h-[1rem]">
                  {t.filament?.color && <span className="w-3 h-3 rounded-full border border-surface-600 shrink-0" style={{ background: t.filament.color }} />}
                  <span className="truncate">
                    {t.filament?.type
                      ? [t.filament.vendor, t.filament.type, t.filament.sub_type].filter(Boolean).join(' · ')
                      : (t.filament?.loaded === false ? tr('kein Filament') : tr('Filament unbekannt'))}
                  </span>
                </div>
                {t.sensor && (
                  <p className={`text-[10px] ${t.sensor.enabled === false ? 'text-surface-600'
                    : t.sensor.detected ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {t.sensor.enabled === false ? tr('Filament-Sensor aus')
                      : t.sensor.detected ? tr('Filament-Sensor: Filament da') : tr('Filament-Sensor: leer')}
                  </p>
                )}
                <div className="flex items-center gap-1">
                  <input type="number" min="0" max={caps.max_nozzle_c} placeholder="°C" className="text-xs" style={{ width: '4.5rem' }}
                    value={field(`t${t.index}`)} onChange={e => setField(`t${t.index}`)(e.target.value)} />
                  <button type="button" className="btn-secondary text-xs disabled:opacity-50"
                    disabled={!!busy || inp[`t${t.index}`] == null || inp[`t${t.index}`] === ''}
                    onClick={() => apply('nozzle_target', { tool: t.index, temp: Number(inp[`t${t.index}`]) })}>
                    {tr('Heizen')}
                  </button>
                  <button type="button" className="btn-ghost text-xs disabled:opacity-50" disabled={!!busy}
                    onClick={() => apply('nozzle_target', { tool: t.index, temp: 0 })}>{tr('Aus')}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bett, Geschwindigkeit, Fluss, Lüfter */}
      <div className="pt-2 border-t border-surface-700 space-y-1.5">
        <p className="text-[11px] font-medium text-surface-300">{tr('Einstellungen')}</p>
        <p className="text-[10px] text-surface-500">
          {tr('Bett {0} / {1} · Geschwindigkeit {2} · Fluss {3} · Bauteillüfter {4}',
              fmt(s.bed_temp, '°'), fmt(s.bed_target_temp, '°'), fmt(s.speed_factor, ' %'),
              fmt(s.flow_factor, ' %'), fmt(s.fan_speed, ' %'))}
        </p>
        <NumSet tr={tr} label={tr('Bett (°C)')} unit="°C" min={0} max={130} busy={!!busy}
          value={field('bed_target')} onChange={setField('bed_target')} onSet={() => applyNum('bed_target')} />
        <NumSet tr={tr} label={tr('Geschwindigkeit')} unit="%" min={10} max={200} busy={!!busy}
          value={field('speed_factor')} onChange={setField('speed_factor')} onSet={() => applyNum('speed_factor')} />
        <NumSet tr={tr} label={tr('Fluss')} unit="%" min={50} max={150} busy={!!busy}
          value={field('flow_factor')} onChange={setField('flow_factor')} onSet={() => applyNum('flow_factor')} />
        <NumSet tr={tr} label={tr('Bauteillüfter')} unit="%" min={0} max={100} busy={!!busy}
          value={field('fan_speed')} onChange={setField('fan_speed')} onSet={() => applyNum('fan_speed')} />
        {caps.work_light && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-surface-400 w-28 shrink-0">{tr('Licht im Bauraum')}</span>
            <button type="button" className={`btn-secondary text-xs ${s.work_light ? 'text-amber-300' : ''}`}
              disabled={!!busy} onClick={() => apply('work_light', !s.work_light)}>
              {s.work_light == null ? tr('unbekannt') : s.work_light ? tr('an — ausschalten') : tr('aus — einschalten')}
            </button>
          </div>
        )}
      </div>

      {/* Top-Cover (Purifier) — nur, wenn der Drucker sie meldet */}
      {caps.top_cover && (
        <div className="pt-2 border-t border-surface-700 space-y-1.5">
          <p className="text-[11px] font-medium text-surface-300">{tr('Top-Cover')}</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {TOP_COVER_MODES.map(o => (
              <button key={o.mode} type="button" disabled={!!busy} onClick={() => apply('top_cover_mode', o.mode)}
                className={`text-xs px-2 py-1 rounded border disabled:opacity-50 ${s.top_cover?.mode === o.mode
                  ? 'border-blue-600 bg-blue-950/40 text-blue-300' : 'border-surface-700 text-surface-500 hover:text-surface-300'}`}>
                {tr(o.label)}
              </button>
            ))}
          </div>
          <p className="text-[10px] text-surface-500">
            {tr('Abluft {0} · Umluft {1}', fmt(s.top_cover?.exhaust_fan, ' %'), fmt(s.top_cover?.inner_fan, ' %'))}
          </p>
          <NumSet tr={tr} label={tr('Abluft-Lüfter')} unit="%" min={0} max={100} busy={!!busy}
            value={field('top_cover_exhaust')} onChange={setField('top_cover_exhaust')} onSet={() => applyNum('top_cover_exhaust')} />
          <NumSet tr={tr} label={tr('Umluft-Lüfter')} unit="%" min={0} max={100} busy={!!busy}
            value={field('top_cover_inner')} onChange={setField('top_cover_inner')} onSet={() => applyNum('top_cover_inner')} />
        </div>
      )}

      {(s.temperature_sensors || []).length > 0 && (
        <p className="text-[10px] text-surface-500">
          {s.temperature_sensors.map(x => `${x.name} ${fmt(x.temp, '°')}`).join(' · ')}
        </p>
      )}

      {/* Drucken */}
      <div className="pt-2 border-t border-surface-700 space-y-1.5">
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-medium text-surface-300">{tr('Drucken')}</p>
          <button type="button" className="btn-ghost text-xs" disabled={!!busy} onClick={loadFiles}>
            {files ? tr('⟳ neu laden') : tr('Dateien laden')}
          </button>
        </div>
        {files && (
          <>
            {lib.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                <select value={libId} onChange={e => setLibId(e.target.value)} className="text-xs max-w-xs">
                  <option value="">{tr('Aus der Bibliothek …')}</option>
                  {lib.map(f => <option key={f.id} value={f.id}>{f.original_filename}</option>)}
                </select>
                <button type="button" className="btn-secondary text-xs disabled:opacity-50"
                  disabled={!libId || !can.start || !!busy} onClick={sendLib}>{tr('Senden & drucken')}</button>
              </div>
            )}
            {files.length === 0 ? (
              <p className="text-[10px] text-surface-500">{tr('Keine Dateien auf dem Drucker.')}</p>
            ) : (
              <div className="max-h-48 overflow-auto rounded border border-surface-700 divide-y divide-surface-700">
                {files.slice(0, 30).map(f => (
                  <div key={f.path} className="flex items-center justify-between gap-2 px-2 py-1">
                    <span className="text-[11px] font-mono text-surface-300 truncate">{f.path}</span>
                    <button type="button" className="btn-ghost text-xs disabled:opacity-50"
                      disabled={!can.start || !!busy} onClick={() => startFile(f.path)}>{tr('Drucken')}</button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[10px] text-surface-600">{tr('Nur .gcode — eine Bambu-.3mf passt nicht auf den U1.')}</p>
          </>
        )}
      </div>

      {/* Kamera */}
      <div className="pt-2 border-t border-surface-700 space-y-1.5">
        <button type="button" className="btn-ghost text-xs" onClick={() => setCam(c => !c)}>
          {cam ? tr('▾ Kamera ausblenden') : tr('▸ Kamera zeigen')}
        </button>
        {cam && camT > 0 && (
          <img src={`${printerService.cameraFrameUrl(device.id)}?t=${camT}`} alt={tr('Kamerabild')}
            className="w-full max-w-md rounded border border-surface-700 bg-surface-900" />
        )}
      </div>

      {msg && <p className={`text-[11px] font-mono ${msg.err ? 'text-red-400' : 'text-emerald-400'}`}>{msg.text}</p>}
      {err && <p className="text-[11px] text-red-400">{err}</p>}
      <p className="text-[10px] text-surface-600">
        {tr('Die Farm fährt den Snapmaker U1 noch nicht — verbinden, überwachen, einstellen und drucken geht schon. Werte, die der Drucker nicht meldet, stehen als „—“.')}
      </p>
    </div>
  )
}
