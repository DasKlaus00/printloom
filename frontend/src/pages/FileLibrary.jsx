import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { fileService, folderService, printerService, deviceService, filamentService, autofarmService } from '../services/api'
import { useAutoRefresh } from '../services/useAutoRefresh'

function ColorDot({ hex }) {
  if (!hex) return <span className="w-3 h-3 rounded-full bg-surface-700 inline-block" />
  const color = hex.startsWith('#') ? hex : `#${hex}`
  return (
    <span
      className="w-3 h-3 rounded-full inline-block border border-white/10 flex-shrink-0"
      style={{ backgroundColor: color }}
      title={color}
    />
  )
}

/* Sekunden → "1 h 5 min" / "12 min". Für Anzeige & Summen. */
function fmtDuration(sec) {
  if (!sec || sec <= 0) return null
  const h = Math.floor(sec / 3600)
  const m = Math.round((sec % 3600) / 60)
  return h ? `${h} h ${m} min` : `${m} min`
}

/* Presentational: zeigt Druckzeit · Gramm · Höhe. Die Daten kommen vom Eltern-Cache
   (metaById), damit man sie auch für Queue-Summen aufaddieren kann. */
function MetaChips({ meta }) {
  if (!meta) return null
  const time = meta.estimated_time || fmtDuration(meta.time_seconds)
  if (!time && !meta.filament_g && !meta.max_z_mm) return null
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
      {time && (
        <span className="flex items-center gap-1 text-[11px] text-surface-400">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          {time}
        </span>
      )}
      {meta.filament_g && (
        <span className="flex items-center gap-1 text-[11px] text-surface-400">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/></svg>
          {meta.filament_g} g
        </span>
      )}
      {meta.max_z_mm && <span className="text-[11px] text-surface-500">↑ {meta.max_z_mm} mm</span>}
    </span>
  )
}

function ThumbnailPreview({ fileId }) {
  const [show, setShow] = useState(false)
  const [err, setErr] = useState(false)
  const url = fileService.thumbnailUrl(fileId)

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setShow(v => !v)}
        className="w-12 h-12 rounded-lg overflow-hidden bg-surface-900 border border-surface-700 flex items-center justify-center hover:border-blue-500 transition-colors"
        title="Vorschau anzeigen"
      >
        {err ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-surface-600">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
        ) : (
          <img
            src={url}
            alt=""
            onError={() => setErr(true)}
            className="w-full h-full object-cover"
          />
        )}
      </button>
      {show && !err && (
        <div
          className="absolute left-0 top-14 z-50 bg-surface-800 border border-surface-600 rounded-xl shadow-2xl p-2"
          style={{ width: 200 }}
          onClick={() => setShow(false)}
        >
          <img src={url} alt="Vorschau" className="w-full rounded-lg" onError={() => { setErr(true); setShow(false) }} />
        </div>
      )}
    </div>
  )
}

function AmsInfoPanel({ fileId, fileType }) {
  const [info, setInfo]       = useState(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen]       = useState(false)

  const load = useCallback(async () => {
    if (info) { setOpen(o => !o); return }
    setOpen(true); setLoading(true)
    try {
      const r = await fileService.getAmsInfo(fileId)
      setInfo(r.data)
    } catch {
      setInfo({ error: 'Analyse fehlgeschlagen' })
    } finally { setLoading(false) }
  }, [fileId, info])

  if (fileType !== '.3mf' && fileType !== '.gcode') return null

  return (
    <div className="mt-1.5">
      <button
        onClick={load}
        className="flex items-center gap-1.5 text-[11px] text-surface-500 hover:text-blue-400 transition-colors"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        AMS-Analyse
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="mt-2 pl-2 border-l border-surface-700 space-y-1.5">
          {loading && <p className="text-[11px] text-surface-600 animate-pulse">Analysiere…</p>}
          {info?.error && <p className="text-[11px] text-red-400">{info.error}</p>}
          {info && !info.error && info.filament_count === 0 && (
            <p className="text-[11px] text-surface-600">Keine Filament-Info gefunden</p>
          )}
          {info && !info.error && info.filament_count > 0 && (
            <>
              {info.warning && (
                <div className="flex items-start gap-1.5 px-2 py-1.5 rounded bg-amber-950/40 border border-amber-800/60">
                  <span className="text-amber-400 text-[10px] mt-0.5">⚠</span>
                  <p className="text-[10px] text-amber-300">{info.warning}</p>
                </div>
              )}
              <div className="space-y-1">
                {info.filaments.map(f => (
                  <div key={f.index} className="flex items-center gap-2 text-[11px]">
                    <span className="text-surface-600 font-mono w-4 text-right">{f.index}</span>
                    <ColorDot hex={f.color} />
                    <span className="text-surface-400 w-14">{f.type || '—'}</span>
                    <span className="text-surface-600">→</span>
                    <span className="font-mono text-blue-300 px-1.5 py-0.5 rounded bg-blue-950/50 border border-blue-800/50">
                      {f.ams_label}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2 pt-1 border-t border-surface-800">
                <span className="text-[10px] text-surface-600">ams_mapping:</span>
                <code className="text-[11px] text-emerald-400 font-mono">{info.ams_mapping_str}</code>
                <button
                  onClick={() => navigator.clipboard?.writeText(info.ams_mapping_str)}
                  className="text-[10px] text-surface-600 hover:text-surface-400"
                >⎘</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}


const PRESETS_KEY = 'ottomat3d_file_presets'

function loadPresets() {
  try { return JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '{}') } catch { return {} }
}

/* Per-file filament assignment. Stored once in localStorage; AutoFarm reads it on
   "add to queue" and maps each filament to the AMS slot with the same material and
   the closest colour (exact colour wins, else nearest same material — never blocks). */
function FilamentPresetPanel({ fileId, amsSlots, catalog }) {
  const [open,       setOpen]       = useState(false)
  const [presets,    setPresets]    = useState(loadPresets)
  const [search,     setSearch]     = useState('')
  const [pickingIdx, setPickingIdx] = useState(null) // null=closed, 'new'=adding, number=replacing

  const preset    = presets[fileId] ?? { filaments: [] }
  const hasPreset = preset.filaments.length > 0

  const save = (next) => {
    const all = { ...loadPresets(), [fileId]: next }
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all))
    setPresets(all)
  }
  const removeEntry = (i) => save({ ...preset, filaments: preset.filaments.filter((_, j) => j !== i) })
  const clearPreset = () => {
    const all = loadPresets()
    delete all[fileId]
    localStorage.setItem(PRESETS_KEY, JSON.stringify(all))
    setPresets(all)
  }

  const pickFilament = (fil) => {
    const entry = {
      material: fil.material,
      name:     fil.name,
      color:    fil.color_hex,
      article:  fil.article,
      brand:    fil.brand,
      type:     fil.material, // backward compat for AutoFarm AMS matching
    }
    if (pickingIdx === 'new') {
      save({ ...preset, filaments: [...preset.filaments, entry] })
    } else {
      save({ ...preset, filaments: preset.filaments.map((f, j) => j === pickingIdx ? entry : f) })
    }
    setPickingIdx(null)
    setSearch('')
  }

  const getAmsMatch = (f) => {
    if (!amsSlots?.length) return null
    const fBase = (f.material || f.type || '').toUpperCase().trim()
    if (!fBase) return null
    const fWord = fBase.split(' ')[0]
    const pool  = amsSlots.filter(s => {
      const sType = (s.type || '').toUpperCase()
      return sType.includes(fWord) || fBase.includes((sType.split(' ')[0]) || '')
    })
    if (!pool.length) return { slot: null }
    const fColor = (f.color || '').replace('#', '').toLowerCase()
    const exact  = pool.find(s => (s.color || '').toLowerCase() === fColor)
    return { slot: exact || pool[0], exact: !!exact }
  }

  const filtered = search
    ? (catalog ?? []).filter(f =>
        `${f.brand} ${f.material} ${f.name}`.toLowerCase().includes(search.toLowerCase())
      )
    : (catalog ?? [])

  return (
    <div className="mt-1.5">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1.5 text-[11px] transition-colors ${
          hasPreset ? 'text-blue-400 hover:text-blue-300' : 'text-surface-500 hover:text-blue-400'
        }`}
        title="Filament-Preset für AutoFarm"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <circle cx="12" cy="12" r="4"/>
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
        </svg>
        Filament-Preset{hasPreset ? ` (${preset.filaments.length})` : ''}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="mt-2 pl-2 border-l border-surface-700 space-y-1.5">
          <p className="text-[9px] text-surface-600">
            {amsSlots?.length
              ? `AMS: ${amsSlots.length} Slot${amsSlots.length !== 1 ? 's' : ''} — beim Hinzufügen wird exakte Farbe gesucht, sonst nächstes gleiches Material`
              : 'Einmal festlegen — wird beim Hinzufügen zur Queue automatisch auf den passenden AMS-Slot gemappt'}
          </p>

          {/* Existing entries */}
          {preset.filaments.map((f, i) => {
            const match    = getAmsMatch(f)
            const dispName = f.name || f.type || '?'
            const dispMat  = f.material || f.type || ''
            return (
              <div key={i} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: f.color?.startsWith('#') ? f.color : `#${f.color || 'FFFFFF'}` }} />
                <span
                  className="text-[10px] text-surface-400 flex-1 min-w-0 truncate"
                  title={dispName !== dispMat ? `${dispName} (${dispMat})` : dispMat}
                >
                  {dispName}
                  {dispMat && dispMat !== dispName && (
                    <span className="text-surface-600 ml-0.5 text-[8px]">{dispMat}</span>
                  )}
                </span>
                {match?.slot ? (
                  <span
                    className="flex items-center gap-0.5 shrink-0"
                    title={match.exact ? 'Exakte Farbe im AMS' : `Material passt, andere Farbe (Slot ${match.slot.gid})`}
                  >
                    <span className="w-2.5 h-2.5 rounded-full border border-white/10"
                      style={{ backgroundColor: `#${match.slot.color || 'FFFFFF'}` }} />
                    <span className={`text-[8px] font-mono ${match.exact ? 'text-emerald-500' : 'text-amber-500'}`}>
                      →{match.slot.gid ?? '?'}
                    </span>
                  </span>
                ) : match?.slot === null ? (
                  <span className="text-[8px] text-red-500 shrink-0" title="Kein passender AMS-Slot">✗</span>
                ) : null}
                <button
                  onClick={() => { setPickingIdx(i); setSearch('') }}
                  className="text-[9px] text-surface-700 hover:text-blue-400 transition-colors shrink-0"
                  title="Filament ändern"
                >✎</button>
                <button
                  onClick={() => removeEntry(i)}
                  className="text-[9px] text-surface-700 hover:text-red-400 transition-colors shrink-0"
                >×</button>
              </div>
            )
          })}

          {/* Inline catalog picker */}
          {pickingIdx !== null && (
            <div className="border border-surface-700 rounded-lg bg-surface-900/90 p-1.5 space-y-1">
              <input
                autoFocus
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="PLA, Silk, PETG, …"
                className="w-full text-[10px] font-mono h-6 py-0 px-1.5"
              />
              <div className="max-h-32 overflow-y-auto">
                {filtered.slice(0, 80).map((fil, fi) => (
                  <button
                    key={fi}
                    onClick={() => pickFilament(fil)}
                    className="w-full flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-700/60 text-left transition-colors"
                  >
                    <span className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0"
                      style={{ backgroundColor: fil.color_hex?.startsWith('#') ? fil.color_hex : `#${fil.color_hex}` }} />
                    <span className="text-[9px] text-surface-300 min-w-0 truncate">
                      {fil.name}
                      <span className="text-surface-600 ml-1">{fil.material}</span>
                    </span>
                  </button>
                ))}
                {filtered.length === 0 && (
                  <p className="text-[9px] text-surface-600 text-center py-1">Keine Ergebnisse</p>
                )}
              </div>
              <button
                onClick={() => { setPickingIdx(null); setSearch('') }}
                className="text-[9px] text-surface-600 hover:text-surface-400 transition-colors"
              >Abbrechen</button>
            </div>
          )}

          {/* Add / clear buttons */}
          {pickingIdx === null && (
            <div className="flex items-center gap-3 pt-0.5">
              <button
                onClick={() => { setPickingIdx('new'); setSearch('') }}
                className="text-[10px] text-blue-400 hover:text-blue-300 transition-colors"
              >+ Filament</button>
              {hasPreset && (
                <button onClick={clearPreset} className="text-[10px] text-surface-600 hover:text-red-400 transition-colors">
                  Preset löschen
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/* One file as a row with all part properties inline & editable (side by side).
   Text fields save on blur; color/folder on change — no full reload, just local update. */
function FileRow({ file, meta, folderOptions, folderById, searching, selected, onToggleSelect,
                  onSaveField, onMoveFolder, onDelete, onQueue, onSend, bambuId, sending, enqueuing,
                  amsSlots, catalog }) {
  const [name, setName]         = useState(file.original_filename || '')
  const [pn, setPn]             = useState(file.part_number || '')
  const [material, setMaterial] = useState(file.material || '')
  const [color, setColor]       = useState(file.color || '')
  const [tags, setTags]         = useState(file.tags || '')

  useEffect(() => {
    setName(file.original_filename || ''); setPn(file.part_number || '')
    setMaterial(file.material || ''); setColor(file.color || ''); setTags(file.tags || '')
  }, [file.id])  // eslint-disable-line react-hooks/exhaustive-deps

  const isPrintable = file.file_type === '.3mf' || file.file_type === '.gcode'
  const colorVal = color ? (color.startsWith('#') ? color : `#${color}`) : '#888888'
  const extColor = { '.3mf': 'badge-blue', '.gcode': 'badge-green', '.stl': 'badge-amber' }
  const save = (field, val, orig) => { if ((val || '') !== (orig || '')) onSaveField(file.id, { [field]: val }) }
  const fld = "text-[11px] h-7 py-0 px-2"

  return (
    <div className={`px-3 py-2.5 rounded-xl border transition-colors group ${selected ? 'bg-blue-950/20 border-blue-800/50' : 'bg-surface-900 border-surface-700/60 hover:border-surface-600'}`}>
      <div className="flex items-start gap-2.5">
        {isPrintable && (
          <input type="checkbox" checked={selected} onChange={onToggleSelect}
            className="mt-1.5 w-4 h-4 p-0 shrink-0 cursor-pointer accent-blue-600" title="Für Queue auswählen" />
        )}
        {file.file_type === '.3mf' && <ThumbnailPreview fileId={file.id} />}
        <span className={`badge ${extColor[file.file_type] ?? 'badge-gray'} flex-shrink-0 mt-1`}>{file.file_type}</span>

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Name */}
          <input value={name} onChange={e => setName(e.target.value)}
            onBlur={() => save('original_filename', name, file.original_filename)}
            className="text-sm font-medium h-7 py-0 px-2" />

          {/* Properties side by side */}
          <div className="flex flex-wrap items-center gap-1.5">
            <input value={pn} onChange={e => setPn(e.target.value)} onBlur={() => save('part_number', pn, file.part_number)}
              placeholder="SKU / Teile-Nr." className={`${fld} font-mono w-32`} title="Teilenummer / SKU" />
            <input value={material} onChange={e => setMaterial(e.target.value)} onBlur={() => save('material', material, file.material)}
              placeholder="Material" className={`${fld} w-24`} title="Material" />
            <span className="flex items-center gap-1">
              <input type="color" value={colorVal}
                onChange={e => { setColor(e.target.value); onSaveField(file.id, { color: e.target.value }) }}
                className="w-7 h-7 p-0.5 cursor-pointer shrink-0" title="Farbe" />
              <input value={color} onChange={e => setColor(e.target.value)} onBlur={() => save('color', color, file.color)}
                placeholder="#Farbe" className={`${fld} font-mono w-20`} />
            </span>
            <input value={tags} onChange={e => setTags(e.target.value)} onBlur={() => save('tags', tags, file.tags)}
              placeholder="Tags (Komma)" className={`${fld} flex-1 min-w-[8rem]`} title="Tags" />
            <select value={file.folder_id ?? ''} onChange={e => onMoveFolder(file.id, e.target.value === '' ? null : Number(e.target.value))}
              className={`${fld} w-36`} title="Ordner">
              <option value="">📁 Wurzel</option>
              {folderOptions.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] text-surface-600 font-mono">{(file.file_size / 1024).toFixed(1)} KB · ID {file.id}</span>
            {isPrintable && <MetaChips meta={meta} />}
            {searching && file.folder_id != null && folderById[file.folder_id] && (
              <span className="text-[10px] text-surface-600">📁 {folderById[file.folder_id].name}</span>
            )}
          </div>
          {isPrintable && <FilamentPresetPanel fileId={file.id} amsSlots={amsSlots} catalog={catalog} />}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isPrintable && (
            <button onClick={() => onQueue([file], 1)} disabled={enqueuing}
              className="btn btn-primary btn-sm" title="In die Auto-Farm-Queue legen">+ Queue</button>
          )}
          {isPrintable && (
            <button onClick={() => onSend(file)} disabled={sending === file.id || !bambuId}
              className="btn btn-cyan btn-sm" title={bambuId ? 'Sofort an Drucker senden (ohne Queue)' : 'Kein Bambu-Gerät konfiguriert'}>
              {sending === file.id ? 'Sende…' : 'Drucken'}
            </button>
          )}
          <button onClick={() => onDelete(file.id, file.original_filename)}
            className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title="Löschen">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6"/><path d="M14 11v6"/>
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

function FileLibrary() {
  const [files, setFiles]       = useState([])
  const [folders, setFolders]   = useState([])
  const [currentFolder, setCurrentFolder] = useState(null)   // folder id or null (root)
  const [bambuId, setBambuId]   = useState(null)
  const [loading, setLoading]   = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(null)
  const [sending, setSending]   = useState(null)
  const [feedback, setFeedback] = useState(null)
  const [search, setSearch]     = useState('')
  const [drag, setDrag]         = useState(false)
  const [useAms, setUseAms]     = useState(() => localStorage.getItem('ottomat3d_use_ams') !== 'false')
  const [amsSlots, setAmsSlots] = useState([])
  const [catalog,  setCatalog]  = useState([])
  const [newFolder, setNewFolder] = useState('')
  const [renamingId, setRenamingId] = useState(null)   // folder being renamed
  const [selected, setSelected]   = useState(() => new Set())  // file ids for bulk queue
  const [qty, setQty]             = useState(1)
  const [enqueuing, setEnqueuing] = useState(false)
  const [metaById, setMetaById]   = useState({})   // fileId → {time_seconds, filament_g, …}
  const inputRef = useRef()
  const newFolderRef = useRef()

  const searching = search.trim().length > 0

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 5000)
  }

  const loadFolders = useCallback(async () => {
    try { const r = await folderService.list(); setFolders(r.data) } catch {}
  }, [])

  const loadFiles = useCallback(async () => {
    try {
      const params = search.trim()
        ? { search: search.trim() }
        : (currentFolder != null ? { folder_id: currentFolder } : { root: true })
      const r = await fileService.queryFiles(params)
      setFiles(r.data.files)
    } catch { showFeedback('Laden fehlgeschlagen', false) }
    finally { setLoading(false) }
  }, [currentFolder, search])

  // Initial: folders + device
  useEffect(() => {
    loadFolders()
    deviceService.listDevices()
      .then(d => { const b = d.data.find(x => x.device_type === 'bambu_lab'); if (b) setBambuId(b.id) })
      .catch(() => {})
  }, [loadFolders])

  // Files: reload on folder/search change (search debounced)
  useEffect(() => {
    const t = setTimeout(loadFiles, search ? 250 : 0)
    return () => clearTimeout(t)
  }, [loadFiles, search])

  useEffect(() => {
    filamentService.list()
      .then(r => setCatalog([...r.data.builtin, ...r.data.custom]))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!bambuId) return
    printerService.getStatus(bambuId)
      .then(r => {
        const raw   = r.data?.ams?.ams ?? []
        const slots = []
        for (const unit of raw) {
          const uid = +unit.id
          for (const tray of (unit.tray ?? [])) {
            // Loaded = has a material type; remain (-1 = unknown) does NOT mean empty.
            const type = tray.tray_type || tray.tray_sub_brands || ''
            if (!type) continue
            slots.push({
              gid:   uid * 4 + +tray.id,
              type,
              color: (tray.tray_color || '').replace('#', '').slice(0, 6),
            })
          }
        }
        setAmsSlots(slots.filter(s => s.type))
      })
      .catch(() => {})
  }, [bambuId])

  useAutoRefresh(loadFiles, 0)

  // Druckzeit/Gramm pro Datei einmalig laden (für Anzeige + Queue-Summe).
  useEffect(() => {
    const todo = files.filter(f => (f.file_type === '.3mf' || f.file_type === '.gcode') && metaById[f.id] === undefined)
    if (!todo.length) return
    let cancelled = false
    ;(async () => {
      for (const f of todo) {
        try {
          const r = await fileService.getQuickMeta(f.id)
          if (cancelled) return
          setMetaById(prev => ({ ...prev, [f.id]: r.data || null }))
        } catch {
          if (!cancelled) setMetaById(prev => ({ ...prev, [f.id]: null }))
        }
      }
    })()
    return () => { cancelled = true }
  }, [files])  // eslint-disable-line react-hooks/exhaustive-deps

  // ── Folder helpers ──────────────────────────────────────────
  const folderById = useMemo(() => Object.fromEntries(folders.map(f => [f.id, f])), [folders])

  const breadcrumb = useMemo(() => {
    const path = []
    let id = currentFolder
    while (id != null && folderById[id]) { path.unshift(folderById[id]); id = folderById[id].parent_id }
    return path
  }, [currentFolder, folderById])

  const subfolders = useMemo(
    () => folders.filter(f => (f.parent_id ?? null) === (currentFolder ?? null))
                 .sort((a, b) => a.name.localeCompare(b.name)),
    [folders, currentFolder]
  )

  // Flattened, indented folder list for the move-select
  const folderOptions = useMemo(() => {
    const byParent = {}
    folders.forEach(f => { const p = f.parent_id ?? 'root'; (byParent[p] ??= []).push(f) })
    const out = []
    const walk = (parent, depth) => {
      (byParent[parent] || []).sort((a, b) => a.name.localeCompare(b.name)).forEach(f => {
        out.push({ id: f.id, label: `${'   '.repeat(depth)}${f.name}` })
        walk(f.id, depth + 1)
      })
    }
    walk('root', 0)
    return out
  }, [folders])

  const createFolder = async () => {
    const name = newFolder.trim()
    if (!name) { newFolderRef.current?.focus(); return }   // guide the user to type a name
    try {
      await folderService.create({ name, parent_id: currentFolder })
      setNewFolder('')
      await loadFolders()
      showFeedback(`Ordner „${name}" erstellt`)
    } catch { showFeedback('Ordner konnte nicht erstellt werden', false) }
  }

  const deleteFolder = async (folder) => {
    if (!confirm(`Ordner „${folder.name}" löschen? Inhalt wandert eine Ebene nach oben.`)) return
    try {
      await folderService.remove(folder.id)
      await Promise.all([loadFolders(), loadFiles()])
      showFeedback(`Ordner „${folder.name}" gelöscht`)
    } catch { showFeedback('Ordner konnte nicht gelöscht werden', false) }
  }

  const renameFolder = async (folder, name) => {
    const nm = name.trim()
    setRenamingId(null)
    if (!nm || nm === folder.name) return
    try { await folderService.update(folder.id, { name: nm }); await loadFolders() }
    catch { showFeedback('Umbenennen fehlgeschlagen', false) }
  }

  // Save a single metadata field — optimistic local update, no full reload (keeps focus/order).
  const saveField = async (fileId, patch) => {
    try {
      const r = await fileService.updateFile(fileId, patch)
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...r.data } : f))
    } catch { showFeedback('Speichern fehlgeschlagen', false) }
  }

  // Moving to another folder: optimistic — drop it from the current view (or just
  // re-tag it when searching), refresh folder counts quietly. No full reload, no jump.
  const moveFile = async (fileId, folderId) => {
    setFiles(prev => searching
      ? prev.map(f => f.id === fileId ? { ...f, folder_id: folderId } : f)
      : prev.filter(f => f.id !== fileId))
    try {
      await fileService.updateFile(fileId, { folder_id: folderId })
      loadFolders()
    } catch { showFeedback('Verschieben fehlgeschlagen', false); loadFiles() }
  }

  // ── Upload / files ──────────────────────────────────────────
  const doUploadOne = async (file) => {
    const fd = new FormData()
    fd.append('file', file)
    await fileService.uploadFile(fd, currentFolder)   // into current folder
  }

  const doUpload = async (fileList) => {
    if (!fileList || fileList.length === 0) return
    const arr = Array.from(fileList)
    setUploading(true)
    let ok = 0, fail = 0
    for (let i = 0; i < arr.length; i++) {
      setUploadProgress(`${i + 1} / ${arr.length}`)
      try { await doUploadOne(arr[i]); ok++ } catch { fail++ }
    }
    await Promise.all([loadFiles(), loadFolders()])
    setUploading(false)
    setUploadProgress(null)
    if (fail === 0) showFeedback(arr.length === 1 ? `${arr[0].name} hochgeladen` : `${ok} Dateien hochgeladen`)
    else showFeedback(`${ok} hochgeladen, ${fail} fehlgeschlagen`, fail === arr.length ? false : true)
  }

  const handleInput  = (e) => doUpload(e.target.files)
  const handleDrop   = (e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files) }
  const handleDelete = async (id, name) => {
    if (!confirm(`"${name}" löschen?`)) return
    setFiles(prev => prev.filter(f => f.id !== id))   // optimistic — no reload jump
    try { await fileService.deleteFile(id); loadFolders() }
    catch { showFeedback('Löschen fehlgeschlagen', false); loadFiles() }
  }

  const handleSend = async (file) => {
    if (!bambuId) return showFeedback('Kein Bambu Lab Gerät konfiguriert', false)
    setSending(file.id)
    try {
      const r = await printerService.sendFile(bambuId, file.id, useAms)
      showFeedback(r.data.message)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? 'Senden fehlgeschlagen', false)
    } finally { setSending(null) }
  }

  const toggleAms = (v) => { setUseAms(v); localStorage.setItem('ottomat3d_use_ams', String(v)) }

  // ── Queue (Aufträge nur aus der Bibliothek) ─────────────────
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const enqueueFiles = async (fileList, count = 1) => {
    const printable = fileList.filter(f => f.file_type === '.3mf' || f.file_type === '.gcode')
    if (!printable.length) return showFeedback('Nur .3mf / .gcode können in die Queue', false)
    setEnqueuing(true)
    try {
      const [statusRes, queueRes] = await Promise.all([
        autofarmService.getStatus().catch(() => ({ data: {} })),
        autofarmService.getQueue().catch(() => ({ data: [] })),
      ])
      const running = !!statusRes.data?.running
      const cur = queueRes.data ?? []
      let nextId = cur.length ? Math.max(...cur.map(j => j.id ?? 0)) + 1 : 1
      const additions = []
      for (let c = 0; c < count; c++) {
        for (const f of printable) {
          additions.push({
            id: nextId++, fileId: f.id, fileName: f.original_filename,
            slot: null, amsMap: '', status: 'pending', plate: null,
            objectHeight: null, progress: 0, remaining: 0,
          })
        }
      }
      if (running) {
        // Running farm uses its in-memory queue → push via /enqueue (slot placeholder).
        for (const j of additions) {
          await autofarmService.enqueue({
            id: j.id, fileId: j.fileId, fileName: j.fileName,
            slot: '1-0', amsMap: '', plate: null,
          })
        }
      } else {
        await autofarmService.saveQueue([...cur, ...additions])
      }
      window.dispatchEvent(new CustomEvent('printloom:queueChanged'))
      setSelected(new Set())
      setQty(1)
      showFeedback(`${additions.length} Job${additions.length !== 1 ? 's' : ''} in die Queue gelegt`)
    } catch {
      showFeedback('In die Queue legen fehlgeschlagen', false)
    } finally { setEnqueuing(false) }
  }

  const extColor = { '.3mf': 'badge-blue', '.gcode': 'badge-green', '.stl': 'badge-amber' }
  const selectedFiles = files.filter(f => selected.has(f.id))

  // Summe für die Auswahl (× Menge je Datei) — Druckzeit & Filament.
  const selTotals = useMemo(() => {
    let sec = 0, g = 0, known = 0
    for (const f of selectedFiles) {
      const m = metaById[f.id]
      if (m?.time_seconds) { sec += m.time_seconds; known++ }
      if (m?.filament_g)   g += parseFloat(m.filament_g) || 0
    }
    return { sec: sec * qty, g: g * qty, known, total: selectedFiles.length }
  }, [selectedFiles, metaById, qty])

  return (
    <div className="space-y-5">

      {feedback && (
        <div className={`fixed bottom-5 right-5 z-50 max-w-sm flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm border shadow-xl shadow-black/30 ${
          feedback.ok
            ? 'bg-emerald-950/90 border-emerald-800 text-emerald-300'
            : 'bg-red-950/90 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      {/* Upload */}
      <div className="card">
        <p className="section-label">
          Upload{breadcrumb.length > 0 && <span className="text-surface-600 normal-case font-normal"> → {breadcrumb.map(b => b.name).join(' / ')}</span>}
        </p>
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
          onDragLeave={() => setDrag(false)}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all ${
            drag
              ? 'border-blue-500 bg-blue-950/20 scale-[1.01]'
              : 'border-surface-700 hover:border-blue-600/50 hover:bg-surface-900/60 bg-surface-900/30'
          }`}
        >
          <input ref={inputRef} type="file" accept=".3mf,.stl,.gcode" multiple className="hidden" onChange={handleInput} />
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"
               className={`mx-auto mb-3 transition-colors ${drag ? 'text-blue-400' : 'text-surface-500'}`}>
            <polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/>
            <path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/>
          </svg>
          {uploading ? (
            <div className="space-y-1">
              <p className="text-sm text-blue-400 animate-pulse">Wird hochgeladen…</p>
              {uploadProgress && <p className="text-xs text-surface-500 font-mono">{uploadProgress}</p>}
            </div>
          ) : (
            <>
              <p className="text-sm text-surface-300 font-medium">Dateien hier ablegen oder klicken</p>
              <p className="text-xs text-surface-600 mt-1">.3mf · .gcode · .stl · landet im aktuellen Ordner</p>
            </>
          )}
        </div>
      </div>

      {/* Library */}
      <div className="card">
        {/* Breadcrumb + search */}
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
            <button onClick={() => { setCurrentFolder(null); setSearch('') }}
              className={`px-1.5 py-0.5 rounded hover:bg-surface-700/50 transition-colors ${currentFolder == null && !searching ? 'text-surface-200 font-medium' : 'text-surface-500'}`}>
              📁 Alle
            </button>
            {breadcrumb.map(b => (
              <span key={b.id} className="flex items-center gap-1 min-w-0">
                <span className="text-surface-700">/</span>
                <button onClick={() => { setCurrentFolder(b.id); setSearch('') }}
                  className={`px-1.5 py-0.5 rounded hover:bg-surface-700/50 transition-colors truncate ${b.id === currentFolder ? 'text-surface-200 font-medium' : 'text-surface-500'}`}>
                  {b.name}
                </button>
              </span>
            ))}
            {searching && <span className="text-surface-500 ml-1">· Suche „{search}"</span>}
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <span className="text-xs text-surface-400">AMS</span>
              <button onClick={() => toggleAms(!useAms)}
                className={`relative w-9 h-5 rounded-full transition-colors ${useAms ? 'bg-blue-600' : 'bg-surface-700'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${useAms ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </label>
            <div className="w-52">
              <input type="text" placeholder="Alle Ordner durchsuchen…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {/* New folder */}
        {!searching && (
          <div className="flex items-center gap-2 mb-4">
            <input ref={newFolderRef} type="text" placeholder="Neuer Ordner…" value={newFolder}
              onChange={e => setNewFolder(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              className="text-sm h-8 py-0 max-w-xs" />
            <button onClick={createFolder} className="btn btn-ghost btn-sm whitespace-nowrap">+ Ordner</button>
          </div>
        )}

        {/* Bulk queue bar */}
        {selectedFiles.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap mb-4 px-3 py-2 rounded-xl bg-blue-950/30 border border-blue-800/50">
            <span className="text-sm text-blue-200 font-medium">{selectedFiles.length} ausgewählt</span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-surface-400">Menge je Datei</span>
              <button onClick={() => setQty(c => Math.max(1, c - 1))}
                className="w-5 h-6 flex items-center justify-center border border-surface-700 rounded text-surface-400 hover:text-surface-100 text-xs">−</button>
              <span className="text-[11px] font-mono text-surface-200 w-5 text-center">{qty}</span>
              <button onClick={() => setQty(c => Math.min(50, c + 1))}
                className="w-5 h-6 flex items-center justify-center border border-surface-700 rounded text-surface-400 hover:text-surface-100 text-xs">+</button>
            </div>
            <button onClick={() => enqueueFiles(selectedFiles, qty)} disabled={enqueuing}
              className="btn btn-primary btn-sm">{enqueuing ? 'Füge hinzu…' : `In Queue (${selectedFiles.length * qty})`}</button>
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">Auswahl aufheben</button>
            {/* Gesamtkalkulation der Auswahl */}
            <div className="flex items-center gap-3 ml-auto text-[12px]">
              {fmtDuration(selTotals.sec) && (
                <span className="flex items-center gap-1 text-blue-200" title="Geschätzte Gesamt-Druckzeit (reine Druckzeit, ohne Wechsel)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  ~{fmtDuration(selTotals.sec)}
                </span>
              )}
              {selTotals.g > 0 && (
                <span className="text-blue-200" title="Geschätztes Gesamt-Filament">≈ {Math.round(selTotals.g)} g</span>
              )}
              {selTotals.known < selTotals.total && (
                <span className="text-surface-500" title="Für einige Dateien fehlt die Slicer-Zeitangabe">({selTotals.known}/{selTotals.total} mit Zeit)</span>
              )}
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-surface-500 py-6 text-center">Lädt…</p>
        ) : (
          <div className="space-y-2">

            {/* Folders */}
            {!searching && subfolders.map(folder => (
              <div key={`f${folder.id}`} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-900 border border-surface-700/60 hover:border-surface-600 transition-colors group"
                onClick={() => renamingId !== folder.id && setCurrentFolder(folder.id)}
                role="button">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-blue-400 shrink-0">
                  <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                </svg>
                <div className="min-w-0 flex-1">
                  {renamingId === folder.id ? (
                    <input autoFocus defaultValue={folder.name}
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => { if (e.key === 'Enter') renameFolder(folder, e.target.value); if (e.key === 'Escape') setRenamingId(null) }}
                      onBlur={e => renameFolder(folder, e.target.value)}
                      className="text-sm h-7 py-0 px-2" />
                  ) : (
                    <p className="text-sm font-medium text-surface-200 truncate">{folder.name}</p>
                  )}
                  <p className="text-[11px] text-surface-500">
                    {folder.file_count} Datei{folder.file_count !== 1 ? 'en' : ''}
                    {folder.subfolder_count > 0 && `, ${folder.subfolder_count} Unterordner`}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setRenamingId(folder.id) }}
                  className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title="Ordner umbenennen">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder) }}
                  className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title="Ordner löschen">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            ))}

            {/* Files */}
            {files.length === 0 && (searching || subfolders.length === 0) ? (
              <p className="text-sm text-surface-500 py-6 text-center">
                {searching ? 'Keine Ergebnisse' : 'Dieser Ordner ist leer'}
              </p>
            ) : files.map(file => (
              <FileRow
                key={file.id}
                file={file}
                meta={metaById[file.id]}
                folderOptions={folderOptions}
                folderById={folderById}
                searching={searching}
                selected={selected.has(file.id)}
                onToggleSelect={() => toggleSelect(file.id)}
                onSaveField={saveField}
                onMoveFolder={moveFile}
                onDelete={handleDelete}
                onQueue={enqueueFiles}
                onSend={handleSend}
                bambuId={bambuId}
                sending={sending}
                enqueuing={enqueuing}
                amsSlots={amsSlots}
                catalog={catalog}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default FileLibrary
