/* Ein Farbpunkt für Filament- und AMS-Farben (seit v1.1.71) — die einzige Stelle mit
   style backgroundColor für Farbpunkte (styles.test.js prüft das).
   Der Rand ist immer surface-600: border-white/10 sah man im hellen Thema nicht, ein
   weißes Filament verschwand dort auf der Karte (im Dunkeln ebenso ein schwarzes).
   Unbekannte Farbe: gestrichelter, leerer Kreis statt einer erfundenen Ersatzfarbe. */
import React from 'react'
import { normalizeHex } from '../services/colorNames'
import { useLanguage } from '../services/i18n'

export default function ColorDot({ hex, size = 'w-3 h-3', title }) {
  const { tr } = useLanguage()
  const color = normalizeHex(hex)
  if (!color) {
    return <span className={`${size} rounded-full inline-block shrink-0 border border-dashed border-surface-600`}
                 title={title ?? tr('Farbe unbekannt')} />
  }
  return <span className={`${size} rounded-full inline-block shrink-0 border border-surface-600`}
               style={{ backgroundColor: color }} title={title ?? color} />
}
