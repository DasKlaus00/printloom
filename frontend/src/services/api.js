import axios from 'axios'
import { withBase } from './basePath'
import { SETUP_DONE_KEY } from './constants'
import { tr } from './i18n'

// Ohne Default-Timeout wartet axios UNBEGRENZT. Steht das Backend kurz (Update,
// überlastet, Netz weg), blieb die Oberfläche für immer im Ladezustand hängen —
// selbst wenn der Server längst wieder antwortet, denn der alte Request kam nie
// zurück und kein Poll setzte nach. 45 s liegt weit über jedem gesunden Request
// und weit unter der Geduld eines Menschen. Einzelne Aufrufe, die legitim länger
// dauern (Upload, Update, Makro-Fahrt), setzen ihren eigenen Wert — siehe unten.
const DEFAULT_TIMEOUT_MS = 45000
const NO_TIMEOUT = 0            // axios: 0 = unbegrenzt

const api = axios.create({ baseURL: withBase('/api'), timeout: DEFAULT_TIMEOUT_MS })

// Kaputte Datendatei (Backend: 503 DATEI_UNLESBAR, seit v1.1.48). EINE Stelle für
// alle Aufrufe: die Meldung übersetzt, und die Kopfzeile erfährt davon.
api.interceptors.response.use(r => r, (error) => {
  const d = error?.response?.data
  if (d && d.detail === 'DATEI_UNLESBAR') {
    d.code = d.detail
    d.detail = tr('Datei {0} ist unlesbar — Printloom hat nichts überschrieben (System → Datenspeicher)', d.file || '?')
    window.dispatchEvent(new CustomEvent('printloom:brokenFile', { detail: { file: d.file } }))
  }
  return Promise.reject(error)
})

// Nach einem Auto-Reload (Update → Container gerade neu gestartet) kann
// die erste Geräteabfrage ins noch nicht bereite Backend laufen — vorher blieb die
// Geräteliste dann leer, bis der Nutzer F5 drückte. Deshalb kurz nachfassen bei
// FEHLER oder bei LEERER Antwort OBWOHL das Setup schon durch ist (dann ist „leer"
// nicht echt). Eine frische Installation (kein Setup) liefert legitim leer → kein Retry.
const _setupDone = () => { try { return !!localStorage.getItem(SETUP_DONE_KEY) } catch { return false } }
async function _listDevices() {
  let last
  for (let i = 0; i < 4; i++) {
    try {
      const r = await api.get('/devices/')
      if (!Array.isArray(r.data) || r.data.length > 0 || !_setupDone()) return r
      last = r
    } catch (e) {
      last = e
      // Nur Netzfehler und Server-Ausfälle (≥ 502: Container startet noch) nachfassen.
      // Eine 4xx-Antwort ist eine echte Antwort — viermal fragen ändert sie nicht
      // und verzögerte bis v1.1.76 nur die Fehlermeldung um drei Sekunden.
      const status = e?.response?.status
      if (status && status < 502) throw e
    }
    if (i < 3) await new Promise(res => setTimeout(res, 1000))
  }
  if (last && last.data !== undefined) return last   // gültige (leere) Antwort durchreichen
  throw last
}

export const deviceService = {
  listDevices:  ()         => _listDevices(),
  createDevice: (data)     => api.post('/devices/', data),
  updateDevice: (id, data) => api.put(`/devices/${id}`, data),
  deleteDevice: (id)       => api.delete(`/devices/${id}`),
  testDevice:   (id)       => api.post(`/devices/${id}/test`),
  // Bekannte Drucker-Modelle (Kamera-Protokoll + Fähigkeiten) — EINE Liste im Backend.
  listModels:   ()         => api.get('/devices/models'),
  // Netzwerk-Suche (SSDP-Bambu + Moonraker-Scan) dauert ~5 s → großzügiger Timeout.
  // subnet: optionales /24 (z. B. „192.168.1"), nötig in Docker-Bridge-Netzen.
  // POST: Der Scan sendet Pakete ins Netz, das darf keine fremde Seite auslösen.
  discover:     (subnet)   => api.post('/devices/discover', null, {
    params: subnet ? { subnet } : {}, timeout: 25000,
  }),
}

export const fileService = {
  // Kein Timeout: eine 40-MB-.3mf über WLAN darf so lange dauern, wie sie dauert.
  uploadFile:   (formData, folderId = null) => api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: NO_TIMEOUT,
    ...(folderId != null ? { params: { folder_id: folderId } } : {}),
  }),
  listFiles:    (skip = 0, limit = 100) => api.get('/files/', { params: { skip, limit } }),
  queryFiles:   (params = {}) => api.get('/files/', { params: { limit: 500, ...params } }),
  updateFile:   (id, data) => api.patch(`/files/${id}`, data),
  deleteFile:   (id)       => api.delete(`/files/${id}`),
  createDemo:   ()         => api.post('/files/demo'),
  getAmsInfo:   (id)       => api.get(`/files/${id}/ams-info`),
  deepAnalyze:  (id)       => api.get(`/files/${id}/deep-analyze`),
  getQuickMeta: (id)       => api.get(`/files/${id}/quick-meta`),
  getPlatesMeta:(id)       => api.get(`/files/${id}/plates-meta`),
  // Crash-Check: Objekt >30 mm hoch UND ragt in den 10-mm-Randstreifen (OTTOeject-Arm)?
  crashCheck:   (id, plate = null) => api.get(`/files/${id}/crash-check`, {
    params: plate != null ? { plate } : {}, timeout: 20000,
  }),
  thumbnailUrl: (id)       => withBase(`/api/files/${id}/thumbnail`),
}

export const folderService = {
  list:   ()         => api.get('/folders/'),
  create: (data)     => api.post('/folders/', data),
  update: (id, data) => api.patch(`/folders/${id}`, data),
  remove: (id)       => api.delete(`/folders/${id}`),
}

export const controlService = {
  // Moonraker antwortet erst, wenn die Fahrt DURCH ist (Backend wartet bis 120 s) —
  // dieser Aufruf darf den Default-Timeout also nicht erben.
  executeMacro:        (data)  => api.post('/control/macro', data, { timeout: 150000 }),
  listAppOps:          ()      => api.get('/control/app-ops'),
  emergencyStop:       ()      => api.post('/control/emergency-stop'),
  resume:              ()      => api.post('/control/resume'),
  emergencyState:      ()      => api.get('/control/emergency-state'),
  getStatus:           ()      => api.get('/control/status'),
  sendKlipperGcode:    (gcode) => api.post('/control/klipper/gcode', { gcode }),
  getKlipperPosition:  ()      => api.get('/control/klipper/position'),
  getKlipperInfo:      ()      => api.get('/control/klipper/info'),
  // OTTOeject-Geometrie (Printloom kennt alle Koordinaten, sendet G-code direkt)
  getGeometry:         ()      => api.get('/control/ottoeject/geometry'),
  // Revision als If-Match: Das Backend speichert nur auf den gelesenen Stand (sonst 409).
  putGeometry:         (g, revision) => api.put('/control/ottoeject/geometry', g,
                                                revision ? { headers: { 'If-Match': revision } } : undefined),
  runOp:               (body)  => api.post('/control/ottoeject/op', body),
  previewOp:           (body)  => api.post('/control/ottoeject/preview', body),
  // Plausibilitätsprüfung der Geometrie (Achsgrenzen) — prüft ohne zu speichern
  checkGeometry:       (g)     => api.post('/control/ottoeject/geometry/check', { geometry: g }),
  getAxisLimits:       ()      => api.get('/control/ottoeject/limits'),
  // Einmessen: eine Achse um `delta` mm verfahren (gegen die Achsgrenzen geprüft)
  jog:                 (axis, delta, feed) => api.post('/control/ottoeject/jog', { axis, delta, feed }),
}

// Printer-Status koaleszieren: viele gleichzeitig gemountete Seiten (Dashboard,
// AutoFarm, FileLibrary, FilamentLibrary, Steuerung) pollen /status. Damit nicht N
// identische Requests parallel laufen, teilen sich zeitgleiche Aufrufer EINEN
// In-Flight-Request; ein sehr kurzer TTL-Cache fängt versetzte Polls ab. Der
// Backend-Status kommt ohnehin aus EINER persistenten Verbindung (bambu_manager) —
// der Cache ist also frisch, und die eigentliche Verbindungslast liegt bei 1.
const _statusInFlight = {}
const _statusCache = {}
const STATUS_TTL_MS = 2000
function _getPrinterStatus(deviceId) {
  const c = _statusCache[deviceId]
  if (c && Date.now() - c.t < STATUS_TTL_MS) return Promise.resolve(c.res)
  if (_statusInFlight[deviceId]) return _statusInFlight[deviceId]
  const p = api.get(`/printer/status/${deviceId}`)
    .then(res => { _statusCache[deviceId] = { t: Date.now(), res }; return res })
    .finally(() => { delete _statusInFlight[deviceId] })
  _statusInFlight[deviceId] = p
  return p
}

export const printerService = {
  // Kein Timeout: der Request wartet auf den FTP-Upload zum Drucker (bei einer
  // großen .3mf über WLAN gern mehrere Minuten).
  sendFile:             (deviceId, fileId, useAms = true, amsSlot = null, plate = null) => api.post(`/printer/send/${deviceId}/${fileId}`, null, { timeout: NO_TIMEOUT, params: { use_ams: useAms, ...(amsSlot !== null && amsSlot !== undefined && { ams_slot: amsSlot }), ...(plate !== null && plate !== undefined && { plate }) } }),
  sendGcode:            (deviceId, gcode)  => api.post(`/printer/gcode/${deviceId}`, null, { params: { gcode } }),
  getStatus:            (deviceId)         => _getPrinterStatus(deviceId),
  cameraStreamUrl:      (deviceId)         => withBase(`/api/printer/camera/${deviceId}`),
  cameraFrameUrl:       (deviceId)         => withBase(`/api/printer/camera/${deviceId}/frame`),
  // Kammerlicht für die Live-Ansicht; die Kamera-GETs schalten es nicht mehr selbst.
  cameraLight:          (deviceId)         => api.post(`/printer/camera/${deviceId}/light`),
  haCameraStreamUrl:    (deviceId)         => withBase(`/api/printer/ha-camera/${deviceId}`),
  haCameraTest:         (deviceId)         => api.get(`/printer/ha-camera/${deviceId}/test`),
  getPlates:            (fileId)           => api.get(`/printer/plates/${fileId}`),
  // Drucker-Einstellungen (KI-Erkennung, Geschwindigkeit, Auto-Recovery, Licht)
  getSettings:          (deviceId)         => api.get(`/printer/settings/${deviceId}`),
  setSettings:          (deviceId, body)   => api.post(`/printer/settings/${deviceId}`, body),
  calibrate:            (deviceId, options) => api.post(`/printer/calibrate/${deviceId}`, { options }),
  getHistory:           ()                 => api.get('/printer/history'),
  takeSnapshot:         (deviceId)         => api.post(`/printer/snapshot/${deviceId}`),
  getSendDiagnostics:   ()                 => api.get('/printer/send-diagnostics'),
  clearSendDiagnostics: ()                 => api.delete('/printer/send-diagnostics'),
  amsLoad:              (deviceId, tray)          => api.post(`/printer/ams/${deviceId}/load`, { tray }),
  amsUnload:            (deviceId)                => api.post(`/printer/ams/${deviceId}/unload`),
  amsReadSlot:          (deviceId, amsId, slotId) => api.post(`/printer/ams/${deviceId}/read`, { ams_id: amsId, slot_id: slotId }),
  // Snapmaker U1 (Moonraker): pausieren/fortsetzen/abbrechen, Dateien auf dem Drucker
  moonrakerAction:      (deviceId, action)  => api.post(`/printer/moonraker/${deviceId}/action`, { action }),
  moonrakerFiles:       (deviceId)          => api.get(`/printer/moonraker/${deviceId}/files`),
  moonrakerPrint:       (deviceId, filename) => api.post(`/printer/moonraker/${deviceId}/print`, { filename }),
}

export const deviceSettingsService = {
  getSettings:    (deviceId)        => api.get(`/devices/${deviceId}/settings`),
  updateSettings: (deviceId, data)  => api.put(`/devices/${deviceId}/settings`, data),
  getPower:       (deviceId)        => api.get(`/devices/${deviceId}/power`),
  switchPower:    (deviceId, on)    => api.post(`/devices/${deviceId}/power/switch`, { on }),
  // Alle eingerichteten Steckdosen auf einmal — die Kopfleiste fragt im Takt ab
  // und soll dafür EINEN Request machen, nicht einen je Drucker.
  listPower:      ()                => api.get('/devices/power'),
}

export const rackManagerService = {
  getAll:        ()                    => api.get('/rack-manager/'),
  updateConfig:  (data)                => api.put('/rack-manager/config', data),
  refillMagazine:(value)               => api.post('/rack-manager/magazine/refill', value != null ? { value } : {}),
  takeFromMagazine:(rack)              => api.post('/rack-manager/magazine/take', { rack }),
  // Kompakt-Regal: „N leere Platten eingelegt" → Fächer in fester Reihenfolge markieren
  compactEmptyPlates:(count)           => api.post('/rack-manager/compact/empty-plates', { count }),
  updateSlot:    (slotId, data)        => api.put(`/rack-manager/slots/${slotId}`, data),
  clearSlots:    (body)                => api.post('/rack-manager/slots/clear', body ?? {}),
  analyzeFile:   (fileId, plate = null) => api.post(`/rack-manager/analyze/${fileId}`, null, { params: (plate !== null && plate !== undefined) ? { plate } : {} }),
}

export const systemService = {
  // Datenspeicher: unlesbare Dateien melden und bewusst zurücksetzen (seit v1.1.48).
  dataFiles:        () => api.get('/system/data-files'),
  resetDataFile:    (key) => api.post(`/system/data-files/${key}/reset`),
  // force=true = einmalige Prüfung auf ausdrücklichen Knopfdruck, auch wenn die
  // automatische „Update-Prüfung im Internet" ausgeschaltet ist. Das ist ein POST,
  // damit keine fremde Seite die Anfrage ins Internet auslösen kann.
  getVersion:       (channel, force) => force
                      ? api.post('/system/version/check', null, { params: channel ? { channel } : {} })
                      : api.get('/system/version', { params: channel ? { channel } : {} }),
  getRunningVersion:() => api.get('/system/running-version'),
  // Kein Timeout: Image ziehen + Container neu starten dauert Minuten.
  triggerUpdate:    (channel, confirmDowngrade) => api.post('/system/update',
                      { ...(channel ? { channel } : {}), ...(confirmDowngrade ? { confirm_downgrade: true } : {}) },
                                          { timeout: NO_TIMEOUT }),
  // Ohne Optionen: Backup OHNE Zugangsdaten. Mit Zugangsdaten per POST, damit das
  // Passwort nicht in der Adresse steht.
  exportBackup:     (opts) => opts?.include_secrets
                      ? api.post('/system/backup', opts)
                      : api.get('/system/backup'),
  importBackup:     (data, password) => api.post('/system/backup/restore',
                      password ? { backup: data, password } : data),
  getLangInstalled: () => api.get('/system/lang/installed'),
  importLang:       (pack) => api.post('/system/lang/import', pack),
  deleteLang:       (code) => api.delete(`/system/lang/${code}`),
  // view: 'farm' (Auto-Farm) | 'home' (Startseite) — getrennte Layouts
  getDashboardLayout:  (view = 'farm') => api.get('/system/dashboard-layout', { params: { view } }),
  saveDashboardLayout: (data, view = 'farm') => api.put('/system/dashboard-layout', data, { params: { view } }),
  getCameraSettings:   () => api.get('/system/camera'),
  saveCameraSettings:  (data) => api.post('/system/camera', data),
  // Diagnose-Paket (ZIP, ohne Zugangsdaten) — direkter Download-Link
  diagnosticsUrl:      () => withBase('/api/system/diagnostics'),
}

/* Online-Dienste — ALLE opt-in. Ohne Zustimmung + Schalter macht das Backend
   keinen einzigen externen Request (siehe backend/app/services/online.py). */
export const onlineService = {
  getSettings:  ()          => api.get('/online/settings'),
  saveSettings: (data)      => api.post('/online/settings', data),
  // refresh = am Cache vorbei neu laden; das ist ein POST, damit keine fremde Seite
  // per <img> Abrufe im Internet auslösen kann.
  getNotices:   (refresh)   => refresh ? api.post('/online/notices/refresh') : api.get('/online/notices'),
  getLibrary:   (kind, refresh) => refresh
                                 ? api.post('/online/library/refresh', null, { params: kind ? { kind } : {} })
                                 : api.get('/online/library', { params: kind ? { kind } : {} }),
  getItem:      (id)        => api.get('/online/library/item', { params: { id } }),
  clearCache:   ()          => api.post('/online/cache/clear'),
}

export const autofarmService = {
  start:         (data)  => api.post('/autofarm/start', data),
  // Welches Gerät fährt die Farm (seit v1.1.87 auch ein Snapmaker U1)?
  getFarmPrinter: ()     => api.get('/autofarm/farm-printer'),
  getStatus:     (light) => api.get('/autofarm/status', light ? { params: { light: 1 } } : undefined),
  stop:          ()      => api.post('/autofarm/stop'),
  forceReset:    ()      => api.post('/autofarm/force-reset'),
  pause:         ()      => api.post('/autofarm/pause'),
  // Warteschlange: nur einzelne Änderungen, die ganze Liste schreibt der Server (seit
  // v1.1.58). Jede Antwort enthält die neue Liste ({ jobs }).
  addJobs:       (body)  => api.post('/autofarm/queue/jobs', body),   // {fileId, plate?, count?, amsMap?, tag?}
  deleteJob:     (jobId) => api.delete(`/autofarm/queue/jobs/${jobId}`),
  setOrder:      (ids)   => api.put('/autofarm/queue/order', { job_ids: ids }),
  patchJob:      (jobId, body) => api.patch(`/autofarm/queue/jobs/${jobId}`, body), // {amsMap?, retry?}
  resetFailed:   ()      => api.post('/autofarm/queue/reset-failed'),
  getSequences:  ()      => api.get('/autofarm/sequences'),
  // Nur auf den gelesenen Stand (revision aus getSequences), sonst 409 (seit v1.1.59).
  saveSequences: (data, revision) => api.put('/autofarm/sequences', data,
    { headers: revision ? { 'If-Match': revision } : {} }),
  // Trockenlauf: Sequenz durchspielen, ohne etwas zu senden
  dryRun:        (body)  => api.post('/autofarm/dry-run', body || {}),
  // Unterbrochener Lauf (Neustart/Update mitten im Zyklus) + Drucker-Fehler-Historie
  getRecovery:      ()     => api.get('/autofarm/recovery'),
  dismissRecovery:  (body) => api.post('/autofarm/recovery/dismiss', body || {}),
  getHmsHistory:    (limit) => api.get('/autofarm/hms-history', { params: { limit: limit || 100 } }),
  clearHmsHistory:  ()     => api.delete('/autofarm/hms-history'),
  // Mehrere Drucker: Übersicht + Verteilung der Warteschlange (seit v1.1.3)
  farmPrinters:     ()     => api.get('/autofarm/printers'),
  dispatch:         (apply) => api.post('/autofarm/dispatch', { apply: !!apply }),
  getSettings:   ()      => api.get('/autofarm/settings'),
  saveSettings:  (data)  => api.put('/autofarm/settings', data),
  getQueue:      ()      => api.get('/autofarm/queue'),
  getHomingFileInfo: ()      => api.get('/autofarm/homing_file/info'),
  setupHomingFile:   ()      => api.post('/autofarm/homing_file/setup'),
  clearLog:          ()      => api.post('/autofarm/clear_log'),
  downloadLogFile:   ()      => window.open(withBase('/api/autofarm/log/download'), '_blank'),
  getStats:          ()      => api.get('/autofarm/stats'),
  resetStats:        ()      => api.delete('/autofarm/stats'),
  getCompleted:      (limit = 500) => api.get('/autofarm/completed', { params: { limit } }),
  clearCompleted:    ()      => api.delete('/autofarm/completed'),
  getHistory:        ()      => api.get('/autofarm/history'),
  getTimeline:       (hours = 24) => api.get('/autofarm/timeline', { params: { hours } }),
  getFileFilaments:  (id, plate) => api.get(`/autofarm/file_filaments/${id}`, plate != null ? { params: { plate } } : undefined),
  setFileAms:        (id, ams_map) => api.put(`/autofarm/file_ams/${id}`, { ams_map }),
  // Stresstest: alle liegenden Platten ins entfernteste Regal umlagern.
  // `plan` bewegt nichts — nur Vorschau samt hochgerechneter Dauer.
  stressPlan:        (mitDrucker = false) => api.get('/autofarm/stress-test/plan', { params: { include_printer: !!mitDrucker } }),
  stressStart:       (body = {}) => api.post('/autofarm/stress-test', body),
  stressStop:        ()      => api.post('/autofarm/stress-test/stop'),
  stressStatus:      ()      => api.get('/autofarm/stress-test/status'),
}

export const projectService = {
  list:          ()          => api.get('/project/'),
  create:        (name)      => api.post('/project/', { name }),
  update:        (pid, data) => api.put(`/project/${pid}`, data),
  remove:        (pid)       => api.delete(`/project/${pid}`),
  resetProgress: (pid)       => api.post(`/project/${pid}/reset`),
}

export const profileService = {
  export:      (meta)    => api.post('/profiles/export', meta),
  import:      (profile) => api.post('/profiles/import', profile),
  listLocal:   ()        => api.get('/profiles/local'),
  saveLocal:   (profile) => api.post('/profiles/local', profile),
  deleteLocal: (name)    => api.delete(`/profiles/local/${encodeURIComponent(name)}`),
}

export const klipperConfigService = {
  listConfigs:  ()           => api.get('/control/klipper/configs'),
  readConfig:   (filename)   => api.get(`/control/klipper/config/${filename}`),
}

export const healthService = {
  check:   () => api.get('/health'),
  targets: () => api.get('/system/health/targets'),
}

export const pushService = {
  getPublicKey: ()        => api.get('/push/public-key'),
  getStatus:    ()        => api.get('/push/status'),
  subscribe:    (sub)     => api.post('/push/subscribe', sub),
  unsubscribe:  (body)    => api.post('/push/unsubscribe', body),
  test:         ()        => api.post('/push/test'),
}

export const filamentService = {
  list:          ()           => api.get('/filaments/'),
  addCustom:     (data)       => api.post('/filaments/custom', data),
  // Über die feste ID (seit v1.1.64), nie über die Position in einer gefilterten Liste.
  updateCustom:  (id, data)   => api.put(`/filaments/custom/id/${encodeURIComponent(id)}`, data),
  deleteCustom:  (id)         => api.delete(`/filaments/custom/id/${encodeURIComponent(id)}`),
  clearCustom:   ()           => api.delete('/filaments/custom'),
  learn:         (slots)      => api.post('/filaments/learn', { slots }),
}

export default api
