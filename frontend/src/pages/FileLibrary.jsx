import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { fileService, folderService, printerService, deviceService, filamentService, autofarmService } from '../services/api'
import { useAutoRefresh } from '../services/useAutoRefresh'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import { colorLabel } from '../services/colorNames'
import { amsAutoMap } from '../services/amsUtils'

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
  const { tr } = useLanguage()
  const [show, setShow] = useState(false)
  const [err, setErr] = useState(false)
  const url = fileService.thumbnailUrl(fileId)

  return (
    <div className="relative flex-shrink-0">
      <button
        onClick={() => setShow(v => !v)}
        className="w-12 h-12 rounded-lg overflow-hidden bg-surface-900 border border-surface-700 flex items-center justify-center hover:border-blue-500 transition-colors"
        title={tr('Vorschau anzeigen')}
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
          <img src={url} alt={tr('Vorschau')} className="w-full rounded-lg" onError={() => { setErr(true); setShow(false) }} />
        </div>
      )}
    </div>
  )
}

function AmsInfoPanel({ fileId, fileType }) {
  const { tr } = useLanguage()
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
      setInfo({ error: tr('Analyse fehlgeschlagen') })
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
        {tr('AMS-Analyse')}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>

      {open && (
        <div className="mt-2 pl-2 border-l border-surface-700 space-y-1.5">
          {loading && <p className="text-[11px] text-surface-600 animate-pulse">{tr('Analysiere…')}</p>}
          {info?.error && <p className="text-[11px] text-red-400">{info.error}</p>}
          {info && !info.error && info.filament_count === 0 && (
            <p className="text-[11px] text-surface-600">{tr('Keine Filament-Info gefunden')}</p>
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


const _matBase = (t) => (t || '').toUpperCase().trim().split(/\s+/)[0]

/* Zeigt die Filamente aus dem Druck (Material + Farbe) und lässt PRO DATEI manuell
   einen AKTIVEN AMS-Slot je Filament wählen. Gespeichert (pro Datei) und beim Druck
   verwendet. Wählt der Nutzer ein anderes MATERIAL, gibt es eine Warnung (PETG≠PLA),
   und der Druck pausiert beim Material-Mismatch (Sicherheitsnetz im Backend). */
function FileFilaments({ fileId, amsSlots }) {
  const { tr } = useLanguage()
  const [fils, setFils] = useState(null)
  const [map,  setMap]  = useState([])      // gids je Filament
  const [open, setOpen] = useState(false)
  const [manual, setManual] = useState(false)

  useEffect(() => {
    if (!open || fils !== null) return
    autofarmService.getFileFilaments(fileId).then(r => {
      const f = r.data.filaments ?? []
      setFils(f)
      const saved = String(r.data.ams_map || '').split(',').map(x => parseInt(x, 10)).filter(n => !isNaN(n))
      if (saved.length === f.length && f.length) { setMap(saved); setManual(true) }
      else {
        const auto = amsAutoMap(f, amsSlots)
        setMap(auto.map(a => a.slot?.gid ?? amsSlots[0]?.gid ?? 0))
        setManual(false)
      }
    }).catch(() => setFils([]))
  }, [open, fileId, fils, amsSlots])

  const save = (next) => {
    setMap(next); setManual(true)
    autofarmService.setFileAms(fileId, next.join(',')).catch(() => {})
  }
  const resetAuto = () => {
    setManual(false)
    autofarmService.setFileAms(fileId, '').catch(() => {})
    const auto = amsAutoMap(fils ?? [], amsSlots)
    setMap(auto.map(a => a.slot?.gid ?? amsSlots[0]?.gid ?? 0))
  }

  return (
    <div className="mt-1.5">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[11px] text-surface-500 hover:text-blue-400 transition-colors">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="9"/></svg>
        {tr('Filamente & AMS-Zuordnung')}{manual ? ` · ${tr('manuell')}` : ''}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          className={`transition-transform ${open ? 'rotate-180' : ''}`}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && (
        <div className="mt-2 pl-2 border-l border-surface-700 space-y-1.5">
          {fils === null && <p className="text-[10px] text-surface-600 animate-pulse">{tr('Lese…')}</p>}
          {fils && fils.length === 0 && <p className="text-[10px] text-surface-600">{tr('Keine Filament-Info in der Datei')}</p>}
          {fils && fils.length > 0 && amsSlots.length === 0 && (
            <p className="text-[10px] text-surface-600">{tr('Kein AMS erkannt — Drucker offline?')}</p>
          )}
          {(fils ?? []).map((f, i) => {
            const slot = amsSlots.find(s => s.gid === map[i])
            const mism = slot && _matBase(f.type) && _matBase(slot.type) && _matBase(f.type) !== _matBase(slot.type)
            return (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                <span className="w-3.5 h-3.5 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: f.color ? (f.color.startsWith('#') ? f.color : `#${f.color}`) : '#555' }} />
                <span className="text-surface-300 w-14 truncate" title={f.color ? colorLabel(f.color) : ''}>{f.type || '?'}</span>
                <span className="text-surface-700">→</span>
                {amsSlots.length > 0 ? (
                  <select value={map[i] ?? ''} onChange={e => { const n = [...map]; n[i] = +e.target.value; save(n) }}
                    className={`flex-1 text-[10px] font-mono h-6 py-0 ${mism ? 'border-red-700 text-red-300' : ''}`}>
                    {amsSlots.map(s => (
                      <option key={s.gid} value={s.gid}>[{s.gid}] {s.type}{s.color ? ` · ${colorLabel(s.color)}` : ''}</option>
                    ))}
                  </select>
                ) : (
                  <span className="text-surface-500 font-mono">{f.color ? colorLabel(f.color) : ''}</span>
                )}
                {slot && <span className="w-3.5 h-3.5 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: slot.color ? `#${String(slot.color).slice(0,6)}` : '#555' }} />}
                {mism && <span className="text-red-400 text-[9px] shrink-0" title={tr('Anderes Material — Druck pausiert')}>⚠</span>}
              </div>
            )
          })}
          {fils && fils.length > 0 && amsSlots.length > 0 && (
            <div className="flex items-center gap-3 pt-0.5">
              <span className="text-[9px] text-surface-600">{manual ? tr('Manuell — wird beim Druck verwendet') : tr('Automatisch (Material + Farbe)')}</span>
              {manual && <button onClick={resetAuto} className="text-[9px] text-blue-400 hover:text-blue-300">{tr('↺ Automatisch')}</button>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}


/* One file as a row with all part properties inline & editable (side by side).
   Text fields save on blur; color/folder on change — no full reload, just local update. */
/* Spalten-Kopf mit Dropdown: Sortieren + (optional) Werte-Filter — Excel-AutoFilter-Stil. */
function ColHeader({ label, width, sortable, sortActive, sortDir, onSort, values, activeValue, onPick, tr }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const filtered = values && activeValue && activeValue !== 'all'
  const item = "block w-full text-left px-2 py-1 text-[11px] rounded hover:bg-surface-700/60 truncate"
  return (
    <div ref={ref} className="relative shrink-0" style={width ? { width } : undefined}>
      <button onClick={() => setOpen(o => !o)}
        className={`w-full flex items-center gap-1 px-2 py-1.5 text-[11px] font-semibold rounded transition-colors ${
          filtered || sortActive ? 'text-blue-300 bg-blue-950/30' : 'text-surface-200 hover:bg-surface-700/50'}`}
        title={tr('Sortieren / filtern')}>
        <span className="truncate">{label}</span>
        {sortActive && <span className="text-[9px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
        {filtered && <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />}
        <span className="ml-auto text-[8px] opacity-60">▼</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 min-w-[11rem] card p-1 shadow-xl border border-surface-700 max-h-72 overflow-y-auto">
          {sortable && (
            <>
              <button onClick={() => { onSort('asc'); setOpen(false) }} className={`${item} ${sortActive && sortDir === 'asc' ? 'text-blue-300' : 'text-surface-300'}`}>{tr('↑ Aufsteigend')}</button>
              <button onClick={() => { onSort('desc'); setOpen(false) }} className={`${item} ${sortActive && sortDir === 'desc' ? 'text-blue-300' : 'text-surface-300'}`}>{tr('↓ Absteigend')}</button>
              {values && <div className="border-t border-surface-800 my-1" />}
            </>
          )}
          {values && (
            <>
              <button onClick={() => { onPick('all'); setOpen(false) }} className={`${item} ${!filtered ? 'text-blue-300' : 'text-surface-300'}`}>{tr('Alle anzeigen')}</button>
              {values.length === 0 && <p className="px-2 py-1 text-[10px] text-surface-600">{tr('(keine Werte)')}</p>}
              {values.map(v => (
                <button key={v} onClick={() => { onPick(v); setOpen(false) }}
                  className={`${item} font-mono ${activeValue === v ? 'text-blue-300' : 'text-surface-300'}`}>{v}</button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function FileRow({ file, meta, folderOptions, folderById, searching, selected, onToggleSelect,
                  onSaveField, onMoveFolder, onDelete, onQueue, onSend, bambuId, sending, enqueuing,
                  amsSlots, catalog }) {
  const { tr } = useLanguage()
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
            className="mt-1.5 w-4 h-4 p-0 shrink-0 cursor-pointer accent-blue-600" title={tr('Für Queue auswählen')} />
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
              placeholder={tr('SKU / Teile-Nr.')} className={`${fld} font-mono w-32`} title={tr('Teilenummer / SKU')} />
            <input value={material} onChange={e => setMaterial(e.target.value)} onBlur={() => save('material', material, file.material)}
              placeholder={tr('Material')} className={`${fld} w-24`} title={tr('Material')} />
            <span className="flex items-center gap-1">
              <input type="color" value={colorVal}
                onChange={e => { setColor(e.target.value); onSaveField(file.id, { color: e.target.value }) }}
                className="w-7 h-7 p-0.5 cursor-pointer shrink-0" title={tr('Farbe')} />
              <input value={color} onChange={e => setColor(e.target.value)} onBlur={() => save('color', color, file.color)}
                placeholder={tr('#Farbe')} className={`${fld} font-mono w-20`} />
            </span>
            <input value={tags} onChange={e => setTags(e.target.value)} onBlur={() => save('tags', tags, file.tags)}
              placeholder={tr('Tags (Komma)')} className={`${fld} flex-1 min-w-[8rem]`} title={tr('Tags')} />
            <select value={file.folder_id ?? ''} onChange={e => onMoveFolder(file.id, e.target.value === '' ? null : Number(e.target.value))}
              className={`${fld} w-36`} title={tr('Ordner')}>
              <option value="">{tr('📁 Wurzel')}</option>
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
          {isPrintable && <FileFilaments fileId={file.id} amsSlots={amsSlots} />}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {isPrintable && (
            <button onClick={() => onQueue([file], 1)} disabled={enqueuing}
              className="btn btn-primary btn-sm" title={tr('In die Auto-Farm-Queue legen')}>{tr('+ Queue')}</button>
          )}
          {isPrintable && (
            <button onClick={() => onSend(file)} disabled={sending === file.id || !bambuId}
              className="btn btn-cyan btn-sm" title={bambuId ? tr('Sofort an Drucker senden (ohne Queue)') : tr('Kein Bambu-Gerät konfiguriert')}>
              {sending === file.id ? tr('Sende…') : tr('Drucken')}
            </button>
          )}
          <button onClick={() => onDelete(file.id, file.original_filename)}
            className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title={tr('Löschen')}>
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
  const { tr } = useLanguage()
  const [files, setFiles]       = useState([])
  const [folders, setFolders]   = useState([])
  // Q5: zuletzt geöffneten Ordner merken (über Reload/Seitenwechsel hinweg)
  const [currentFolder, setCurrentFolder] = useState(() => {
    const v = localStorage.getItem('printloom.fileLibrary.folder')
    return v != null && v !== '' ? Number(v) : null
  })
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
  // Sort & filter (client-side over the current folder/search result)
  const [sortBy,     setSortBy]     = useState(() => localStorage.getItem('ottomat3d_lib_sort') || 'name')
  const [sortDir,    setSortDir]    = useState(() => localStorage.getItem('ottomat3d_lib_dir')  || 'asc')
  const [filters,    setFilters]    = useState({ type: 'all', material: 'all', tags: 'all' })
  const inputRef = useRef()
  const newFolderRef = useRef()

  const searching = search.trim().length > 0

  useEffect(() => { localStorage.setItem('ottomat3d_lib_sort', sortBy) }, [sortBy])
  useEffect(() => { localStorage.setItem('ottomat3d_lib_dir', sortDir) }, [sortDir])

  const fileTags = (f) => (f.tags || '').split(',').map(t => t.trim()).filter(Boolean)

  // Filtered + sorted view of the loaded files (folders stay above, unaffected).
  const visibleFiles = useMemo(() => {
    let out = files
    if (filters.type     !== 'all') out = out.filter(f => f.file_type === filters.type)
    if (filters.material !== 'all') out = out.filter(f => (f.material || '') === filters.material)
    if (filters.tags     !== 'all') out = out.filter(f => fileTags(f).includes(filters.tags))
    const dir = sortDir === 'asc' ? 1 : -1
    const val = (f) => {
      switch (sortBy) {
        case 'date':     return new Date(f.uploaded_at || 0).getTime()
        case 'size':     return f.file_size || 0
        case 'time':     return metaById[f.id]?.time_seconds || 0
        case 'type':     return f.file_type || ''
        case 'material': return (f.material || '').toLowerCase()
        default:         return (f.original_filename || '').toLowerCase()
      }
    }
    return [...out].sort((a, b) => {
      const va = val(a), vb = val(b)
      if (typeof va === 'string') return dir * va.localeCompare(vb)
      return dir * (va - vb)
    })
  }, [files, filters, sortBy, sortDir, metaById])

  // Distinct values actually present → fill the per-column filter dropdowns.
  const presentTypes     = useMemo(() => [...new Set(files.map(f => f.file_type))].filter(Boolean).sort(), [files])
  const presentMaterials = useMemo(() => [...new Set(files.map(f => f.material))].filter(Boolean).sort(), [files])
  const presentTags      = useMemo(() => {
    const s = new Set()
    files.forEach(f => fileTags(f).forEach(t => s.add(t)))
    return [...s].sort()
  }, [files])

  const sortByCol = (key) => (dir) => { setSortBy(key); setSortDir(dir) }
  const pickFilter = (col) => (v) => setFilters(f => ({ ...f, [col]: v }))

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
    } catch { showFeedback(tr('Laden fehlgeschlagen'), false) }
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

  // Q5: gemerkten Ordner persistieren …
  useEffect(() => {
    if (currentFolder == null) localStorage.removeItem('printloom.fileLibrary.folder')
    else localStorage.setItem('printloom.fileLibrary.folder', String(currentFolder))
  }, [currentFolder])

  // … und auf Root zurückfallen, falls der gemerkte Ordner inzwischen weg ist.
  useEffect(() => {
    if (currentFolder != null && folders.length > 0 && !folders.some(f => f.id === currentFolder)) {
      setCurrentFolder(null)
    }
  }, [folders, currentFolder])

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
      showFeedback(tr('Ordner „{0}" erstellt', name))
    } catch { showFeedback(tr('Ordner konnte nicht erstellt werden'), false) }
  }

  const deleteFolder = async (folder) => {
    if (!(await confirmDialog({ title: tr('Ordner löschen'), message: tr('Ordner „{0}" löschen? Inhalt wandert eine Ebene nach oben.', folder.name), confirmLabel: tr('Löschen') }))) return
    try {
      await folderService.remove(folder.id)
      await Promise.all([loadFolders(), loadFiles()])
      showFeedback(tr('Ordner „{0}" gelöscht', folder.name))
    } catch { showFeedback(tr('Ordner konnte nicht gelöscht werden'), false) }
  }

  const renameFolder = async (folder, name) => {
    const nm = name.trim()
    setRenamingId(null)
    if (!nm || nm === folder.name) return
    try { await folderService.update(folder.id, { name: nm }); await loadFolders() }
    catch { showFeedback(tr('Umbenennen fehlgeschlagen'), false) }
  }

  // Save a single metadata field — optimistic local update, no full reload (keeps focus/order).
  const saveField = async (fileId, patch) => {
    try {
      const r = await fileService.updateFile(fileId, patch)
      setFiles(prev => prev.map(f => f.id === fileId ? { ...f, ...r.data } : f))
    } catch { showFeedback(tr('Speichern fehlgeschlagen'), false) }
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
    } catch { showFeedback(tr('Verschieben fehlgeschlagen'), false); loadFiles() }
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
    if (fail === 0) showFeedback(arr.length === 1 ? tr('{0} hochgeladen', arr[0].name) : tr('{0} Dateien hochgeladen', ok))
    else showFeedback(tr('{0} hochgeladen, {1} fehlgeschlagen', ok, fail), fail === arr.length ? false : true)
  }

  const handleInput  = (e) => doUpload(e.target.files)
  const handleDrop   = (e) => { e.preventDefault(); setDrag(false); doUpload(e.dataTransfer.files) }
  const loadDemo = async () => {
    try {
      const r = await fileService.createDemo()
      await Promise.all([loadFiles(), loadFolders()])
      showFeedback(r.data.created ? tr('Beispiel-Teil geladen') : tr('Beispiel-Teil ist bereits vorhanden'))
    } catch { showFeedback(tr('Beispiel-Teil konnte nicht geladen werden'), false) }
  }
  const handleDelete = async (id, name) => {
    if (!(await confirmDialog({ title: tr('Datei löschen'), message: tr('"{0}" löschen?', name), confirmLabel: tr('Löschen') }))) return
    setFiles(prev => prev.filter(f => f.id !== id))   // optimistic — no reload jump
    try { await fileService.deleteFile(id); loadFolders() }
    catch { showFeedback(tr('Löschen fehlgeschlagen'), false); loadFiles() }
  }

  // Mehrere markierte Dateien auf einmal löschen — ein Confirm, dann parallel.
  const handleBulkDelete = async () => {
    const ids = [...selected]
    if (!ids.length) return
    if (!(await confirmDialog({
      title: tr('Dateien löschen'),
      message: tr('{0} ausgewählte Datei(en) löschen? Das kann nicht rückgängig gemacht werden.', ids.length),
      confirmLabel: tr('Löschen'),
    }))) return
    setFiles(prev => prev.filter(f => !selected.has(f.id)))   // optimistic — kein Reload-Sprung
    setSelected(new Set())
    const results = await Promise.allSettled(ids.map(id => fileService.deleteFile(id)))
    const failed = results.filter(r => r.status === 'rejected').length
    if (failed) { showFeedback(tr('{0} Datei(en) konnten nicht gelöscht werden', failed), false); loadFiles() }
    else showFeedback(tr('{0} Datei(en) gelöscht', ids.length))
    loadFolders()
  }

  const handleSend = async (file) => {
    if (!bambuId) return showFeedback(tr('Kein Bambu Lab Gerät konfiguriert'), false)
    setSending(file.id)
    try {
      const r = await printerService.sendFile(bambuId, file.id, useAms)
      showFeedback(r.data.message)
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? tr('Senden fehlgeschlagen'), false)
    } finally { setSending(null) }
  }

  const toggleAms = (v) => { setUseAms(v); localStorage.setItem('ottomat3d_use_ams', String(v)) }

  // ── Queue (Aufträge nur aus der Bibliothek) ─────────────────
  const toggleSelect = (id) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  // Mehr-Platten-.3mf → je Platte eine Druck-Einheit. Eine Einzel-Platte / .gcode
  // bleibt eine Einheit (plate=null). So entsteht pro Platte ein eigener Job.
  const expandToPlateUnits = async (printable) => {
    const units = []
    for (const f of printable) {
      let plates = []
      if (f.file_type === '.3mf') {
        try { plates = (await printerService.getPlates(f.id)).data?.plates ?? [] } catch { plates = [] }
      }
      if (plates.length > 1) plates.forEach(p => units.push({ file: f, plate: p, plateTotal: plates.length }))
      else units.push({ file: f, plate: null, plateTotal: null })
    }
    return units
  }

  const enqueueFiles = async (fileList, count = 1) => {
    const printable = fileList.filter(f => f.file_type === '.3mf' || f.file_type === '.gcode')
    if (!printable.length) return showFeedback(tr('Nur .3mf / .gcode können in die Queue'), false)
    setEnqueuing(true)
    try {
      const [statusRes, queueRes, units] = await Promise.all([
        autofarmService.getStatus(true).catch(() => ({ data: {} })),
        autofarmService.getQueue().catch(() => ({ data: [] })),
        expandToPlateUnits(printable),
      ])
      const running = !!statusRes.data?.running
      const cur = queueRes.data ?? []
      let nextId = cur.length ? Math.max(...cur.map(j => j.id ?? 0)) + 1 : 1
      const additions = []
      for (let c = 0; c < count; c++) {
        for (const u of units) {
          additions.push({
            id: nextId++, fileId: u.file.id, fileName: u.file.original_filename,
            slot: null, amsMap: '', status: 'pending', plate: u.plate, plateTotal: u.plateTotal,
            objectHeight: null, progress: 0, remaining: 0,
          })
        }
      }
      if (running) {
        // Running farm uses its in-memory queue → push via /enqueue (slot placeholder).
        for (const j of additions) {
          await autofarmService.enqueue({
            id: j.id, fileId: j.fileId, fileName: j.fileName,
            slot: '1-0', amsMap: '', plate: j.plate, plateTotal: j.plateTotal,
          })
        }
      } else {
        await autofarmService.saveQueue([...cur, ...additions])
      }
      window.dispatchEvent(new CustomEvent('printloom:queueChanged'))
      setSelected(new Set())
      setQty(1)
      showFeedback(tr('{0} Job(s) in die Queue gelegt', additions.length))
    } catch {
      showFeedback(tr('In die Queue legen fehlgeschlagen'), false)
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
          {tr('Upload')}{breadcrumb.length > 0 && <span className="text-surface-600 normal-case font-normal"> → {breadcrumb.map(b => b.name).join(' / ')}</span>}
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
              <p className="text-sm text-blue-400 animate-pulse">{tr('Wird hochgeladen…')}</p>
              {uploadProgress && <p className="text-xs text-surface-500 font-mono">{uploadProgress}</p>}
            </div>
          ) : (
            <>
              <p className="text-sm text-surface-300 font-medium">{tr('Dateien hier ablegen oder klicken')}</p>
              <p className="text-xs text-surface-600 mt-1">{tr('.3mf · .gcode · .stl · landet im aktuellen Ordner')}</p>
            </>
          )}
        </div>
        {/* 2.6 — Beispiel-Teil zum Ausprobieren (ohne echten Druck) */}
        <div className="mt-2 text-right">
          <button onClick={loadDemo} className="text-[11px] text-surface-500 hover:text-blue-400 transition-colors">
            {tr('+ Beispiel-Teil laden')}
          </button>
        </div>
      </div>

      {/* Library */}
      <div className="card">
        {/* Breadcrumb + search */}
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <div className="flex items-center gap-1 text-sm min-w-0 flex-wrap">
            <button onClick={() => { setCurrentFolder(null); setSearch('') }}
              className={`px-1.5 py-0.5 rounded hover:bg-surface-700/50 transition-colors ${currentFolder == null && !searching ? 'text-surface-200 font-medium' : 'text-surface-500'}`}>
              {tr('📁 Alle')}
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
            {searching && <span className="text-surface-500 ml-1">{tr('· Suche „{0}"', search)}</span>}
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
              <input type="text" placeholder={tr('Alle Ordner durchsuchen…')} value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>
        </div>

        {/* New folder */}
        {!searching && (
          <div className="flex items-center gap-2 mb-4">
            <input ref={newFolderRef} type="text" placeholder={tr('Neuer Ordner…')} value={newFolder}
              onChange={e => setNewFolder(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createFolder()}
              className="text-sm h-8 py-0 max-w-xs" />
            <button onClick={createFolder} className="btn btn-ghost btn-sm whitespace-nowrap">{tr('+ Ordner')}</button>
          </div>
        )}

        {/* Bulk queue bar */}
        {selectedFiles.length > 0 && (
          <div className="flex items-center gap-3 flex-wrap mb-4 px-3 py-2 rounded-xl bg-blue-950/30 border border-blue-800/50">
            <span className="text-sm text-blue-200 font-medium">{tr('{0} ausgewählt', selectedFiles.length)}</span>
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-surface-400">{tr('Menge je Datei')}</span>
              <button onClick={() => setQty(c => Math.max(1, c - 1))}
                className="w-5 h-6 flex items-center justify-center border border-surface-700 rounded text-surface-400 hover:text-surface-100 text-xs">−</button>
              <span className="text-[11px] font-mono text-surface-200 w-5 text-center">{qty}</span>
              <button onClick={() => setQty(c => Math.min(50, c + 1))}
                className="w-5 h-6 flex items-center justify-center border border-surface-700 rounded text-surface-400 hover:text-surface-100 text-xs">+</button>
            </div>
            <button onClick={() => enqueueFiles(selectedFiles, qty)} disabled={enqueuing}
              className="btn btn-primary btn-sm">{enqueuing ? tr('Füge hinzu…') : tr('In Queue ({0})', selectedFiles.length * qty)}</button>
            <button onClick={handleBulkDelete} disabled={enqueuing}
              className="btn btn-danger btn-sm" title={tr('Ausgewählte Dateien löschen')}>
              {tr('Löschen ({0})', selectedFiles.length)}
            </button>
            <button onClick={() => setSelected(new Set())} className="btn btn-ghost btn-sm">{tr('Auswahl aufheben')}</button>
            {/* Gesamtkalkulation der Auswahl */}
            <div className="flex items-center gap-3 ml-auto text-[12px]">
              {fmtDuration(selTotals.sec) && (
                <span className="flex items-center gap-1 text-blue-200" title={tr('Geschätzte Gesamt-Druckzeit (reine Druckzeit, ohne Wechsel)')}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                  ~{fmtDuration(selTotals.sec)}
                </span>
              )}
              {selTotals.g > 0 && (
                <span className="text-blue-200" title={tr('Geschätztes Gesamt-Filament')}>≈ {Math.round(selTotals.g)} g</span>
              )}
              {selTotals.known < selTotals.total && (
                <span className="text-surface-500" title={tr('Für einige Dateien fehlt die Slicer-Zeitangabe')}>{tr('({0}/{1} mit Zeit)', selTotals.known, selTotals.total)}</span>
              )}
            </div>
          </div>
        )}

        {/* Spalten-Kopfzeile mit Filter/Sortier-Dropdowns (AutoFilter-Stil) */}
        {!loading && files.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap mb-3 px-2 py-1 rounded-lg bg-surface-800/70 border border-surface-700">
            <ColHeader label={tr('Name')} width="14rem" sortable sortActive={sortBy === 'name'} sortDir={sortDir} onSort={sortByCol('name')} tr={tr} />
            <ColHeader label={tr('Typ')} width="7rem" sortable sortActive={sortBy === 'type'} sortDir={sortDir} onSort={sortByCol('type')}
              values={presentTypes} activeValue={filters.type} onPick={pickFilter('type')} tr={tr} />
            <ColHeader label={tr('Material')} width="8rem" sortable sortActive={sortBy === 'material'} sortDir={sortDir} onSort={sortByCol('material')}
              values={presentMaterials} activeValue={filters.material} onPick={pickFilter('material')} tr={tr} />
            <ColHeader label={tr('Tags')} width="8rem" values={presentTags} activeValue={filters.tags} onPick={pickFilter('tags')} tr={tr} />
            <ColHeader label={tr('Größe')} width="6rem" sortable sortActive={sortBy === 'size'} sortDir={sortDir} onSort={sortByCol('size')} tr={tr} />
            <ColHeader label={tr('Druckzeit')} width="7rem" sortable sortActive={sortBy === 'time'} sortDir={sortDir} onSort={sortByCol('time')} tr={tr} />
            <ColHeader label={tr('Datum')} width="7rem" sortable sortActive={sortBy === 'date'} sortDir={sortDir} onSort={sortByCol('date')} tr={tr} />
            <span className="ml-auto pr-1 text-[10px] text-surface-600 font-mono shrink-0">{tr('{0} Datei(en)', visibleFiles.length)}</span>
          </div>
        )}

        {loading ? (
          <div className="space-y-2" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-900 border border-surface-700/40 animate-pulse">
                <div className="w-5 h-5 rounded bg-surface-800 shrink-0" />
                <div className="flex-1 min-w-0 space-y-2">
                  <div className="h-3 rounded bg-surface-800" style={{ width: `${55 + (i * 11) % 35}%` }} />
                  <div className="h-2 rounded bg-surface-800/70 w-24" />
                </div>
                <div className="h-3 w-12 rounded bg-surface-800 shrink-0" />
              </div>
            ))}
          </div>
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
                    {tr('{0} Datei(en)', folder.file_count)}
                    {folder.subfolder_count > 0 && tr(', {0} Unterordner', folder.subfolder_count)}
                  </p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); setRenamingId(folder.id) }}
                  className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title={tr('Ordner umbenennen')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                  </svg>
                </button>
                <button onClick={(e) => { e.stopPropagation(); deleteFolder(folder) }}
                  className="btn-icon opacity-0 group-hover:opacity-100 transition-opacity" title={tr('Ordner löschen')}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  </svg>
                </button>
              </div>
            ))}

            {/* Files */}
            {visibleFiles.length === 0 && (searching || subfolders.length === 0) ? (
              <p className="text-sm text-surface-500 py-6 text-center">
                {files.length > 0 ? tr('Keine Datei passt zum Filter')
                  : searching ? tr('Keine Ergebnisse') : tr('Dieser Ordner ist leer')}
              </p>
            ) : visibleFiles.map(file => (
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
