import React from 'react'

/* Kleines Drucker-Piktogramm für den Drucker-Tab (Modell-Auswahl, Panels).
   enclosed = geschlossen (mit Tür), sonst offener Rahmen (Bedslinger). */
export function PrinterIcon({ x = 0, y = 0, w = 60, h = 80, enclosed = true, stroke = '#60a5fa', fill = 'rgba(30,58,138,0.28)' }) {
  if (enclosed) {
    return (
      <g stroke={stroke} strokeWidth="1.5" fill="none">
        <rect x={x} y={y} width={w} height={h} rx="4" fill={fill} />
        <line x1={x + 4} y1={y + h * 0.22} x2={x + w - 4} y2={y + h * 0.22} />
        <rect x={x + w * 0.5} y={y + h * 0.34} width={w * 0.42} height={h * 0.56} rx="2" />
        <line x1={x + w * 0.56} y1={y + h * 0.62} x2={x + w * 0.58} y2={y + h * 0.62} strokeWidth="3" />
        <circle cx={x + w * 0.24} cy={y + h * 0.5} r={Math.min(w, h) * 0.09} />
      </g>
    )
  }
  return (
    <g stroke={stroke} strokeWidth="1.5" fill="none">
      <rect x={x} y={y + h * 0.78} width={w} height={h * 0.14} rx="1" fill={fill} />
      <line x1={x + w * 0.5} y1={y + h * 0.85} x2={x + w * 0.5} y2={y + h * 0.12} />
      <line x1={x + w * 0.22} y1={y + h * 0.12} x2={x + w * 0.78} y2={y + h * 0.12} />
      <line x1={x + w * 0.5} y1={y + h * 0.22} x2={x + w * 0.68} y2={y + h * 0.22} strokeWidth="3" />
    </g>
  )
}

export function PrinterBadge({ enclosed = true, size = 34 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 44 52" aria-hidden="true">
      <PrinterIcon x={4} y={2} w={36} h={48} enclosed={enclosed} />
    </svg>
  )
}

export default PrinterBadge
