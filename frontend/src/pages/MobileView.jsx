import React, { useState, useEffect, useCallback } from 'react'
import { rackManagerService, autofarmService } from '../services/api'
import { useLanguage } from '../services/i18n'

const STATUS_META = {
  free:     { label: 'Leer',     bg: 'bg-surface-800',    border: 'border-surface-700', text: 'text-surface-400',  dot: 'bg-gray-500'   },
  ready:    { label: 'Bereit',   bg: 'bg-emerald-950/40', border: 'border-emerald-700', text: 'text-emerald-300',  dot: 'bg-emerald-400' },
  printing: { label: 'Druckt',   bg: 'bg-blue-950/40',    border: 'border-blue-700',    text: 'text-blue-300',     dot: 'bg-blue-400'   },
  done:     { label: 'Fertig',   bg: 'bg-amber-950/30',   border: 'border-amber-700',   text: 'text-amber-300',    dot: 'bg-amber-400'  },
  locked:   { label: 'Gesperrt', bg: 'bg-red-950/30',     border: 'border-red-900',     text: 'text-red-400',      dot: 'bg-red-500'    },
}

function SlotCard({ id, slot, onClear }) {
  const { tr } = useLanguage()
  const meta = STATUS_META[slot.status] ?? STATUS_META.free
  const isDone = slot.status === 'done'

  return (
    <div className={`rounded-2xl border-2 p-5 flex flex-col gap-3 transition-colors ${meta.bg} ${meta.border}`}>
      <div className="flex items-center justify-between">
        <span className="text-base font-bold text-surface-300">{tr('Fach {0}', id)}</span>
        <div className="flex items-center gap-2">
          <span className={`w-3 h-3 rounded-full flex-shrink-0 ${meta.dot} ${slot.status === 'printing' ? 'animate-pulse' : ''}`} />
          <span className={`text-lg font-bold ${meta.text}`}>{tr(meta.label)}</span>
        </div>
      </div>

      {slot.file_name && (
        <p className="text-sm text-surface-200 font-medium break-words leading-tight">
          {slot.file_name}
        </p>
      )}

      {slot.object_height_mm != null && slot.object_height_mm > 0 && (
        <p className="text-xs text-surface-500 font-mono">{tr('{0} mm Höhe', slot.object_height_mm)}</p>
      )}

      {isDone && (
        <button
          onClick={() => onClear(id)}
          className="mt-1 w-full py-3 rounded-xl bg-amber-600 hover:bg-amber-500 active:bg-amber-700 text-white text-base font-semibold transition-colors"
        >
          {tr('Entnommen')}
        </button>
      )}
    </div>
  )
}

export default function MobileView() {
  const { tr } = useLanguage()
  const [rackData, setRackData]   = useState(null)
  const [farmState, setFarmState] = useState(null)
  const [lastUpdate, setLastUpdate] = useState(null)

  const load = useCallback(async () => {
    try {
      const [rr, fr] = await Promise.allSettled([
        rackManagerService.getAll(),
        autofarmService.getStatus(),
      ])
      if (rr.status === 'fulfilled') setRackData(rr.value.data)
      if (fr.status === 'fulfilled') setFarmState(fr.value.data)
      setLastUpdate(new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }))
    } catch {}
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  const handleClear = async (slotId) => {
    try {
      await rackManagerService.updateSlot(slotId, { status: 'free', file_name: null })
      await load()
    } catch {}
  }

  const slots = rackData?.slots ?? {}
  const slotArr = Object.entries(slots).sort((a, b) => +a[0] - +b[0])
  const numCols = rackData?.cols ?? 1

  const farmRunning = farmState?.running
  const farmPaused  = farmState?.paused

  const farmStatusLabel = farmRunning
    ? (farmPaused ? 'Pausiert' : 'Läuft')
    : 'Gestoppt'
  const farmStatusColor = farmRunning
    ? (farmPaused ? 'text-amber-300' : 'text-emerald-300')
    : 'text-surface-400'
  const farmDotColor = farmRunning
    ? (farmPaused ? 'bg-amber-400' : 'bg-emerald-400')
    : 'bg-gray-500'

  const doneCount = Object.values(slots).filter(s => s.status === 'done').length
  const totalCount = slotArr.length

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-gray-950/95 backdrop-blur border-b border-gray-800 px-4 py-3">
        <div className="flex items-center justify-between max-w-2xl mx-auto">
          <div>
            <h1 className="text-lg font-bold text-white">Printloom</h1>
            <p className="text-xs text-gray-500">{tr('Rack-Übersicht · Mobile')}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              <span className={`w-2.5 h-2.5 rounded-full ${farmDotColor} ${farmRunning && !farmPaused ? 'animate-pulse' : ''}`} />
              <span className={`text-sm font-semibold ${farmStatusColor}`}>Farm {tr(farmStatusLabel)}</span>
            </div>
            {lastUpdate && (
              <span className="text-[10px] text-gray-600 font-mono">{lastUpdate}</span>
            )}
          </div>
        </div>
      </div>

      {/* Stats Bar */}
      <div className="bg-gray-900 border-b border-gray-800">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-4 text-sm">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
            <span className="text-amber-300 font-medium">{tr('{0} fertig', doneCount)}</span>
          </div>
          <div className="text-gray-600">·</div>
          <div className="text-gray-400">{tr('{0} Fächer gesamt', totalCount)}</div>
          {farmRunning && (
            <>
              <div className="text-gray-600">·</div>
              <div className="text-blue-400">
                {tr('Job {0} läuft', (farmState?.current_job_idx ?? -1) + 1)}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Slot Grid */}
      <div className="max-w-2xl mx-auto px-4 py-4">
        {slotArr.length === 0 ? (
          <div className="text-center py-16 text-gray-500">
            <p className="text-lg">{tr('Keine Fächer konfiguriert')}</p>
            <p className="text-sm mt-2">{tr('Konfiguriere das Rack im Rack Manager')}</p>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: numCols > 1 ? `repeat(${Math.min(numCols, 2)}, minmax(0, 1fr))` : '1fr' }}
          >
            {slotArr.map(([id, slot]) => (
              <SlotCard key={id} id={id} slot={slot} onClear={handleClear} />
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="max-w-2xl mx-auto px-4 py-6 text-center">
        <p className="text-xs text-gray-700">{tr('Auto-Refresh alle 5s')}</p>
        <button
          onClick={load}
          className="mt-2 text-xs text-gray-600 hover:text-gray-400 underline"
        >
          {tr('Jetzt aktualisieren')}
        </button>
      </div>
    </div>
  )
}
