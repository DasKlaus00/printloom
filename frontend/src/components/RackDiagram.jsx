import React from 'react'
import { useLanguage } from '../services/i18n'

/* Technisches Schema für den Konfigurator: Drucker-Piktogramm (fest links) + Regale
   (wachsen nach rechts) mit eingezeichneten Abständen. Fächer sind anklickbar
   (onSlotClick → OTTOeject fährt das Fach an). Maße = OTTOeject-X/Z in mm, schematisch
   (nicht maßstabsgetreu). 2020-Alu-Profil (20 mm) wird als Rahmenstärke berücksichtigt. */

const PROFILE_MM = 20   // 2020-Aluprofil

// Piktogramm je Bauart. enclosed = geschlossen (mit Tür), sonst offener Rahmen (Bedslinger).
function PrinterIcon({ x, y, w, h, enclosed }) {
  const s = 'stroke-blue-400'
  const f = 'fill-blue-950/40'
  if (enclosed) {
    return (
      <g className={`${s} ${f}`} strokeWidth="1.5" fill="none">
        <rect x={x} y={y} width={w} height={h} rx="4" className={f} />
        <line x1={x + 4} y1={y + h * 0.22} x2={x + w - 4} y2={y + h * 0.22} />          {/* Gantry */}
        <rect x={x + w * 0.52} y={y + h * 0.34} width={w * 0.4} height={h * 0.56} rx="2" /> {/* Tür */}
        <line x1={x + w * 0.58} y1={y + h * 0.62} x2={x + w * 0.6} y2={y + h * 0.62} strokeWidth="3" /> {/* Griff */}
        <circle cx={x + w * 0.24} cy={y + h * 0.5} r={Math.min(w, h) * 0.09} />           {/* Spule */}
      </g>
    )
  }
  return (
    <g className={s} strokeWidth="1.5" fill="none">
      <rect x={x} y={y + h * 0.78} width={w} height={h * 0.14} rx="1" className="fill-blue-950/40" /> {/* Basis/Bett */}
      <line x1={x + w * 0.5} y1={y + h * 0.85} x2={x + w * 0.5} y2={y + h * 0.12} />                   {/* Portal */}
      <line x1={x + w * 0.22} y1={y + h * 0.12} x2={x + w * 0.78} y2={y + h * 0.12} />                 {/* Querbalken */}
      <line x1={x + w * 0.5} y1={y + h * 0.22} x2={x + w * 0.68} y2={y + h * 0.22} strokeWidth="3" />  {/* Druckkopf */}
    </g>
  )
}

// Bemaßung mit Endstrichen + zentriertem Label (horizontal oder vertikal).
function Dim({ x1, y1, x2, y2, label, vertical }) {
  const tick = 4
  const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  return (
    <g className="stroke-surface-500" strokeWidth="1">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - tick} y1={y1} x2={x1 + tick} y2={y1} />
          <line x1={x2 - tick} y1={y2} x2={x2 + tick} y2={y2} />
          <text x={midX + 6} y={midY} className="fill-surface-300 stroke-none text-[8px]" dominantBaseline="middle">{label}</text>
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - tick} x2={x1} y2={y1 + tick} />
          <line x1={x2} y1={y2 - tick} x2={x2} y2={y2 + tick} />
          <text x={midX} y={midY - 3} className="fill-surface-300 stroke-none text-[8px]" textAnchor="middle">{label}</text>
        </>
      )}
    </g>
  )
}

export default function RackDiagram({
  printerName = 'Drucker', enclosed = true,
  numRacks = 1, slotsPerRack = 6, magazineSlot = null,
  slotStepMm = 55, rackGapMm = 250, printerGapMm = 0,
  onSlotClick = null, busy = false,
}) {
  const { tr } = useLanguage()
  const racks = Math.max(1, Math.min(9, +numRacks || 1))
  const slots = Math.max(1, Math.min(20, +slotsPerRack || 1))
  const clickable = typeof onSlotClick === 'function'

  // Layout (px, schematisch)
  const PAD = 10, SLOT_W = 38, SLOT_H = 20, VGAP = 2
  const RACK_GAP_PX = 46, PRINTER_W = 74, PRINTER_GAP_PX = 54
  const DIM_BOTTOM = 42, DIM_RIGHT = 56, LABEL_H = 14, TOP = 12

  const stackH = slots * SLOT_H + (slots - 1) * VGAP
  const stackTop = TOP, stackBottom = TOP + stackH
  const rackX = r => PAD + PRINTER_W + PRINTER_GAP_PX + r * (SLOT_W + RACK_GAP_PX)
  const slotY = n => stackTop + (slots - n) * (SLOT_H + VGAP)   // n: 1=unten … slots=oben
  const lastRackRight = rackX(racks - 1) + SLOT_W
  const W = lastRackRight + DIM_RIGHT
  const H = stackBottom + DIM_BOTTOM + LABEL_H

  const printerX = PAD, printerRight = PAD + PRINTER_W
  const dimYp = stackBottom + 14           // Drucker ↔ Regal 1
  const dimYr = stackBottom + 30           // Regal-Raster

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/50 p-2 overflow-x-auto">
      <style>{`.otto-slot{cursor:pointer}.otto-slot:hover{stroke:#60a5fa;stroke-width:2}`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, 720), maxWidth: W }} role="img">
        {/* Drucker-Piktogramm (fest links, direkt neben Regal 1) */}
        <PrinterIcon x={printerX} y={stackTop} w={PRINTER_W} h={stackH} enclosed={enclosed} />
        <text x={printerX + PRINTER_W / 2} y={stackBottom + LABEL_H + DIM_BOTTOM - 2} textAnchor="middle"
          className="fill-blue-300 text-[8px]">{printerName}</text>

        {/* Regale */}
        {Array.from({ length: racks }).map((_, r) => (
          <g key={r}>
            {Array.from({ length: slots }).map((_, i) => {
              const n = i + 1
              const isMag = magazineSlot != null && n === +magazineSlot
              const y = slotY(n)
              const common = {
                x: rackX(r), y, width: SLOT_W, height: SLOT_H, rx: 2,
                className: `${isMag ? 'fill-amber-950/50 stroke-amber-600' : 'fill-surface-800 stroke-surface-600'}${clickable ? ' otto-slot' : ''}`,
                strokeWidth: 1,
              }
              return clickable
                ? <rect key={n} {...common} onClick={() => !busy && onSlotClick(r + 1, n)} style={busy ? { opacity: 0.5, cursor: 'wait' } : undefined}>
                    <title>{tr('{0} anfahren (Regal {1})', isMag ? tr('Magazin (Fach {0})', n) : tr('Fach {0}', n), r + 1)}</title>
                  </rect>
                : <rect key={n} {...common}><title>{isMag ? tr('Magazin (Fach {0})', n) : tr('Fach {0}', n)}</title></rect>
            })}
            {/* Fachnummern in Regal 1 */}
            {r === 0 && Array.from({ length: slots }).map((_, i) => (
              <text key={i} x={rackX(0) + SLOT_W / 2} y={slotY(i + 1) + SLOT_H / 2} textAnchor="middle" dominantBaseline="middle"
                className={`${(i + 1) === +magazineSlot ? 'fill-amber-400' : 'fill-surface-500'} text-[8px] pointer-events-none`}>{i + 1}</text>
            ))}
            <text x={rackX(r) + SLOT_W / 2} y={stackBottom + LABEL_H} textAnchor="middle" className="fill-surface-500 text-[8px]">{tr('Regal {0}', r + 1)}</text>
          </g>
        ))}

        {/* Bemaßung: Drucker ↔ Regal 1 */}
        <Dim x1={printerRight} y1={dimYp} x2={rackX(0)} y2={dimYp} label={`${printerGapMm} mm`} />
        {/* Bemaßung: Regal-Raster (Mitte–Mitte) */}
        {racks >= 2
          ? <Dim x1={rackX(0) + SLOT_W / 2} y1={dimYr} x2={rackX(1) + SLOT_W / 2} y2={dimYr} label={`${rackGapMm} mm`} />
          : <Dim x1={rackX(0) - RACK_GAP_PX / 2} y1={dimYr} x2={rackX(0) + SLOT_W + RACK_GAP_PX / 2} y2={dimYr} label={tr('Raster {0} mm', rackGapMm)} />}
        {/* Bemaßung: Fach-Raster (senkrecht, rechts) */}
        <Dim vertical x1={lastRackRight + 12} y1={slotY(1) + SLOT_H / 2} x2={lastRackRight + 12} y2={slotY(2) + SLOT_H / 2} label={`${slotStepMm} mm`} />
      </svg>

      <p className="text-[10px] text-surface-400 text-center mt-1">
        {clickable
          ? tr('Drucker fest links · Regale wachsen nach rechts · Fach anklicken zum Anfahren')
          : tr('Drucker fest links · Regale wachsen nach rechts')}
      </p>
      <p className="text-[9px] text-surface-600 text-center">
        {tr('Rahmen aus 2020-Alu (20 mm): Regal-Raster {0} mm Mitte–Mitte (min. Regalbreite + {1} mm Profil + Luft) · Maße schematisch', rackGapMm, PROFILE_MM)}
      </p>
    </div>
  )
}
