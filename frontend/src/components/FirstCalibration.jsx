import React, { useState, useCallback } from 'react'
import { controlService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { SLOT_Z_EXTRA } from '../services/hardware'
import TeachIn from './TeachIn'

/* Geführte Erstkalibrierung (Abschluss des Setup-Assistenten)
   ───────────────────────────────────────────────────────────
   Alles Nötige gab es schon: TeachIn fährt an, man justiert mit den Pfeilen, der
   Wert kommt aus der ECHTEN Ist-Position. Was fehlte, war die REIHENFOLGE — man
   musste wissen, dass es vier Stellen im Drucker-Tab gibt, wie sie zusammenhängen
   und was ein falscher Wert anrichtet.

   Die Kette folgt der Abhängigkeit: Regal 1 ist der Anker, alles andere hängt daran.

     ① Regal 1, Fach 1   → X, Greif-Y und die Höhe von Fachboden 1 (der Anker)
     ② Magazin in R1     → prüft die gerechnete Höhe; nachjustiert ergibt sie den
                            FACH-ABSTAND aus zwei gemessenen Höhen statt aus dem
                            Messschieber
     ③ letztes Regal     → nur X; die Regale dazwischen werden gleichmäßig verteilt
     ④ Drucker           → Auswurf und Einlegen

   Jede Station ist einzeln überspringbar, der ganze Schritt auch. Übersprungenes
   behält seine Vorlagenwerte — es gibt keinen stillen Ausfall, die Station bleibt
   sichtbar offen.

   Bewusst NICHT gebaut: eine eigene Bewegungslogik. Angefahren wird über die
   vorhandenen Operationen (`approach`, `move_to_printer`), gejoggt über /jog mit
   seiner Achsprüfung. Diese Komponente ordnet nur. */

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d)

export default function FirstCalibration({ numRacks = 1, magazineSlot = 7, onDone }) {
  const { tr } = useLanguage()
  const [open, setOpen] = useState('rack1')   // offene Station
  const [done, setDone] = useState({})        // id → 'ok' | 'skip'
  const [busy, setBusy] = useState(false)
  const [err, setErr]   = useState('')

  const nr = Math.max(1, num(numRacks, 1))
  const mag = num(magazineSlot, 0)

  const runHome = async () => {
    setHoming('run'); setErr('')
    try {
      const r = await controlService.executeMacro({ macro_name: 'OTTOEJECT_HOME' })
      const ok = r?.data?.success !== false
      setHoming(ok ? 'ok' : 'err')
      if (!ok && r?.data?.message) setErr(r.data.message)
    } catch (e) {
      setHoming('err')
      setErr(e?.response?.data?.detail || e?.message || tr('Fehler'))
    }
  }

  /* Geometrie lesen, ändern, zurückschreiben. putGeometry ERSETZT die Datei —
     ein blind gesendetes Teilobjekt würde alles andere löschen. */
  const patchGeometry = useCallback(async (fn) => {
    setErr(''); setBusy(true)
    try {
      const g = (await controlService.getGeometry())?.data?.geometry
      if (!g) throw new Error(tr('Geometrie nicht lesbar'))
      await controlService.putGeometry(fn(structuredClone(g)))
      return true
    } catch (e) {
      setErr(e?.response?.data?.detail || e?.message || tr('Fehler'))
      return false
    } finally { setBusy(false) }
  }, [tr])

  /* Stations-Reihenfolge. Steht VOR den Handlern, damit `finish` nicht auf die
     weiter unten gebaute Stationsliste zugreifen muss — das Magazin entfällt ohne
     Magazin-Fach, das äußerste Regal bei nur einem Regal. */
  const IDS = ['rack1', ...(mag > 0 ? ['magazine'] : []),
               ...(nr > 1 ? ['lastRack'] : []), 'eject', 'place']

  const finish = (id, how) => {
    setDone(d => {
      const next = { ...d, [id]: how }
      // Nach einer übernommenen Station gleich die nächste offene aufklappen; nach
      // einem Überspringen bewusst nichts öffnen (der Nutzer wollte gerade nicht).
      setOpen(how === 'ok' ? (IDS.find(x => x !== id && !next[x]) || null) : null)
      return next
    })
  }

  // ── ① Anker: Regal 1, Fach 1 ──────────────────────────────────────────────
  const applyRack1 = async (pos) => {
    const okay = await patchGeometry(g => {
      const rg = { ...(g.rack_geo || {}) }
      rg['1'] = { ...(rg['1'] || {}), x: num(pos.x), y_engage: num(pos.y), first_z: num(pos.z) }
      return { ...g, rack_geo: rg }
    })
    if (okay) finish('rack1', 'ok')
  }

  // ── ② Magazin: aus zwei Höhen folgt der Fach-Abstand ──────────────────────
  const applyMagazine = async (pos) => {
    const okay = await patchGeometry(g => {
      const rg = { ...(g.rack_geo || {}) }
      const r1 = rg['1'] || {}
      const firstZ = num(r1.first_z, num(g.storage?.first_z_flat, 7))
      // z(mag) = first_z + (mag−1)·(slot_gap + 30)  →  nach slot_gap auflösen
      const steps = Math.max(1, mag - 1)
      const gap = Math.round(((num(pos.z) - firstZ) / steps - SLOT_Z_EXTRA) * 100) / 100
      if (!(gap > 0)) return g          // unplausibel → Wert nicht anfassen
      for (const k of Object.keys(rg)) rg[k] = { ...rg[k], slot_gap: gap }
      rg['1'] = { ...(rg['1'] || {}), slot_gap: gap }
      return { ...g, rack_geo: rg, storage: { ...(g.storage || {}), slot_gap: gap } }
    })
    if (okay) finish('magazine', 'ok')
  }

  // ── ③ Letztes Regal: nur X; Zwischenregale gleichmäßig verteilen ──────────
  const applyLastRack = async (pos) => {
    const okay = await patchGeometry(g => {
      const rg = { ...(g.rack_geo || {}) }
      const x1 = num(rg['1']?.x, num(g.storage?.x_unclamp, 43))
      const xn = num(pos.x)
      rg[String(nr)] = { ...(rg[String(nr)] || {}), x: xn, y_engage: num(pos.y) }
      // Gleichmäßig verteilen: bei gleich gebauten Regalen genau richtig, sonst ein
      // guter Startwert — jedes Regal bleibt im Drucker-Tab einzeln korrigierbar.
      for (let r = 2; r < nr; r++) {
        const x = Math.round((x1 + ((xn - x1) * (r - 1)) / (nr - 1)) * 10) / 10
        rg[String(r)] = { ...(rg[String(r)] || {}), x }
      }
      return { ...g, rack_geo: rg }
    })
    if (okay) finish('lastRack', 'ok')
  }

  // ── ④ Drucker: Auswurf und Einlegen ───────────────────────────────────────
  const applyPrinter = (key, id) => async (pos) => {
    const okay = await patchGeometry(g => {
      const list = Array.isArray(g.printers) && g.printers.length ? [...g.printers] : [{}]
      list[0] = { ...list[0], [key]: { x: num(pos.x), y: num(pos.y), z: num(pos.z) } }
      return { ...g, printers: list }
    })
    if (okay) finish(id, 'ok')
  }

  const approachSlot = (rack, slot) => () =>
    controlService.runOp({ op: 'approach', rack, slot })
  const approachPrinter = () => controlService.runOp({ op: 'move_to_printer' })

  /* Stationen. Das Magazin fällt weg, wenn keins konfiguriert ist; das letzte Regal,
     wenn es nur eines gibt — eine Station, die dasselbe zweimal messen ließe, wäre
     kein Schritt, sondern eine Falle. */
  const STATIONS = [
    {
      id: 'rack1', label: tr('Regal 1, Fach 1'), tag: tr('Anker'),
      hint: tr('Der Greifer soll genau vor Fach 1 des Regals direkt am Drucker stehen. Daraus folgen X, Greif-Y und die Höhe von Fachboden 1.'),
      approach: approachSlot(1, 1), apply: applyRack1,
    },
    mag > 0 && {
      id: 'magazine', label: tr('Magazin in Regal 1'), tag: tr('Fach-Abstand'),
      hint: tr('Printloom fährt die gerechnete Höhe des Magazins an. Steht der Greifer daneben, hier nachjustieren — aus den beiden gemessenen Höhen folgt der Fach-Abstand, ohne dass du ihn abmessen musst.'),
      approach: approachSlot(1, mag), apply: applyMagazine,
    },
    nr > 1 && {
      id: 'lastRack', label: tr('Regal {0}, Fach 1', nr), tag: tr('Regal-Abstand'),
      hint: tr('Das äußerste Regal. Daraus folgt der Abstand der Regale; die Regale dazwischen werden gleichmäßig verteilt und bleiben einzeln korrigierbar.'),
      approach: approachSlot(nr, 1), apply: applyLastRack,
    },
    {
      id: 'eject', label: tr('Drucker: Auswurf'), tag: tr('Drucker'),
      hint: tr('Der Greifer muss genau an der Platte im Drucker ansetzen.'),
      approach: approachPrinter, apply: applyPrinter('eject', 'eject'),
    },
    {
      id: 'place', label: tr('Drucker: Einlegen'), tag: tr('Drucker'),
      hint: tr('Position, an der die Platte im Drucker abgesetzt wird.'),
      approach: approachPrinter, apply: applyPrinter('load', 'place'),
    },
  ].filter(Boolean).sort((a, b) => IDS.indexOf(a.id) - IDS.indexOf(b.id))

  const total = STATIONS.length
  const okCount = STATIONS.filter(st => done[st.id] === 'ok').length

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs text-surface-500">
          {tr('Anfahren, mit den Pfeilen justieren, übernehmen — der Wert kommt aus der echten Ist-Position, nicht aus einem Eingabefeld.')}
        </p>
        <span className="text-[10px] font-mono text-surface-600 shrink-0">{okCount}/{total}</span>
      </div>

      {/* Referenzfahrt zuerst — ohne sie verweigert Klipper jede Bewegung. */}
      <div className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
        homing === 'ok'  ? 'border-emerald-800/60 bg-emerald-950/20'
        : homing === 'err' ? 'border-red-800/60 bg-red-950/20'
        : 'border-amber-800/60 bg-amber-950/20'}`}>
        <button type="button" onClick={runHome} disabled={homing === 'run'}
          className="btn btn-secondary btn-sm shrink-0 disabled:opacity-50">
          {homing === 'run' ? tr('Fährt…') : tr('⌂ OTTOeject homen')}
        </button>
        <span className={`text-[10px] leading-snug ${
          homing === 'ok' ? 'text-emerald-300' : homing === 'err' ? 'text-red-300' : 'text-amber-300'}`}>
          {homing === 'ok'  ? tr('✓ Referenzfahrt gemacht — jetzt kannst du anfahren und justieren.')
           : homing === 'err' ? tr('Referenzfahrt fehlgeschlagen — ohne sie verweigert der OTTOeject jede Bewegung.')
           : tr('Zuerst einmal homen. Ohne Referenzfahrt lehnt der OTTOeject jede Bewegung ab, und die Meldung sagt nicht, dass sie fehlt.')}
        </span>
      </div>

      <div className="rounded-lg border border-surface-800 divide-y divide-surface-800/70">
        {STATIONS.map((st, i) => {
          const state = done[st.id]
          const isOpen = open === st.id
          return (
            <div key={st.id}>
              <button type="button" onClick={() => setOpen(isOpen ? null : st.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-surface-900/40 transition-colors">
                <span className={`w-5 h-5 rounded-full border shrink-0 flex items-center justify-center text-[10px] font-mono ${
                  state === 'ok'   ? 'bg-emerald-600 border-emerald-500 text-white'
                  : state === 'skip' ? 'border-surface-700 text-surface-600'
                  : isOpen           ? 'bg-blue-600 border-blue-500 text-white'
                  : 'border-surface-700 text-surface-600'}`}>
                  {state === 'ok' ? '✓' : state === 'skip' ? '–' : i + 1}
                </span>
                <span className={`text-xs flex-1 min-w-0 truncate ${
                  state === 'ok' ? 'text-emerald-300' : 'text-surface-300'}`}>{st.label}</span>
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-surface-800 text-surface-500 shrink-0">{st.tag}</span>
                <span className="text-[10px] text-surface-600 shrink-0">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 space-y-2">
                  <TeachIn title={st.label} hint={st.hint} axes={['x', 'y', 'z']}
                    onApproach={st.approach} onApply={st.apply}
                    onClose={() => setOpen(null)} />
                  <button type="button" onClick={() => finish(st.id, 'skip')}
                    className="text-[10px] text-surface-600 hover:text-surface-400">
                    {tr('Diese Station überspringen →')}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {err && <p className="text-[11px] text-red-400">{err}</p>}
      {busy && <p className="text-[11px] text-surface-600">{tr('Speichere…')}</p>}

      <p className="text-[10px] text-surface-600">
        {tr('Übersprungene Stationen behalten die Werte der Drucker-Vorlage. Nachholen kannst du sie jederzeit im Drucker-Tab über 📐.')}
      </p>
      {onDone && (
        <div className="flex justify-end">
          <button type="button" onClick={onDone} className="btn btn-ghost btn-sm text-[11px]">
            {okCount === total ? tr('✓ Einmessen abgeschlossen') : tr('Einmessen später fortsetzen')}
          </button>
        </div>
      )}
    </div>
  )
}
