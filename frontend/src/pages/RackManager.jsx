import React, { useState, useEffect, useCallback } from 'react'
import { rackManagerService } from '../services/api'
import { useAutoRefresh } from '../services/useAutoRefresh'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import RackPreview from '../components/RackPreview'

const STATUS_META = {
  free:     { label: 'Leer',     dot: 'dot-gray',  bg: 'bg-surface-800',    border: 'border-surface-700' },
  ready:    { label: 'Bereit',   dot: 'dot-green', bg: 'bg-emerald-950/30', border: 'border-emerald-800/50' },
  printing: { label: 'Druckt',   dot: 'dot-blue',  bg: 'bg-blue-950/30',    border: 'border-blue-800/50' },
  done:     { label: 'Fertig',   dot: 'dot-amber', bg: 'bg-amber-950/20',   border: 'border-amber-800/40' },
  locked:   { label: 'Gesperrt', dot: 'dot-red',   bg: 'bg-red-950/20',     border: 'border-red-900/40' },
}

function SlotCard({ id, slotLabel, slot, slotH, onReset, onLock }) {
  const { tr } = useLanguage()
  const meta = STATUS_META[slot.status] ?? STATUS_META.free
  const fits = slot.object_height_mm != null && slot.object_height_mm > 0
    ? slot.object_height_mm <= slotH
    : null

  return (
    <div className={`rounded-lg border p-2.5 flex flex-col gap-1.5 ${meta.bg} ${meta.border}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-mono text-surface-500">{slotLabel ?? tr('Fach {0}', id)}</span>
        <div className="flex items-center gap-2">
          <span className={`dot ${meta.dot} ${slot.status === 'printing' ? 'animate-pulse' : ''}`} />
          <span className="text-[10px] text-surface-400">{tr(meta.label)}</span>
          {slot.status !== 'printing' && (
            <button
              onClick={() => onLock(id)}
              title={slot.status === 'locked' ? tr('Entsperren') : tr('Sperren')}
              className={`text-[10px] leading-none transition-colors ${
                slot.status === 'locked'
                  ? 'text-red-400 hover:text-surface-400'
                  : 'text-surface-700 hover:text-amber-400'
              }`}
            >
              {slot.status === 'locked' ? '⊘' : '⊙'}
            </button>
          )}
          {slot.status !== 'free' && slot.status !== 'locked' && (
            <button
              onClick={() => onReset(id)}
              title={tr('Auf Leer zurücksetzen')}
              className="text-[10px] text-surface-600 hover:text-red-400 transition-colors leading-none"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {slot.file_name && (
        <p className="text-xs text-surface-300 truncate" title={slot.file_name}>{slot.file_name}</p>
      )}

      {slot.object_height_mm != null && slot.object_height_mm > 0 && (
        <div className="flex items-center gap-1.5">
          <div className="flex-1 bg-surface-700 rounded-full h-1 overflow-hidden">
            <div
              className={`h-1 rounded-full ${fits ? 'bg-emerald-500' : 'bg-red-500'}`}
              style={{ width: `${Math.min(100, (slot.object_height_mm / slotH) * 100)}%` }}
            />
          </div>
          <span className={`text-[10px] font-mono ${fits ? 'text-emerald-400' : 'text-red-400'}`}>
            {slot.object_height_mm}mm
          </span>
        </div>
      )}
    </div>
  )
}

/* ── New Rack Dialog ──────────────────────────────────────────────── */
function NewRackDialog({ onSave, onClose }) {
  const { tr } = useLanguage()
  const [name,    setName]    = useState('')
  const [rows,    setRows]    = useState(1)
  const [cols,    setCols]    = useState(6)
  const [slotH,   setSlotH]   = useState(50)
  const [color,   setColor]   = useState('#6366f1')
  const [saving,  setSaving]  = useState(false)

  const handleSave = async () => {
    if (!name.trim()) return
    setSaving(true)
    try {
      await rackManagerService.createRack({ name, rows: +rows, cols: +cols, slot_height_mm: +slotH, color })
      onSave()
    } catch {
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-surface-900 border border-surface-700 rounded-2xl w-full max-w-sm shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-800">
          <h3 className="text-sm font-semibold text-surface-100">{tr('Neues Rack anlegen')}</h3>
          <button onClick={onClose} className="text-surface-500 hover:text-surface-300 text-lg leading-none">✕</button>
        </div>
        <div className="px-5 py-4 space-y-3">
          <div>
            <label className="text-xs text-surface-500 block mb-1">{tr('Name')}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={tr('z.B. Rack B')} className="w-full" autoFocus />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-surface-500 block mb-1">{tr('Reihen')}</label>
              <input type="number" min="1" max="10" value={rows} onChange={e => setRows(e.target.value)} className="w-full font-mono" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">{tr('Spalten')}</label>
              <input type="number" min="1" max="12" value={cols} onChange={e => setCols(e.target.value)} className="w-full font-mono" />
            </div>
            <div>
              <label className="text-xs text-surface-500 block mb-1">{tr('Höhe (mm)')}</label>
              <input type="number" min="10" max="500" value={slotH} onChange={e => setSlotH(e.target.value)} className="w-full font-mono" />
            </div>
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">{tr('Farbe')}</label>
            <div className="flex items-center gap-2">
              <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-8 h-8 rounded cursor-pointer bg-transparent border-0" />
              <span className="text-xs font-mono text-surface-500">{color}</span>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-5 py-4 border-t border-surface-800">
          <button onClick={onClose} className="btn-ghost text-sm">{tr('Abbrechen')}</button>
          <button onClick={handleSave} disabled={saving || !name.trim()} className="btn-primary text-sm">
            {saving ? tr('Erstellt…') : tr('Erstellen')}
          </button>
        </div>
      </div>
    </div>
  )
}

/* ── Main Component ───────────────────────────────────────────────── */
function RackManager() {
  const { tr } = useLanguage()
  const [data, setData]             = useState(null)
  const [racks, setRacks]           = useState([])
  const [selectedRackId, setSelectedRackId] = useState('default')
  const [numRacks,    setNumRacks]    = useState(3)
  const [slotsPerRack, setSlotsPerRack] = useState(6)
  const [slotH, setSlotH]           = useState(50)
  const [slotTol, setSlotTol]       = useState(20)   // Fächer-Toleranz (mm)
  const [saving, setSaving]         = useState(false)
  const [feedback, setFeedback]     = useState(null)
  const [showNewRack, setShowNewRack] = useState(false)

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 3500)
  }

  const loadRacks = useCallback(async () => {
    try {
      const r = await rackManagerService.getRacks()
      const list = r.data
      setRacks(list)
      // Ensure selectedRackId is valid
      if (!list.find(r => r.id === selectedRackId) && list.length > 0) {
        setSelectedRackId(list[0].id)
      }
    } catch {
      // Silently fail — multi-rack is an enhancement
    }
  }, [selectedRackId])

  const load = useCallback(async () => {
    try {
      const r = await rackManagerService.getAll()
      setData(r.data)
      setNumRacks(r.data.num_racks      ?? 3)
      setSlotsPerRack(r.data.slots_per_rack ?? 6)
      setSlotH(r.data.slot_height_mm ?? 50)
      setSlotTol(r.data.slot_tolerance_mm ?? 20)
    } catch {
      showFeedback(tr('Laden fehlgeschlagen'), false)
    }
  }, [])

  useEffect(() => { load(); loadRacks() }, [load, loadRacks])

  /* Keep the rack visualization current without clobbering the config
     input fields (num racks / slots / height) that `load` also seeds.
     Refreshes on interval and when the tab/PWA regains focus. */
  const refreshData = useCallback(async () => {
    try {
      const r = await rackManagerService.getAll()
      setData(r.data)
    } catch {}
  }, [])
  useAutoRefresh(refreshData, 12000)

  const selectedRack = racks.find(r => r.id === selectedRackId)

  const handleResetSlot = async (slotId) => {
    try {
      await rackManagerService.updateSlot(slotId, { status: 'free', file_name: null })
      await load()
      showFeedback(tr('Fach {0} zurückgesetzt', slotId))
    } catch {
      showFeedback(tr('Zurücksetzen fehlgeschlagen'), false)
    }
  }

  const handleLockSlot = async (slotId) => {
    const slot = (data?.slots ?? {})[slotId]
    if (!slot) return
    try {
      const newStatus = slot.status === 'locked' ? 'free' : 'locked'
      await rackManagerService.updateSlot(slotId, {
        status: newStatus,
        file_name: newStatus === 'free' ? null : (slot.file_name ?? null),
      })
      await load()
      showFeedback(newStatus === 'locked' ? tr('Fach {0} gesperrt', slotId) : tr('Fach {0} entsperrt', slotId))
    } catch {
      showFeedback(tr('Aktion fehlgeschlagen'), false)
    }
  }

  const handleResetAll = async () => {
    if (!(await confirmDialog({ title: tr('Regal zurücksetzen'), message: tr('Alle Fächer auf "Leer" zurücksetzen?'), confirmLabel: tr('Zurücksetzen') }))) return
    try {
      const nonFree = Object.entries(data?.slots ?? {}).filter(([, s]) => s.status !== 'free')
      if (!nonFree.length) return
      const res = await rackManagerService.clearSlots({ slot_ids: nonFree.map(([id]) => id) })
      await load()
      const n = res.data?.cleared ?? nonFree.length
      showFeedback(tr('{0} Fach/Fächer zurückgesetzt', n))
    } catch {
      showFeedback(tr('Zurücksetzen fehlgeschlagen'), false)
    }
  }

  const handleRefillMagazine = async () => {
    try {
      const r = await rackManagerService.refillMagazine()
      await load()
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      showFeedback(tr('Magazin aufgefüllt ({0} Platten)', r.data?.magazine_count ?? ''))
    } catch {
      showFeedback(tr('Magazin auffüllen fehlgeschlagen'), false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      await rackManagerService.updateConfig({
        num_racks:      Number(numRacks),
        slots_per_rack: Number(slotsPerRack),
        slot_height_mm: Number(slotH),
        slot_tolerance_mm: Number(slotTol),
      })
      await load()
      showFeedback(tr('Gespeichert'))
    } catch {
      showFeedback(tr('Speichern fehlgeschlagen'), false)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteRack = async (rackId) => {
    if (!(await confirmDialog({ title: tr('Rack löschen'), message: tr('Rack wirklich löschen?'), confirmLabel: tr('Löschen') }))) return
    try {
      await rackManagerService.deleteRack(rackId)
      await loadRacks()
      showFeedback(tr('Rack gelöscht'))
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? tr('Löschen fehlgeschlagen'), false)
    }
  }

  const handleNewRackSaved = async () => {
    setShowNewRack(false)
    await loadRacks()
    showFeedback(tr('Rack erstellt'))
  }

  const slots = data?.slots ?? {}
  const nr    = data?.num_racks      ?? 3
  const spr   = data?.slots_per_rack  ?? 6

  const counts = Object.values(slots).reduce((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  const hasChanges = data
    && (Number(numRacks)     !== data.num_racks
      || Number(slotsPerRack) !== data.slots_per_rack
      || Number(slotH)        !== data.slot_height_mm
      || Number(slotTol)      !== data.slot_tolerance_mm)

  return (
    <div className="space-y-6">

      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                      : 'bg-red-950/40 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      {/* ── Rack Selector ────────────────────────────────── */}
      {racks.length > 0 && (
        <div className="card p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="section-label">{tr('Regal auswählen')}</p>
            <button onClick={() => setShowNewRack(true)} className="btn-ghost text-xs py-1 px-2">{tr('+ Neues Rack')}</button>
          </div>
          <div className="flex flex-wrap gap-2">
            {racks.map(rack => (
              <button
                key={rack.id}
                onClick={() => setSelectedRackId(rack.id)}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${
                  selectedRackId === rack.id
                    ? 'border-blue-600 bg-blue-950/40 text-blue-300'
                    : 'border-surface-700 bg-surface-800 text-surface-400 hover:border-surface-600 hover:text-surface-200'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: rack.color ?? '#6366f1' }}
                />
                {rack.name}
                <span className="text-[10px] text-surface-600 font-mono">
                  {rack.rows}×{rack.cols}
                </span>
                {rack.id !== 'default' && selectedRackId === rack.id && (
                  <button
                    onClick={e => { e.stopPropagation(); handleDeleteRack(rack.id) }}
                    className="ml-1 text-surface-600 hover:text-red-400 leading-none"
                    title={tr('Rack löschen')}
                  >
                    ✕
                  </button>
                )}
              </button>
            ))}
          </div>
          {selectedRack && (
            <p className="text-[10px] text-surface-600 mt-2">
              {tr('Aktiv:')} <span className="text-surface-500 font-medium">{selectedRack.name}</span>
              {' · '}{selectedRack.rows}×{selectedRack.cols} = {tr('{0} Fächer', selectedRack.rows * selectedRack.cols)}
              {' · '}{tr('{0} mm Fachhöhe', selectedRack.slot_height_mm)}
            </p>
          )}
        </div>
      )}

      {/* ── Config ───────────────────────────────────────── */}
      <div className="card">
        <p className="section-label">{tr('Rack Konfiguration')}</p>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <div>
            <label className="text-xs text-surface-500 block mb-1">
              {tr('Anzahl Racks')}
              <span className="text-surface-700 ml-1">{tr('(nebeneinander)')}</span>
            </label>
            <input
              type="number" min="1" max="10" value={numRacks}
              onChange={e => setNumRacks(e.target.value)}
              className="font-mono w-full"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">
              {tr('Fächer pro Rack')}
              <span className="text-surface-700 ml-1">{tr('(übereinander)')}</span>
            </label>
            <input
              type="number" min="1" max="20" value={slotsPerRack}
              onChange={e => setSlotsPerRack(e.target.value)}
              className="font-mono w-full"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">{tr('Fachhöhe (mm)')}</label>
            <input
              type="number" min="10" max="500" step="1" value={slotH}
              onChange={e => setSlotH(e.target.value)}
              className="font-mono w-full"
            />
          </div>
          <div>
            <label className="text-xs text-surface-500 block mb-1">
              {tr('Fächer-Toleranz (mm)')}
              <span className="text-surface-700 ml-1">{tr('(Überstand nach oben)')}</span>
            </label>
            <input
              type="number" min="0" max="100" step="1" value={slotTol}
              onChange={e => setSlotTol(e.target.value)}
              className="font-mono w-full"
            />
            <p className="text-[10px] text-surface-600 mt-1">
              {tr('Wie weit ein Objekt über sein oberstes Fach ragen darf, bevor ein weiteres reserviert wird. Höher = weniger Fächer, aber Kollisionsgefahr.')}
            </p>
          </div>
        </div>

        {/* 2.4 — Live-Vorschau: aktualisiert sich beim Tippen */}
        <RackPreview numRacks={numRacks} slotsPerRack={slotsPerRack} slotHeightMm={slotH} />

        <div className="flex items-center gap-4">
          <button onClick={handleSave} disabled={saving || !hasChanges} className="btn btn-primary">
            {saving ? tr('Speichert...') : tr('Speichern')}
          </button>
          {data && (
            <span className="text-xs text-surface-600 font-mono">
              {tr('Aktuell: {0} Racks × {1} Fächer = {2} gesamt · {3} mm', data.num_racks, data.slots_per_rack, data.num_racks * data.slots_per_rack, data.slot_height_mm)}
            </span>
          )}
        </div>
      </div>

      {/* ── Stats ────────────────────────────────────────── */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { key: 'free',     label: 'Leer',   dot: 'dot-gray'  },
          { key: 'ready',    label: 'Bereit', dot: 'dot-green' },
          { key: 'printing', label: 'Druckt', dot: 'dot-blue'  },
          { key: 'done',     label: 'Fertig', dot: 'dot-amber' },
        ].map(({ key, label, dot }) => (
          <div key={key} className="card text-center py-3">
            <span className={`dot ${dot} mx-auto block mb-1.5`} />
            <p className="text-2xl font-bold font-mono text-surface-200">{counts[key] ?? 0}</p>
            <p className="text-xs text-surface-500 mt-0.5">{tr(label)}</p>
          </div>
        ))}
      </div>

      {/* ── Rack Visual ──────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <p className="section-label">{tr('Rack Übersicht')}</p>
          <div className="flex gap-2">
            {Object.values(slots).some(s => s.status !== 'free') && (
              <button onClick={handleResetAll} className="btn btn-ghost btn-sm text-xs text-amber-400 hover:text-amber-300"
                title={tr('Platten entnehmen — Magazin füllt sich automatisch wieder auf')}>
                {tr('Alle entnehmen')}
              </button>
            )}
            <button onClick={load} className="btn btn-ghost btn-sm text-xs">{tr('Aktualisieren')}</button>
          </div>
        </div>

        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: `repeat(${nr}, minmax(0, 1fr))` }}
        >
          {Array.from({length: nr}, (_, r) => (
            <div key={r+1}>
              <p className="text-xs font-semibold text-center text-surface-400 mb-2 font-mono tracking-wide">
                {tr('Rack {0}', r+1)}
              </p>
              <div className="space-y-2">
                {Array.from({length: spr}, (_, s) => {
                  const s2   = spr - 1 - s  // visual: slot 6→1 top to bottom
                  const id   = `${r+1}-${s2+1}`
                  const slot = slots[id]
                  if (!slot) return null
                  return (
                    <SlotCard
                      key={id}
                      id={id}
                      slotLabel={tr('Fach {0}', s2+1)}
                      slot={slot}
                      slotH={data?.slot_height_mm ?? 50}
                      onReset={handleResetSlot}
                      onLock={handleLockSlot}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {/* Legend */}
        <div className="mt-4 pt-3 border-t border-surface-800 flex gap-5 flex-wrap">
          {Object.entries(STATUS_META).map(([key, meta]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs text-surface-500">
              <span className={`dot ${meta.dot}`} />
              {tr(meta.label)}
            </div>
          ))}
          <span className="ml-auto text-xs text-surface-700">
            {tr('Status wird von Auto Farm verwaltet')}
          </span>
        </div>
      </div>

      {showNewRack && (
        <NewRackDialog
          onSave={handleNewRackSaved}
          onClose={() => setShowNewRack(false)}
        />
      )}
    </div>
  )
}

export default RackManager
