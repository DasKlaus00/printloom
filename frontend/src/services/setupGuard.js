/* Läuft der Setup-Assistent auf einer Anlage, die schon eingerichtet ist?
   ─────────────────────────────────────────────────────────────────────
   Dann überschreibt er nichts ohne Rückfrage (seit v1.1.50): Bis v1.1.49 setzte ein
   erneuter Durchlauf den Magazin-Bestand auf die Vorgabe, einen gemeinsamen
   Fach-Abstand über alle Regale und die Vorlagen-Positionen über den eingemessenen
   Drucker. Reine Funktion (getestet). */
export function isExistingInstall(devices, rack) {
  if (Array.isArray(devices) && devices.length > 0) return true
  const slots = rack?.slots || {}
  return Object.values(slots).some(s =>
    s && ((s.status && !['free', 'ready'].includes(s.status)) || s.empty_plate || s.object_height_mm))
}

/* Tragen die Regale verschiedene Fach-Abstände? Dann ist ein gemeinsamer Wert eine
   Änderung, nach der man fragen muss. */
export function hasMixedSlotGaps(geometry) {
  const gaps = Object.values(geometry?.rack_geo || {})
    .map(r => r?.slot_gap).filter(v => v != null).map(Number)
  return new Set(gaps).size > 1
}

/* Gehört der erste Drucker-Block schon einem Gerät oder trägt er eingemessene Werte
   (nicht die der Vorlage)? Dann nur nach Rückfrage durch die Vorlage ersetzen. */
export function printerBlockIsCalibrated(block, presetEject) {
  if (!block || typeof block !== 'object') return false
  if (block.device_id != null) return true
  const e = block.eject
  if (!e || !presetEject) return false
  return ['x', 'y', 'z'].some(k => e[k] != null && presetEject[k] != null && Math.abs(+e[k] - +presetEject[k]) > 0.5)
}
