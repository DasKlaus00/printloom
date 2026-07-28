import React from 'react'
import { tr } from '../services/i18n'

/* Hinweis: Diese Komponente wird derzeit nirgends eingebunden (die Regal-Anzeige
   läuft über RackPreview/RackManager). Die Beschriftungen standen hier als
   einzige Stelle der App auf Englisch fest — jetzt wie überall deutsch als
   Quelltext und über tr() übersetzt. */
const statusConfig = {
  free:     { cls: 'rack-slot-free',     label: 'Leer',   dotCls: 'dot-green' },
  occupied: { cls: 'rack-slot-occupied', label: 'Belegt', dotCls: 'dot-amber' },
  printing: { cls: 'rack-slot-printing', label: 'Druckt', dotCls: 'dot-blue'  },
}

function RackVisualization({ rackConfig }) {
  const sorted = [...rackConfig.slots].sort((a, b) => b.slot_number - a.slot_number)

  return (
    <div className="space-y-2">
      {sorted.map(slot => {
        const cfg = statusConfig[slot.status] ?? { cls: 'rack-slot-empty', label: slot.status, dotCls: 'dot-gray' }
        return (
          <div key={slot.id} className={`rack-slot ${cfg.cls}`}>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono text-surface-500">S{slot.slot_number}</span>
              <span className="text-sm font-medium">{tr('Fach {0}', slot.slot_number)}</span>
            </div>
            <div className="flex items-center gap-2">
              {slot.current_job_id && (
                <span className="text-xs font-mono text-surface-500">Job #{slot.current_job_id}</span>
              )}
              <span className={`dot ${cfg.dotCls}`} />
              <span className="text-xs font-medium">{tr(cfg.label)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default RackVisualization
