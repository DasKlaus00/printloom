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

/* Herkunft einer Option. „ottomat3d" = Original-OTTOeject-Aufbau (so ausgeliefert
   und mit der Original-Kalibrierdatei vermessen), „printloom" = von Printloom
   ergänzte Bauform. Der Tag steht im Assistenten an der Option — ohne ihn ist
   nicht erkennbar, was Originalteil ist und was eine Printloom-Erweiterung. */
export const VENDOR_LABEL = { ottomat3d: 'OTTOmat3D', printloom: 'Printloom' }

/* Halterung bestimmt die REGALSTRUKTUR: wie viele Positionen ein Regal hat und wie
   hoch der Z-Schritt ist. positions = physische Fachpositionen je Regal-Turm.

   `soon: true` = gebaut, aber noch nicht freigegeben — im Assistenten sichtbar
   und ausgegraut. Freigeben heißt: Flag entfernen, sobald die Maße am realen
   Aufbau nachgemessen sind. */
export const HOLDERS = [
  {
    id: 'standard',
    name: 'Standard-Halterung',
    vendor: 'ottomat3d',
    badge: 'Standard',
    desc: '25 mm Spalt zwischen den Haltern → 55 mm von Fach zu Fach. 7 Positionen je Regal. Passt zur Original-Kalibrierdatei des OTTOeject.',
    positions: 7,
    pitch: 55,
    slot_height_mm: 50,
  },
  {
    id: 'compact',
    name: 'Kompakt-Halterung',
    vendor: 'printloom',
    soon: true,
    desc: 'Flache Halter: alle 25 mm ein Fach, ~260 mm von Aluprofil zu Aluprofil → 10 Positionen je Regal. Viel mehr Platten, aber nur ~20 mm Bauhöhe je Druck. Noch in Arbeit: die Y-Tiefe des Greifpunkts ist am realen Aufbau noch nicht nachgemessen.',
    positions: 10,
    pitch: 25,
    slot_height_mm: 20,
  },
]

/* GREIFER — Greifarm und Greifmechanismus. Betrifft nicht das Regal, sondern WIE
   der Arm eine Platte aufnimmt und wieder loslässt:
     'clamp'  — Original: der Arm fährt in X über den Greifpunkt hinaus und
                klemmt/löst die Platte seitlich (clamp_push_mm).
     'magnet' — magnetischer Greifer: kein Zug nach links/rechts, der Arm senkt
                sich nur ab (Z), nimmt die Platte auf und hebt wieder.
   `motion` landet in der Geometrie und steuert dort die erzeugte Bewegung
   (ottoeject_motion.gripper_motion). */
export const GRIPPERS = [
  {
    id: 'standard',
    name: 'Standard-Greifer',
    vendor: 'ottomat3d',
    badge: 'Standard',
    motion: 'clamp',
    desc: 'Der ausgelieferte Greifarm. Er fährt seitlich über den Greifpunkt hinaus und klemmt die Platte in ihrer Halterung fest bzw. schiebt sie beim Ablegen wieder heraus.',
  },
  {
    id: 'magnet',
    name: 'Magnet-Greifer',
    vendor: 'printloom',
    motion: 'magnet',
    badge: 'Test',
    desc: 'Umgebauter Greifarm mit magnetischem Greifmechanismus. Er zieht nicht mehr nach links/rechts, sondern senkt sich nur ab, nimmt die Platte auf und hebt wieder — kürzerer Weg je Fach, und Magazin und Lagerfach werden zur selben Bewegung. Zum Austesten freigegeben: Schwebe-Höhe und Anhebeweg stellst du im Drucker-Tab ein. Erst mit Einzelschritt-Test fahren, nicht gleich mit einer Farm-Sequenz — ob die Platte beim Abheben sicher im Fach bleibt, muss der Testlauf zeigen.',
  },
]

/* Greif-Art des gewählten Greifers ('clamp' | 'magnet'). */
export function gripperMotion(gripperId) {
  return GRIPPERS.find(x => x.id === gripperId)?.motion || 'clamp'
}

/* Oberstes Fach: Lagerfach (Original-Aufbau) oder Magazin (Printloom-Erweiterung).
   Reihenfolge = Anzeige-Reihenfolge im Assistenten, links das Original. Die
   VORAUSWAHL steckt in DEFAULT_COMPONENTS und bleibt bewusst das Magazin: nur damit
   holt sich die Farm selbst Nachschub. Reihenfolge und Vorauswahl sind hier also
   absichtlich zwei verschiedene Dinge. */
export const TOP_SLOT_OPTIONS = [
  {
    id: 'storage',
    name: 'Alle Fächer = Lagerfächer',
    vendor: 'ottomat3d',
    desc: 'Kein Magazin: die leeren Platten liegen BEREITS in den Fächern. In der Farm-Ansicht markierst du je Fach mit ▭, wo eine leere Platte liegt — die Farm greift von oben nach unten daraus und legt den fertigen Druck in ein Fach OHNE Platte. Ein Lagerfach mehr, aber Nachschub legst du selbst ein.',
  },
  {
    id: 'magazine',
    name: 'Oberstes Fach = Magazin',
    vendor: 'printloom',
    badge: 'Standard',
    desc: 'Das oberste Fach hält einen Stapel LEERER Druckplatten. Die Farm holt sich daraus selbst Nachschub — echter unbeaufsichtigter Dauerbetrieb. Die Fächer darunter lagern die fertigen Drucke.',
  },
]

export const COMPONENT_GROUPS = [
  { id: 'holder',  title: 'Regal-Halterung', hint: 'Welche Fachhalter sind verbaut?',      options: HOLDERS },
  { id: 'topSlot', title: 'Oberstes Fach',   hint: 'Wofür nutzt du die oberste Position?', options: TOP_SLOT_OPTIONS },
  { id: 'gripper', title: 'Greifer',         hint: 'Welcher Greifarm ist am OTTOeject?',   options: GRIPPERS },
]

export const DEFAULT_COMPONENTS = { holder: 'standard', topSlot: 'magazine', gripper: 'standard' }

/** Gewählte Option eines Bereichs (fällt auf die erste/Standard-Option zurück). */
export function optionOf(groupId, selectedId) {
  const g = COMPONENT_GROUPS.find(x => x.id === groupId)
  if (!g) return null
  // Fallback ist bewusst die erste FREIGEGEBENE Option: eine gesperrte („soon")
  // darf auch über einen alten gespeicherten Wert nicht wirksam werden.
  return g.options.find(o => o.id === selectedId)
      || g.options.find(o => !o.soon) || g.options[0]
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
  const gripper = optionOf('gripper', sel.gripper)
  const withMag = optionOf('topSlot', sel.topSlot)?.id !== 'storage'
  const positions = holder.positions
  return {
    holder_id: holder.id,
    gripper_id: gripper.id,
    gripper_motion: gripper.motion || 'clamp',
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
