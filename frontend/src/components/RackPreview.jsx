import React from 'react'
import { useLanguage } from '../services/i18n'

/* 2.4 — Live-Vorschau des Regals. Raster aus Regalen × Fächern, aktualisiert sich
   sofort beim Ändern der Werte; Fachhöhe wird proportional als Pixelhöhe gezeigt,
   damit man hohe/niedrige Fächer sieht. Optional ein Magazin-Fach hervorheben. */
export default function RackPreview({ numRacks = 1, slotsPerRack = 6, slotHeightMm = 50, magazineSlot = null }) {
  const { tr } = useLanguage()
  const racks = Math.max(1, Math.min(9, +numRacks || 1))
  const slots = Math.max(1, Math.min(20, +slotsPerRack || 1))
  const h     = Math.max(1, +slotHeightMm || 1)
  const px    = Math.round(12 + Math.min(300, h) / 300 * 22)   // 10–300 mm → ~13–34 px

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/50 p-3">
      <div className="flex items-end justify-center gap-3 overflow-x-auto">
        {Array.from({ length: racks }).map((_, r) => (
          <div key={r} className="flex flex-col items-center gap-1 shrink-0">
            <div className="flex flex-col-reverse gap-0.5">
              {Array.from({ length: slots }).map((_, s) => {
                const isMag = magazineSlot != null && (s + 1) === +magazineSlot
                return (
                  <div key={s}
                    className={`w-12 rounded-sm border flex items-center justify-center text-[8px] font-mono ${
                      isMag ? 'border-amber-700 bg-amber-950/40 text-amber-400'
                            : 'border-surface-600 bg-surface-800 text-surface-500'}`}
                    style={{ height: px }}
                    title={isMag ? tr('Magazin (Fach {0})', s + 1) : tr('Fach {0}', s + 1)}>
                    {s + 1}
                  </div>
                )
              })}
            </div>
            <span className="text-[9px] text-surface-500">{tr('Regal {0}', r + 1)}</span>
          </div>
        ))}
      </div>
      <p className="text-[10px] text-surface-600 text-center mt-2">
        {tr('Gesamt: {0} Fächer · bis {1} mm Objekthöhe je Fach', racks * slots, h)}
      </p>
    </div>
  )
}
