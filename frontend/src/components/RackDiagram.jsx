import React from 'react'
import { useLanguage } from '../services/i18n'

/* Technisches Schema für den Konfigurator: Drucker-Piktogramm (fest links) + Regale
   (wachsen nach rechts), dazwischen 2020-Alu-Profile. Über den Regalen sind die
   einzuhaltenden Abstände bemaßt. Fächer sind anklickbar (onSlotClick → OTTOeject
   fährt das Fach an). Horizontal maßstäblich (mm→px), Z-Höhen schematisch. */

const PROFILE_MM = 20   // 2020-Aluprofil (20 × 20 mm)
const C = {             // Farben inline (robust, unabhängig von Tailwind-fill-Utilities)
  txt: '#cbd5e1', dim: '#64748b',
  slotF: '#1e293b', slotS: '#475569',
  magF: 'rgba(120,53,15,0.45)', magS: '#d97706', magT: '#fbbf24',
  pcbS: '#60a5fa', pcbF: 'rgba(30,58,138,0.28)',
  postF: '#64748b', postS: '#94a3b8',
}

// Piktogramm je Bauart. enclosed = geschlossen (mit Tür), sonst offener Rahmen (Bedslinger).
export function PrinterIcon({ x = 0, y = 0, w = 60, h = 80, enclosed = true }) {
  if (enclosed) {
    return (
      <g stroke={C.pcbS} strokeWidth="1.5" fill="none">
        <rect x={x} y={y} width={w} height={h} rx="4" fill={C.pcbF} />
        <line x1={x + 4} y1={y + h * 0.22} x2={x + w - 4} y2={y + h * 0.22} />
        <rect x={x + w * 0.5} y={y + h * 0.34} width={w * 0.42} height={h * 0.56} rx="2" />
        <line x1={x + w * 0.56} y1={y + h * 0.62} x2={x + w * 0.58} y2={y + h * 0.62} strokeWidth="3" />
        <circle cx={x + w * 0.24} cy={y + h * 0.5} r={Math.min(w, h) * 0.09} />
      </g>
    )
  }
  return (
    <g stroke={C.pcbS} strokeWidth="1.5" fill="none">
      <rect x={x} y={y + h * 0.78} width={w} height={h * 0.14} rx="1" fill={C.pcbF} />
      <line x1={x + w * 0.5} y1={y + h * 0.85} x2={x + w * 0.5} y2={y + h * 0.12} />
      <line x1={x + w * 0.22} y1={y + h * 0.12} x2={x + w * 0.78} y2={y + h * 0.12} />
      <line x1={x + w * 0.5} y1={y + h * 0.22} x2={x + w * 0.68} y2={y + h * 0.22} strokeWidth="3" />
    </g>
  )
}

// Kleines eigenständiges Piktogramm für Buttons/Panels.
export function PrinterBadge({ enclosed = true, size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 52" aria-hidden="true">
      <PrinterIcon x={4} y={2} w={36} h={48} enclosed={enclosed} />
    </svg>
  )
}

// Bemaßung mit Endstrichen + zentriertem Label (horizontal oder vertikal).
function Dim({ x1, y1, x2, y2, label, vertical }) {
  const t = 4, midX = (x1 + x2) / 2, midY = (y1 + y2) / 2
  return (
    <g stroke={C.dim} strokeWidth="1">
      <line x1={x1} y1={y1} x2={x2} y2={y2} />
      {vertical ? (
        <>
          <line x1={x1 - t} y1={y1} x2={x1 + t} y2={y1} />
          <line x1={x2 - t} y1={y2} x2={x2 + t} y2={y2} />
          <text x={midX + 6} y={midY} fill={C.txt} stroke="none" fontSize="8" dominantBaseline="middle">{label}</text>
        </>
      ) : (
        <>
          <line x1={x1} y1={y1 - t} x2={x1} y2={y1 + t} />
          <line x1={x2} y1={y2 - t} x2={x2} y2={y2 + t} />
          <text x={midX} y={y1 - 3} fill={C.txt} stroke="none" fontSize="8" textAnchor="middle">{label}</text>
        </>
      )}
    </g>
  )
}

export default function RackDiagram({
  printerName = 'Drucker', enclosed = true,
  numRacks = 1, slotsPerRack = 6, magazineSlot = null,
  slotStepMm = 55, rackGapMm = 250, rackWidthMm = 230, printerGapMm = 0,
  printerScales = false, onSlotClick = null, busy = false,
}) {
  const { tr } = useLanguage()
  const racks = Math.max(1, Math.min(9, +numRacks || 1))
  const slots = Math.max(1, Math.min(20, +slotsPerRack || 1))
  const clickable = typeof onSlotClick === 'function'
  const pitch = Math.max(PROFILE_MM + 10, +rackGapMm || 250)          // Regal-Raster (Anfang→Anfang)
  // Aufbau von rechts: Regal 1 ganz rechts, Regal N links am Drucker.
  // printerGapMm = Drucker ↔ Regal 1 (weitestes). Nächstes Regal (N) = weniger, außer der Drucker skaliert mit.
  const pGapRack1 = Math.max(0, +printerGapMm || 0)
  const pGap  = printerScales ? pGapRack1 : Math.max(0, pGapRack1 - (racks - 1) * pitch)  // Drucker → Regal N (nächstes)
  const rW    = Math.max(20, Math.min(+rackWidthMm || 230, pitch - PROFILE_MM))  // Regalbreite (in Raster passend)
  const clear = pitch - PROFILE_MM                                     // lichte Weite 2020 ↔ 2020

  // Maßstab: der bemaßte (rechte) Teil wird auf ~540px skaliert
  const spanMm = pGap + racks * pitch + PROFILE_MM
  const scale  = Math.max(0.12, Math.min(0.55, 540 / Math.max(1, spanMm)))

  // Layout (px)
  const PAD = 10, PRINTER_PX = 66, SLOT_H = 20, VGAP = 2, DIM_RIGHT = 46, LABEL_H = 14
  const rowA = 12, rowB = 27, rowC = 42, TOPDIM = 52
  const stackTop = TOPDIM, stackH = slots * SLOT_H + (slots - 1) * VGAP, stackBottom = stackTop + stackH
  const originX = PAD + PRINTER_PX
  const X = mm => originX + mm * scale                                 // mm 0 = rechte Kante Drucker-Symbol
  const rackStart = i => pGap + i * pitch                             // i: 0-basiert
  const postW = Math.max(3, PROFILE_MM * scale)
  const slotY = n => stackTop + (slots - n) * (SLOT_H + VGAP)          // n: 1=unten … slots=oben

  const lastRight = X(rackStart(racks - 1) + rW) + postW               // rechte Kante inkl. Schlusspfosten
  const W = lastRight + DIM_RIGHT, H = stackBottom + LABEL_H + 4

  // Pfosten: einer links jedes Regals + Schlusspfosten rechts
  const posts = []
  for (let i = 0; i < racks; i++) posts.push(rackStart(i) - PROFILE_MM)
  posts.push(rackStart(racks - 1) + rW)

  const fmt = v => `${Math.round(v)} mm`

  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/50 p-2 overflow-x-auto">
      <style>{`.otto-slot{cursor:pointer}.otto-slot:hover{stroke:#60a5fa;stroke-width:2}`}</style>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: Math.min(W, 720), maxWidth: W }} role="img">
        {/* Drucker-Piktogramm (fest links) */}
        <PrinterIcon x={PAD} y={stackTop} w={PRINTER_PX - 6} h={stackH} enclosed={enclosed} />
        <text x={PAD + (PRINTER_PX - 6) / 2} y={stackBottom + LABEL_H} textAnchor="middle" fill={C.pcbS} fontSize="8">{printerName}</text>

        {/* 2020-Profile zwischen/um die Regale */}
        {posts.map((mm, k) => (
          <g key={k}>
            <rect x={X(mm)} y={stackTop} width={postW} height={stackH} fill={C.postF} stroke={C.postS} strokeWidth="0.8" />
          </g>
        ))}
        <text x={X(posts[0]) + postW / 2} y={stackBottom + LABEL_H} textAnchor="middle" fill={C.postS} fontSize="7">2020</text>

        {/* Regale — Aufbau von rechts: Spalte r (links→rechts) = Regal (racks−r), Regal 1 ganz rechts */}
        {Array.from({ length: racks }).map((_, r) => {
          const x0 = X(rackStart(r)), rackPxW = Math.max(14, rW * scale)
          const rackNo = racks - r
          return (
            <g key={r}>
              {Array.from({ length: slots }).map((_, i) => {
                const n = i + 1, isMag = magazineSlot != null && n === +magazineSlot, y = slotY(n)
                const fill = isMag ? C.magF : C.slotF, stroke = isMag ? C.magS : C.slotS
                const title = isMag ? tr('Magazin (Fach {0})', n) : tr('Fach {0}', n)
                return clickable ? (
                  <rect key={n} x={x0} y={y} width={rackPxW} height={SLOT_H} rx="2" fill={fill} stroke={stroke} strokeWidth="1"
                    className="otto-slot" style={busy ? { opacity: 0.5, cursor: 'wait' } : undefined}
                    onClick={() => !busy && onSlotClick(rackNo, n)}>
                    <title>{tr('{0} anfahren (Regal {1})', title, rackNo)}</title>
                  </rect>
                ) : (
                  <rect key={n} x={x0} y={y} width={rackPxW} height={SLOT_H} rx="2" fill={fill} stroke={stroke} strokeWidth="1">
                    <title>{title}</title>
                  </rect>
                )
              })}
              {rackNo === 1 && Array.from({ length: slots }).map((_, i) => (
                <text key={i} x={x0 + Math.max(14, rW * scale) / 2} y={slotY(i + 1) + SLOT_H / 2} textAnchor="middle" dominantBaseline="middle"
                  fill={(i + 1) === +magazineSlot ? C.magT : C.slotS} fontSize="8" style={{ pointerEvents: 'none' }}>{i + 1}</text>
              ))}
              <text x={x0 + Math.max(14, rW * scale) / 2} y={stackBottom + LABEL_H} textAnchor="middle" fill={C.slotS} fontSize="8">{tr('Regal {0}', rackNo)}</text>
            </g>
          )
        })}

        {/* ── Bemaßung ÜBER den Regalen ── */}
        {/* Reihe A: 2020 ↔ Drucker  |  Regal-Raster (Anfang 1 → Anfang 2) */}
        <Dim x1={X(0)} y1={rowA} x2={X(rackStart(0)) } y2={rowA} label={fmt(pGap)} />
        <Dim x1={X(rackStart(0))} y1={rowA} x2={X(rackStart(1))} y2={rowA} label={fmt(pitch)} />
        {/* Reihe B: Regalbreite (Regal 1) */}
        <Dim x1={X(rackStart(0))} y1={rowB} x2={X(rackStart(0) + rW)} y2={rowB} label={fmt(rW)} />
        {/* Reihe C: lichte Weite 2020 ↔ 2020 */}
        <Dim x1={X(rackStart(0))} y1={rowC} x2={X(rackStart(1) - PROFILE_MM)} y2={rowC} label={fmt(clear)} />
        {/* Z: Fach-Raster (senkrecht, rechts) */}
        <Dim vertical x1={lastRight + 12} y1={slotY(1) + SLOT_H / 2} x2={lastRight + 12} y2={slotY(2) + SLOT_H / 2} label={fmt(slotStepMm)} />
      </svg>

      <p className="text-[10px] text-surface-400 text-center mt-1">
        {clickable
          ? tr('Drucker links · Regal 1 rechts (Aufbau von rechts) · Fach anklicken zum Anfahren')
          : tr('Drucker links · Regal 1 rechts (Aufbau von rechts)')}
      </p>
      <div className="text-[9px] text-surface-600 text-center leading-snug mt-0.5">
        <p>{tr('Bemaßung oben: Drucker↔nächstes Regal · Regal-Raster (Anfang→Anfang) · Regalbreite · lichte Weite 2020↔2020. Rechts: Fach-Raster (Z).')}</p>
        <p>{tr('Regal-Raster = Regalbreite + {0} mm Profil (2020) · Maße schematisch, Z-Höhen nicht maßstäblich', PROFILE_MM)}</p>
      </div>
    </div>
  )
}
