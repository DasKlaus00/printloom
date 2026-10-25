import React, { useState, useEffect, useCallback } from 'react'
import { deviceService, rackManagerService, autofarmService, healthService,
         controlService } from '../services/api'
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
    const [dev, rack, homing, settings, targets, geo, seq] = await Promise.all([
      deviceService.listDevices().then(r => r.data ?? []).catch(() => []),
      rackManagerService.getAll().then(r => r.data ?? {}).catch(() => ({})),
      autofarmService.getHomingFileInfo().then(r => r.data ?? {}).catch(() => ({})),
      autofarmService.getSettings().then(r => r.data ?? {}).catch(() => ({})),
      healthService.targets().then(r => r.data ?? {}).catch(() => ({})),
      // Geometrie-Prüfung (Achsgrenzen) + Sequenz — beides entscheidet, ob ein
      // Lauf überhaupt sauber durchgehen kann.
      controlService.checkGeometry().then(r => r.data?.check ?? null).catch(() => null),
      autofarmService.getSequences().then(r => r.data ?? {}).catch(() => ({})),
    ])
    const bambu   = dev.find(d => d.device_type === 'bambu_lab')
    const klipper = dev.find(d => d.device_type === 'klipper')
    const onState = (t) => t?.status === 'online' ? 'ok' : (t?.status === 'unconfigured' ? 'fail' : 'warn')
    const noMag   = (rack.magazine_slot ?? 7) <= 0
    const plates  = rack.magazine_count ?? 0
    const seqLen  = (seq.seq_next ?? []).length

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
      // Geometrie: würde eine Bewegung aus der Achse fahren?
      { key: 'geometry', label: tr('Geometrie plausibel'),
        state: !geo ? 'warn' : (geo.errors?.length ? 'fail' : 'ok'),
        detail: !geo ? tr('nicht prüfbar')
          : geo.errors?.length ? tr('{0} Bewegung(en) außerhalb der Achse', geo.errors.length)
          : tr('alle Bewegungen innerhalb der Achsen') },
      { key: 'limits', label: tr('Achsgrenzen bekannt'),
        state: geo?.limits_known ? 'ok' : 'warn',
        detail: geo?.limits_known
          ? `X ${geo.limits.x} · Y ${geo.limits.y} · Z ${geo.limits.z}`
          : tr('nicht gesetzt — „vom Gerät holen", dann wird auch nach oben geprüft') },
      { key: 'sequence', label: tr('Sequenz vorhanden'),
        state: seqLen ? 'ok' : 'warn',
        detail: seqLen ? tr('{0} Schritte im Zyklus', seqLen) : tr('leer — im Sequenz-Editor anlegen') },
      // Nachschub: ohne leere Platten läuft die Farm in die Magazin-Pause.
      { key: 'plates', label: tr('Leere Platten bereit'),
        state: plates > 0 ? 'ok' : 'warn',
        detail: plates > 0
          ? (noMag ? tr('{0} Fächer als bestückt markiert', plates) : tr('{0} Platten im Magazin', plates))
          : (noMag ? tr('keine markiert — in der Farm-Ansicht mit ▭ setzen') : tr('Magazin leer')) },
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
