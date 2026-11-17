import React, { useState, useEffect, useRef } from 'react'
import { printerService } from '../../services/api'
import { usePageActive } from '../../services/useAutoRefresh'
import { useLanguage, tr as translate } from '../../services/i18n'

/* Aus pages/AutoFarm.jsx verschoben (v1.1.79), wortgleich. */

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
      if (!Hls.isSupported()) { onError?.(translate('Browser kann HLS nicht abspielen')); return }
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
    }).catch(() => onError?.(translate('HLS-Player konnte nicht geladen werden')))

    // Wenn das Video ausgeblendet ist (andere Seite offen → display:none, der
    // Container hat keine Box → nicht „intersecting"), Wiedergabe & Download
    // stoppen — sonst dekodiert der Browser im Hintergrund weiter (CPU-Last!).
    let io
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => {
        if (e.isIntersecting) { try { hls?.startLoad() } catch {} video.play?.().catch(() => {}) }
        else { video.pause?.(); try { hls?.stopLoad() } catch {} }
      }, { threshold: 0.01 })
      io.observe(video)
    }
    return () => { cancelled = true; try { io?.disconnect() } catch {} try { hls?.destroy() } catch {} }
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
    let pc, cancelled = false, started = false

    const start = async () => {
      if (started || cancelled) return
      started = true
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
    // WebRTC dekodiert laufend — bei ausgeblendetem Video (andere Seite offen) die
    // Verbindung schließen, sonst CPU-Last im Hintergrund. Beim Wiedersehen neu auf.
    const stop = () => { started = false; try { pc?.close() } catch {} pc = null; video.pause?.() }
    let io
    if (typeof IntersectionObserver !== 'undefined') {
      io = new IntersectionObserver(([e]) => { e.isIntersecting ? start() : stop() }, { threshold: 0.01 })
      io.observe(video)
    } else { start() }
    return () => { cancelled = true; try { io?.disconnect() } catch {} try { pc?.close() } catch {} }
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
function StreamView({ url, label, grow = 'flex-1' }) {
  const { tr } = useLanguage()
  // MJPEG lädt nur auf der sichtbaren Seite (wie X1CView): Ein verstecktes <img>
  // zog bis v1.1.67 weiter Bilder vom Kamera-Server.
  const active = usePageActive()
  const [err, setErr] = useState(false)
  const [k,   setK]   = useState(0)
  useEffect(() => { setErr(false); setK(x => x + 1) }, [url])
  const reconnect = () => { setErr(false); setK(x => x + 1) }
  const type = guessCamType(url)
  const src  = type === 'hls' ? hlsUrlFrom(url) : type === 'webrtc' ? whepUrlFrom(url) : url
  // Die Kachel füllt ihren Teil des Panels, das Bild passt sich ein (statt eines
  // festen Seitenverhältnisses, das bis v1.1.67 über die Rasterzelle hinauswuchs).
  return (
    <div className={`relative ${grow} min-h-0 w-full cam-surface rounded-lg overflow-hidden`}>
      {!url ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
          <p className="text-[10px]">{label}</p>
          <p className="text-[10px] cam-muted">{tr('URL in Konfiguration → Kameras')}</p>
        </div>
      ) : err ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
          <p className="text-[10px]">{tr('{0} nicht erreichbar', label)}</p>
          <p className="text-[10px] font-mono cam-muted break-all">{src}</p>
          <button onClick={reconnect} className="btn btn-ghost btn-sm">{tr('Neu verbinden')}</button>
        </div>
      ) : type === 'webrtc' ? (
        <WhepVideo key={k} src={src} onError={() => setErr(true)} className="absolute inset-0 w-full h-full object-contain" />
      ) : type === 'hls' ? (
        <HlsVideo key={k} src={src} onError={() => setErr(true)} className="absolute inset-0 w-full h-full object-contain" />
      ) : active ? (
        <img key={k} src={src} alt={label} onError={() => setErr(true)} onLoad={() => setErr(false)} className="absolute inset-0 w-full h-full object-contain" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center cam-muted text-[10px]">{tr('Pausiert (Seite im Hintergrund)')}</div>
      )}
      {url && !err && (
        <>
          <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>
          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-black/60 text-white/80">{CAM_TYPE_LABEL[type]}</span>
          <button onClick={reconnect} title={tr('Neu verbinden')}
            className="absolute bottom-1.5 right-1.5 text-xs leading-none px-1.5 py-1 rounded bg-black/50 text-white/80 hover:text-white">⟳</button>
        </>
      )}
    </div>
  )
}

/* Eingebaute X1C-Kamera (proprietäres Port-6000-Protokoll übers Backend).
   Fallback für die obere Kachel, wenn keine Bambu-URL hinterlegt ist. */
function X1CView({ bambuId, grow = 'flex-1' }) {
  const { tr } = useLanguage()
  const [live,  setLive]  = useState(false)
  const [ready, setReady] = useState(false)
  const [err,   setErr]   = useState('')
  const [key,   setKey]   = useState(0)
  const connect = async () => {
    if (!bambuId) return
    setErr(''); setReady(false); setKey(k => k + 1); setLive(true)
    // Licht an, sonst bleibt das Bild im dunklen Bauraum schwarz. Ein Fehler hier
    // ändert nichts am Bild selbst, darum nur ins Konsolen-Log.
    printerService.cameraLight(bambuId).catch(e => console.warn('Kammerlicht:', e?.message || e))
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

  // Ausgeblendet (andere Seite offen → display:none) den MJPEG-Stream droppen, sonst
  // läuft ffmpeg auf dem Server weiter (CPU!). Beim Wiedersehen frisch verbinden.
  const wrapRef = useRef(null)
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const el = wrapRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => {
      setVisible(prev => { if (e.isIntersecting && !prev) setKey(k => k + 1); return e.isIntersecting })
    }, { threshold: 0.01 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div className={`flex flex-col gap-1.5 ${grow} min-h-0`}>
      <div className="flex items-center justify-between gap-2 shrink-0">
        <span className="text-[10px] text-surface-500 truncate">{tr('Oben · Drucker-Kamera (direkt)')}</span>
        <button onClick={() => live ? stop() : connect()} disabled={!bambuId}
          className={`btn btn-sm px-2 ${live ? 'btn-primary' : 'btn-ghost'}`}
          title={tr('LAN-Liveview muss am Drucker aktiv sein')}>
          {live ? tr('⏹ Stopp') : tr('📷 Live')}
        </button>
      </div>
      <div ref={wrapRef} className="relative flex-1 min-h-0 w-full cam-surface rounded-lg overflow-hidden">
        {live ? (
          err ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-3 text-center">
              <p className="text-[10px]">{tr('Drucker-Kamera nicht erreichbar')}</p>
              {err && <p className="text-[10px] font-mono cam-error break-all">{err}</p>}
              <button onClick={connect} className="btn btn-ghost btn-sm mt-0.5">{tr('Neu verbinden')}</button>
            </div>
          ) : ready ? (
            visible ? (
              <img key={key} src={`${printerService.cameraStreamUrl(bambuId)}?t=${key}`} alt="Drucker-Kamera Live"
                onError={() => setErr(e => e || tr('Stream-Verbindung abgebrochen'))}
                className="absolute inset-0 w-full h-full object-contain" />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center cam-muted text-[10px]">{tr('Pausiert (Seite im Hintergrund)')}</div>
            )
          ) : (
            <div className="absolute inset-0 flex items-center justify-center cam-muted text-[10px]">{tr('Verbinde …')}</div>
          )
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
            <p className="text-[10px]">{bambuId ? tr('X1C bereit') : tr('Kein Drucker')}</p>
            {bambuId && <p className="text-[10px] cam-muted">{tr('„📷 Live" drücken')}</p>}
          </div>
        )}
        {live && ready && <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>}
      </div>
    </div>
  )
}

/* X1C-Kamera über Home Assistant: HA liefert ein Standbild (kein echter Video-
   Stream), daher laden wir das Einzelbild im ~1-s-Takt nach (≈1 fps Live-Ansicht).
   Doppelpuffer: das sichtbare Bild wird erst getauscht, wenn das nächste geladen
   ist → kein Flackern, keine Blackframes. */
function HaPollView({ deviceId, label, grow = 'flex-1' }) {
  const { tr } = useLanguage()
  const [src, setSrc] = useState(null)
  const [err, setErr] = useState(false)
  // Nur auf der sichtbaren Seite nachladen (bis v1.1.67 lief der Takt auch versteckt).
  const active = usePageActive()
  useEffect(() => {
    if (!deviceId || !active) return
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
  }, [deviceId, active])
  return (
    <div className={`relative ${grow} min-h-0 w-full cam-surface rounded-lg overflow-hidden`}>
      {src ? (
        <img src={src} alt={label} className="absolute inset-0 w-full h-full object-contain" />
      ) : !err ? (
        <div className="absolute inset-0 flex items-center justify-center cam-muted text-[10px]">{tr('Verbinde mit Home Assistant …')}</div>
      ) : null}
      {err && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-3 text-center">
          <p className="text-[10px]">{tr('{0} nicht erreichbar', label)}</p>
          <p className="text-[10px] cam-muted">{tr('Home Assistant / Token prüfen')}</p>
        </div>
      )}
      {src && !err && (
        <>
          <span className="absolute top-1.5 left-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-red-600/80 text-white">● LIVE</span>
          <span className="absolute top-1.5 right-1.5 text-[10px] font-mono px-1 py-0.5 rounded bg-black/60 text-white/80">HA</span>
        </>
      )}
    </div>
  )
}

/* Beide Kameras fest übereinander: oben Bambu (quer) bzw. X1C, unten hochkant.
   URLs kommen aus der Konfiguration (Konfiguration → Kameras). */
export function CameraPanel({ bambuId, webcamUrl, webcamUrlTop, haCamReady, cameraOn, onToggle, hideCam2, onToggleCam2 }) {
  const { tr } = useLanguage()
  return (
    <div className="card p-2.5 flex flex-col gap-2.5 h-full">
      <div className="flex items-center justify-between gap-2 shrink-0">
        <p className="section-label mb-0">{tr('Kameras')}</p>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-surface-600 cq-hide-narrow truncate">{tr('Konfiguration → Kameras')}</span>
          {cameraOn && (
            <button
              onClick={onToggleCam2}
              title={hideCam2 ? tr('Zweite Kamera (unten) einblenden') : tr('Zweite Kamera (unten) ausblenden')}
              className={`btn btn-sm px-2 ${hideCam2 ? 'btn-ghost' : 'btn-primary'}`}
            >
              {hideCam2 ? tr('Cam 2 ⨯') : tr('Cam 2')}
            </button>
          )}
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
          {/* Zwei Kameras teilen sich die Höhe 2:3 (unten hochkant), eine füllt allein. */}
          {haCamReady
            ? <HaPollView deviceId={bambuId} label={tr('X1C (Home Assistant)')} grow={hideCam2 ? 'flex-1' : 'flex-[2]'} />
            : webcamUrlTop
              ? <StreamView url={webcamUrlTop} label={tr('Bambu (oben)')} grow={hideCam2 ? 'flex-1' : 'flex-[2]'} />
              : <X1CView bambuId={bambuId} grow={hideCam2 ? 'flex-1' : 'flex-[2]'} />}
          {/* Unten: Hochkant — optional ausblendbar */}
          {!hideCam2 && <StreamView url={webcamUrl} label={tr('Hochkant (unten)')} grow="flex-[3]" />}
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-surface-600 gap-1 py-8 text-center">
          <p className="text-[11px]">{tr('Kamera aus')}</p>
          <p className="text-[10px] text-surface-700">{tr('Kein Livebild, keine automatischen Snapshots')}</p>
        </div>
      )}
    </div>
  )
}
