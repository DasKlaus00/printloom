import React from 'react'

const statusConfig = {
  free:     { cls: 'rack-slot-free',     label: 'Free',     dotCls: 'dot-green' },
  occupied: { cls: 'rack-slot-occupied', label: 'Occupied', dotCls: 'dot-amber' },
  printing: { cls: 'rack-slot-printing', label: 'Printing', dotCls: 'dot-blue'  },
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
              <span className="text-sm font-medium">Slot {slot.slot_number}</span>
            </div>
            <div className="flex items-center gap-2">
              {slot.current_job_id && (
                <span className="text-xs font-mono text-surface-500">Job #{slot.current_job_id}</span>
              )}
              <span className={`dot ${cfg.dotCls}`} />
              <span className="text-xs font-medium">{cfg.label}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default RackVisualization
