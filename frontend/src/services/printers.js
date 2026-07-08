/* ── Drucker-Presets ────────────────────────────────────────────────────────────
   Startwerte je Modell für den Geometrie-Speicher (Printloom sendet daraus den
   G-code). eject/load = Arm-Position am Drucker; door = Tür-Bewegung (nur bei
   geschlossenen Druckern). Ein Modell setzt nur Werte + enclosed/door — die
   Farm-Macronamen bleiben modellunabhängig fest. */
export const PRINTERS = [
  { id: 'x1c',   name: 'Bambu Lab X1C',          enclosed:true,  eject:{x:425,y:340,z:17.5}, load:{x:425,y:340,z:17.5}, door:{open:{x:104,y:319,z:105,d:370}, close:{x:103,y:322,z:105,d:375}} },
  { id: 'p1s',   name: 'Bambu Lab P1S',          enclosed:true,  eject:{x:421,y:334,z:15},   load:{x:421,y:334,z:15},   door:{open:{x:97,y:303,z:112,d:372},  close:{x:97,y:303,z:112,d:372}} },
  { id: 'p1p',   name: 'Bambu Lab P1P',          enclosed:false, eject:{x:417,y:334,z:15},   load:{x:417,y:334,z:15},   door:null },
  { id: 'a1',    name: 'Bambu Lab A1',           enclosed:false, eject:{x:418,y:318,z:2},    load:{x:418,y:318,z:2},    door:null },
  { id: 'k1c',   name: 'Creality K1C',           enclosed:true,  eject:{x:411,y:329,z:33.5}, load:{x:411,y:329,z:33.5}, door:{open:{x:101,y:321,z:160,d:347}, close:{x:101,y:321,z:160,d:347}} },
  { id: 'cc',    name: 'Elegoo Centauri Carbon', enclosed:true,  eject:{x:423,y:345,z:40},   load:{x:423,y:345,z:40},   door:{open:{x:102,y:326,z:160,d:382}, close:{x:102,y:326,z:160,d:382}} },
  { id: 'kobra', name: 'Anycubic Kobra S1',      enclosed:true,  eject:{x:421,y:344,z:12},   load:{x:421,y:344,z:12},   door:{open:{x:95,y:325,z:138,d:405},  close:{x:95,y:325,z:138,d:405}} },
  { id: 'ad5x',  name: 'Flashforge AD5X',        enclosed:true,  eject:{x:422,y:316,z:10},   load:{x:422,y:316,z:10},   door:null },
]

// Custom Printer = ausschließlich eigener G-code je Operation (keine Start-Positionen).
// eject/load/door bleiben als unschädliche Platzhalter (werden im Custom-Modus ignoriert),
// damit der Geometrie-Speicher/„Vorlage laden" ein gültiges Grundgerüst hat.
export const CUSTOM_PRINTER = {
  id: 'custom', name: 'Custom Printer', enclosed: true, custom: true,
  eject: { x: 420, y: 335, z: 15 }, load: { x: 420, y: 335, z: 15 },
  door: { open: { x: 100, y: 315, z: 120, d: 375 }, close: { x: 100, y: 315, z: 120, d: 375 } },
}

export function findPrinter(id) {
  return PRINTERS.find(p => p.id === id) || (id === 'custom' ? CUSTOM_PRINTER : null)
}
