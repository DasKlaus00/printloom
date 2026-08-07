import axios from 'axios'

// Ohne Default-Timeout wartet axios UNBEGRENZT. Steht das Backend kurz (Update,
// überlastet, Netz weg), blieb die Oberfläche für immer im Ladezustand hängen —
// selbst wenn der Server längst wieder antwortet, denn der alte Request kam nie
// zurück und kein Poll setzte nach. 45 s liegt weit über jedem gesunden Request
// und weit unter der Geduld eines Menschen. Einzelne Aufrufe, die legitim länger
// dauern (Upload, Update, Makro-Fahrt), setzen ihren eigenen Wert — siehe unten.
const DEFAULT_TIMEOUT_MS = 45000
const NO_TIMEOUT = 0            // axios: 0 = unbegrenzt

const api = axios.create({ baseURL: '/api', timeout: DEFAULT_TIMEOUT_MS })

// Nach einem Auto-Reload (Watchtower-Update → Container gerade neu gestartet) kann
// die erste Geräteabfrage ins noch nicht bereite Backend laufen — vorher blieb die
// Geräteliste dann leer, bis der Nutzer F5 drückte. Deshalb kurz nachfassen bei
// FEHLER oder bei LEERER Antwort OBWOHL das Setup schon durch ist (dann ist „leer"
// nicht echt). Eine frische Installation (kein Setup) liefert legitim leer → kein Retry.
const _setupDone = () => { try { return !!localStorage.getItem('ottomat3d_setup_done') } catch { return false } }
async function _listDevices() {
  let last
  for (let i = 0; i < 4; i++) {
    try {
      const r = await api.get('/devices/')
      if (!Array.isArray(r.data) || r.data.length > 0 || !_setupDone()) return r
      last = r
    } catch (e) {
      last = e
    }
    if (i < 3) await new Promise(res => setTimeout(res, 1000))
  }
  if (last && last.data !== undefined) return last   // gültige (leere) Antwort durchreichen
  throw last
}

export const deviceService = {
  listDevices:  ()         => _listDevices(),
  getDevice:    (id)       => api.get(`/devices/${id}`),
  createDevice: (data)     => api.post('/devices/', data),
  updateDevice: (id, data) => api.put(`/devices/${id}`, data),
  deleteDevice: (id)       => api.delete(`/devices/${id}`),
  testDevice:   (id)       => api.post(`/devices/${id}/test`),
  // Bekannte Drucker-Modelle (Kamera-Protokoll + Fähigkeiten) — EINE Liste im Backend.
  listModels:   ()         => api.get('/devices/models'),
  // Netzwerk-Suche (SSDP-Bambu + Moonraker-Scan) dauert ~5 s → großzügiger Timeout.
  // subnet: optionales /24 (z. B. „192.168.1"), nötig in Docker-Bridge-Netzen.
  discover:     (subnet)   => api.get('/devices/discover', {
    params: subnet ? { subnet } : {}, timeout: 25000,
  }),
}

/* Farm-Layout: Drucker & Regale als Module auf einer X-Schiene.
   Seit v1.1.8 wird es aus der Drucker-Geometrie ABGELEITET — eingestellt wird
   alles im Drucker-Tab, hier gibt es nur noch die fertige Sicht (Übersicht,
   Job-Verteilung) und die Zuordnung Regal → Drucker. */
export const layoutService = {
  get:      ()       => api.get('/layout/'),
  save:     (lay)    => api.put('/layout/', lay),
  setLock:  (locked) => api.post('/layout/lock', { locked }),
  reset:    ()       => api.delete('/layout/'),
  printers: ()       => api.get('/layout/printers'),
}

export const configService = {
  getRackConfig:    ()       => api.get('/config/rack'),
  updateRackConfig: (data)   => api.put('/config/rack', data),
  getSlotStatus:    (slotId) => api.get(`/config/slot/${slotId}`),
  updateSlotStatus: (slotId, data) => api.put(`/config/slot/${slotId}/status`, data),
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
  thumbnailUrl: (id)       => `/api/files/${id}/thumbnail`,
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
  listMacros:          ()      => api.get('/control/macros'),
  listAppOps:          ()      => api.get('/control/app-ops'),
  emergencyStop:       ()      => api.post('/control/emergency-stop'),
  resume:              ()      => api.post('/control/resume'),
  getStatus:           ()      => api.get('/control/status'),
  getOttoejectVars:    ()      => api.get('/control/ottoeject/variables'),
  setOttoejectVars:    (vars)  => api.post('/control/ottoeject/variables', vars),
  sendKlipperGcode:    (gcode) => api.post('/control/klipper/gcode', { gcode }),
  getKlipperPosition:  ()      => api.get('/control/klipper/position'),
  getKlipperInfo:      ()      => api.get('/control/klipper/info'),
  // OTTOeject-Geometrie (Printloom kennt alle Koordinaten, sendet G-code direkt)
  getGeometry:         ()      => api.get('/control/ottoeject/geometry'),
  putGeometry:         (g)     => api.put('/control/ottoeject/geometry', g),
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
  cameraStreamUrl:      (deviceId)         => `/api/printer/camera/${deviceId}`,
  cameraFrameUrl:       (deviceId)         => `/api/printer/camera/${deviceId}/frame`,
  haCameraStreamUrl:    (deviceId)         => `/api/printer/ha-camera/${deviceId}`,
  haCameraTest:         (deviceId)         => api.get(`/printer/ha-camera/${deviceId}/test`),
  getPlates:            (fileId)           => api.get(`/printer/plates/${fileId}`),
  // Drucker-Einstellungen (KI-Erkennung, Geschwindigkeit, Auto-Recovery, Licht)
  getSettings:          (deviceId)         => api.get(`/printer/settings/${deviceId}`),
  setSettings:          (deviceId, body)   => api.post(`/printer/settings/${deviceId}`, body),
  calibrate:            (deviceId, options) => api.post(`/printer/calibrate/${deviceId}`, { options }),
  getHistory:           ()                 => api.get('/printer/history'),
  takeSnapshot:         (deviceId)         => api.post(`/printer/snapshot/${deviceId}`),
  getSnapshots:         ()                 => api.get('/printer/snapshots'),
  getSendDiagnostics:   ()                 => api.get('/printer/send-diagnostics'),
  clearSendDiagnostics: ()                 => api.delete('/printer/send-diagnostics'),
  amsLoad:              (deviceId, tray)          => api.post(`/printer/ams/${deviceId}/load`, { tray }),
  amsUnload:            (deviceId)                => api.post(`/printer/ams/${deviceId}/unload`),
  amsReadSlot:          (deviceId, amsId, slotId) => api.post(`/printer/ams/${deviceId}/read`, { ams_id: amsId, slot_id: slotId }),
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
  updateSlot:    (slotId, data)        => api.put(`/rack-manager/slots/${slotId}`, data),
  clearSlots:    (body)                => api.post('/rack-manager/slots/clear', body ?? {}),
  analyzeFile:   (fileId, plate = null) => api.post(`/rack-manager/analyze/${fileId}`, null, { params: (plate !== null && plate !== undefined) ? { plate } : {} }),
  getRacks:      ()                    => api.get('/rack-manager/racks'),
  createRack:    (data)                => api.post('/rack-manager/racks', data),
  deleteRack:    (rackId)              => api.delete(`/rack-manager/racks/${rackId}`),
}

export const calibrationService = {
  getConfigs:      ()                      => api.get('/calibration/configs'),
  updateConfig:    (key, values)           => api.put(`/calibration/configs/${key}`, values),
  runConfig:       (key)                   => api.post(`/calibration/run/${key}`),
  runWithValues:   (key, values)           => api.post(`/calibration/run/${key}/with-values`, values),
}

export const systemService = {
  // force=true = einmalige Prüfung auf ausdrücklichen Knopfdruck, auch wenn die
  // automatische „Update-Prüfung im Internet" ausgeschaltet ist.
  getVersion:       (channel, force) => api.get('/system/version', {
                      params: { ...(channel && { channel }), ...(force && { force: 1 }) } }),
  getRunningVersion:() => api.get('/system/running-version'),
  // Kein Timeout: Image ziehen + Container neu starten dauert Minuten.
  triggerUpdate:    (channel) => api.post('/system/update', channel ? { channel } : {},
                                          { timeout: NO_TIMEOUT }),
  getNotifications: () => api.get('/system/notifications'),
  saveNotifications:(data) => api.post('/system/notifications', data),
  sendNotification: (data) => api.post('/system/notify', data),
  testNotification: () => api.post('/system/notify/test'),
  exportBackup:     () => api.get('/system/backup'),
  importBackup:     (data) => api.post('/system/backup/restore', data),
  getLangInstalled: () => api.get('/system/lang/installed'),
  importLang:       (pack) => api.post('/system/lang/import', pack),
  deleteLang:       (code) => api.delete(`/system/lang/${code}`),
  getDashboardLayout:  () => api.get('/system/dashboard-layout'),
  saveDashboardLayout: (data) => api.put('/system/dashboard-layout', data),
  resetDashboardLayout:() => api.delete('/system/dashboard-layout'),
  getCameraSettings:   () => api.get('/system/camera'),
  saveCameraSettings:  (data) => api.post('/system/camera', data),
  // Diagnose-Paket (ZIP, ohne Zugangsdaten) — direkter Download-Link
  diagnosticsUrl:      () => '/api/system/diagnostics',
}

/* Online-Dienste — ALLE opt-in. Ohne Zustimmung + Schalter macht das Backend
   keinen einzigen externen Request (siehe backend/app/services/online.py). */
export const onlineService = {
  getSettings:  ()          => api.get('/online/settings'),
  saveSettings: (data)      => api.post('/online/settings', data),
  getNotices:   (refresh)   => api.get('/online/notices', refresh ? { params: { refresh: 1 } } : undefined),
  getLibrary:   (kind, refresh) => api.get('/online/library', {
                                 params: { ...(kind && { kind }), ...(refresh && { refresh: 1 }) } }),
  getItem:      (id)        => api.get('/online/library/item', { params: { id } }),
  clearCache:   ()          => api.post('/online/cache/clear'),
}

export const autofarmService = {
  start:         (data)  => api.post('/autofarm/start', data),
  getStatus:     (light) => api.get('/autofarm/status', light ? { params: { light: 1 } } : undefined),
  stop:          ()      => api.post('/autofarm/stop'),
  forceReset:    ()      => api.post('/autofarm/force-reset'),
  reorderJobs:   (ids)   => api.put('/autofarm/jobs/reorder', { job_ids: ids }),
  pause:         ()      => api.post('/autofarm/pause'),
  enqueue:       (job)   => api.post('/autofarm/enqueue', job),
  removeJob:     (jobId) => api.delete(`/autofarm/jobs/${jobId}`),
  setJobAms:     (jobId, amsMap) => api.put(`/autofarm/job/${jobId}/ams`, { amsMap }),
  getSequences:  ()      => api.get('/autofarm/sequences'),
  saveSequences: (data)  => api.put('/autofarm/sequences', data),
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
  saveQueue:         (jobs)  => api.put('/autofarm/queue', { jobs }),
  getHomingFileInfo: ()      => api.get('/autofarm/homing_file/info'),
  setupHomingFile:   ()      => api.post('/autofarm/homing_file/setup'),
  clearLog:          ()      => api.post('/autofarm/clear_log'),
  downloadLogFile:   ()      => window.open('/api/autofarm/log/download', '_blank'),
  clearLogFile:      ()      => api.delete('/autofarm/log/file'),
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
  stressPlan:        ()      => api.get('/autofarm/stress-test/plan'),
  stressStart:       ()      => api.post('/autofarm/stress-test'),
  stressStop:        ()      => api.post('/autofarm/stress-test/stop'),
  stressStatus:      ()      => api.get('/autofarm/stress-test/status'),
  testCycle:         ()      => api.post('/autofarm/test-cycle'),
  testCycleStop:     ()      => api.post('/autofarm/test-cycle/stop'),
  testCycleStatus:   ()      => api.get('/autofarm/test-cycle/status'),
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
  updateCustom:  (idx, data)  => api.put(`/filaments/custom/${idx}`, data),
  deleteCustom:  (idx)        => api.delete(`/filaments/custom/${idx}`),
  clearCustom:   ()           => api.delete('/filaments/custom'),
  learn:         (slots)      => api.post('/filaments/learn', { slots }),
}

export default api
