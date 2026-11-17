/* Was sagt der Hinweis nach einem Abbruch? Reine Funktion (getestet).
   ────────────────────────────────────────────────────────────────────
   Bausteine vom Backend (holding, from, bed), Sätze hier, damit sie übersetzt
   werden: Das Backend kennt die eingestellte Sprache nicht. Unbekannt heißt
   „nachsehen", nie „leer" (bis v1.1.46 stand bei unbekanntem Wert „Der Greifer war leer").

   Rückgabe: { arm: {key, args}, bed: {key, args}, clean } — key ist der deutsche
   tr()-Text, args die Werte dazu. clean = nichts mehr im Greifer und auf dem Bett. */
export function recoveryHint(rec) {
  const holding = rec?.arm?.holding ?? 'none'
  const from = rec?.arm?.from
  const bed = rec?.bed ?? 'empty'

  const arm = holding === 'none'
    ? { key: 'Der Greifer war leer', args: [] }
    : holding === 'empty'
      ? (from ? { key: 'Im Greifer hängt eine LEERE Platte (aus Fach {0})', args: [from] }
              : { key: 'Im Greifer hängt eine LEERE Platte', args: [] })
      : holding === 'printed'
        ? { key: 'Im Greifer hängt eine Platte mit einem FERTIGEN Druck', args: [] }
        : { key: 'Greifer-Inhalt unbekannt — bitte nachsehen', args: [] }

  const bedHint = bed === 'empty'
    ? { key: 'Druckbett leer', args: [] }
    : bed === 'plate'
      ? { key: 'Auf dem Druckbett liegt laut Printloom eine leere Platte', args: [] }
      : bed === 'printed'
        ? { key: 'Auf dem Druckbett liegt laut Printloom ein fertiger Druck', args: [] }
        : { key: 'Auf dem Druckbett liegt laut Printloom ein (laufender oder abgebrochener) Druck', args: [] }

  return { arm: arm, bed: bedHint, armFull: holding !== 'none', bedFull: bed !== 'empty',
           clean: holding === 'none' && bed === 'empty' }
}
