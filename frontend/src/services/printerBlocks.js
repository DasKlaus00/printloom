/* Drucker-Blöcke der Geometrie auf die Geräteliste abgleichen (seit v1.1.54 eigene Datei).
   ──────────────────────────────────────────────────────────────────────────────────
   Je Gerät ein Block, in Gerätereihenfolge. Gibt es zu einem Gerät keinen Block,
   aber einen VERWAISTEN (Gerät gelöscht und neu angelegt, oder Backup auf neuer
   Datenbank), wird nicht still ein um 400 mm verschobener Block erfunden: Der
   verwaiste kommt als Übernahme-Kandidat zurück, und die Seite fragt. Bis v1.1.53
   bekam das Gerät die erfundenen Positionen, und der Autosave löschte den
   verwaisten Block mit den eingemessenen Werten.

   → { printers, adopt: [{ deviceId, deviceName, blockIdx, blockName }] }.
   Unverändert: dieselbe Referenz `ps` (sonst löste der Effekt sich selbst aus). */
export function reconcilePrinters(ps, devs, seed, { declined = new Set() } = {}) {
  if (!devs.length) return { printers: ps, adopt: [] }
  const ids = new Set(devs.map(d => d.id))
  const taken = new Set()
  const out = []
  const adopt = []
  for (const [i, d] of devs.entries()) {
    let idx = ps.findIndex((p, k) => !taken.has(k) && p.device_id === d.id)
    if (idx < 0) idx = ps.findIndex((p, k) => !taken.has(k) && p.device_id == null)
    if (idx < 0 && !declined.has(d.id)) {
      const orphan = ps.findIndex((p, k) => !taken.has(k) && p.device_id != null && !ids.has(p.device_id))
      if (orphan >= 0) {
        taken.add(orphan)
        adopt.push({ deviceId: d.id, deviceName: d.name, blockIdx: orphan, blockName: ps[orphan].name || '' })
        out.push(ps[orphan])           // bleibt stehen, bis die Frage beantwortet ist
        continue
      }
    }
    if (idx < 0) { out.push(seed(out[out.length - 1] || ps[0], d, i)); continue }
    taken.add(idx)
    const p = ps[idx]
    out.push(p.device_id === d.id && p.name === d.name && (p.model || '') === (d.model || '')
      ? p
      // Name und Modell gehören dem Gerät — hier stünden sie sonst ein zweites Mal.
      : { ...p, device_id: d.id, name: d.name, model: d.model || p.model || '' })
  }
  const next = [...out, ...ps.filter((_, k) => !taken.has(k))]
  const same = next.length === ps.length && next.every((p, i) => p === ps[i])
  return { printers: same ? ps : next, adopt }
}

/* Antwort „Ja": Der verwaiste Block gehört jetzt diesem Gerät. */
export function adoptBlock(ps, { deviceId, deviceName, blockIdx }) {
  return ps.map((p, k) => (k === blockIdx ? { ...p, device_id: deviceId, name: deviceName } : p))
}
