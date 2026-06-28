// Farb-Klartext (1.6): ordnet einem Hex den nächstgelegenen Bambu-Katalognamen zu
// (Firebrick, Charcoal, Dark Red …). Quelle: backend/app/routers/filaments.py.
// Nur benennen, wenn die Farbe klar passt (kleine Distanz) — sonst zeigt die UI
// ehrlich den Hex-Code statt einen falschen Namen anzuhängen.

const PALETTE = [
  ['#FFFFFF','White'],['#1A1A1A','Black'],['#808080','Grey'],['#D32F2F','Red'],['#1565C0','Blue'],
  ['#2E7D32','Green'],['#F9A825','Yellow'],['#E65100','Orange'],['#F48FB1','Pink'],['#6A1B9A','Purple'],
  ['#5D4037','Brown'],['#D7C5A8','Beige'],['#E8F5E9','Jade White'],['#FFFFF0','Ivory'],['#36454F','Charcoal'],
  ['#F5F5F5','White'],['#212121','Black'],['#C62828','Red'],['#1E3A5F','Blue'],['#8FAF8E','Sage Green'],
  ['#C8A97E','Desert Tan'],['#F6EF78','Lemon Yellow'],['#B39DDB','Lilac Purple'],['#BE5832','Terracotta'],
  ['#FFF8E7','Cream White'],['#B0BEC5','Misty Grey'],['#FFD700','Gold'],['#C0C0C0','Silver'],['#B87333','Copper'],
  ['#B76E79','Rose Gold'],['#CD7F32','Bronze'],['#F7E7CE','Champagne Gold'],['#5C85D6','Silk Blue'],
  ['#4CAF50','Silk Green'],['#E53935','Silk Red'],['#8E24AA','Silk Purple'],['#1C1C2E','Galaxy Black'],
  ['#283593','Starry Blue'],['#4A148C','Purple Galaxy'],['#00897B','Teal'],['#00BCD4','Cyan'],['#AD1457','Magenta'],
  ['#1A237E','Cobalt Blue'],['#1B5E20','Forest Green'],['#FF7043','Coral'],['#EF6C00','Orange'],['#4DB6AC','Teal'],
  ['#0D1B4B','Deep Blue'],['#4A5240','Moss Green'],['#2ECC71','Emerald Green'],['#F8F4EC','Pearl White'],
  ['#7B1FA2','Red Galaxy'],['#4E3A0C','Gold Galaxy'],['#1B4332','Green Galaxy'],['#9E9E9E','Grey Marble'],
  ['#F3E5E8','Pink Marble'],['#F0EDE6','White Marble'],['#2C2C2C','Black Marble'],['#3E5B45','Green Marble'],
  ['#E0F7FA','Transparent'],['#B3D9F5','Translucent Blue'],['#D6EAF8','Transparent'],['#E8DCC8','Natural'],
]

function rgb(hex) {
  const s = (hex || '').replace('#', '').padEnd(6, '0').slice(0, 6)
  return [parseInt(s.slice(0, 2), 16) || 0, parseInt(s.slice(2, 4), 16) || 0, parseInt(s.slice(4, 6), 16) || 0]
}
function dist(a, b) {
  const [r1, g1, b1] = rgb(a), [r2, g2, b2] = rgb(b)
  return Math.sqrt((r1 - r2) ** 2 + (g1 - g2) ** 2 + (b1 - b2) ** 2)
}

/** Nächster Bambu-Farbname zu `hex`, oder null wenn nichts klar genug passt (Distanz > maxDist). */
export function nearestColorName(hex, maxDist = 18) {
  if (!hex) return null
  let best = null, bd = Infinity
  for (const [h, name] of PALETTE) {
    const d = dist(hex, h)
    if (d < bd) { bd = d; best = name }
  }
  return bd <= maxDist ? best : null
}

/** „Dark Red" wenn bekannt, sonst „#BB3D43". Praktisch für Labels. */
export function colorLabel(hex) {
  if (!hex) return ''
  const h = hex.startsWith('#') ? hex : `#${hex}`
  return nearestColorName(h) || h.toUpperCase().slice(0, 7)
}
