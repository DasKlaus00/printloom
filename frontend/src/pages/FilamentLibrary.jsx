import { useState, useEffect, useCallback } from 'react'
import { filamentService } from '../services/api'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'

const MATERIALS = [
  'Alle', 'PLA Basic', 'PLA Matte', 'PLA Silk', 'PLA Sparkle', 'PLA Marble',
  'PETG Basic', 'PETG HF', 'ABS', 'ASA', 'TPU 95A HF', 'TPU 90A',
  'PA6-CF', 'PA-CF', 'PPA-CF', 'PPA-GF', 'PC', 'Support W', 'Support PLA', 'HIPS', 'PVA',
]

function ColorSwatch({ hex, size = 'md' }) {
  const s = size === 'sm' ? 'w-4 h-4' : 'w-6 h-6'
  return (
    <span
      className={`${s} rounded-full border border-white/15 shrink-0 inline-block`}
      style={{ backgroundColor: hex || '#888' }}
    />
  )
}

function FilamentCard({ f, isCustom, idx, onEdit, onDelete }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-900/50 border border-surface-800/40 hover:border-surface-700/60 transition-colors group">
      <ColorSwatch hex={f.color_hex} />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-surface-200 truncate">{f.name}</p>
        <p className="text-[10px] text-surface-500 truncate">{f.brand} · {f.material}</p>
      </div>
      {f.article && (
        <span className="text-[9px] font-mono text-surface-600 shrink-0 hidden sm:block">{f.article}</span>
      )}
      {isCustom && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
          <button onClick={() => onEdit(idx, f)} className="text-surface-600 hover:text-blue-400 text-xs px-1">✎</button>
          <button onClick={() => onDelete(idx)} className="text-surface-600 hover:text-red-400 text-xs px-1">×</button>
        </div>
      )}
    </div>
  )
}

function CustomForm({ initial, onSave, onCancel }) {
  const { tr } = useLanguage()
  const [brand, setBrand]       = useState(initial?.brand    ?? '')
  const [material, setMaterial] = useState(initial?.material ?? '')
  const [name, setName]         = useState(initial?.name     ?? '')
  const [colorHex, setColorHex] = useState(initial?.color_hex ?? '#FFFFFF')
  const [article, setArticle]   = useState(initial?.article  ?? '')
  const [saving, setSaving]     = useState(false)

  const submit = async () => {
    if (!brand || !material || !name) return
    setSaving(true)
    await onSave({ brand, material, name, color_hex: colorHex, article })
    setSaving(false)
  }

  return (
    <div className="rounded-xl border border-blue-700/40 bg-blue-950/20 p-4 space-y-3">
      <p className="text-[11px] font-semibold text-blue-300">{initial ? tr('Filament bearbeiten') : tr('Neues Filament')}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div>
          <label className="block text-[9px] text-surface-500 mb-0.5">{tr('Marke*')}</label>
          <input value={brand} onChange={e => setBrand(e.target.value)} placeholder={tr('z.B. Bambu Lab')} className="w-full text-[11px] h-7 py-0" />
        </div>
        <div>
          <label className="block text-[9px] text-surface-500 mb-0.5">{tr('Material*')}</label>
          <input value={material} onChange={e => setMaterial(e.target.value)} placeholder={tr('z.B. PLA Basic')} className="w-full text-[11px] h-7 py-0" />
        </div>
        <div>
          <label className="block text-[9px] text-surface-500 mb-0.5">{tr('Name*')}</label>
          <input value={name} onChange={e => setName(e.target.value)} placeholder={tr('z.B. Midnight Black')} className="w-full text-[11px] h-7 py-0" />
        </div>
        <div>
          <label className="block text-[9px] text-surface-500 mb-0.5">{tr('Farbe')}</label>
          <div className="flex items-center gap-2">
            <input type="color" value={colorHex} onChange={e => setColorHex(e.target.value)}
              className="w-8 h-7 rounded cursor-pointer border border-surface-700 p-0" />
            <input value={colorHex} onChange={e => setColorHex(e.target.value)}
              placeholder="#FFFFFF" className="flex-1 text-[11px] font-mono h-7 py-0" />
          </div>
        </div>
        <div>
          <label className="block text-[9px] text-surface-500 mb-0.5">{tr('Artikel-Nr.')}</label>
          <input value={article} onChange={e => setArticle(e.target.value)} placeholder={tr('z.B. AC-P01A01')} className="w-full text-[11px] font-mono h-7 py-0" />
        </div>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={submit} disabled={saving || !brand || !material || !name}
          className="btn btn-secondary btn-sm text-xs">
          {saving ? '…' : (initial ? tr('Speichern') : tr('Hinzufügen'))}
        </button>
        <button onClick={onCancel} className="btn btn-ghost btn-sm text-xs">{tr('Abbrechen')}</button>
      </div>
    </div>
  )
}

export default function FilamentLibrary() {
  const { tr } = useLanguage()
  const [builtin, setBuiltin]       = useState([])
  const [custom, setCustom]         = useState([])
  const [loading, setLoading]       = useState(true)
  const [filterMat, setFilterMat]   = useState('Alle')
  const [search, setSearch]         = useState('')
  const [showForm, setShowForm]     = useState(false)
  const [editEntry, setEditEntry]   = useState(null)
  const [editIdx, setEditIdx]       = useState(null)
  const [feedback, setFeedback]     = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await filamentService.list()
      setBuiltin(r.data.builtin ?? [])
      setCustom(r.data.custom ?? [])
    } catch {
      setFeedback({ ok: false, msg: tr('Fehler beim Laden') })
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!feedback) return
    const t = setTimeout(() => setFeedback(null), 3000)
    return () => clearTimeout(t)
  }, [feedback])

  const filter = (list) => list.filter(f => {
    const matchMat = filterMat === 'Alle' || f.material === filterMat
    const q = search.toLowerCase()
    const matchSearch = !q || [f.name, f.brand, f.material, f.article ?? ''].some(v => v.toLowerCase().includes(q))
    return matchMat && matchSearch
  })

  const handleAddCustom = async (data) => {
    try {
      await filamentService.addCustom(data)
      await load()
      setShowForm(false)
      setFeedback({ ok: true, msg: tr('Filament hinzugefügt.') })
    } catch {
      setFeedback({ ok: false, msg: tr('Fehler beim Speichern') })
    }
  }

  const handleUpdateCustom = async (data) => {
    try {
      await filamentService.updateCustom(editIdx, data)
      await load()
      setEditEntry(null); setEditIdx(null)
      setFeedback({ ok: true, msg: tr('Filament aktualisiert.') })
    } catch {
      setFeedback({ ok: false, msg: tr('Fehler beim Speichern') })
    }
  }

  const handleDelete = async (idx) => {
    if (!(await confirmDialog({ title: tr('Filament löschen'), message: tr('Filament wirklich löschen?'), confirmLabel: tr('Löschen') }))) return
    try {
      await filamentService.deleteCustom(idx)
      await load()
      setFeedback({ ok: true, msg: tr('Gelöscht.') })
    } catch {
      setFeedback({ ok: false, msg: tr('Fehler beim Löschen') })
    }
  }

  const filteredBuiltin = filter(builtin)
  const filteredCustom  = filter(custom)

  const builtinMaterialGroups = filteredBuiltin.reduce((acc, f) => {
    ;(acc[f.material] ??= []).push(f)
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-surface-100">{tr('Filamente')}</h1>
        <p className="text-sm text-surface-500 mt-0.5">
          {tr('Bambu Lab Katalog · {0} eingebaut · {1} eigene', builtin.length, custom.length)}
        </p>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`text-xs px-3 py-2 rounded-lg border ${feedback.ok ? 'bg-emerald-950/30 border-emerald-800/40 text-emerald-300' : 'bg-red-950/30 border-red-800/40 text-red-300'}`}>
          {feedback.msg}
        </div>
      )}

      {/* Search + Filter */}
      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={tr('Suchen…')}
          className="text-[11px] h-7 py-0 w-44"
        />
        <div className="flex flex-wrap gap-1">
          {MATERIALS.map(m => (
            <button
              key={m}
              onClick={() => setFilterMat(m)}
              className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                filterMat === m
                  ? 'border-blue-600/80 bg-blue-900/30 text-blue-300'
                  : 'border-surface-700/50 text-surface-500 hover:text-surface-300'
              }`}
            >{tr(m)}</button>
          ))}
        </div>
      </div>

      {loading && <p className="text-xs text-surface-600">{tr('Lade…')}</p>}

      {/* Custom filaments */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <p className="section-label">{tr('Eigene Filamente')}</p>
          <button
            onClick={() => { setShowForm(true); setEditEntry(null); setEditIdx(null) }}
            className="btn btn-ghost btn-sm text-xs"
          >{tr('+ Hinzufügen')}</button>
        </div>

        {(showForm && !editEntry) && (
          <CustomForm
            onSave={handleAddCustom}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editEntry && (
          <CustomForm
            initial={editEntry}
            onSave={handleUpdateCustom}
            onCancel={() => { setEditEntry(null); setEditIdx(null) }}
          />
        )}

        {filteredCustom.length === 0 && !showForm && !editEntry ? (
          <p className="text-[11px] text-surface-600 py-2">{tr('Noch keine eigenen Filamente. Klicke „+ Hinzufügen".')}</p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {filteredCustom.map((f, i) => (
              <FilamentCard
                key={i} f={f} isCustom idx={i}
                onEdit={(idx, entry) => { setEditIdx(idx); setEditEntry(entry); setShowForm(false) }}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}
      </div>

      {/* Built-in catalog by material group */}
      <div className="space-y-4">
        <p className="section-label">{tr('Bambu Lab Katalog')}</p>
        {Object.entries(builtinMaterialGroups).map(([mat, items]) => (
          <div key={mat} className="card space-y-2">
            <p className="text-[11px] font-semibold text-surface-400 mb-1">{mat}</p>
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((f, i) => (
                <FilamentCard key={i} f={f} isCustom={false} />
              ))}
            </div>
          </div>
        ))}
        {Object.keys(builtinMaterialGroups).length === 0 && !loading && (
          <p className="text-[11px] text-surface-600">{tr('Keine Ergebnisse.')}</p>
        )}
      </div>
    </div>
  )
}
