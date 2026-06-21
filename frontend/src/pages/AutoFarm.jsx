import React, { useState, useEffect, useCallback, useRef } from 'react'
import { rackManagerService, fileService, deviceService, printerService, controlService, autofarmService, deviceSettingsService, systemService } from '../services/api'
import DashboardGrid, { PANELS, DEFAULT_LAYOUT, mergeLayout } from '../components/DashboardGrid'
import { parseSlotKey, slotsNeeded, autoSlot, checkClearance, slotTolerance } from '../services/rackUtils'
import { amsMissing, colorDist } from '../services/amsUtils'
import { useQueueEta, fmtDur, jobPrintSec, ensureMeta, getCachedMeta, CHANGEOVER_SEC } from '../services/useQueueEta'
import { useFarmStatusStream } from '../services/useFarmStatusStream'
import { useLanguage } from '../services/i18n'

/* Snapshot eines Jobs — blendet sich aus, wenn kein Bild da ist (z. B. keine
   Webcam am Drucker → 404), statt ein kaputtes Bild-Icon zu zeigen. */
function JobSnapshot({ name }) {
  const [err, setErr] = useState(false)
  if (!name || err) return null
  const src = `/api/printer/snapshots/${name}`
  return (
    <a href={src} target="_blank" rel="noreferrer" className="block w-fit">
      <img src={src} alt="Snapshot" onError={() => setErr(true)}
        className="h-16 rounded border border-surface-700 object-cover" />
    </a>
  )
}
async function checkPreflight(bambuId, tr = (s) => s) {
  const errors = []
  try {
    await printerService.getStatus(bambuId)
    // Printer may already be running — continuous mode handles that
  } catch {
    errors.push(tr('Bambu X1C nicht erreichbar — Verbindung prüfen'))
  }
  try {
    const r = await controlService.getKlipperInfo()
    if (!r.data.ready) {
      const stateMsg = r.data.state_message ? `: ${r.data.state_message}` : ''
      errors.push(tr('OTTOeject nicht bereit ({0}{1}) — bitte Firmware neu starten', r.data.state, stateMsg))
    }
  } catch {
    errors.push(tr('OTTOeject nicht erreichbar — Verbindung prüfen'))
  }
  return errors
}

const S = {
  pending:  { label: 'Wartet',        dot: 'dot-gray',  color: 'text-surface-500' },
  running:  { label: 'Läuft…',        dot: 'dot-blue',  color: 'text-blue-400',   pulse: true },
  printing: { label: 'Druckt…',       dot: 'dot-green', color: 'text-emerald-400', pulse: true },
  sending:  { label: 'Datei senden',  dot: 'dot-blue',  color: 'text-blue-400'   },
  done:     { label: 'Fertig',        dot: 'dot-green', color: 'text-emerald-400' },
  error:    { label: 'Fehler',        dot: 'dot-red',   color: 'text-red-400'    },
}

let _id = Date.now()

const TEMPLATES_KEY = 'ottomat3d_queue_templates'
const loadTemplates = () => {
  try { return JSON.parse(localStorage.getItem(TEMPLATES_KEY) || '{}') } catch { return {} }
}

function AmsMapper({ filaments, amsSlots, value, onChange }) {
  const { tr } = useLanguage()
  const norm = c => (c||'').replace('#','').toUpperCase().slice(0,6)

  const mapArr = React.useMemo(() => {
    if (value && value.trim()) {
      const parts = value.split(',').map(s => parseInt(s.trim(),10))
      if (parts.length === filaments.length && parts.every(n => !isNaN(n))) return parts
    }
    return filaments.map((_,i) => amsSlots[i]?.gid ?? 0)
  }, [value, filaments, amsSlots])

  if (!filaments.length) return <p className="text-[10px] text-surface-600 py-1">{tr('Keine Filament-Info in Datei (älteres Format)')}</p>
  if (!amsSlots.length)  return <p className="text-[10px] text-surface-600 py-1">{tr('Kein AMS erkannt — Drucker offline?')}</p>

  const autoMatch = () => {
    const nm = filaments.map((f, fi) => {
      const fBase  = (f.type||'').toUpperCase().trim().split(/\s+/)[0]
      const fColor = norm(f.color)
      const pool   = amsSlots.filter(s => s.type.toUpperCase().includes(fBase) || fBase.includes(s.type.toUpperCase().split(/\s+/)[0]))
      const src    = pool.length ? pool : amsSlots
      return [...src].sort((a,b) => colorDist(fColor, norm(a.color)) - colorDist(fColor, norm(b.color)))[0]?.gid ?? mapArr[fi]
    })
    onChange(nm.join(','))
  }

  return (
    <div className="space-y-1.5">
      {filaments.map((f, fi) => {
        const slot    = amsSlots.find(s => s.gid === mapArr[fi]) ?? amsSlots[0]
        const fColor  = norm(f.color)
        const sColor  = norm(slot?.color)
        const matches = fColor && sColor && fColor === sColor
        return (
          <div key={fi} className="flex items-center gap-1.5">
            <span className="w-3.5 h-3.5 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: f.color ? (f.color.startsWith('#') ? f.color : `#${f.color}`) : '#555' }} />
            <span className="text-[10px] text-surface-400 w-16 truncate shrink-0">{f.type||'?'}</span>
            <span className="text-surface-700 text-[10px]">→</span>
            <select
              value={mapArr[fi] ?? ''}
              onChange={e => { const nm=[...mapArr]; nm[fi]=+e.target.value; onChange(nm.join(',')) }}
              className="flex-1 text-[10px] font-mono h-6 py-0"
            >
              {amsSlots.map(s => (
                <option key={s.gid} value={s.gid}>[{s.gid}] {s.type}{s.color ? ` #${s.color.slice(0,6)}` : ''}</option>
              ))}
            </select>
            <span className="w-3.5 h-3.5 rounded-full border border-white/10 shrink-0"
                  style={{ backgroundColor: slot?.color ? `#${slot.color.slice(0,6)}` : '#555' }} />
            {!matches && <span className="text-amber-500 text-[9px]" title={tr('Farbe unterschiedlich')}>⚠</span>}
          </div>
        )
      })}
      <div className="flex items-center gap-2 pt-1 border-t border-surface-800/40">
        <span className="text-[9px] text-surface-700 font-mono">{tr('Map:')} {mapArr.join(',')}</span>
        <button onClick={autoMatch} className="ml-auto text-[9px] text-blue-400 hover:text-blue-300 transition-colors">
          {tr('Auto-Match')}
        </button>
      </div>
    </div>
  )
}

const RACK_DOT   = { free: 'dot-gray', ready: 'dot-green', printing: 'dot-blue', done: 'dot-amber', locked: 'dot-red' }
const RACK_COL   = { free: 'text-surface-600', ready: 'text-emerald-400', printing: 'text-blue-400', done: 'text-amber-400', locked: 'text-red-400' }
const RACK_LABEL = { free: 'Leer', ready: 'Bereit', printing: 'Druckt', done: 'Fertig', locked: 'Gesperrt' }

/* ── Aktueller Schritt (Dashboard-Panel) ──────────────────────
   idle=true → zeigt auch im Leerlauf einen Platzhalter (sonst leeres Panel). */
function CurrentStep({ farmStatus, idle }) {
  const { tr } = useLanguage()
  const active = farmStatus?.running && farmStatus?.seq_step_label
  if (!active) {
    if (!idle) return null
    return (
      <div className="card p-2.5">
        <p className="section-label mb-1">{tr('Aktueller Schritt')}</p>
        <p className="text-[10px] text-surface-600">{tr('Kein aktiver Schritt')}</p>
      </div>
    )
  }
  return (
    <div className="card p-2.5 bg-blue-950/20 border-blue-800/40">
      <p className="section-label mb-1">{tr('Aktueller Schritt')}</p>
      <div className="flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse shrink-0" />
        <p className="text-[9px] font-mono text-blue-300 truncate">{farmStatus.seq_step_label}</p>
      </div>
    </div>
  )
}

/* ── Farm-Visualisierung: Ablauf-Phasen ─── */
function FarmViz({ farmStatus, jobs, curJobId }) {
  const { tr } = useLanguage()
  const curJob     = jobs.find(j => j.id === curJobId)
  const isPrinting = curJob?.status === 'printing'

  const PHASES = [
    { id: 'grab_mag',   label: 'Holen aus Magazin' },
    { id: 'to_printer', label: 'Zum Drucker' },
    { id: 'load',       label: 'Einlegen' },
    { id: 'printing',   label: 'Druckt…' },
    { id: 'eject',      label: 'Auswerfen' },
    { id: 'to_rack',    label: 'Zum Regal' },
    { id: 'store',      label: 'Einlagern' },
    { id: 'return',     label: 'Zurück' },
  ]

  const seqLabel = farmStatus?.seq_step_label?.toLowerCase() ?? ''
  let activePhase = null
  if (isPrinting) activePhase = 'printing'
  else if (seqLabel.includes('holen') || seqLabel.includes('grab') || seqLabel.includes('magazin')) activePhase = 'grab_mag'
  else if (seqLabel.includes('einlegen') || seqLabel.includes('load')) activePhase = 'load'
  else if (seqLabel.includes('auswerfen') || seqLabel.includes('eject')) activePhase = 'eject'
  else if (seqLabel.includes('einlagern') || seqLabel.includes('store')) activePhase = 'store'
  else if (seqLabel.includes('regal') || seqLabel.includes('rack')) activePhase = 'to_rack'
  else if (seqLabel.includes('drucker') || seqLabel.includes('printer')) activePhase = 'to_printer'
  else if (seqLabel.includes('zurück') || seqLabel.includes('park')) activePhase = 'return'

  const running = farmStatus?.running

  return (
    <div className="space-y-2">
      {/* Ablauf-Phasen — der „Aktuelle Schritt" sitzt jetzt oben in der Sidebar (CurrentStep) */}
      <div className="card p-2.5 space-y-0.5">
        {PHASES.map(p => (
          <div key={p.id} className={`flex items-center gap-1.5 px-1.5 py-0.5 rounded text-[8px] font-mono transition-colors ${
            activePhase === p.id && running
              ? 'bg-blue-900/30 text-blue-300'
              : 'text-surface-700'
          }`}>
            {activePhase === p.id && running
              ? <span className="w-1 h-1 rounded-full bg-blue-400 animate-pulse shrink-0" />
              : <span className="w-1 h-1 rounded-full bg-surface-800 shrink-0" />}
            {tr(p.label)}
          </div>
        ))}
      </div>
    </div>
  )
}

/* HLS-Video (MediaMTX/go2rtc). Safari/iOS spielen HLS nativ; alle anderen laden
   hls.js lazy (eigener Chunk, damit der Haupt-Bundle schlank bleibt). */
function HlsVideo({ src, onError, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const video = ref.current
    if (!video || !src) return
    let hls, cancelled = false
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src
      video.play?.().catch(() => {})
      return
    }
    import('hls.js').then(({ default: Hls }) => {
      if (cancelled || !ref.current) return
      if (!Hls.isSupported()) { onError?.('Browser kann HLS nicht abspielen'); return }
      // Aggressive Low-Latency-Konfig: nah an der Live-Kante bleiben statt zu puffern.
      hls = new Hls({
        liveDurationInfinity: true,
        lowLatencyMode: true,
        backBufferLength: 0,            // keine Vergangenheit puffern
        liveSyncDurationCount: 1,       // nur ~1 Segment hinter Live spielen
        liveMaxLatencyDurationCount: 4, // bei mehr Rückstand → nachholen
        maxLiveSyncPlaybackRate: 1.5,   // leicht schneller abspielen, um aufzuholen
      })
      hls.loadSource(src)
      hls.attachMedia(ref.current)
      hls.on(Hls.Events.ERROR, (_e, data) => { if (data?.fatal) onError?.(data?.details || 'HLS-Fehler') })
      // Driftet die Wiedergabe doch zurück → hart an die Live-Kante springen.
      const jumpLive = () => {
        const v = ref.current
        if (v && hls.liveSyncPosition != null && v.currentTime < hls.liveSyncPosition - 3) {
          v.currentTime = hls.liveSyncPosition
        }
      }
      hls.on(Hls.Events.FRAG_CHANGED, jumpLive)
      ref.current.play?.().catch(() => {})
    }).catch(() => onError?.('HLS-Player konnte nicht geladen werden'))
    return () => { cancelled = true; try { hls?.destroy() } catch {} }
  }, [src])
  return <video ref={ref} muted autoPlay playsInline className={className} />
}

/* Derive the MediaMTX HLS playlist URL from a path URL like http://host:8888/stream/ */
function hlsUrlFrom(url) {
  if (!url) return ''
  if (url.includes('.m3u8')) return url
  return url.endsWith('/') ? `${url}index.m3u8` : `${url}/index.m3u8`
}

/* Derive the MediaMTX WHEP (WebRTC) endpoint from a path URL like http://host:8889/stream */
function whepUrlFrom(url) {
  if (!url) return ''
  const u = url.trim().replace(/\/+$/, '')
  return u.endsWith('/whep') ? u : `${u}/whep`
}

/* WebRTC-Video via WHEP (MediaMTX :8889). Sub-Sekunden-Latenz, ohne Extra-Bibliothek —
   der Browser spricht WebRTC nativ. Reines Empfangen (recvonly), ICE non-trickle. */
function WhepVideo({ src, onError, className }) {
  const ref = useRef(null)
  useEffect(() => {
    const video = ref.current
    if (!video || !src) return
    let pc, cancelled = false

    const start = async () => {
      try {
        pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
        pc.addTransceiver('video', { direction: 'recvonly' })
        pc.addTransceiver('audio', { direction: 'recvonly' })
        pc.ontrack = (e) => {
          if (ref.current && e.streams[0]) {
            ref.current.srcObject = e.streams[0]
            ref.current.play?.().catch(() => {})
          }
        }
        pc.onconnectionstatechange = () => {
          if (pc && ['failed', 'disconnected', 'closed'].includes(pc.connectionState)) {
            onError?.(`Verbindung ${pc.connectionState}`)
          }
        }
        await pc.setLocalDescription(await pc.createOffer())
        // ICE-Kandidaten einsammeln (non-trickle), höchstens 2 s warten.
        await new Promise((resolve) => {
          if (pc.iceGatheringState === 'complete') return resolve()
          const done = () => { pc.removeEventListener('icegatheringstatechange', done); resolve() }
          pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') done() })
          setTimeout(resolve, 2000)
        })
        if (cancelled) return
        const res = await fetch(src, {
          method: 'POST',
          headers: { 'Content-Type': 'application/sdp' },
          body: pc.localDescription.sdp,
        })
        if (!res.ok) { onError?.(`WHEP HTTP ${res.status}`); return }
        const answer = await res.text()
        if (cancelled) return
        await pc.setRemoteDescription({ type: 'answer', sdp: answer })
      } catch (e) {
        if (!cancelled) onError?.(String(e?.message || e))
      }
    }
    start()
    return () => { cancelled = true; try { pc?.close() } catch {} }
  }, [src])
  return <video ref={ref} muted autoPlay playsInline className={className} />
}

/* ── Kamera-Fenster unter der Schritt-Anzeige ─────────────────
   Zwei umschaltbare Kameras: eingebaute X1C (quer) + eine externe Webcam
   (MJPEG oder HLS/MediaMTX) hochkant, deren URL & Typ anpassbar sind. */
const CAM_PORTRAIT_KEY = 'printloom_cam_ext_portrait'
const CAM_TYPE_KEY     = 'printloom_cam_ext_type'   // 'webrtc' | 'hls' | 'mjpeg'

const CAM_TYPE_ORDER = ['webrtc', 'hls', 'mjpeg']
const CAM_TYPE_LABEL = { webrtc: 'WebRTC', hls: 'HLS', mjpeg: 'MJPEG' }
/* Guess the stream type from the URL: :8889/whep → WebRTC, :8888/.m3u8 → HLS, sonst MJPEG. */
function guessCamType(url) {
  const u = url || ''
  if (u.includes('/whep') || u.includes(':8889')) return 'webrtc'
  if (u.includes('.m3u8') || u.includes(':8888')) return 'hls'
  return 'mjpeg'
}

/* Ein Stream (Typ aus URL erkannt: WebRTC/HLS/MJPEG). Blendet sich bei Fehler
   sauber aus (statt kaputtem Bild) und bietet einen Reconnect-Knopf. */
function StreamView({ url, portrait, label }) {
  const { tr } = useLanguage()
  const [err, setErr] = useState(false)
  const [k,   setK]   = useState(0)
  useEffect(() => { setErr(false); setK(x => x + 1) }, [url])
  const reconnect = () => { setErr(false); setK(x => x + 1) }
  const type = guessCamType(url)
  const src  = type === 'hls' ? hlsUrlFrom(url) : type === 'webrtc' ? whepUrlFrom(url) : url
  const aspect = portrait ? '9/16' : '16/9'
  return (
    <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: aspect, maxWidth: '100%' }}>
      {!url ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-1 px-3 text-center">
          <p className="text-[10px]">{label}</p>
          <p className="text-[9px] text-surface-700">{tr('URL in Konfiguration → Kameras')}</p>
        </div>
      ) : err ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-1.5 px-3 text-center">
          <p className="text-[10px]">{tr('{0} nicht erreichbar', label)}</p>
          <p className="text-[9px] font-mono text-surface-700 break-all">{src}</p>
          <button onClick={reconnect} className="btn btn-ghost btn-sm">{tr('Neu verbinden')}</button>
        </div>
      ) : type === 'webrtc' ? (
        <WhepVideo key={k} src={src} onError={() => setErr(true)} className="w-full h-full object-contain" />
      ) : type === 'hls' ? (
        <HlsVideo key={k} src={src} onError={() => setErr(true)} className="w-full h-full object-contain" />
      ) : (
        <img key={k} src={src} alt={label} onError={() => setErr(true)} onLoad={() => setErr(false)} className="w-full h-full object-contain" />
      )}
      {url && !err && (
        <>
          <span className="absolute top-1.5 left-1.5 text-[8px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>
          <span className="absolute top-1.5 right-1.5 text-[8px] font-mono px-1 py-0.5 rounded bg-black/60 text-surface-300">{CAM_TYPE_LABEL[type]}</span>
          <button onClick={reconnect} title={tr('Neu verbinden')}
            className="absolute bottom-1.5 right-1.5 text-[11px] leading-none px-1.5 py-1 rounded bg-black/50 text-surface-300 hover:text-white">⟳</button>
        </>
      )}
    </div>
  )
}

/* Eingebaute X1C-Kamera (proprietäres Port-6000-Protokoll übers Backend).
   Fallback für die obere Kachel, wenn keine Bambu-URL hinterlegt ist. */
function X1CView({ bambuId }) {
  const { tr } = useLanguage()
  const [live,  setLive]  = useState(false)
  const [ready, setReady] = useState(false)
  const [err,   setErr]   = useState('')
  const [key,   setKey]   = useState(0)
  const connect = async () => {
    if (!bambuId) return
    setErr(''); setReady(false); setKey(k => k + 1); setLive(true)
    try {
      const r = await fetch(`${printerService.cameraFrameUrl(bambuId)}?probe=${Date.now()}`)
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try { detail = (await r.json()).detail || detail } catch { try { detail = (await r.text()) || detail } catch {} }
        setErr(detail); return
      }
      setReady(true)
    } catch (e) { setErr(String(e?.message || e)) }
  }
  const stop = () => { setLive(false); setReady(false); setErr('') }
  // Direkt anzeigen: sobald ein Drucker da ist, automatisch verbinden (der
  // Kamera-Toggle im Panel steuert das Ein/Aus; hier kein manueller Klick nötig).
  useEffect(() => { if (bambuId) connect() /* eslint-disable-next-line */ }, [bambuId])
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] text-surface-500">{tr('Oben · X1C (RTSPS · direkt)')}</span>
        <button onClick={() => live ? stop() : connect()} disabled={!bambuId}
          className={`btn btn-sm px-2 ${live ? 'btn-primary' : 'btn-ghost'}`}
          title={tr('LAN-Liveview muss am Drucker aktiv sein')}>
          {live ? tr('⏹ Stopp') : tr('📷 Live')}
        </button>
      </div>
      <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: '16/9', maxWidth: '100%' }}>
        {live ? (
          err ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-1.5 px-3 text-center">
              <p className="text-[10px]">{tr('X1C nicht erreichbar')}</p>
              {err && <p className="text-[9px] font-mono text-red-400/80 break-all">{err}</p>}
              <button onClick={connect} className="btn btn-ghost btn-sm mt-0.5">{tr('Neu verbinden')}</button>
            </div>
          ) : ready ? (
            <img src={`${printerService.cameraStreamUrl(bambuId)}?t=${key}`} alt="X1C Live"
              onError={() => setErr(e => e || tr('Stream-Verbindung abgebrochen'))}
              className="w-full h-full object-contain" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-[10px]">{tr('Verbinde …')}</div>
          )
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-1 px-3 text-center">
            <p className="text-[10px]">{bambuId ? tr('X1C bereit') : tr('Kein Drucker')}</p>
            {bambuId && <p className="text-[9px] text-surface-700">{tr('„📷 Live" drücken')}</p>}
          </div>
        )}
        {live && ready && <span className="absolute top-1.5 left-1.5 text-[8px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>}
      </div>
    </div>
  )
}

/* X1C-Kamera über Home Assistant: HA liefert ein Standbild (kein echter Video-
   Stream), daher laden wir das Einzelbild im ~1-s-Takt nach (≈1 fps Live-Ansicht).
   Doppelpuffer: das sichtbare Bild wird erst getauscht, wenn das nächste geladen
   ist → kein Flackern, keine Blackframes. */
function HaPollView({ deviceId, label, portrait = false }) {
  const { tr } = useLanguage()
  const [src, setSrc] = useState(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    if (!deviceId) return
    let alive = true, timer
    const load = () => {
      const u = `${printerService.haCameraStreamUrl(deviceId)}/frame?t=${Date.now()}`
      const img = new Image()
      img.onload  = () => { if (!alive) return; setSrc(u); setErr(false); timer = setTimeout(load, 250) }
      img.onerror = () => { if (!alive) return; setErr(true);            timer = setTimeout(load, 2500) }
      img.src = u
    }
    load()
    return () => { alive = false; clearTimeout(timer) }
  }, [deviceId])
  const aspect = portrait ? '9/16' : '16/9'
  return (
    <div className="relative bg-black rounded-lg overflow-hidden mx-auto" style={{ aspectRatio: aspect, maxWidth: '100%' }}>
      {src ? (
        <img src={src} alt={label} className="w-full h-full object-contain" />
      ) : !err ? (
        <div className="absolute inset-0 flex items-center justify-center text-surface-500 text-[10px]">{tr('Verbinde mit Home Assistant …')}</div>
      ) : null}
      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-surface-600 gap-1 px-3 text-center">
          <p className="text-[10px]">{tr('{0} nicht erreichbar', label)}</p>
          <p className="text-[9px] text-surface-700">{tr('Home Assistant / Token prüfen')}</p>
        </div>
      )}
      {src && !err && (
        <>
          <span className="absolute top-1.5 left-1.5 text-[8px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>
          <span className="absolute top-1.5 right-1.5 text-[8px] font-mono px-1 py-0.5 rounded bg-black/60 text-surface-300">HA</span>
        </>
      )}
    </div>
  )
}

/* Beide Kameras fest übereinander: oben Bambu (quer) bzw. X1C, unten hochkant.
   URLs kommen aus der Konfiguration (Konfiguration → Kameras). */
function CameraPanel({ bambuId, webcamUrl, webcamUrlTop, haCamReady, cameraOn, onToggle }) {
  const { tr } = useLanguage()
  return (
    <div className="card p-2.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="section-label mb-0">{tr('Kameras')}</p>
        <div className="flex items-center gap-2">
          <span className="text-[9px] text-surface-600 hidden sm:inline">{tr('Konfiguration → Kameras')}</span>
          <button
            onClick={onToggle}
            disabled={!bambuId}
            title={cameraOn ? tr('Kamera ausschalten (Anzeige + Snapshots)') : tr('Kamera einschalten')}
            className={`btn btn-sm px-2 ${cameraOn ? 'btn-primary' : 'btn-ghost'}`}
          >
            {cameraOn ? tr('📷 An') : tr('⨯ Aus')}
          </button>
        </div>
      </div>
      {cameraOn ? (
        <>
          {/* Oben: X1C via Home Assistant > externe Bambu-URL > eingebaute X1C (Port 6000) */}
          {haCamReady
            ? <HaPollView deviceId={bambuId} label={tr('X1C (Home Assistant)')} />
            : webcamUrlTop
              ? <StreamView url={webcamUrlTop} portrait={false} label={tr('Bambu (oben)')} />
              : <X1CView bambuId={bambuId} />}
          {/* Unten: Hochkant */}
          <StreamView url={webcamUrl} portrait={true} label={tr('Hochkant (unten)')} />
        </>
      ) : (
        <div className="flex flex-col items-center justify-center text-surface-600 gap-1 py-8 text-center">
          <p className="text-[11px]">{tr('Kamera aus')}</p>
          <p className="text-[9px] text-surface-700">{tr('Kein Livebild, keine automatischen Snapshots')}</p>
        </div>
      )}
    </div>
  )
}

/* ── B.3 Was-wäre-wenn-Planer ─────────────────────────────────
   Zeigt für die aktuelle Queue-Reihenfolge eine Zeitleiste: pro Job die
   beste verfügbare Dauer (Live > Historie > Slicer) + Wechsel-Aufschlag, mit
   kumulierter Fertig-Uhrzeit. Reihenfolge ändern (Smart-Sort / ↑↓) → Planer
   rechnet sofort neu, ohne irgendetwas zu starten. */
function QueuePlanner({ jobs, tr }) {
  const [hist, setHist] = useState({})
  const [cost, setCost] = useState(null)   // { power_price_eur_kwh, machine_rate_eur_h, filament_price_eur_kg }
  const [tick, setTick] = useState(0)

  const active = jobs.filter(j => ['pending', 'running', 'printing', 'sending'].includes(j.status))
  const sig = active.map(j => `${j.id}:${j.status}:${j.remaining || 0}`).join(',')

  useEffect(() => {
    let cancelled = false
    autofarmService.getHistory().then(r => { if (!cancelled) setHist(r.data || {}) }).catch(() => {})
    autofarmService.getSettings().then(r => { if (!cancelled) setCost(r.data) }).catch(() => {})
    Promise.all(active.map(j => ensureMeta(j.fileId))).then(() => { if (!cancelled) setTick(t => t + 1) })
    return () => { cancelled = true }
  }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!active.length) {
    return <p className="text-[11px] text-surface-600 py-3 text-center">{tr('Keine wartenden Jobs zum Planen')}</p>
  }

  // Kosten je Job: Strom (Historie-kWh) + Maschinenzeit + Filament (Gramm aus Meta).
  const pPrice = cost?.power_price_eur_kwh ?? 0
  const mRate  = cost?.machine_rate_eur_h ?? 0
  const fPrice = cost?.filament_price_eur_kg ?? 0
  const jobCost = (j, sec) => {
    const h = hist[j.fileId] ?? hist[String(j.fileId)]
    const grams = getCachedMeta(j.fileId)?.filament_g || 0
    const e = (h?.avg_kwh || 0) * pPrice
    const m = (sec / 3600) * mRate
    const f = (grams / 1000) * fPrice
    return e + m + f
  }
  const costOn = pPrice > 0 || mRate > 0 || fPrice > 0

  const now = Date.now()
  let acc = 0, totalCost = 0
  const rows = active.map((j, i) => {
    if (i > 0) acc += CHANGEOVER_SEC
    const { sec, src } = jobPrintSec(j, getCachedMeta(j.fileId), hist)
    acc += sec
    const c = jobCost(j, sec); totalCost += c
    return { j, sec, src, cost: c, end: new Date(now + acc * 1000) }
  })
  const totalSec = acc
  const clk = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const srcMeta = {
    live:   { sym: '●', cls: 'text-blue-400',    title: tr('Live-Restzeit') },
    hist:   { sym: '📊', cls: 'text-emerald-400', title: tr('aus echter Historie') },
    slicer: { sym: '~', cls: 'text-surface-500',  title: tr('Slicer-Schätzung') },
    none:   { sym: '?', cls: 'text-amber-500',    title: tr('keine Zeitangabe') },
  }

  return (
    <div className="space-y-1.5">
      <div className="space-y-1">
        {rows.map(({ j, sec, src, cost: c, end }, i) => {
          const m = srcMeta[src] ?? srcMeta.none
          return (
            <div key={j.id} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono text-surface-600 w-4 text-right shrink-0">{i + 1}</span>
              <span className="text-surface-300 flex-1 min-w-0 truncate">{j.fileName?.replace(/\.[^.]+$/, '')}</span>
              <span className={`shrink-0 ${m.cls}`} title={m.title}>{m.sym}</span>
              <span className="font-mono text-surface-400 w-16 text-right shrink-0">{fmtDur(sec) ?? '—'}</span>
              {costOn && <span className="font-mono text-amber-400/80 w-14 text-right shrink-0" title={tr('Kosten: Strom + Maschine + Filament')}>{c > 0 ? `${c.toFixed(2)} €` : '—'}</span>}
              <span className="font-mono text-surface-600 w-12 text-right shrink-0" title={tr('voraussichtlich fertig')}>{clk(end)}</span>
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between border-t border-surface-800/50 pt-1.5 text-[11px]">
        <span className="text-surface-500">{tr('{0} Jobs', rows.length)}</span>
        <span className="font-mono text-surface-300">
          {costOn && totalCost > 0 && <span className="text-amber-400/80 mr-2">{totalCost.toFixed(2)} €</span>}
          {fmtDur(totalSec) ? tr('~{0} · fertig ~{1} Uhr', fmtDur(totalSec), clk(new Date(now + totalSec * 1000))) : tr('Gesamtzeit unbekannt')}
        </span>
      </div>
    </div>
  )
}

function AutoFarm() {
  const { tr } = useLanguage()
  const [gcodeFiles,      setGcodeFiles]      = useState([])
  const [rackData,        setRackData]        = useState(null)
  const [bambuId,         setBambuId]         = useState(null)
  const [webcamUrl,       setWebcamUrl]       = useState('')        // untere (hochkant) Kamera
  const [webcamUrlTop,    setWebcamUrlTop]    = useState('')        // obere (Bambu / quer) Kamera
  const [haCamReady,      setHaCamReady]      = useState(false)     // X1C-Cam via Home Assistant
  const [cameraOn,        setCameraOn]        = useState(true)      // Kamera-Toggle (Anzeige + Snapshots)
  const [jobs,            setJobs]            = useState([])
  const [farmStatus,      setFarmStatus]      = useState(null)
  const [feedback,        setFeedback]        = useState(null)
  const [showSettings,    setShowSettings]    = useState(false)
  const [pollInterval,    setPollInterval]    = useState(20)
  const [minPrintMinutes, setMinPrintMinutes] = useState(0)
  const [useAms,          setUseAms]          = useState(true)
  const [settingsLoaded,  setSettingsLoaded]  = useState(false)
  const [queueLoaded,     setQueueLoaded]     = useState(false)
  const [homingFile,      setHomingFile]      = useState(null)   // {configured, file_id, filename}
  const [homingSetupBusy, setHomingSetupBusy] = useState(false)
  const [addFileId,       setAddFileId]       = useState(null)
  const [addCount,        setAddCount]        = useState(1)
  const [templates,       setTemplates]       = useState(loadTemplates)
  const [tplOpen,         setTplOpen]         = useState(false)
  const [tplName,         setTplName]         = useState('')
  const [plannerOpen,     setPlannerOpen]     = useState(false)
  const [filePlates,      setFilePlates]      = useState([])     // plate numbers in selected file (multi-plate .3mf)
  const [selPlates,       setSelPlates]       = useState([])     // which plates to enqueue
  const [amsSlots,        setAmsSlots]        = useState([])
  const [amsLoading,      setAmsLoading]      = useState(false)
  const [amsOpenIds,      setAmsOpenIds]      = useState(() => new Set())
  const [showRackCfg,    setShowRackCfg]     = useState(false)
  const [rackCfgNr,      setRackCfgNr]       = useState(3)
  const [rackCfgSpr,     setRackCfgSpr]      = useState(6)
  const [rackCfgH,       setRackCfgH]        = useState(50)
  const [stackRack,      setStackRack]       = useState(1)
  const [stackSlot,      setStackSlot]       = useState(7)
  const [maxPlates,       setMaxPlates]       = useState(4)
  const [heightMarginPct, setHeightMarginPct] = useState(15)
  // Frei konfigurierbares Dashboard (Position/Größe/Ein-Aus der Panels, serverseitig)
  const [editingDash, setEditingDash] = useState(false)
  const [dashLayout,  setDashLayout]  = useState(DEFAULT_LAYOUT)
  const [dashHidden,  setDashHidden]  = useState([])
  const [logFilter,   setLogFilter]   = useState('')   // Q2: Aktivitäts-Log durchsuchen
  const [dragId,      setDragId]      = useState(null) // Q1: gezogener Job (Drag-&-Drop)
  const dashSaveRef   = useRef(null)
  const rootRef       = useRef(null)   // Q3: Sichtbarkeits-Check für Tastenkürzel
  const logFilterRef  = useRef(null)
  const togglePauseRef = useRef(null)
  const dashLoadedRef = useRef(false)
  const prevRunningRef = useRef(false)
  const pollTimerRef = useRef(null)
  const settingsSaveRef = useRef(null)
  const queueSaveRef    = useRef(null)
  const runningRef  = useRef(false)
  const rackDataRef = useRef(null)

  const running  = farmStatus?.running  ?? false
  const paused   = farmStatus?.paused   ?? false
  const farmLog  = farmStatus?.log      ?? []
  // Use current_job_id from backend; fall back to finding any active job
  const curJobId = farmStatus?.current_job_id
    ?? farmStatus?.jobs?.find(j => ['running', 'printing', 'sending'].includes(j.status))?.id
    ?? null
  const seqProgress = (farmStatus?.seq_step_total > 0) ? {
    idx:   farmStatus.seq_step_idx,
    total: farmStatus.seq_step_total,
    label: farmStatus.seq_step_label,
  } : null

  runningRef.current  = running
  rackDataRef.current = rackData

  const showFeedback = (msg, ok = true) => {
    setFeedback({ msg, ok })
    setTimeout(() => setFeedback(null), 5000)
  }

  // Kamera an/aus: blendet Livebild aus und stoppt (auto.) Snapshots. Persistiert
  // pro Drucker; andere Ansichten ziehen über das cameraSettingsSaved-Event nach.
  const toggleCamera = useCallback(async () => {
    if (!bambuId) return
    const next = !cameraOn
    setCameraOn(next)
    try {
      await deviceSettingsService.updateSettings(bambuId, { camera_enabled: next })
      window.dispatchEvent(new CustomEvent('printloom:cameraSettingsSaved'))
    } catch {
      setCameraOn(!next)  // bei Fehler zurückrollen
      showFeedback(tr('Kamera-Status konnte nicht gespeichert werden'), false)
    }
  }, [bambuId, cameraOn])

  /* ── Dashboard-Layout laden/speichern (serverseitig, global) ─── */
  useEffect(() => {
    systemService.getDashboardLayout()
      .then(r => {
        const d = r.data || {}
        if (Array.isArray(d.layout) && d.layout.length) setDashLayout(mergeLayout(d.layout))
        if (Array.isArray(d.hidden)) setDashHidden(d.hidden)
      })
      .catch(() => {})
      .finally(() => { dashLoadedRef.current = true })
  }, [])

  const persistDash = useCallback((layout, hidden) => {
    if (!dashLoadedRef.current) return          // nicht während des Erst-Ladens speichern
    clearTimeout(dashSaveRef.current)
    dashSaveRef.current = setTimeout(() => {
      systemService.saveDashboardLayout({ layout, hidden }).catch(() => {})
    }, 600)
  }, [])

  // RGL meldet nur die sichtbaren Items — in den Gesamt-Layout-Stand einmischen,
  // damit ausgeblendete Panels ihre Position/Größe behalten.
  const onDashLayoutChange = useCallback((lay) => {
    setDashLayout(prev => {
      const map = new Map(prev.map(l => [l.i, l]))
      lay.forEach(l => map.set(l.i, { ...map.get(l.i), ...l }))
      const next = Array.from(map.values())
      persistDash(next, dashHidden)
      return next
    })
  }, [dashHidden, persistDash])

  const toggleDashPanel = useCallback((id) => {
    setDashHidden(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      persistDash(dashLayout, next)
      return next
    })
  }, [dashLayout, persistDash])

  const resetDash = useCallback(() => {
    setDashLayout(DEFAULT_LAYOUT)
    setDashHidden([])
    dashLoadedRef.current = true
    systemService.saveDashboardLayout({ layout: DEFAULT_LAYOUT, hidden: [] }).catch(() => {})
    showFeedback(tr('Dashboard auf Standard zurückgesetzt'))
  }, [])

  const fetchAmsSlots = useCallback(async () => {
    if (!bambuId) { setAmsSlots([]); return }
    setAmsLoading(true)
    try {
      const r   = await printerService.getStatus(bambuId)
      const raw = r.data?.ams?.ams ?? []
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
            color: (tray.tray_color || '').replace('#','').slice(0,6),
          })
        }
      }
      setAmsSlots(slots)
    } catch { setAmsSlots([]) }
    setAmsLoading(false)
  }, [bambuId])

  /* ── Sync job statuses from backend (only while running) ─── */
  useEffect(() => {
    if (!farmStatus?.jobs?.length || !farmStatus?.running) return
    // Keep _id ahead of all known job IDs to prevent 409 collisions on re-enqueue
    const maxId = Math.max(...farmStatus.jobs.map(j => j.id))
    if (maxId >= _id) _id = maxId + 1
    setJobs(prev => {
      if (!prev.length) {
        // Fresh page load while the farm already runs — map height like below so
        // the rack preview works without waiting for a queue reload.
        return farmStatus.jobs.map(j => ({
          ...j,
          computedHeight: j.object_height_mm ?? null,
          objectHeight:   j.object_height_mm ?? null,
          slot:           (j.slot && j.slot !== '1-0') ? j.slot : null,
          heightLoading:  false,
          note:           '',
        }))
      }
      const updated = prev.map(j => {
        const bj = farmStatus.jobs.find(x => x.id === j.id)
        if (!bj) return j
        return {
          ...j,
          status:           bj.status,
          progress:         bj.progress,
          remaining:        bj.remaining,
          estimatedMinutes: bj.estimatedMinutes ?? j.estimatedMinutes,
          // Use the real slot the backend assigns at print start, but keep our
          // local preview while it still echoes the '1-0' placeholder (pending) —
          // otherwise the rack viz loses the target fach for queued jobs mid-run.
          slot:             (bj.slot && bj.slot !== '1-0') ? bj.slot : j.slot,
          needs_ams:        bj.needs_ams ?? j.needs_ams,
          ams_missing:      bj.ams_missing ?? j.ams_missing,
          snapshot:         bj.snapshot ?? j.snapshot,
        }
      })
      // Append jobs that exist in the backend but not locally — e.g. added to
      // the running farm from another device (iPhone vs. desktop).
      const known = new Set(updated.map(j => j.id))
      const added = farmStatus.jobs
        .filter(bj => !known.has(bj.id))
        .map(bj => ({
          ...bj,
          // Backend uses snake_case object_height_mm; the UI height bar + slot
          // preview read computedHeight — map it so mid-run additions render fully.
          computedHeight: bj.object_height_mm ?? null,
          objectHeight:   bj.object_height_mm ?? null,
          slot:           (bj.slot && bj.slot !== '1-0') ? bj.slot : null,
          heightLoading:  false,
          note:           '',
        }))
      return added.length ? [...updated, ...added] : updated
    })
  }, [farmStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Preview target slots while the farm runs ────────────────
     Pending jobs (incl. ones added mid-run from the file library) carry the
     backend's '1-0' placeholder until they actually start printing. Give them a
     previewed free slot so the rack viz shows where each queued job will land.
     This is purely visual and never persisted — the backend picks the real slot
     at print start based on the live rack state. */
  useEffect(() => {
    if (!running || !rackData) return
    const slotH = rackData.slot_height_mm ?? 50
    setJobs(prev => {
      let changed = false
      const result = []
      for (const j of prev) {
        // Once a job is actually printing/done the backend owns its slot — leave it.
        const backendOwned = ['printing', 'running', 'sending', 'done', 'error'].includes(j.status)
        if (j.status !== 'pending' || backendOwned || !j.computedHeight) { result.push(j); continue }
        const priorPending = result.filter(p => p.status === 'pending')
        const preview = autoSlot(priorPending, rackData, j.computedHeight, slotH)
        if (preview !== j.slot) changed = true
        result.push(preview !== j.slot ? { ...j, slot: preview } : j)
      }
      return changed ? result : prev
    })
  }, [running, jobs, rackData]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Browser tab title ───────────────────────────────────── */
  useEffect(() => {
    if (!running) { document.title = 'Printloom'; return }
    const active = jobs.find(j => j.id === curJobId)
    if (active?.status === 'printing' && active.progress > 0) {
      document.title = `[${active.progress}%] ${active.fileName} — Printloom`
    } else {
      document.title = '[Auto Farm] Printloom'
    }
  }, [running, curJobId, jobs])
  useEffect(() => () => { document.title = 'Printloom' }, [])

  /* ── Farm status polling ─────────────────────────────────── */
  const fetchStatus = useCallback(async () => {
    try {
      const r = await autofarmService.getStatus()
      setFarmStatus(r.data)
    } catch {}
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  // P6: Status kommt live per WebSocket (mit HTTP-Poll-Fallback) — ersetzt das
  // bisherige 5s-Status-Polling. fetchStatus bleibt für sofortige Updates nach
  // Aktionen (Start/Stop/Pause) erhalten.
  useFarmStatusStream(setFarmStatus)

  // Auto-stop notification — only fires when farm stopped on its own (not manual)
  useEffect(() => {
    const nowRunning = farmStatus?.running ?? false
    if (prevRunningRef.current && !nowRunning && farmStatus?.stop_reason === 'completed') {
      showFeedback(tr('✓ Alle Jobs abgearbeitet — Auto Farm beendet'))
    }
    prevRunningRef.current = nowRunning
  }, [farmStatus?.running, farmStatus?.stop_reason]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (running) {
      // Status läuft jetzt über den WebSocket (P6). Während die Farm läuft ziehen
      // wir nur noch das Regal nach, damit fertige Fächer sofort „fertig" werden.
      const poll = () => {
        rackManagerService.getAll().then(r => setRackData(r.data)).catch(() => {})
      }
      pollTimerRef.current = setInterval(poll, 5000)
    } else {
      if (pollTimerRef.current) { clearInterval(pollTimerRef.current); pollTimerRef.current = null }
    }
    return () => { if (pollTimerRef.current) clearInterval(pollTimerRef.current) }
  }, [running])

  useEffect(() => {
    autofarmService.getSettings()
      .then(r => {
        setPollInterval(Math.max(1, r.data.poll_interval ?? 20))
        setMinPrintMinutes(r.data.min_print_minutes ?? 0)
        setUseAms(r.data.use_ams ?? true)
      })
      .catch(() => {})
      .finally(() => setSettingsLoaded(true))
    autofarmService.getHomingFileInfo()
      .then(r => setHomingFile(r.data))
      .catch(() => {})
  }, [])

  useEffect(() => {
    autofarmService.getQueue()
      .then(r => {
        const loaded = (r.data ?? []).map(j => ({ ...j, heightLoading: false, progress: j.progress ?? 0, remaining: j.remaining ?? 0 }))
        if (loaded.length) {
          _id = Math.max(...loaded.map(j => j.id)) + 1
          setJobs(loaded)
        }
      })
      .catch(() => {})
      .finally(() => setQueueLoaded(true))
  }, [])

  // Jobs are added from the Datei-Bibliothek now — reload the queue when it
  // signals a change (or when the tab regains focus), unless the farm is running.
  useEffect(() => {
    const reload = () => {
      // While running the in-memory farm queue is the source of truth; don't reload
      // (it would clobber live state). Just refresh the status so the merge picks up
      // mid-run additions immediately instead of waiting for the next 5s poll.
      if (runningRef.current) { fetchStatus(); return }
      autofarmService.getQueue()
        .then(r => {
          const loaded = (r.data ?? []).map(j => ({ ...j, heightLoading: false, progress: j.progress ?? 0, remaining: j.remaining ?? 0 }))
          _id = loaded.length ? Math.max(...loaded.map(j => j.id)) + 1 : _id
          setJobs(loaded)
          loaded.forEach(j => { if (!j.computedHeight && j.fileId) analyzeFile(j.id, j.fileId) })
        })
        .catch(() => {})
    }
    window.addEventListener('printloom:queueChanged', reload)
    return () => window.removeEventListener('printloom:queueChanged', reload)
  }, [fetchStatus]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!settingsLoaded) return
    clearTimeout(settingsSaveRef.current)
    settingsSaveRef.current = setTimeout(() => {
      autofarmService.saveSettings({ poll_interval: pollInterval, min_print_minutes: minPrintMinutes, use_ams: useAms })
        .catch(() => {})
    }, 600)
    return () => clearTimeout(settingsSaveRef.current)
  }, [pollInterval, minPrintMinutes, useAms, settingsLoaded])

  useEffect(() => {
    if (!queueLoaded || running) return
    clearTimeout(queueSaveRef.current)
    queueSaveRef.current = setTimeout(() => {
      const toSave = jobs.map(({ heightLoading, ...rest }) => rest)
      autofarmService.saveQueue(toSave).catch(() => {})
    }, 800)
    return () => clearTimeout(queueSaveRef.current)
  }, [jobs, running, queueLoaded])

  /* ── Load ────────────────────────────────────────────────── */
  const load = useCallback(async () => {
    const [r, f, d] = await Promise.allSettled([
      rackManagerService.getAll(),
      fileService.listFiles(),
      deviceService.listDevices(),
    ])
    if (r.status === 'fulfilled') {
      const rd = r.value.data
      setRackData(rd)
      setRackCfgNr(rd.num_racks      ?? 3)
      setRackCfgSpr(rd.slots_per_rack ?? 6)
      setRackCfgH(rd.slot_height_mm  ?? 50)
      setStackRack(rd.stack_rack     ?? 1)
      setStackSlot(rd.stack_slot     ?? 7)
      setMaxPlates(rd.max_plates ?? 4)
      setHeightMarginPct(rd.height_margin_pct ?? 15)
    }
    if (f.status === 'fulfilled') {
      const files = (f.value.data.files ?? []).filter(x => x.file_type === '.gcode' || x.file_type === '.3mf')
      setGcodeFiles(files)
      setAddFileId(prev => prev ?? files[0]?.id ?? null)
    }
    if (d.status === 'fulfilled') {
      const b = d.value.data.find(x => x.device_type === 'bambu_lab')
      if (b) {
        setBambuId(b.id)
        deviceSettingsService.getSettings(b.id)
          .then(s => {
            setWebcamUrl(s.data?.webcam_url || ''); setWebcamUrlTop(s.data?.webcam_url_top || '')
            setHaCamReady(!!(s.data?.ha_url && s.data?.ha_camera && s.data?.ha_token_set))
            setCameraOn(s.data?.camera_enabled !== false)
          })
          .catch(() => {})
      }
    }
    if ([r, f, d].some(x => x.status === 'rejected')) {
      showFeedback(tr('Einige Daten konnten nicht geladen werden'), false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  /* ── Live refresh: keep file dropdown + rack viz current ─────
     load() runs once on mount and App.jsx keeps this page mounted, so
     without this the file list and rack state stay stale until a full
     page reload. Only refreshes the volatile live data (not the rack
     config modal fields), so it won't clobber in-progress edits. */
  const refreshLiveData = useCallback(async () => {
    const [r, f] = await Promise.allSettled([
      rackManagerService.getAll(),
      fileService.listFiles(),
    ])
    if (r.status === 'fulfilled') setRackData(r.value.data)
    if (f.status === 'fulfilled') {
      const files = (f.value.data.files ?? []).filter(x => x.file_type === '.gcode' || x.file_type === '.3mf')
      setGcodeFiles(files)
      setAddFileId(prev => prev ?? files[0]?.id ?? null)
    }
  }, [])

  // Load live AMS slots up front so the queue can flag filament mismatches
  // ("manuelle AMS-Festlegung notwendig") before the farm is even started.
  useEffect(() => { if (bambuId) fetchAmsSlots() }, [bambuId, fetchAmsSlots])

  // Detect multi-plate .3mf for the file selected in the "add job" picker.
  useEffect(() => {
    const fid = addFileId ?? gcodeFiles[0]?.id
    const f   = gcodeFiles.find(x => x.id === fid)
    if (!fid || f?.file_type !== '.3mf') { setFilePlates([]); setSelPlates([]); return }
    let cancelled = false
    printerService.getPlates(fid)
      .then(r => {
        if (cancelled) return
        const plates = r.data?.plates ?? []
        setFilePlates(plates.length > 1 ? plates : [])
        setSelPlates(plates.length > 1 ? plates : [])  // default: all plates selected
      })
      .catch(() => { if (!cancelled) { setFilePlates([]); setSelPlates([]) } })
    return () => { cancelled = true }
  }, [addFileId, gcodeFiles])

  // Sync rack config changes from Configuration page without F5
  useEffect(() => {
    const handler = () => refreshLiveData()
    window.addEventListener('printloom:rackConfigSaved', handler)
    return () => window.removeEventListener('printloom:rackConfigSaved', handler)
  }, [refreshLiveData])

  // Kamera-URLs aus der Konfiguration ohne F5 übernehmen
  useEffect(() => {
    const handler = () => {
      if (!bambuId) return
      deviceSettingsService.getSettings(bambuId)
        .then(s => {
          setWebcamUrl(s.data?.webcam_url || ''); setWebcamUrlTop(s.data?.webcam_url_top || '')
          setHaCamReady(!!(s.data?.ha_url && s.data?.ha_camera && s.data?.ha_token_set))
          setCameraOn(s.data?.camera_enabled !== false)
        })
        .catch(() => {})
    }
    window.addEventListener('printloom:cameraSettingsSaved', handler)
    return () => window.removeEventListener('printloom:cameraSettingsSaved', handler)
  }, [bambuId])

  // Filaments of a job that have no confident match in the live AMS.
  const jobAmsMissing = (job) =>
    (useAms && amsSlots.length > 0 && !(job.amsMap || '').trim() && job.filaments?.length > 0)
      ? amsMissing(job.filaments, amsSlots) : []
  const jobNeedsAms = (job) => job.needs_ams === true || jobAmsMissing(job).length > 0

  /* ── Job helpers ─────────────────────────────────────────── */
  const setJobField = (id, updates) =>
    setJobs(prev => prev.map(j => j.id === id ? { ...j, ...updates } : j))

  const analyzeFile = (jobId, fileId) => {
    rackManagerService.analyzeFile(fileId)
      .then(r => {
        const computed = r.data.computed_height_mm ?? null
        setJobs(prev => {
          // First apply this job's analysis result
          const updated = prev.map(j => j.id === jobId ? {
            ...j,
            objectHeight:   r.data.max_z_mm,
            layerCount:     r.data.layer_count    ?? 0,
            layerHeightMm:  r.data.layer_height_mm ?? 0,
            heightSource:   r.data.source         ?? '',
            computedHeight: computed,
            heightLoading:  false,
          } : j)
          // Recompute slots for ALL pending jobs in order to fix race conditions
          // when multiple jobs are analyzed in parallel (each sees others' stale state)
          if (!rackDataRef.current || runningRef.current) return updated
          const slotH = rackDataRef.current?.slot_height_mm ?? 50
          const result = []
          for (const j of updated) {
            if (j.status !== 'pending' || !j.computedHeight) { result.push(j); continue }
            const priorPending = result.filter(p => p.status === 'pending')
            result.push({ ...j, slot: autoSlot(priorPending, rackDataRef.current, j.computedHeight, slotH) })
          }
          return result
        })
      })
      .catch(() => setJobField(jobId, { heightLoading: false }))

    autofarmService.getFileFilaments(fileId)
      .then(r => setJobField(jobId, { filaments: r.data.filaments ?? [] }))
      .catch(() => setJobField(jobId, { filaments: [] }))
  }

  const _doAddJobs = (file, amsMap, count, plate = null) => {
    const newJobs = Array.from({ length: count }, () => {
      const jobId = _id++
      return {
        id: jobId, fileId: file.id, fileName: file.original_filename,
        slot: null, amsMap: amsMap ?? '', objectHeight: null, heightLoading: true,
        progress: 0, remaining: 0, status: 'pending', note: '', estimatedMinutes: null,
        filaments: [], plate: plate ?? null,
      }
    })
    setJobs(prev => [...prev, ...newJobs])
    newJobs.forEach(j => analyzeFile(j.id, file.id))
    if (running) {
      newJobs.forEach(j =>
        autofarmService.enqueue({
          id: j.id, fileId: file.id, fileName: file.original_filename,
          slot: '1-0', amsMap: j.amsMap ?? '', plate: j.plate ?? null,
        }).catch(e => showFeedback(e.response?.data?.detail ?? e.message, false))
      )
    }
    if (count > 1) setAddCount(1)
  }

  const addJob = () => {
    if (!gcodeFiles.length) return
    const file  = gcodeFiles.find(f => f.id === addFileId) ?? gcodeFiles[0]
    const count = Math.max(1, addCount)
    // Auto-match stored filament preset (from FileLibrary) to current AMS slots
    let amsMap = ''
    try {
      const presets = JSON.parse(localStorage.getItem('ottomat3d_file_presets') || '{}')
      const preset  = presets[file.id]
      if (preset?.filaments?.length && amsSlots.length > 0) {
        const norm = c => (c || '').replace('#', '').toUpperCase().slice(0, 6)
        const mapped = preset.filaments.map(f => {
          const fBase  = (f.type || '').toUpperCase().trim().split(/\s+/)[0]
          const fColor = norm(f.color)
          const pool   = amsSlots.filter(s => s.type.toUpperCase().includes(fBase) || fBase.includes(s.type.toUpperCase().split(/\s+/)[0]))
          const src    = pool.length ? pool : amsSlots
          return [...src].sort((a, b) => colorDist(fColor, norm(a.color)) - colorDist(fColor, norm(b.color)))[0]?.gid ?? 0
        })
        amsMap = mapped.join(',')
      }
    } catch {}
    // Multi-plate: one job per selected plate (× repeat count); else a single job.
    if (filePlates.length > 1 && selPlates.length > 0) {
      selPlates.forEach(p => _doAddJobs(file, amsMap, count, p))
    } else {
      _doAddJobs(file, amsMap, count)
    }
  }

  const toggleSelPlate = (p) =>
    setSelPlates(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p].sort((a, b) => a - b))

  /* ── Queue-Vorlagen (Templates) ─── */
  const saveTemplate = () => {
    const name = tplName.trim()
    if (!name || !jobs.length) return
    // collapse identical jobs (same file + AMS-Map) into {fileId, fileName, amsMap, count}
    const groups = []
    jobs.forEach(j => {
      const g = groups.find(x => x.fileId === j.fileId && x.amsMap === (j.amsMap || ''))
      if (g) g.count++
      else groups.push({ fileId: j.fileId, fileName: j.fileName, amsMap: j.amsMap || '', count: 1 })
    })
    const all = { ...loadTemplates(), [name]: groups }
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all))
    setTemplates(all)
    setTplName('')
    showFeedback(tr('Vorlage „{0}" gespeichert ({1} Jobs)', name, jobs.length))
  }

  const applyTemplate = (name) => {
    const entries = templates[name]
    if (!entries?.length) return
    let added = 0, missing = 0
    entries.forEach(e => {
      const file = gcodeFiles.find(f => f.id === e.fileId)
      if (!file) { missing++; return }
      _doAddJobs(file, e.amsMap || '', e.count || 1)
      added += e.count || 1
    })
    setTplOpen(false)
    showFeedback(
      missing
        ? tr('{0} Jobs geladen — {1} Datei(en) nicht mehr vorhanden', added, missing)
        : tr('Vorlage „{0}" geladen ({1} Jobs)', name, added),
      added > 0
    )
  }

  const deleteTemplate = (name) => {
    const all = loadTemplates()
    delete all[name]
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(all))
    setTemplates(all)
  }

  const changeFile = (jobId, fileId) => {
    const f = gcodeFiles.find(x => x.id === +fileId)
    if (!f) return
    setJobField(jobId, { fileId: +fileId, fileName: f.original_filename, objectHeight: null, heightLoading: true })
    analyzeFile(jobId, +fileId)
  }

  const removeJob = async (id) => {
    if (running) {
      const job = jobs.find(j => j.id === id)
      if (job?.status === 'done') {
        setJobs(prev => prev.filter(j => j.id !== id))
        return
      }
      try {
        await autofarmService.removeJob(id)
      } catch (e) {
        if (e.response?.status === 404) {
          // Job already gone from backend — remove locally
          setJobs(prev => prev.filter(j => j.id !== id))
          return
        }
        showFeedback(e.response?.data?.detail ?? e.message, false)
        return
      }
    }
    setJobs(prev => prev.filter(j => j.id !== id))
  }

  const syncReorder = (updatedJobs) => {
    if (running) {
      const pendingIds = updatedJobs.filter(j => j.status === 'pending').map(j => j.id)
      autofarmService.reorderJobs(pendingIds).catch(() => {})
    }
  }

  const moveJobUp = (id) => setJobs(prev => {
    const i = prev.findIndex(j => j.id === id)
    if (i <= 0) return prev
    const next = [...prev]
    ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
    syncReorder(next)
    return next
  })

  const moveJobDown = (id) => setJobs(prev => {
    const i = prev.findIndex(j => j.id === id)
    if (i >= prev.length - 1) return prev
    const next = [...prev]
    ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
    syncReorder(next)
    return next
  })

  // Q1: gezogenen Job vor das Ziel einsortieren (nur zwischen wartenden Jobs).
  const moveJobTo = (dragJobId, targetId) => {
    if (dragJobId == null || dragJobId === targetId) return
    setJobs(prev => {
      const from = prev.findIndex(j => j.id === dragJobId)
      const to   = prev.findIndex(j => j.id === targetId)
      if (from < 0 || to < 0) return prev
      if (prev[from].status !== 'pending' || prev[to].status !== 'pending') return prev
      const next = [...prev]
      const [moved] = next.splice(from, 1)
      const insertAt = next.findIndex(j => j.id === targetId)   // nach Entfernen neu bestimmen
      next.splice(insertAt, 0, moved)
      syncReorder(next)
      return next
    })
  }

  const resetJob = (id) => {
    setJobs(prev => {
      const updated = prev.map(j => j.id === id ? { ...j, status: 'pending', progress: 0, remaining: 0 } : j)
      const toSave = updated.map(({ heightLoading, ...rest }) => rest)
      autofarmService.saveQueue(toSave).catch(() => {})
      return updated
    })
  }

  /* ── B.1 Smart-Sortierung ─────────────────────────────────────
     Gruppiert wartende Jobs nach Filament-Signatur (Material+Farbe bzw. AMS-
     Belegung), damit gleichartige Jobs nacheinander laufen → minimiert AMS-/
     Spulen-Wechsel. Laufende/fertige Jobs bleiben an ihrer Position. */
  const jobFilamentKey = (j) => {
    if (j.filaments?.length)
      return j.filaments.map(f => `${(f.type || '').toUpperCase()}|${(f.color || '').toUpperCase().replace('#', '')}`).sort().join('+')
    if ((j.amsMap || '').trim()) return `ams:${j.amsMap.trim()}`
    return `file:${j.fileId}`
  }

  const smartSort = () => setJobs(prev => {
    const pending = prev.filter(j => j.status === 'pending')
    if (pending.length < 2) return prev
    const order = []
    const groups = {}
    pending.forEach(j => {
      const k = jobFilamentKey(j)
      if (!groups[k]) { groups[k] = []; order.push(k) }
      groups[k].push(j)
    })
    const sorted = order.flatMap(k => groups[k])
    // No change? Don't churn state.
    if (sorted.every((j, i) => j.id === pending[i].id)) {
      showFeedback(tr('Bereits optimal gruppiert ({0} Filament-Gruppen)', order.length))
      return prev
    }
    let pi = 0
    const next = prev.map(j => j.status === 'pending' ? sorted[pi++] : j)
    syncReorder(next)   // pushes new order to the backend while running; debounced save otherwise
    showFeedback(tr('Nach Filament sortiert — {0} Gruppen, weniger AMS-Wechsel', order.length))
    return next
  })

  // Persist the external webcam URL (shared with the Steuerung page via device settings)
  const saveWebcamUrl = useCallback(async (url) => {
    setWebcamUrl(url)
    if (bambuId) {
      try { await deviceSettingsService.updateSettings(bambuId, { webcam_url: url }) } catch {}
    }
  }, [bambuId])

  const resetFarm = () => {
    setJobs(prev => {
      const reset = prev.map(j => ({ ...j, status: 'pending', progress: 0, remaining: 0 }))
      const toSave = reset.map(({ heightLoading, ...rest }) => rest)
      autofarmService.saveQueue(toSave).catch(() => {})
      return reset
    })
    setFarmStatus(null)
  }

  /* ── Rack management ─────────────────────────────────────── */
  const clearRackSlot = async (slotId) => {
    try {
      await rackManagerService.updateSlot(slotId, { status: 'free', file_id: null, file_name: null })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
    } catch {
      showFeedback(tr('Fach konnte nicht geleert werden'), false)
    }
  }

  const assignJobToSlot = async (slotKey) => {
    try {
      await rackManagerService.updateSlot(slotKey, { status: 'free', file_id: null, file_name: null })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      const pendingJob = jobs.find(j => j.status === 'pending')
      if (pendingJob) {
        setJobs(prev => {
          const updated = prev.map(j => j.id === pendingJob.id ? { ...j, slot: slotKey } : j)
          autofarmService.saveQueue(updated.map(({ heightLoading, ...rest }) => rest)).catch(() => {})
          return updated
        })
        showFeedback(tr('Fach {0} → "{1}" zugewiesen', slotKey, pendingJob.fileName))
      } else {
        showFeedback(tr('Fach {0} geleert — kein ausstehender Job', slotKey))
      }
    } catch {
      showFeedback(tr('Zuweisung fehlgeschlagen'), false)
    }
  }

  const clearAllDoneSlots = async () => {
    try {
      const done = Object.entries(rackData?.slots ?? {}).filter(([, s]) => s.status === 'done')
      if (!done.length) return
      const res = await rackManagerService.clearSlots({ slot_ids: done.map(([n]) => n) })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      const n = res.data?.cleared ?? done.length
      showFeedback(tr('{0} Fach/Fächer geleert', n))
    } catch {
      showFeedback(tr('Regal konnte nicht geleert werden'), false)
    }
  }

  const refillMagazine = async () => {
    try {
      await rackManagerService.refillMagazine()
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      window.dispatchEvent(new CustomEvent('printloom:rackConfigSaved'))
      showFeedback(tr('Magazin aufgefüllt ({0} Platten)', r.data.magazine_count))
    } catch {
      showFeedback(tr('Magazin konnte nicht aufgefüllt werden'), false)
    }
  }

  /* ── Log export ──────────────────────────────────────────── */
  const exportLog = () => {
    const text = [...farmLog].reverse().join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `printloom_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  /* ── Log in die Zwischenablage (gefiltert, älteste zuerst) ── */
  const copyLog = async (lines) => {
    const text = [...lines].reverse().join('\n')
    try {
      await navigator.clipboard.writeText(text)
      showFeedback(tr('Log kopiert ({0} Zeilen)', lines.length))
    } catch {
      showFeedback(tr('Kopieren nicht möglich'), false)
    }
  }

  /* ── Farm control ────────────────────────────────────────── */
  const startFarm = async () => {
    if (!bambuId) return showFeedback(tr('Kein Bambu Lab Gerät konfiguriert'), false)

    const preflightErrors = await checkPreflight(bambuId, tr)
    if (preflightErrors.length) return showFeedback(preflightErrors[0], false)

    const pending = jobs.filter(j => j.status === 'pending')
    if (!pending.length) return showFeedback(tr('Keine Jobs in der Warteschlange'), false)

    // Queue preflight (hard block): every job's filaments must match the live AMS.
    const amsBlocked = pending.filter(j => jobNeedsAms(j))
    if (amsBlocked.length) {
      return showFeedback(
        tr('Manuelle AMS-Festlegung notwendig für {0} Job(s) — Filament zuweisen, dann starten', amsBlocked.length),
        false,
      )
    }

    // Queue preflight (soft warning): simulate the slot plan; the farm pauses
    // safely if it runs out mid-run, so this only warns.
    if (rackData) {
      const slotH = rackData.slot_height_mm ?? 50
      const assigned = []
      let noSlot = 0
      for (const j of pending) {
        const h = j.computedHeight ?? j.objectHeight ?? 0
        const s = autoSlot(assigned, rackData, h, slotH)
        if (s === '1-0') noSlot++
        else assigned.push({ slot: s, computedHeight: h, status: 'pending' })
      }
      if (noSlot > 0) {
        showFeedback(tr('⚠ Nur Platz für {0}/{1} Jobs — Farm pausiert bei vollem Regal', pending.length - noSlot, pending.length), false)
      }
    }

    try {
      await autofarmService.start({
        bambu_id:          bambuId,
        use_ams:           useAms,
        poll_interval:     pollInterval,
        min_print_minutes: minPrintMinutes,
        jobs: pending.map(j => ({
          id: j.id, fileId: j.fileId, fileName: j.fileName, slot: j.slot ?? '1-0',
          status: 'pending', amsMap: j.amsMap ?? '',
          layerHeightMm: j.layerHeightMm ?? 0,
          object_height_mm: j.computedHeight ?? j.objectHeight ?? null,
          plate: j.plate ?? null,
        })),
      })
      await fetchStatus()
      showFeedback(tr('Auto Farm gestartet'))
    } catch (e) {
      showFeedback(e.response?.data?.detail ?? e.message, false)
    }
  }

  const stopFarm = async () => {
    try { await autofarmService.stop(); await fetchStatus() }
    catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }

  const saveRackConfig = async () => {
    try {
      await rackManagerService.updateConfig({
        num_racks: +rackCfgNr, slots_per_rack: +rackCfgSpr, slot_height_mm: +rackCfgH,
        stack_rack: +stackRack, stack_slot: +stackSlot,
        max_plates: +maxPlates,
        height_margin_pct: +heightMarginPct,
      })
      const r = await rackManagerService.getAll()
      setRackData(r.data)
      setRackCfgNr(r.data.num_racks); setRackCfgSpr(r.data.slots_per_rack); setRackCfgH(r.data.slot_height_mm)
      setStackRack(r.data.stack_rack ?? 1); setStackSlot(r.data.stack_slot ?? 7)
      setMaxPlates(r.data.max_plates ?? 4)
      showFeedback(tr('Regal gespeichert'))
    } catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }

  const forceReset = async () => {
    try { await autofarmService.forceReset(); await fetchStatus(); showFeedback(tr('Farm-State zurückgesetzt')) }
    catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }

  const togglePause = async () => {
    try { await autofarmService.pause(); await fetchStatus() }
    catch (e) { showFeedback(e.response?.data?.detail ?? e.message, false) }
  }
  togglePauseRef.current = togglePause

  /* ── Q3: Tastenkürzel — nur aktiv, wenn diese Seite sichtbar ist ──
     (App.jsx hält Seiten im DOM, daher Sichtbarkeits-Check via offsetParent).
     '/' fokussiert den Log-Filter · Esc verlässt ihn · Leertaste pausiert/
     setzt fort (nur während eines Laufs; Start bleibt bewusst nur per Klick). */
  useEffect(() => {
    const onKey = (e) => {
      if (!rootRef.current || rootRef.current.offsetParent === null) return
      const t = e.target
      const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' ||
                           t.tagName === 'SELECT' || t.isContentEditable)
      if (e.key === '/' && !typing) {
        e.preventDefault()
        logFilterRef.current?.focus()
      } else if (e.key === 'Escape' && t === logFilterRef.current) {
        setLogFilter('')
        t.blur()
      } else if (e.code === 'Space' && !typing && runningRef.current) {
        e.preventDefault()
        togglePauseRef.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* ── Derived helpers ─────────────────────────────────────── */
  const slotH      = rackData?.slot_height_mm  ?? 50
  const slotTol    = slotTolerance(rackData)
  const numRacks   = rackData?.num_racks        ?? 3
  const slotsPerRack = rackData?.slots_per_rack ?? 6
  const slots      = rackData
    ? Object.entries(rackData.slots ?? {}).sort(([a], [b]) => {
        const [ar, as] = parseSlotKey(a)
        const [br, bs] = parseSlotKey(b)
        return ar !== br ? ar - br : as - bs
      })
    : []
  const doneSlots = slots.filter(([, s]) => s.status === 'done')

  const pendingJobs   = jobs.filter(j => j.status === 'pending')
  const errorJobs     = jobs.filter(j => j.status === 'error')
  const activeJobs    = jobs.filter(j => ['pending', 'printing'].includes(j.status))
  const eta = useQueueEta()   // echte Rest-Druckzeit der Warteschlange (Dashboard nutzt denselben Hook)

  // Build slot → assigned job map (for rack preview)
  const slotJobMap = {}
  jobs.forEach(j => {
    if (['pending', 'running', 'printing', 'sending'].includes(j.status)) {
      if (!slotJobMap[j.slot]) slotJobMap[j.slot] = []
      slotJobMap[j.slot].push(j)
    }
  })

  // Ghost-Fächer: ein hohes Teil belegt sein Basis-Fach + die Fächer darüber.
  // Wir markieren die ÜBERLIEGENDEN Fächer (k → Basis-Job), damit sie als
  // reserviert (Ghost) statt leer angezeigt werden. Quelle: zugewiesene Jobs
  // (Vorschau) UND eingelagerte Platten aus dem Regal-Status (Drucken/Fertig).
  const ghostMap = {}   // "r-s" (überliegendes Fach) → { name, baseSlot }
  const addGhost = (slotKey, height, name) => {
    if (!slotKey || slotKey === '1-0' || !height || height <= 0) return
    const [r, s] = parseSlotKey(slotKey)
    const used = slotsNeeded(height, slotH, slotTol)   // einheitliche Fächer-Logik inkl. Toleranz
    for (let i = 1; i < used; i++) {
      const k = `${r}-${s + i}`
      if (!ghostMap[k]) ghostMap[k] = { name: name || '', baseSlot: s }
    }
  }
  jobs.forEach(j => {
    if (['pending', 'running', 'printing', 'sending'].includes(j.status))
      addGhost(j.slot, j.computedHeight ?? j.objectHeight, j.fileName)
  })
  Object.entries(rackData?.slots ?? {}).forEach(([k, sd]) => {
    // Nur für wirklich belegte Fächer — ein entnommenes (Status „empty") Fach darf
    // keinen Ghost mehr erzeugen, auch wenn die alte Höhe noch im Datensatz steht.
    if (sd?.object_height_mm > 0 && ['printing', 'done'].includes(sd.status))
      addGhost(k, sd.object_height_mm, sd.file_name)
  })

  /* ─────────────────────────────────────────────────────────── */
  return (
    <div className="space-y-4" ref={rootRef}>

      {/* Feedback */}
      {feedback && (
        <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border ${
          feedback.ok
            ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
            : 'bg-red-950/40 border-red-800 text-red-300'
        }`}>
          <span className={`dot ${feedback.ok ? 'dot-green' : 'dot-red'}`} />
          {feedback.msg}
        </div>
      )}

      {!bambuId && (
        <div className="px-4 py-3 rounded-lg bg-amber-950/40 border border-amber-800 text-amber-300 text-sm flex items-center gap-2">
          <span className="dot dot-amber" /> {tr('Kein Bambu Lab Gerät konfiguriert — bitte erst unter Configuration einrichten')}
        </div>
      )}

      {running && !curJobId && !pendingJobs.length && (
        <div className="px-4 py-3 rounded-lg bg-surface-800/60 border border-surface-700 text-surface-400 text-sm flex items-center gap-2">
          <span className="dot dot-gray animate-pulse" /> {tr('Wartet auf neue Jobs — "+ Datei" klicken um fortzufahren')}
        </div>
      )}
      {running && !jobs.find(j => j.id === curJobId) && !!curJobId && (
        <div className="px-4 py-3 rounded-lg bg-blue-950/40 border border-blue-800 text-blue-300 text-sm flex items-center gap-2">
          <span className="dot dot-blue animate-pulse" /> {tr('Auto Farm läuft im Server — Status wird live aktualisiert')}
        </div>
      )}

      {/* ── Top bar ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Title */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div>
            <h2 className="text-base font-semibold text-surface-100 leading-tight">Auto Farm</h2>
            {running && (
              <p className="text-[11px] text-surface-600 font-mono mt-0.5">
                {paused
                  ? tr('Pausiert')
                  : curJobId
                    ? tr('Läuft · {0}', jobs.find(j => j.id === curJobId)?.fileName?.replace(/\.[^.]+$/, '')?.slice(0, 28) ?? '…')
                    : pendingJobs.length
                      ? tr('{0} Job(s) wartet', pendingJobs.length)
                      : tr('Wartet auf Jobs…')}
              </p>
            )}
          </div>
          {running && (
            <div className="flex items-center gap-1.5">
              <span className="dot dot-blue animate-pulse" />
              <span className="text-xs text-blue-400 font-medium">{paused ? tr('Pausiert') : tr('Läuft')}</span>
            </div>
          )}
          {errorJobs.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-950/40 border border-red-800 text-red-400">
              {tr('{0} Fehler', errorJobs.length)}
            </span>
          )}
        </div>

        {/* Sequence progress */}
        {seqProgress && (
          <div className="flex items-center gap-2 min-w-0 max-w-xs shrink-0">
            <div className="w-20 bg-surface-800 rounded-full h-1 overflow-hidden shrink-0">
              <div
                className="h-1 rounded-full bg-blue-500 transition-all duration-300"
                style={{ width: `${Math.round(((seqProgress.idx + 1) / seqProgress.total) * 100)}%` }}
              />
            </div>
            <span className="text-[10px] font-mono text-blue-300 truncate">{seqProgress.label}</span>
          </div>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditingDash(e => !e)}
            className={`btn btn-sm ${editingDash ? 'btn-primary' : 'btn-ghost'}`}
            title={tr('Dashboard anpassen: Panels verschieben, Größe ändern, ein-/ausblenden')}
          >
            {editingDash ? tr('✓ Fertig') : tr('✎ Layout')}
          </button>
          {!running ? (
            <>
              {jobs.some(j => j.status !== 'pending') && (
                <button onClick={resetFarm} className="btn btn-ghost btn-sm text-surface-500 hover:text-surface-300" title={tr('Alle auf Ausstehend zurücksetzen')}>
                  {tr('↺ Reset')}
                </button>
              )}
              <button
                onClick={startFarm}
                disabled={!bambuId}
                className="btn btn-primary btn-sm"
              >
                {tr('▶ Aktivieren')}
                {pendingJobs.length > 0 && (
                  <span className="ml-1.5 opacity-60 text-[10px] font-mono">{pendingJobs.length}</span>
                )}
              </button>
            </>
          ) : (
            <>
              <button
                onClick={togglePause}
                title={tr('Tastenkürzel: Leertaste')}
                className={`btn btn-sm ${paused ? 'btn-primary' : 'btn-ghost text-amber-400 hover:text-amber-300'}`}
              >
                {paused ? tr('▶ Fortsetzen') : tr('⏸ Pause')}
              </button>
              <button onClick={stopFarm} className="btn btn-danger btn-sm">{tr('■ Stopp')}</button>
              <button
                onClick={forceReset}
                title={tr('Erzwingt das Zurücksetzen des Farm-States — benutze dies wenn Stopp nicht reagiert')}
                className="btn btn-ghost btn-sm text-surface-600 hover:text-red-400 text-[10px]"
              >↺</button>
            </>
          )}
        </div>
      </div>

      {/* Paused banner */}
      {paused && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm border bg-amber-950/40 border-amber-800 text-amber-300">
          <span className="dot dot-amber animate-pulse" /> {tr('Pausiert — warte auf Fortsetzen…')}
        </div>
      )}

      {/* ── Bearbeiten-Leiste: Panels ein-/ausblenden ── */}
      {editingDash && (
        <div className="card p-2.5 flex items-center gap-2 flex-wrap">
          <span className="section-label mb-0 mr-1">{tr('Panels')}</span>
          {PANELS.map(p => {
            const on = !dashHidden.includes(p.id)
            return (
              <button key={p.id} onClick={() => toggleDashPanel(p.id)}
                className={`text-[11px] font-medium px-2 h-7 rounded-lg border transition-colors ${
                  on ? 'border-blue-700 bg-blue-950/40 text-blue-300'
                     : 'border-surface-700 text-surface-600 hover:text-surface-400'}`}
                title={on ? tr('Ausblenden') : tr('Einblenden')}>
                {on ? '☑' : '☐'} {tr(p.label)}
              </button>
            )
          })}
          <button onClick={resetDash}
            className="ml-auto text-[11px] text-surface-500 hover:text-surface-300 transition-colors"
            title={tr('Positionen, Größen und Sichtbarkeit auf Standard zurücksetzen')}>
            {tr('↺ Standard')}
          </button>
        </div>
      )}

      {/* ── Frei konfigurierbares Dashboard-Raster ── */}
      <DashboardGrid layout={dashLayout} editing={editingDash} onLayoutChange={onDashLayoutChange}>
        {[
          !dashHidden.includes('camera') && (
            <div key="camera" className="panel-fill">
              <CameraPanel bambuId={bambuId} webcamUrl={webcamUrl} webcamUrlTop={webcamUrlTop} haCamReady={haCamReady} cameraOn={cameraOn} onToggle={toggleCamera} />
            </div>
          ),
          !dashHidden.includes('phases') && (
            <div key="phases" className="panel-fill">
              <FarmViz farmStatus={farmStatus} jobs={jobs} curJobId={curJobId} />
            </div>
          ),
          !dashHidden.includes('queue') && (
            <div key="queue" className="panel-fill">
        {/* ── Print queue ─────────────────────────────────────── */}
        <div className="card">
          <div className="flex items-start justify-between mb-4 gap-2 flex-wrap">
            <div>
              <p className="section-label">{tr('Warteschlange')}</p>
              {eta.ready && eta.jobs > 0 && (
                <p className="text-[11px] text-surface-500 font-mono mt-0.5">
                  {fmtDur(eta.totalSec)
                    ? <>{tr('~{0} gesamt', fmtDur(eta.totalSec))}{eta.finishAt && <span className="text-surface-600">{tr(' · fertig ~{0} Uhr', eta.finishAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span>}</>
                    : tr('Gesamtzeit unbekannt')}
                  {eta.known < eta.jobs && <span className="text-surface-600"> {tr('({0}/{1} mit Zeit)', eta.known, eta.jobs)}</span>}
                  {eta.histCount > 0 && <span className="text-emerald-500/80" title={tr('Basierend auf echten früheren Druckzeiten')}> {tr('· 📊 {0} aus Historie', eta.histCount)}</span>}
                </p>
              )}
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {/* B.1 Smart-Sortierung */}
              {pendingJobs.length > 1 && (
                <button
                  onClick={smartSort}
                  className="btn btn-ghost btn-sm shrink-0"
                  title={tr('Wartende Jobs nach Filament gruppieren → weniger AMS-Wechsel')}
                >{tr('⚡ Smart')}</button>
              )}
              {/* B.3 Planer */}
              {activeJobs.length > 0 && (
                <button
                  onClick={() => setPlannerOpen(o => !o)}
                  className={`btn btn-sm shrink-0 ${plannerOpen ? 'btn-primary' : 'btn-ghost'}`}
                  title={tr('Zeitplan der Warteschlange anzeigen (Was-wäre-wenn)')}
                >{tr('🗓 Planer')}</button>
              )}
              {/* Queue-Vorlagen */}
              <div className="relative">
                <button
                  onClick={() => setTplOpen(o => !o)}
                  className="btn btn-ghost btn-sm shrink-0"
                  title={tr('Warteschlangen-Vorlagen speichern/laden')}
                >{tr('☰ Vorlagen')}{tplOpen ? ' ▲' : ' ▼'}</button>
                {tplOpen && (
                  <div className="absolute right-0 top-full mt-1 z-20 w-64 card p-2 space-y-2 shadow-xl border border-surface-700">
                    <div className="flex items-center gap-1">
                      <input
                        type="text"
                        value={tplName}
                        onChange={e => setTplName(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveTemplate() }}
                        placeholder={tr('Name der aktuellen Queue…')}
                        className="flex-1 text-[11px] h-7 py-0 px-1.5"
                      />
                      <button
                        onClick={saveTemplate}
                        disabled={!tplName.trim() || !jobs.length}
                        className="btn btn-ghost btn-sm shrink-0 disabled:opacity-40"
                        title={!jobs.length ? tr('Warteschlange ist leer') : tr('Aktuelle Warteschlange speichern')}
                      >＋</button>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-0.5">
                      {Object.keys(templates).length === 0 ? (
                        <p className="text-[10px] text-surface-600 text-center py-2">{tr('Noch keine Vorlagen')}</p>
                      ) : (
                        Object.entries(templates).map(([name, entries]) => {
                          const total = entries.reduce((s, e) => s + (e.count || 1), 0)
                          return (
                            <div key={name} className="flex items-center gap-1.5 px-1 py-0.5 rounded hover:bg-surface-700/50">
                              <button
                                onClick={() => applyTemplate(name)}
                                className="flex-1 min-w-0 text-left"
                                title={tr('{0} Jobs laden', total)}
                              >
                                <span className="text-[11px] text-surface-200 truncate block">{name}</span>
                                <span className="text-[9px] text-surface-600 font-mono">{tr('{0} Datei(en) · {1} Jobs', entries.length, total)}</span>
                              </button>
                              <button
                                onClick={() => deleteTemplate(name)}
                                className="text-[10px] text-surface-700 hover:text-red-400 transition-colors shrink-0"
                                title={tr('Vorlage löschen')}
                              >×</button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>
              <span className="text-[11px] text-surface-500 italic px-1">
                {tr('Jobs in der')} <span className="text-surface-300">{tr('Datei-Bibliothek')}</span> {tr('hinzufügen →')}
              </span>
            </div>
          </div>

          {/* B.3 Planer-Panel */}
          {plannerOpen && (
            <div className="mb-4 -mt-1 p-2.5 rounded-xl bg-surface-900/60 border border-surface-700/60">
              <QueuePlanner jobs={jobs} tr={tr} />
            </div>
          )}

          {/* Multi-plate selector — pick which plates of the .3mf to enqueue */}
          {filePlates.length > 1 && (
            <div className="flex items-center gap-1.5 flex-wrap mb-4 -mt-2">
              <span className="text-[10px] text-surface-500 font-mono">{tr('Platten:')}</span>
              {filePlates.map(p => {
                const on = selPlates.includes(p)
                return (
                  <button
                    key={p}
                    onClick={() => toggleSelPlate(p)}
                    className={`text-[10px] font-mono px-1.5 h-6 rounded border transition-colors ${
                      on ? 'border-blue-700 bg-blue-950/40 text-blue-300'
                         : 'border-surface-700 text-surface-500 hover:text-surface-300'
                    }`}
                    title={on ? tr('Platte {0} — ausgewählt', p) : tr('Platte {0}', p)}
                  >P{p}</button>
                )
              })}
              <span className="text-[9px] text-surface-600">
                {tr('{0} ausgewählt → je {1} Job', selPlates.length, addCount > 1 ? `${addCount}×` : '1')}
              </span>
            </div>
          )}


          {!jobs.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-surface-600 text-center">
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" className="mb-3 opacity-40">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                <path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
              <p className="text-sm mb-1">{tr('Keine Jobs')}</p>
              <p className="text-xs text-surface-700">
                {tr('+ Datei klicken um zu beginnen')}<br/>
                {tr('Regal-Fächer werden automatisch vergeben')}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {jobs.map((job, idx) => {
                const sm      = S[job.status] ?? S.pending
                const busy    = running && job.id === curJobId
                const displayH = job.computedHeight ?? job.objectHeight
                const slotsUsed = (displayH > 0) ? slotsNeeded(displayH, slotH, slotTol) : 0
                const pending = job.status === 'pending'

                // '1-0' has two meanings: a real "rack full" result from the
                // preflight autoSlot() preview (only while NOT running), OR the
                // "assign at execution" placeholder the backend echoes back once
                // the farm is running. Only the former is a genuine overflow —
                // otherwise the badge falsely cries "Regal voll" mid-run.
                const isOverflow = !running && job.slot === '1-0'
                const hasRealSlot = job.slot && job.slot !== '1-0'
                return (
                  <div
                    key={job.id}
                    onDragOver={pending && dragId != null && dragId !== job.id ? (e) => e.preventDefault() : undefined}
                    onDrop={pending && dragId != null ? (e) => { e.preventDefault(); moveJobTo(dragId, job.id); setDragId(null) } : undefined}
                    className={`rounded-xl border p-2.5 space-y-1.5 transition-colors ${
                      dragId === job.id ? 'opacity-40' : ''
                    } ${
                      dragId != null && dragId !== job.id && pending ? 'border-dashed border-blue-700/60' :
                      busy                ? 'border-blue-700 bg-blue-950/20' :
                      job.status==='done'  ? 'border-surface-800 bg-surface-900/20 opacity-40' :
                      job.status==='error' ? 'border-red-900/70 bg-red-950/15' :
                      isOverflow          ? 'border-amber-900/60 bg-amber-950/10' :
                      'border-surface-700 bg-surface-900'
                    }`}
                  >
                    {/* ── Row 1: status + controls ── */}
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono text-surface-700 w-5 shrink-0 text-right">#{idx+1}</span>
                      <span className={`dot ${sm.dot} ${busy && sm.pulse ? 'animate-pulse' : ''} shrink-0`} />
                      <span className={`text-xs font-medium ${sm.color} shrink-0`}>{tr(sm.label)}</span>
                      {job.status === 'printing' && job.progress > 0 && (
                        <span className="text-xs text-surface-500 font-mono shrink-0">
                          {job.progress}%{job.remaining > 0 ? ` · ~${job.remaining} min` : ''}
                        </span>
                      )}
                      {pending && job.estimatedMinutes && (
                        <span className="text-[10px] text-surface-700 font-mono shrink-0">~{job.estimatedMinutes} min</span>
                      )}
                      <div className="flex-1" />
                      {pending && (
                        <>
                          <button onClick={() => moveJobUp(job.id)} disabled={idx === 0}
                            className="w-5 h-5 flex items-center justify-center text-[11px] text-surface-700 hover:text-surface-300 disabled:opacity-20 transition-colors">▲</button>
                          <button onClick={() => moveJobDown(job.id)} disabled={idx === jobs.length - 1}
                            className="w-5 h-5 flex items-center justify-center text-[11px] text-surface-700 hover:text-surface-300 disabled:opacity-20 transition-colors">▼</button>
                          <span
                            draggable
                            onDragStart={(e) => { setDragId(job.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', String(job.id)) } catch {} }}
                            onDragEnd={() => setDragId(null)}
                            title={tr('Ziehen zum Umsortieren')}
                            className="w-5 h-5 flex items-center justify-center text-surface-700 hover:text-surface-300 cursor-grab active:cursor-grabbing select-none leading-none">⠿</span>
                        </>
                      )}
                      {!busy && !['running', 'printing', 'sending'].includes(job.status) && (
                        <button onClick={() => removeJob(job.id)} className="btn-icon opacity-25 hover:opacity-100 ml-0.5">
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                          </svg>
                        </button>
                      )}
                    </div>

                    {/* ── Progress bar ── */}
                    {job.status === 'printing' && job.progress > 0 && (
                      <div className="w-full bg-surface-800 rounded-full h-1 overflow-hidden">
                        <div className="h-1 rounded-full bg-emerald-500 transition-all" style={{ width: `${job.progress}%` }} />
                      </div>
                    )}

                    {/* ── File selector ── */}
                    <select
                      value={job.fileId}
                      disabled={running}
                      onChange={e => changeFile(job.id, e.target.value)}
                      className="w-full"
                    >
                      {gcodeFiles.map(f => <option key={f.id} value={f.id}>{f.original_filename}</option>)}
                    </select>

                    {/* ── Info row: height + slot ── */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {job.plate != null && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border border-blue-900/60 bg-blue-950/20 text-blue-300"
                          title={tr('Platte {0} aus Multi-Plate-.3mf', job.plate)}>
                          {tr('Platte {0}', job.plate)}
                        </span>
                      )}
                      {job.heightLoading ? (
                        <span className="text-[10px] text-surface-700 font-mono animate-pulse">{tr('Höhe…')}</span>
                      ) : displayH != null && displayH > 0 ? (
                        <span
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded border text-emerald-400 border-emerald-900/60 bg-emerald-950/20"
                          title={job.layerCount > 0 && job.layerHeightMm > 0
                            ? tr('Roh: {0} mm · {1} Schichten × {2} mm · +{3}% = {4} mm', job.objectHeight, job.layerCount, job.layerHeightMm, heightMarginPct, job.computedHeight)
                            : `${job.objectHeight} mm (${job.heightSource ?? ''})`}
                        >
                          {displayH} mm
                          {slotsUsed > 0 && (
                            <span className="opacity-70 ml-1 text-[9px]">· {tr(slotsUsed === 1 ? '{0} Fach' : '{0} Fächer', slotsUsed)}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[10px] text-surface-700 font-mono">{tr('Höhe unbekannt')}</span>
                      )}
                      <div className="flex-1" />
                      <div className="flex items-center gap-1 text-[10px] text-surface-600">
                        <span>{tr('Fach')}</span>
                        {isOverflow ? (
                          <span className="font-mono text-[10px] text-amber-500 px-1 rounded border border-amber-800/60" title={tr('Regal voll — kein freies Fach in der Vorschau')}>{tr('Regal voll')}</span>
                        ) : hasRealSlot ? (
                          <span className="font-mono text-[10px] text-surface-400">{job.slot}</span>
                        ) : (
                          <span className="font-mono text-[10px] text-surface-600 px-1 rounded border border-surface-800/50" title={tr('Fach wird bei Ausführung automatisch zugewiesen')}>{tr('Auto')}</span>
                        )}
                      </div>
                    </div>

                    {/* ── Filaments + AMS compact ── */}
                    {(job.filaments?.length > 0 || job.amsMap) && (
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {(job.filaments ?? []).map((f, fi) => (
                          <span key={fi} className="flex items-center gap-0.5" title={`${f.type ?? '?'}${f.color ? ` #${f.color}` : ''}`}>
                            <span className="w-2.5 h-2.5 rounded-full border border-white/10 shrink-0"
                              style={{ backgroundColor: f.color ? (f.color.startsWith('#') ? f.color : `#${f.color}`) : '#555' }} />
                            <span className="text-[9px] text-surface-600 font-mono">{f.type?.slice(0, 4) ?? '?'}</span>
                          </span>
                        ))}
                        {jobNeedsAms(job) && (
                          <span
                            className="text-[9px] font-mono px-1 rounded border border-red-800/60 bg-red-950/30 text-red-400"
                            title={jobAmsMissing(job).map(m => `${m.type ?? '?'} ${m.color ?? ''} (${m.reason})`).join(', ')}
                          >{tr('⚠ Manuelle AMS-Festlegung')}</span>
                        )}
                        <button
                          onClick={() => {
                            setAmsOpenIds(prev => {
                              const next = new Set(prev)
                              if (next.has(job.id)) { next.delete(job.id) }
                              else { next.add(job.id); fetchAmsSlots() }
                              return next
                            })
                          }}
                          className={`ml-auto text-[9px] font-mono px-1 rounded border transition-colors ${
                            amsOpenIds.has(job.id)
                              ? 'text-blue-400 border-blue-800/60 bg-blue-900/20'
                              : 'text-surface-700 border-surface-700/30 hover:text-surface-400'
                          }`}
                        >AMS {amsOpenIds.has(job.id) ? '▲' : '▼'}</button>
                        {(amsOpenIds.has(job.id) || jobNeedsAms(job)) && (
                          <div className="w-full">
                            {amsLoading ? (
                              <p className="text-[10px] text-surface-700 animate-pulse">{tr('AMS laden…')}</p>
                            ) : (
                              <AmsMapper
                                filaments={job.filaments ?? []}
                                amsSlots={amsSlots}
                                value={job.amsMap}
                                onChange={map => {
                                  setJobField(job.id, { amsMap: map })
                                  if (running) autofarmService.setJobAms(job.id, map).catch(() => {})
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── Snapshot (best-effort; blendet sich aus, wenn kein Bild da ist) ── */}
                    <JobSnapshot name={job.snapshot} />

                    {/* ── Error state ── */}
                    {job.status === 'error' && (
                      <div className="flex items-center gap-3 pt-0.5">
                        <span className="text-xs text-red-400 flex-1">{tr('Fehlgeschlagen')}</span>
                        {!running && (
                          <button onClick={() => resetJob(job.id)} className="text-[10px] text-blue-400 hover:text-blue-300 font-mono transition-colors">
                            {tr('↺ Wiederholen')}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
            </div>
          ),
          !dashHidden.includes('step') && (
            <div key="step" className="panel-fill">
              <CurrentStep farmStatus={farmStatus} idle />
            </div>
          ),
          !dashHidden.includes('rack') && (
            <div key="rack" className="panel-fill">
          {/* Rack */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <p className="section-label">{tr('Regal')}</p>
                {rackData && (
                  <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${
                    rackData.magazine_count === 0 ? 'border-red-800/60 bg-red-950/30 text-red-400' :
                    rackData.magazine_count <= 1  ? 'border-amber-800/50 bg-amber-950/20 text-amber-400' :
                    'border-surface-700/50 bg-surface-800/30 text-surface-500'
                  }`}>
                    📦 {rackData.magazine_count}/{numRacks * slotsPerRack}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={load} className="text-xs text-surface-700 hover:text-surface-400 transition-colors">↺</button>
                {doneSlots.length > 0 && (
                  <button
                    onClick={clearAllDoneSlots}
                    className="text-xs text-amber-500 hover:text-amber-400 font-medium transition-colors"
                    title={tr('Fertige Platten entnehmen — Magazin füllt sich automatisch wieder auf')}
                  >
                    {tr('Alle entnehmen')}
                  </button>
                )}
              </div>
            </div>

            {numRacks === 0 ? (
              <p className="text-xs text-surface-700 py-3 text-center">{tr('Kein Regal konfiguriert')}</p>
            ) : (
              <div className={`grid gap-2`} style={{ gridTemplateColumns: `repeat(${numRacks}, 1fr)` }}>
                {Array.from({length: numRacks}, (_, ri) => (
                  <div key={ri+1}>
                    <p className="text-[9px] text-center font-mono text-surface-600 mb-1.5 tracking-wide">
                      R{ri+1}
                    </p>
                    <div className="space-y-1">
                      {Array.from({length: slotsPerRack}, (_, si) => {
                        const si2          = slotsPerRack - 1 - si  // visual: 6→1 top to bottom
                        const key          = `${ri+1}-${si2+1}`
                        const slot         = rackData?.slots?.[key] ?? { status: 'free' }
                        const assignedJobs = slotJobMap[key] ?? []
                        const topJob       = assignedJobs[0] ?? null
                        const isDone       = slot.status === 'done'
                        const isStuck      = !running && slot.status === 'printing'
                        const isActive     = running && (slot.status === 'printing' || topJob?.id === curJobId)
                        const isLocked     = slot.status === 'locked'
                        const dispH        = topJob?.computedHeight ?? topJob?.objectHeight
                        const heightPct    = dispH ? Math.min(100, (dispH / slotH) * 100) : 0
                        const overHeight   = dispH && dispH > slotH
                        // Ghost-Fach: in dieses leere Fach ragt ein hohes Teil aus einem
                        // tieferen Fach hinein → als reserviert (Ghost) zeigen, nicht als leer.
                        const occupied     = isDone || isActive || isLocked || !!topJob
                        const ghost        = !occupied ? ghostMap[key] : null
                        const isGhost      = !!ghost
                        const ghostName    = ghost?.name ?? ''
                        const ghostBase    = ghost?.baseSlot ?? ''
                        // Fach mit untypischem Belegt-Status (z. B. "occupied"/"ready") —
                        // rendert sonst wie leer, ist aber nicht frei und „hängt".
                        const isOther      = !occupied && !isGhost && slot.status !== 'free'
                        // Leeren-Knopf für JEDES belegte, nicht gerade aktiv druckende Fach,
                        // damit sich auch hängende Fächer immer zurücksetzen lassen.
                        const canClear     = !isActive && slot.status !== 'free'

                        return (
                          <div
                            key={key}
                            className={`flex items-center gap-1 px-1.5 py-1.5 rounded-lg border text-xs transition-colors ${
                              isDone   ? 'border-amber-800/40 bg-amber-950/10' :
                              isActive ? 'border-blue-800/40 bg-blue-950/10' :
                              isLocked ? 'border-red-900/40 bg-red-950/10' :
                              topJob   ? 'border-surface-700/50 bg-surface-900' :
                              isGhost  ? 'border-dashed border-surface-700/40 bg-surface-800/15' :
                              'border-surface-800/20 bg-transparent'
                            }`}
                          >
                            <span className="font-mono text-surface-600 text-[9px] w-3 text-right shrink-0">{si2+1}</span>
                            <span className={`dot shrink-0 ${
                              isDone   ? 'dot-amber' :
                              isActive ? 'dot-blue animate-pulse' :
                              isLocked ? 'dot-red' :
                              topJob   ? (S[topJob.status]?.dot ?? 'dot-gray') :
                              isGhost  ? 'dot-gray opacity-50' :
                              isOther  ? 'dot-amber opacity-70' :
                              'dot-gray opacity-30'
                            }`} />
                            <div className="flex-1 min-w-0">
                              {isDone ? (
                                <p className="text-[9px] text-amber-400 truncate leading-tight">{slot.file_name?.replace(/\.[^.]+$/, '') || tr('Fertig')}</p>
                              ) : topJob ? (
                                <p className="text-[9px] text-surface-400 truncate leading-tight">{topJob.fileName.replace(/\.[^.]+$/, '')}</p>
                              ) : isGhost ? (
                                <p className="text-[9px] text-surface-600 italic truncate leading-tight" title={tr('Belegt durch „{0}" (ragt aus Fach {1})', ghostName.replace(/\.[^.]+$/, ''), ghostBase)}>↑ {ghostName.replace(/\.[^.]+$/, '')}</p>
                              ) : isOther ? (
                                <p className="text-[9px] text-amber-600/80 truncate leading-tight" title={tr('Hängendes Fach (Status: {0}) — ✓ zum Leeren', slot.status)}>{slot.file_name?.replace(/\.[^.]+$/, '') || tr('belegt')}</p>
                              ) : (
                                <p className="text-[9px] text-surface-800">{isLocked ? tr('Sperr') : ''}</p>
                              )}
                            </div>
                            {(heightPct > 0 || isGhost) && (
                              <div className="w-1 h-5 bg-surface-800 rounded-full overflow-hidden shrink-0">
                                <div
                                  className={`w-full rounded-full ${isGhost ? 'bg-surface-600/40' : overHeight ? 'bg-amber-500/70' : isActive ? 'bg-blue-400/70' : 'bg-surface-500/60'}`}
                                  style={{ height: `${isGhost ? 100 : heightPct}%`, marginTop: `${isGhost ? 0 : 100 - heightPct}%` }}
                                />
                              </div>
                            )}
                            {canClear && (
                              <div className="flex items-center gap-0.5 shrink-0 ml-0.5">
                                <button onClick={() => clearRackSlot(key)} title={tr('Fach leeren')} className={`text-[9px] hover:text-amber-300 ${isStuck || isOther ? 'text-red-500' : 'text-amber-500'}`}>✓</button>
                                {isDone && (
                                  <button onClick={() => assignJobToSlot(key)} title={tr('Leeren + nächsten Job zuweisen')} className="text-[9px] text-blue-500 hover:text-blue-300">↻</button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Rack legend */}
            {slots.length > 0 && (
              <div className="flex items-center gap-3 mt-3 pt-2.5 border-t border-surface-800/40">
                <span className="text-[9px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-amber w-1.5 h-1.5" /> {tr('Fertig')}
                </span>
                <span className="text-[9px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-blue w-1.5 h-1.5" /> {tr('Druckt')}
                </span>
                <span className="text-[9px] text-surface-700 flex items-center gap-1">
                  <span className="dot dot-gray w-1.5 h-1.5 opacity-30" /> {tr('Leer')}
                </span>
                <span className="flex-1 text-right text-[9px] text-surface-700 font-mono">
                  {tr('{0} mm/Fach', slotH)}
                </span>
              </div>
            )}
          </div>
            </div>
          ),
          !dashHidden.includes('activity') && (
            <div key="activity" className="panel-fill">
          {/* Activity log */}
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2 min-w-0">
                <p className="section-label shrink-0">{tr('Aktivität')}</p>
                {seqProgress && (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-blue-900/40 border border-blue-700/60 text-blue-300 animate-pulse truncate">
                    {seqProgress.label}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {farmLog.length > 0 && (
                  <div className="relative">
                    <input
                      ref={logFilterRef}
                      value={logFilter}
                      onChange={e => setLogFilter(e.target.value)}
                      placeholder={tr('Filter…')}
                      className="w-24 focus:w-32 transition-all bg-surface-900/60 border border-surface-800 rounded px-2 py-0.5 text-[10px] text-surface-300 placeholder-surface-700 focus:outline-none focus:border-blue-700"
                    />
                    {logFilter && (
                      <button onClick={() => setLogFilter('')} className="absolute right-1 top-1/2 -translate-y-1/2 text-surface-600 hover:text-surface-300 text-[10px]" title={tr('Filter löschen')}>✕</button>
                    )}
                  </div>
                )}
                {(() => {
                  const shown = logFilter ? farmLog.filter(l => l.toLowerCase().includes(logFilter.toLowerCase())) : farmLog
                  return (
                    <button onClick={() => copyLog(shown)} disabled={!shown.length} className="text-xs text-surface-700 hover:text-blue-400 disabled:opacity-40 transition-colors" title={tr('Sichtbare Zeilen kopieren')}>⧉</button>
                  )
                })()}
                <button onClick={() => autofarmService.downloadLogFile()} className="text-xs text-surface-700 hover:text-blue-400 transition-colors" title={tr('Persistentes Log-File herunterladen (alle Läufe)')}>{tr('↓ Log')}</button>
                <button onClick={exportLog} className="text-xs text-surface-700 hover:text-surface-400 transition-colors" title={tr('Aktuellen Log als .txt')}>↓</button>
                <button onClick={() => { autofarmService.clearLog().catch(() => {}); setFarmStatus(s => s ? { ...s, log: [] } : s) }} className="text-xs text-surface-700 hover:text-surface-400 transition-colors">✕</button>
              </div>
            </div>
            {!farmLog.length ? (
              <p className="text-[10px] text-surface-700 py-2">{tr('Noch keine Aktivität')}</p>
            ) : (() => {
              const shown = logFilter ? farmLog.filter(l => l.toLowerCase().includes(logFilter.toLowerCase())) : farmLog
              if (!shown.length) return <p className="text-[10px] text-surface-700 py-2">{tr('Kein Treffer für „{0}"', logFilter)}</p>
              return (
              <div className="space-y-0.5 font-mono text-[10px] max-h-52 overflow-y-auto">
                {logFilter && <p className="text-[10px] text-surface-600 sticky top-0 bg-surface-900 py-0.5">{tr('{0} von {1} Zeilen', shown.length, farmLog.length)}</p>}
                {shown.map((line, i) => (
                  <p key={i} className={
                    line.includes('FEHLER') ? 'text-red-400' :
                    line.includes('═══')    ? 'text-surface-500 font-semibold' :
                    line.includes('✓')      ? 'text-emerald-400' :
                    line.includes('▶') || line.includes('▸') ? 'text-surface-600' :
                    'text-surface-400'
                  }>{line}</p>
                ))}
              </div>
              )
            })()}
          </div>
            </div>
          ),
        ].filter(Boolean)}
      </DashboardGrid>
    </div>
  )
}

export default AutoFarm
