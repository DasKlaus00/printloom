import React, { useState, useEffect, useCallback } from 'react'
import { apiError } from '../services/apiError'
import { controlService, rackManagerService } from '../services/api'
import { patchGeometry } from '../services/geometryClient'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { rackSaveError } from '../services/rackForm'
import { SLOT_Z_EXTRA } from '../services/hardware'
import { compactPlateSource, compactBottomZ, compactReach } from '../services/rackUtils'
import TeachIn from './TeachIn'

/* Kompakt-Regal einrichten (seit v1.1.80)
   ──────────────────────────────────────
   Bewusst NICHT der alte Weg (Fachhöhe, Toleranz, Stapel-Anteil, Magazin-Fach,
   Fach-Abstand vom Messschieber). Stattdessen:

     Aufbau      vier vorbelegte Angaben und die Zahl der leeren Platten — das Bild
                 daneben zeigt sofort, wo was liegt.
     Einmessen   drei Handgriffe an EINEM Regal nach Wahl: Fach 1 (oben) (daraus X,
                 Greif-Y, Höhe), unterstes Fach (daraus der echte Fachabstand),
                 Einlege-Punkt. Für jedes andere Regal nur noch X.
     Testen      eine leere Platte holen, in Regal 1 Fach 1 ablegen.

   FACH 1 IST OBEN (seit v1.1.81), die Nummern zählen nach unten.

   Die Regeln, nach denen die Farm dann holt und ablegt, stehen in
   backend/app/services/rack_logic.py („Kompakt-Regal"). */

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d)

/* Kleines Bild: je Regal eine Spalte, oben Fach 1 — die leeren Platten liegen oben. */
function CompactPicture({ nr, spr, plates, tr }) {
  const n = Math.max(1, Math.min(10, num(nr, 3)))
  const s = Math.max(1, Math.min(40, num(spr, 24)))
  let left = Math.max(0, num(plates, 0))
  const filled = {}
  for (let r = n; r >= 1 && left > 0; r--) { filled[r] = Math.min(s, left); left -= filled[r] }
  return (
    <div className="flex items-end gap-3" aria-hidden="true">
      {Array.from({ length: n }, (_, i) => i + 1).map(r => (
        <div key={r} className="flex flex-col items-center gap-1">
          <span className="text-[10px] text-surface-500">
            {r === 1 ? tr('Drucke ↓') : (filled[r] ? tr('leer') : '')}
          </span>
          <div className="flex flex-col gap-px border border-surface-600 rounded-sm p-0.5">
            {Array.from({ length: s }, (_, j) => j + 1).map(f => (
              <span key={f} className={`block w-6 h-1 rounded-[1px] ${
                f <= (filled[r] || 0) ? 'bg-surface-400' : 'bg-surface-800'}`} />
            ))}
          </div>
          <span className="text-[10px] text-surface-500 font-mono">R{r}</span>
        </div>
      ))}
    </div>
  )
}

/* ── Teil 1: Aufbau und leere Platten (Setup-Schritt „Regal") ───────────── */
export function CompactRackPlan({ onSaved, onBack }) {
  const { tr } = useLanguage()
  const [nr, setNr]           = useState(3)
  const [spr, setSpr]         = useState(24)
  const [pitch, setPitch]     = useState(16)
  const [topOpen, setTopOpen] = useState(true)
  const [clearance, setClearance] = useState(8)
  const [plates, setPlates]   = useState(18)
  const [saving, setSaving]   = useState(false)
  const [err, setErr]         = useState('')
  const [geo, setGeo]         = useState(null)

  useEffect(() => {
    // Nur für die Reichweite in Z (Achsgrenze aus dem Schritt „OTTOeject“).
    controlService.getGeometry().then(r => setGeo(r?.data?.geometry || null))
      .catch(e => setErr(apiError(e, tr('Geometrie nicht lesbar'))))
    rackManagerService.getAll().then(r => {
      const d = r.data ?? {}
      if (d.rack_type !== 'compact') return     // erstes Einrichten: Vorgaben stehen lassen
      if (d.num_racks) setNr(d.num_racks)
      if (d.slots_per_rack) setSpr(d.slots_per_rack)
      if (d.slot_height_mm) setPitch(d.slot_height_mm)
      setTopOpen(!!d.compact_top_open)
      if (d.compact_clearance_mm != null) setClearance(d.compact_clearance_mm)
      setPlates((d.empty_plates || []).length)
    }).catch(e => setErr(apiError(e, tr('Regal nicht lesbar'))))
  }, [tr])

  // Wo die leeren Platten liegen werden — genau die Reihenfolge des Backends
  // (rack_logic.compact_fill_order): letztes Regal ab Fach 1 (oben), dann das davor.
  const where = (() => {
    const out = []
    let left = Math.max(0, num(plates, 0))
    for (let r = Math.max(1, num(nr, 3)); r >= 1 && left > 0; r--) {
      const n = Math.min(Math.max(1, num(spr, 24)), left)
      out.push(tr('Regal {0}: Fächer 1–{1}', r, n))
      left -= n
    }
    return out
  })()
  const tooMany = num(plates, 0) > num(nr, 3) * num(spr, 24)
  const reach = compactReach(geo, num(pitch, 16), num(spr, 24))

  const save = async () => {
    setErr(''); setSaving(true)
    try {
      const p = num(pitch, 16)
      await rackManagerService.updateConfig({
        num_racks: num(nr, 3), slots_per_rack: num(spr, 24), slot_height_mm: p,
        rack_type: 'compact', compact_clearance_mm: num(clearance, 8), compact_top_open: !!topOpen,
      })
      await rackManagerService.compactEmptyPlates(num(plates, 0))
      // Die Bewegung rechnet mit slot_gap + 30 (ottoeject_motion.slot_position):
      // derselbe Fachabstand, aus derselben Eingabe.
      await patchGeometry(g => {
        const rg = { ...(g.rack_geo || {}) }
        for (let r = 1; r <= num(nr, 3); r++) rg[r] = { ...(rg[r] || {}), slot_gap: p - SLOT_Z_EXTRA }
        return { ...g, holder: 'compact', gripper: 'magnet', rack_geo: rg,
                 storage: { ...(g.storage || {}), slot_gap: p - SLOT_Z_EXTRA } }
      }, 'setup')
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      onSaved?.()
    } catch (e) {
      setErr(rackSaveError(e))
    } finally { setSaving(false) }
  }

  const field = 'w-full text-sm'
  return (
    <div className="space-y-4">
      <p className="text-xs text-surface-500">
        {tr('Kompakt-Regal: Die leeren Platten liegen im letzten Regal, fertige Drucke füllen Regal 1 von oben nach unten. Jeder Druck bekommt genau so viel Platz, wie er hoch ist.')}
      </p>
      <div className="flex flex-wrap gap-5 items-start">
        <div className="grid grid-cols-2 gap-3 flex-1 min-w-[16rem]">
          <label className="space-y-1">
            <span className="text-[10px] text-surface-500">{tr('Regale')}</span>
            <input type="number" min="1" max="10" className={field} value={nr} onChange={e => setNr(e.target.value)} />
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-surface-500">{tr('Fächer je Regal')}</span>
            <input type="number" min="2" max="40" className={field} value={spr} onChange={e => setSpr(e.target.value)} />
          </label>
          {reach && !reach.ok && (
            <div className="col-span-2 rounded border border-amber-800 bg-amber-950/40 px-3 py-2 space-y-1.5">
              <p className="text-[11px] text-amber-300"><ReachText reach={reach} spr={num(spr, 24)} pitch={num(pitch, 16)} tr={tr} /></p>
              <button type="button" className="btn-secondary text-xs" onClick={() => setSpr(reach.maxSlots)}>
                {tr('Auf {0} Fächer setzen', reach.maxSlots)}
              </button>
            </div>
          )}
          <label className="space-y-1">
            <span className="text-[10px] text-surface-500">{tr('Fachabstand (mm)')}</span>
            <input type="number" min="8" max="60" step="0.1" className={field} value={pitch} onChange={e => setPitch(e.target.value)} />
            <span className="block text-[10px] text-surface-500">{tr('wird beim Einmessen nachgemessen')}</span>
          </label>
          <label className="space-y-1">
            <span className="text-[10px] text-surface-500">{tr('Zugabe über dem Druck (mm)')}</span>
            <input type="number" min="0" max="60" step="0.5" className={field} value={clearance} onChange={e => setClearance(e.target.value)} />
            <span className="block text-[10px] text-surface-500">{tr('Plattenstärke + Hub beim Tragen + etwas Luft')}</span>
          </label>
          <label className="col-span-2 flex items-center gap-2">
            <input type="checkbox" checked={topOpen} onChange={e => setTopOpen(e.target.checked)} />
            <span className="text-xs text-surface-300">{tr('Über dem obersten Fach ist es offen — ein Druck darf oben herausragen')}</span>
          </label>
          <label className="col-span-2 space-y-1">
            <span className="text-[10px] text-surface-500">{tr('Wie viele leere Platten hast du eingelegt?')}</span>
            <input type="number" min="0" className={field} value={plates} onChange={e => setPlates(e.target.value)} />
            <span className={`block text-[10px] ${tooMany ? 'text-red-400' : 'text-surface-500'}`}>
              {tooMany ? tr('Mehr Platten als Fächer') : (where.length ? where.join(' · ') : tr('keine'))}
            </span>
          </label>
        </div>
        <CompactPicture nr={nr} spr={spr} plates={plates} tr={tr} />
      </div>
      <p className="text-[10px] text-surface-500">
        {tr('Lege die leeren Platten ab Fach 1 (oben) in das letzte Regal, ohne Lücke. Die Farm holt immer die oberste. Zwischen einem fertigen Druck und einer leeren Platte lässt sie ein Fach frei.')}
      </p>
      {err && <p className="text-xs text-red-400">{err}</p>}
      <div className="flex justify-between pt-2">
        <button onClick={onBack} className="btn-secondary text-sm">{tr('← Zurück')}</button>
        <button onClick={save} disabled={saving || tooMany} className="btn-primary text-sm disabled:opacity-50">
          {saving ? tr('Speichere…') : tr('Regal speichern →')}
        </button>
      </div>
    </div>
  )
}

/* Warnung, wenn der Z-Weg des Arms nicht für alle Fächer reicht (eine Stelle für den Text). */
function ReachText({ reach, spr, pitch, tr }) {
  return tr('Der Arm fährt in Z nur bis {0} mm. {1} Fächer à {2} mm brauchen samt Hub und Absenken {3} mm — erreichbar sind höchstens {4} Fächer je Regal. Tiefere Fächer kann die Farm nicht anfahren.',
            reach.zmax, spr, pitch, reach.need, reach.maxSlots)
}

/* Eine Messstation. Außerhalb der Komponente definiert: Innen entstünde bei jedem
   Neuzeichnen ein neuer Typ, und das geöffnete TeachIn verlöre seine Position.
   `blocked` (Text) sperrt die Station mit Begründung, `warn` zeigt einen Hinweis. */
function Station({ id, nrLabel, title, text, value, warn, blocked, open, done, busy, onToggle, tr, children }) {
  return (
    <div className="rounded-lg border border-surface-700 bg-surface-900/40 p-3 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-surface-200">
            <span className="font-mono text-surface-500 mr-1.5">{nrLabel}</span>{title}
            {done && <span className="ml-2 text-emerald-400">✓</span>}
          </p>
          <p className="text-[11px] text-surface-500">{text}</p>
          {value && <p className="text-[11px] font-mono text-surface-400 mt-0.5">{value}</p>}
          {warn && <p className="text-[11px] text-amber-400 mt-1">{warn}</p>}
          {blocked && <p className="text-[11px] text-surface-400 mt-1">{blocked}</p>}
        </div>
        <button onClick={() => onToggle(id)} disabled={busy || !!blocked}
          className="btn-secondary text-xs shrink-0 disabled:opacity-50">
          {open ? tr('Schließen') : tr('📐 Einmessen')}
        </button>
      </div>
      {open && !blocked && children}
    </div>
  )
}

/* ── Teil 2: Einmessen und Testen (Setup-Schritt „Einmessen") ───────────── */
export function CompactRackMeasure() {
  const { tr } = useLanguage()
  const [geo, setGeo]     = useState(null)
  const [rack, setRack]   = useState(null)
  const [open, setOpen]   = useState('')
  const [done, setDone]   = useState({})
  const [msg, setMsg]     = useState('')
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)
  // Mess-Regal: Alle Regale sind gleich gebaut, Höhe, Tiefe und Einlege-Punkt misst
  // man also an EINEM — an dem, an das man am besten herankommt (Alex, 19.11.2026).
  const [mr, setMr]       = useState(1)

  const load = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([controlService.getGeometry(), rackManagerService.getAll()])
      setGeo(g?.data?.geometry || null)
      setRack(r?.data || null)
    } catch (e) { setErr(apiError(e, tr('Fehler'))) }
  }, [tr])
  useEffect(() => { load() }, [load])

  const nr    = num(rack?.num_racks, 1)
  const spr   = num(rack?.slots_per_rack, 24)
  const pitch = num(rack?.slot_height_mm, 16)
  const m     = Math.min(Math.max(1, mr), nr)          // falls es weniger Regale geworden sind
  const rm    = geo?.rack_geo?.[String(m)] || {}
  // Fach 1 ist oben, das unterste Fach liegt (Fächer − 1) Abstände tiefer. Liegt es
  // unter Z 0, gehört die gespeicherte Höhe nicht zu Fach 1 oben — etwa noch aus
  // v1.1.80, als Schritt 1 das unterste Fach war. Dann fährt Schritt 2 nicht los.
  const bottomZ = compactBottomZ(num(rm.first_z, NaN), spr, pitch)
  const topOk   = Number.isFinite(bottomZ) && bottomZ >= 0
  const reach   = compactReach(geo, pitch, spr)
  // Fach 1 kann richtig liegen und trotzdem reicht der Z-Weg nicht bis Fach N: dann
  // ist die Fachzahl die Ursache, nicht die Messung.
  const z1      = num(rm.first_z, NaN)
  const tooMany = !!reach && !reach.ok && z1 + reach.lift <= reach.zmax
                  && z1 >= (reach.maxSlots - 1) * pitch + reach.release
  const bz      = Math.round(bottomZ * 10) / 10

  const patch = async (fn, stationId, okText) => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      await patchGeometry(fn, 'kompakt-einmessen')
      setDone(d => ({ ...d, [stationId]: true }))
      setMsg(okText)
      setOpen('')
      await load()
    } catch (e) {
      setErr(apiError(e, tr('Fehler')))
    } finally { setBusy(false) }
  }

  // ① Fach 1 (oben) am Mess-Regal → X dieses Regals, Greif-Y und Höhe von Fach 1
  //   (first_z). Greif-Y und Höhe gelten für alle Regale; X misst jedes Regal einzeln.
  const applyTop = (pos) => patch(g => {
    const rg = { ...(g.rack_geo || {}) }
    for (let r = 1; r <= nr; r++) {
      rg[r] = { ...(rg[r] || {}), y_engage: pos.y, first_z: pos.z, ...(r === m ? { x: pos.x } : {}) }
    }
    return { ...g, rack_geo: rg }
  }, 'top', tr('✓ Regal {0}, Fach 1: X {1} · Y {2} · Z {3}', m, pos.x, pos.y, pos.z))

  // ② Unterstes Fach → echter Fachabstand aus zwei gemessenen Höhen. Fach 1 liegt
  //   oben, also ist das unterste Fach um (Fächer − 1) Abstände TIEFER.
  const applyBottom = async (pos) => {
    const z1 = num(rm.first_z, NaN)
    const p0 = (z1 - num(pos.z)) / Math.max(1, spr - 1)
    if (!Number.isFinite(p0) || p0 < 8 || p0 > 60) {
      setErr(tr('Gemessener Fachabstand {0} mm ist unplausibel — erst Fach 1 (oben) einmessen.',
                Number.isFinite(p0) ? p0.toFixed(1) : '?'))
      return
    }
    const p = Math.round(p0 * 100) / 100
    try {
      await rackManagerService.updateConfig({ slot_height_mm: p })
    } catch (e) { setErr(rackSaveError(e)); return }
    await patch(g => {
      const rg = { ...(g.rack_geo || {}) }
      for (let r = 1; r <= nr; r++) rg[r] = { ...(rg[r] || {}), slot_gap: p - SLOT_Z_EXTRA }
      return { ...g, rack_geo: rg, storage: { ...(g.storage || {}), slot_gap: p - SLOT_Z_EXTRA } }
    }, 'bottom', tr('✓ Fachabstand gemessen: {0} mm', p))
  }

  // ③ Einlege-Punkt: wie weit vor „ganz drin" die Vorderkante auf dem Eingang liegt.
  const applyEntry = (pos) => {
    const entry = num(rm.y_engage, NaN) - num(pos.y)
    if (!(entry > 0)) {
      setErr(tr('Der Einlege-Punkt muss vor dem Greifpunkt liegen (kleinere Y) — erst Fach 1 (oben) einmessen.'))
      return
    }
    return patch(g => ({ ...g, compact_entry_mm: Math.round(entry * 10) / 10 }),
                 'entry', tr('✓ Einlege-Weg {0} mm', Math.round(entry * 10) / 10))
  }

  // ④ Die übrigen Regale: nur X.
  const applyX = (r) => (pos) => patch(g => {
    const rg = { ...(g.rack_geo || {}) }
    rg[r] = { ...(rg[r] || {}), x: pos.x }
    return { ...g, rack_geo: rg }
  }, `x${r}`, tr('✓ Regal {0}: X {1}', r, pos.x))

  const home = async () => {
    setErr(''); setMsg(''); setBusy(true)
    try {
      const r = await controlService.executeMacro({ macro_name: 'OTTOEJECT_HOME' })
      if (r?.data?.success === false) throw new Error(r.data.message || tr('Referenzfahrt fehlgeschlagen'))
      setMsg(tr('✓ Referenzfahrt fertig'))
    } catch (e) { setErr(apiError(e, tr('Fehler'))) } finally { setBusy(false) }
  }

  const src = compactPlateSource(rack)
  const runTest = async (op, r, s, frage) => {
    if (!await confirmDialog({ title: tr('Test fahren?'), message: frage, confirmLabel: tr('Fahren') })) return
    setErr(''); setMsg(''); setBusy(true)
    try {
      await controlService.runOp({ op, rack: r, slot: s })
      setMsg(op === 'grab'
        ? tr('✓ Platte aus Regal {0} Fach {1} geholt — sie hängt jetzt am Greifer.', r, s)
        : tr('✓ Platte in Regal {0} Fach {1} abgelegt. Lege sie nach dem Test von Hand zurück in ihr Fach.', r, s))
    } catch (e) { setErr(apiError(e, tr('Fehler'))) } finally { setBusy(false) }
  }

  const st = (id) => ({ open: open === id, done: !!done[id], busy, tr,
                        onToggle: (x) => setOpen(o => (o === x ? '' : x)) })

  if (!geo || !rack) return <p className="text-xs text-surface-500">{err || tr('Lade…')}</p>

  const others = Array.from({ length: nr }, (_, i) => i + 1).filter(r => r !== m)
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-surface-500">
          {tr('Drei Handgriffe. Printloom fährt jeweils hin, du justierst mit den Pfeilen, „Übernehmen" speichert die echte Position.')}
        </p>
        <button onClick={home} disabled={busy} className="btn-secondary text-xs shrink-0 disabled:opacity-50">
          {tr('⌂ Referenzfahrt')}
        </button>
      </div>

      {nr > 1 && (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-surface-400">{tr('Messen an')}</span>
            <div className="segmented" role="group" aria-label={tr('Messen an')}>
              {Array.from({ length: nr }, (_, i) => i + 1).map(r => (
                <button key={r} type="button" aria-pressed={m === r} disabled={busy}
                  className={m === r ? 'active' : ''}
                  onClick={() => { setMr(r); setOpen('') }}>
                  {tr('Regal {0}', r)}
                </button>
              ))}
            </div>
          </div>
          <p className="text-[11px] text-surface-500">
            {tr('Alle Regale sind gleich gebaut: Höhe, Tiefe und Einlege-Punkt misst du an einem. Nimm das, an das du am besten herankommst.')}
          </p>
        </div>
      )}

      {reach && !reach.ok && (
        <p className="text-[11px] text-amber-300 rounded border border-amber-800 bg-amber-950/40 px-3 py-2">
          <ReachText reach={reach} spr={spr} pitch={pitch} tr={tr} />
        </p>
      )}

      <Station {...st('top')} id="top" nrLabel="1" title={tr('Regal {0} · Fach 1 (oben)', m)}
        text={tr('Greifer auf Fachhöhe ganz unter die Platte in Fach 1, dem obersten Fach, fahren — so tief, wie er beim Holen hineinfährt.')}
        value={`X ${rm.x ?? '—'} · Y ${rm.y_engage ?? '—'} · Z ${rm.first_z ?? '—'}`}
        warn={!Number.isFinite(bottomZ) || topOk ? ''
          : tooMany
            ? tr('Fach 1 passt, aber Fach {0} läge bei Z {1} mm — der Arm erreicht nur {2} Fächer (siehe oben).', spr, bz, reach.maxSlots)
            : tr('Diese Höhe passt nicht zu Fach 1 oben: Fach {0} läge bei Z {1} mm. Bitte Fach 1 (oben) neu einmessen.', spr, bz)}>
        <TeachIn title={tr('Regal {0} · Fach 1 (oben)', m)} axes={['x', 'y', 'z']}
          hint={tr('Unter die Platte, ganz hinein.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: m, slot: 1 })}
          onApply={applyTop} onClose={() => setOpen('')} />
      </Station>

      <Station {...st('bottom')} id="bottom" nrLabel="2" title={tr('Regal {0} · unterstes Fach', m)}
        text={tr('Nur die Höhe: genauso unter das unterste Fach (Fach {0}). Daraus rechnet Printloom den echten Fachabstand.', spr)}
        value={rack.slot_height_mm ? tr('Fachabstand {0} mm', rack.slot_height_mm) : ''}
        blocked={topOk ? '' : tooMany ? tr('Erst die Fächer je Regal auf {0} setzen (Schritt „Regal“).', reach.maxSlots)
                                     : tr('Erst Schritt 1: Fach 1 (oben) einmessen.')}>
        <TeachIn title={tr('Regal {0} · unterstes Fach', m)} axes={['z']}
          hint={tr('Auf die Höhe des untersten Fachs.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: m, slot: spr })}
          onApply={applyBottom} onClose={() => setOpen('')} />
      </Station>

      <Station {...st('entry')} id="entry" nrLabel="3" title={tr('Einlege-Punkt')}
        text={tr('Eine Platte mit dem Magnet-Greifer halten und vor Regal {0} so weit vorfahren, dass ihre Vorderkante etwa 1 cm auf dem Eingang des Fachs liegt. Von dort schiebt die Farm sie auf Fachhöhe hinein.', m)}
        value={geo.compact_entry_mm ? tr('Einlege-Weg {0} mm', geo.compact_entry_mm) : tr('noch nicht eingemessen')}>
        <TeachIn title={tr('Einlege-Punkt')} axes={['y']}
          hint={tr('Vorderkante ~1 cm auf dem Regaleingang.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: m, slot: 1 })}
          onApply={applyEntry} onClose={() => setOpen('')} />
      </Station>

      {others.map(r => (
        <Station key={r} {...st(`x${r}`)} id={`x${r}`} nrLabel={`R${r}`} title={tr('Regal {0} · Position', r)}
          text={tr('Nur X: vor Fach 1 (oben) von Regal {0}. Höhe und Tiefe sind wie bei Regal {1}.', r, m)}
          value={`X ${geo.rack_geo?.[String(r)]?.x ?? '—'}`}>
          <TeachIn title={tr('Regal {0} · Position', r)} axes={['x']}
            hint={tr('Vor Fach 1 (oben).')}
            onApproach={() => controlService.runOp({ op: 'approach', rack: r, slot: 1 })}
            onApply={applyX(r)} onClose={() => setOpen('')} />
        </Station>
      ))}

      <div className="rounded-lg border border-surface-700 p-3 space-y-2">
        <p className="text-sm text-surface-200">{tr('Testen')}</p>
        <p className="text-[11px] text-surface-500">
          {tr('Erst holen, dann ablegen. Die Farm-Buchhaltung ändert sich dabei nicht — lege die Platte danach von Hand zurück.')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button disabled={busy || !src} className="btn-secondary text-sm disabled:opacity-50"
            onClick={() => runTest('grab', src[0], src[1],
              tr('Der Arm holt die oberste leere Platte aus Regal {0} Fach {1}.', src[0], src[1]))}>
            {src ? tr('Leere Platte holen (Regal {0} · Fach {1})', src[0], src[1]) : tr('Keine leere Platte eingetragen')}
          </button>
          <button disabled={busy || !geo.compact_entry_mm} className="btn-secondary text-sm disabled:opacity-50"
            onClick={() => runTest('store', 1, 1,
              tr('Der Arm legt die Platte im Greifer in Regal 1 Fach {0} ab (Vorderkante an den Eingang, dann hineinschieben).', 1))}>
            {tr('In Regal 1 oben ablegen')}
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  )
}
