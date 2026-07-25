/* ── Verbaute Hardware-Komponenten → Standard-Konfiguration ────────────────────
   Der Setup-Assistent fragt zuerst ab, WAS gebaut ist; daraus wird die
   Grundkonfiguration abgeleitet (Fächer je Regal, Z-Schritt, Magazin).
   Alle abgeleiteten Werte bleiben danach editierbar — das hier sind Startwerte.

   Z-SCHRITT vs. slot_gap: Gemessen wird der Abstand von Fach zu Fach (pitch).
   Die OTTOeject-Mathematik rechnet mit `slot_gap`, wobei der effektive Schritt
   `slot_gap + 30` ist (30 mm = Halter, SLOT_Z_EXTRA im Backend). Deshalb wird in
   der UI der PITCH abgefragt und intern in slot_gap umgerechnet — sonst müsste
   der Nutzer bei der Kompakt-Halterung „−5" eintragen. */

export const SLOT_Z_EXTRA = 30

export const pitchToGap = (pitch) => Number(pitch) - SLOT_Z_EXTRA
export const gapToPitch = (gap) => Number(gap) + SLOT_Z_EXTRA

/* Halterung bestimmt, WIE VIELE Positionen ein Regal hat und wie hoch der
   Z-Schritt ist. positions = physische Fachpositionen je Regal-Turm. */
export const HOLDERS = [
  {
    id: 'standard',
    name: 'Standard-Halterung',
    badge: 'Standard',
    desc: '25 mm Spalt zwischen den Haltern → 55 mm von Fach zu Fach. 7 Positionen je Regal. Passt zur Original-Kalibrierdatei des OTTOeject.',
    positions: 7,
    pitch: 55,
    slot_height_mm: 50,
  },
  {
    id: 'compact',
    name: 'Kompakt-Halterung',
    desc: 'Flache Halter: alle 25 mm ein Fach, ~260 mm von Aluprofil zu Aluprofil → 10 Positionen je Regal. Viel mehr Platten, aber nur ~20 mm Bauhöhe je Druck.',
    positions: 10,
    pitch: 25,
    slot_height_mm: 20,
  },
]

/* Oberstes Fach: Magazin (Nachschub-Stapel) oder normales Lagerfach. */
export const TOP_SLOT_OPTIONS = [
  {
    id: 'magazine',
    name: 'Oberstes Fach = Magazin',
    badge: 'Standard',
    desc: 'Das oberste Fach hält einen Stapel LEERER Druckplatten. Die Farm holt sich daraus selbst Nachschub — echter unbeaufsichtigter Dauerbetrieb. Die Fächer darunter lagern die fertigen Drucke.',
  },
  {
    id: 'storage',
    name: 'Alle Fächer = Lagerfächer',
    desc: 'Kein Magazin: die leeren Platten liegen BEREITS in den Fächern. In der Farm-Ansicht markierst du je Fach mit ▭, wo eine leere Platte liegt — die Farm greift von oben nach unten daraus und legt den fertigen Druck in ein Fach OHNE Platte. Ein Lagerfach mehr, aber Nachschub legst du selbst ein.',
  },
]

export const COMPONENT_GROUPS = [
  { id: 'holder',  title: 'Regal-Halterung', hint: 'Welche Fachhalter sind verbaut?',   options: HOLDERS },
  { id: 'topSlot', title: 'Oberstes Fach',   hint: 'Wofür nutzt du die oberste Position?', options: TOP_SLOT_OPTIONS },
]

export const DEFAULT_COMPONENTS = { holder: 'standard', topSlot: 'magazine' }

/** Gewählte Option eines Bereichs (fällt auf die erste/Standard-Option zurück). */
export function optionOf(groupId, selectedId) {
  const g = COMPONENT_GROUPS.find(x => x.id === groupId)
  if (!g) return null
  return g.options.find(o => o.id === selectedId) || g.options[0]
}

/**
 * Komponenten-Auswahl → konkrete Konfiguration.
 *   slots_per_rack / magazine_slot / slot_height_mm → Rack-Konfiguration
 *   slot_gap                                       → Geometrie (storage.slot_gap)
 *   plates_per_rack                                → magazine_defaults je Regal
 * Mit Magazin: oberste Position ist das Magazin, darunter wird gelagert.
 * Ohne Magazin: alle Positionen lagern UND sind mit leeren Platten vorbelegt.
 */
export function derivedConfig(selection) {
  const sel = { ...DEFAULT_COMPONENTS, ...(selection || {}) }
  const holder = optionOf('holder', sel.holder)
  const withMag = optionOf('topSlot', sel.topSlot)?.id !== 'storage'
  const positions = holder.positions
  return {
    holder_id: holder.id,
    positions,
    pitch: holder.pitch,
    slot_gap: pitchToGap(holder.pitch),
    slot_height_mm: holder.slot_height_mm,
    with_magazine: withMag,
    slots_per_rack: withMag ? positions - 1 : positions,
    magazine_slot: withMag ? positions : 0,
    // Mit Magazin = Stapelhöhe im Magazin; ohne Magazin = wie viele Fächer
    // beim Start mit einer leeren Platte belegt sind (von unten gezählt).
    plates_per_rack: withMag ? 4 : positions,
  }
}

export const COMPONENTS_KEY = 'printloom_components'

export function loadComponents() {
  try {
    return { ...DEFAULT_COMPONENTS, ...JSON.parse(localStorage.getItem(COMPONENTS_KEY) || '{}') }
  } catch {
    return { ...DEFAULT_COMPONENTS }
  }
}

export function saveComponents(sel) {
  try { localStorage.setItem(COMPONENTS_KEY, JSON.stringify(sel)) } catch {}
}
