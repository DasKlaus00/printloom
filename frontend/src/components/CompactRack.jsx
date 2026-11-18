import React, { useState, useEffect, useCallback } from 'react'
import { apiError } from '../services/apiError'
import { controlService, rackManagerService } from '../services/api'
import { patchGeometry } from '../services/geometryClient'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { rackSaveError } from '../services/rackForm'
import { SLOT_Z_EXTRA } from '../services/hardware'
import { compactPlateSource } from '../services/rackUtils'
import TeachIn from './TeachIn'

/* Kompakt-Regal einrichten (seit v1.1.80)
   ──────────────────────────────────────
   Bewusst NICHT der alte Weg (Fachhöhe, Toleranz, Stapel-Anteil, Magazin-Fach,
   Fach-Abstand vom Messschieber). Stattdessen:

     Aufbau      vier vorbelegte Angaben und die Zahl der leeren Platten — das Bild
                 daneben zeigt sofort, wo was liegt.
     Einmessen   drei Handgriffe: unterstes Fach von Regal 1 (daraus X, Greif-Y, Höhe),
                 oberstes Fach (daraus der echte Fachabstand), Einlege-Punkt. Für jedes
                 weitere Regal nur noch X.
     Testen      eine leere Platte holen, in Regal 1 oben ablegen.

   Die Regeln, nach denen die Farm dann holt und ablegt, stehen in
   backend/app/services/rack_logic.py („Kompakt-Regal"). */

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d)

/* Kleines Bild: je Regal eine Spalte, unten Fach 1. */
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
          <div className="flex flex-col-reverse gap-px border border-surface-600 rounded-sm p-0.5">
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

  useEffect(() => {
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
  // (rack_logic.compact_fill_order): letztes Regal von unten, dann das davor.
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
        {tr('Lege die leeren Platten von unten in das letzte Regal, ohne Lücke. Die Farm holt immer die oberste. Zwischen einem fertigen Druck und einer leeren Platte lässt sie ein Fach frei.')}
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

/* Eine Messstation. Außerhalb der Komponente definiert: Innen entstünde bei jedem
   Neuzeichnen ein neuer Typ, und das geöffnete TeachIn verlöre seine Position. */
function Station({ id, nrLabel, title, text, value, open, done, busy, onToggle, tr, children }) {
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
        </div>
        <button onClick={() => onToggle(id)} disabled={busy}
          className="btn-secondary text-xs shrink-0 disabled:opacity-50">
          {open ? tr('Schließen') : tr('📐 Einmessen')}
        </button>
      </div>
      {open && children}
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

  const load = useCallback(async () => {
    try {
      const [g, r] = await Promise.all([controlService.getGeometry(), rackManagerService.getAll()])
      setGeo(g?.data?.geometry || null)
      setRack(r?.data || null)
    } catch (e) { setErr(apiError(e, tr('Fehler'))) }
  }, [tr])
  useEffect(() => { load() }, [load])

  const nr  = num(rack?.num_racks, 1)
  const spr = num(rack?.slots_per_rack, 24)
  const r1  = geo?.rack_geo?.['1'] || {}

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

  // ① Unterstes Fach von Regal 1 → X, Greif-Y und Höhe. Greif-Y und Höhe gelten
  //   für alle Regale (gleich gebaut); X misst jedes Regal einzeln (④).
  const applyR1 = (pos) => patch(g => {
    const rg = { ...(g.rack_geo || {}) }
    for (let r = 1; r <= nr; r++) {
      rg[r] = { ...(rg[r] || {}), y_engage: pos.y, first_z: pos.z, ...(r === 1 ? { x: pos.x } : {}) }
    }
    return { ...g, rack_geo: rg }
  }, 'r1', tr('✓ Regal 1: X {0} · Y {1} · Z {2}', pos.x, pos.y, pos.z))

  // ② Oberstes Fach → echter Fachabstand aus zwei gemessenen Höhen.
  const applyTop = async (pos) => {
    const z1 = num(r1.first_z, NaN)
    const pitch = (num(pos.z) - z1) / Math.max(1, spr - 1)
    if (!Number.isFinite(pitch) || pitch < 8 || pitch > 60) {
      setErr(tr('Gemessener Fachabstand {0} mm ist unplausibel — erst das unterste Fach einmessen.',
                Number.isFinite(pitch) ? pitch.toFixed(1) : '?'))
      return
    }
    const p = Math.round(pitch * 100) / 100
    try {
      await rackManagerService.updateConfig({ slot_height_mm: p })
    } catch (e) { setErr(rackSaveError(e)); return }
    await patch(g => {
      const rg = { ...(g.rack_geo || {}) }
      for (let r = 1; r <= nr; r++) rg[r] = { ...(rg[r] || {}), slot_gap: p - SLOT_Z_EXTRA }
      return { ...g, rack_geo: rg, storage: { ...(g.storage || {}), slot_gap: p - SLOT_Z_EXTRA } }
    }, 'top', tr('✓ Fachabstand gemessen: {0} mm', p))
  }

  // ③ Einlege-Punkt: wie weit vor „ganz drin" die Vorderkante auf dem Eingang liegt.
  const applyEntry = (pos) => {
    const entry = num(r1.y_engage, NaN) - num(pos.y)
    if (!(entry > 0)) {
      setErr(tr('Der Einlege-Punkt muss vor dem Greifpunkt liegen (kleinere Y) — erst das unterste Fach einmessen.'))
      return
    }
    return patch(g => ({ ...g, compact_entry_mm: Math.round(entry * 10) / 10 }),
                 'entry', tr('✓ Einlege-Weg {0} mm', Math.round(entry * 10) / 10))
  }

  // ④ Weitere Regale: nur X.
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

      <Station {...st('r1')} id="r1" nrLabel="1" title={tr('Regal 1 · unterstes Fach')}
        text={tr('Greifer auf Fachhöhe ganz unter die Platte im untersten Fach fahren — so tief, wie er beim Holen hineinfährt.')}
        value={`X ${r1.x ?? '—'} · Y ${r1.y_engage ?? '—'} · Z ${r1.first_z ?? '—'}`}>
        <TeachIn title={tr('Regal 1 · unterstes Fach')} axes={['x', 'y', 'z']}
          hint={tr('Unter die Platte, ganz hinein.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: 1, slot: 1 })}
          onApply={applyR1} onClose={() => setOpen('')} />
      </Station>

      <Station {...st('top')} id="top" nrLabel="2" title={tr('Regal 1 · oberstes Fach')}
        text={tr('Nur die Höhe: genauso unter das oberste Fach (Fach {0}). Daraus rechnet Printloom den echten Fachabstand.', spr)}
        value={rack.slot_height_mm ? tr('Fachabstand {0} mm', rack.slot_height_mm) : ''}>
        <TeachIn title={tr('Regal 1 · oberstes Fach')} axes={['z']}
          hint={tr('Auf die Höhe des obersten Fachs.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: 1, slot: spr })}
          onApply={applyTop} onClose={() => setOpen('')} />
      </Station>

      <Station {...st('entry')} id="entry" nrLabel="3" title={tr('Einlege-Punkt')}
        text={tr('Eine Platte mit dem Magnet-Greifer halten und vor Regal 1 so weit vorfahren, dass ihre Vorderkante etwa 1 cm auf dem Eingang des Fachs liegt. Von dort schiebt die Farm sie auf Fachhöhe hinein.')}
        value={geo.compact_entry_mm ? tr('Einlege-Weg {0} mm', geo.compact_entry_mm) : tr('noch nicht eingemessen')}>
        <TeachIn title={tr('Einlege-Punkt')} axes={['y']}
          hint={tr('Vorderkante ~1 cm auf dem Regaleingang.')}
          onApproach={() => controlService.runOp({ op: 'approach', rack: 1, slot: spr })}
          onApply={applyEntry} onClose={() => setOpen('')} />
      </Station>

      {Array.from({ length: Math.max(0, nr - 1) }, (_, i) => i + 2).map(r => (
        <Station key={r} {...st(`x${r}`)} id={`x${r}`} nrLabel={`R${r}`} title={tr('Regal {0} · Position', r)}
          text={tr('Nur X: vor das unterste Fach von Regal {0}. Höhe und Tiefe sind wie bei Regal 1.', r)}
          value={`X ${geo.rack_geo?.[String(r)]?.x ?? '—'}`}>
          <TeachIn title={tr('Regal {0} · Position', r)} axes={['x']}
            hint={tr('Vor das unterste Fach.')}
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
            onClick={() => runTest('store', 1, spr,
              tr('Der Arm legt die Platte im Greifer in Regal 1 Fach {0} ab (Vorderkante an den Eingang, dann hineinschieben).', spr))}>
            {tr('In Regal 1 oben ablegen')}
          </button>
        </div>
      </div>

      {msg && <p className="text-xs text-emerald-400">{msg}</p>}
      {err && <p className="text-xs text-red-400">{err}</p>}
    </div>
  )
}
