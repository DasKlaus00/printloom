import React, { useState, useEffect, useCallback } from 'react'
import { deviceService, rackManagerService, autofarmService, healthService } from '../services/api'
import { useLanguage } from '../services/i18n'

/* 2.9 — Health-Check / Einrichtungs-Checkliste: zeigt auf einen Blick, was
   konfiguriert/erreichbar ist und was noch fehlt. Holt sich die Daten selbst
   aus den bestehenden Endpunkten (Geräte, Rack, Homing, Settings, Live-Health). */
export default function SetupHealth({ compact = false }) {
  const { tr } = useLanguage()
  const [checks, setChecks] = useState(null)
  const [busy, setBusy]     = useState(false)

  const run = useCallback(async () => {
    setBusy(true)
    const [dev, rack, homing, settings, targets] = await Promise.all([
      deviceService.listDevices().then(r => r.data ?? []).catch(() => []),
      rackManagerService.getAll().then(r => r.data ?? {}).catch(() => ({})),
      autofarmService.getHomingFileInfo().then(r => r.data ?? {}).catch(() => ({})),
      autofarmService.getSettings().then(r => r.data ?? {}).catch(() => ({})),
      healthService.targets().then(r => r.data ?? {}).catch(() => ({})),
    ])
    const bambu   = dev.find(d => d.device_type === 'bambu_lab')
    const klipper = dev.find(d => d.device_type === 'klipper')
    const onState = (t) => t?.status === 'online' ? 'ok' : (t?.status === 'unconfigured' ? 'fail' : 'warn')

    setChecks([
      { key: 'tz', label: tr('Zeitzone gesetzt'),
        state: settings.timezone ? 'ok' : 'warn',
        detail: settings.timezone || tr('nicht gesetzt — Betriebszeiten laufen sonst in UTC') },
      { key: 'printer', label: tr('Bambu-Drucker konfiguriert'),
        state: bambu ? onState(targets.printer) : 'fail',
        detail: bambu ? `${bambu.name} · ${tr(targets.printer?.status || 'offline')}` : tr('kein Drucker angelegt') },
      { key: 'ottoeject', label: tr('OTTOeject / Klipper konfiguriert'),
        state: klipper ? onState(targets.klipper) : 'fail',
        detail: klipper ? `${klipper.name} · ${tr(targets.klipper?.status || 'offline')}` : tr('kein OTTOeject angelegt') },
      { key: 'rack', label: tr('Regal konfiguriert'),
        state: (rack.num_racks > 0 && rack.slot_height_mm > 0) ? 'ok' : 'warn',
        detail: rack.num_racks ? tr('{0} Regal(e) · {1} Fächer · {2} mm', rack.num_racks, rack.slots_per_rack, rack.slot_height_mm) : tr('Standard') },
      { key: 'homing', label: tr('Homing-Datei erstellt'),
        state: homing.configured ? 'ok' : 'warn',
        detail: homing.configured ? (homing.filename || '✓') : tr('nicht erstellt — für den Auswurf nötig') },
    ])
    setBusy(false)
  }, [tr])

  useEffect(() => { run() }, [run])

  const ICON = {
    ok:   { sym: '✓', cls: 'text-emerald-400', dot: 'bg-emerald-500' },
    warn: { sym: '!', cls: 'text-amber-400',   dot: 'bg-amber-500' },
    fail: { sym: '✗', cls: 'text-red-400',     dot: 'bg-red-500' },
  }
  const allOk  = checks && checks.every(c => c.state === 'ok')
  const anyBad = checks && checks.some(c => c.state === 'fail')

  return (
    <div className="space-y-2">
      {!compact && (
        <div className="flex items-center justify-between">
          <span className={`text-xs font-medium ${allOk ? 'text-emerald-400' : anyBad ? 'text-red-400' : 'text-amber-400'}`}>
            {checks ? (allOk ? tr('Alles bereit ✓') : anyBad ? tr('Es fehlt noch etwas') : tr('Fast fertig')) : tr('Prüfe…')}
          </span>
          <button onClick={run} disabled={busy}
            className="text-[11px] text-blue-400 hover:text-blue-300 disabled:opacity-40">{busy ? tr('Prüfe…') : tr('↻ Neu prüfen')}</button>
        </div>
      )}
      <div className="space-y-1">
        {(checks ?? []).map(c => {
          const ic = ICON[c.state] ?? ICON.warn
          return (
            <div key={c.key} className="flex items-center gap-2 text-xs">
              <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${ic.cls}`}>{ic.sym}</span>
              <span className="text-surface-300">{c.label}</span>
              <span className="text-surface-600 ml-auto truncate max-w-[55%] text-right">{c.detail}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
