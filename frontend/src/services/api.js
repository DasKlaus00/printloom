import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

export const deviceService = {
  listDevices:  ()         => api.get('/devices/'),
  getDevice:    (id)       => api.get(`/devices/${id}`),
  createDevice: (data)     => api.post('/devices/', data),
  updateDevice: (id, data) => api.put(`/devices/${id}`, data),
  deleteDevice: (id)       => api.delete(`/devices/${id}`),
  testDevice:   (id)       => api.post(`/devices/${id}/test`),
}

export const configService = {
  getRackConfig:    ()       => api.get('/config/rack'),
  updateRackConfig: (data)   => api.put('/config/rack', data),
  getSlotStatus:    (slotId) => api.get(`/config/slot/${slotId}`),
  updateSlotStatus: (slotId, data) => api.put(`/config/slot/${slotId}/status`, data),
}

export const fileService = {
  uploadFile:   (formData, folderId = null) => api.post('/files/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    ...(folderId != null ? { params: { folder_id: folderId } } : {}),
  }),
  listFiles:    (skip = 0, limit = 100) => api.get('/files/', { params: { skip, limit } }),
  queryFiles:   (params = {}) => api.get('/files/', { params: { limit: 500, ...params } }),
  updateFile:   (id, data) => api.patch(`/files/${id}`, data),
  deleteFile:   (id)       => api.delete(`/files/${id}`),
  getAmsInfo:   (id)       => api.get(`/files/${id}/ams-info`),
  deepAnalyze:  (id)       => api.get(`/files/${id}/deep-analyze`),
  getQuickMeta: (id)       => api.get(`/files/${id}/quick-meta`),
  thumbnailUrl: (id)       => `/api/files/${id}/thumbnail`,
}

export const folderService = {
  list:   ()         => api.get('/folders/'),
  create: (data)     => api.post('/folders/', data),
  update: (id, data) => api.patch(`/folders/${id}`, data),
  remove: (id)       => api.delete(`/folders/${id}`),
}

export const queueService = {
  getQueue:         ()              => api.get('/queue/'),
  addToQueue:       (data)          => api.post('/queue/add', data),
  removeFromQueue:  (jobId)         => api.delete(`/queue/remove/${jobId}`),
  updateJobStatus:  (jobId, data)   => api.put(`/queue/job/${jobId}/status`, data),
}

export const controlService = {
  executeMacro:        (data)  => api.post('/control/macro', data),
  listMacros:          ()      => api.get('/control/macros'),
  emergencyStop:       ()      => api.post('/control/emergency-stop'),
  resume:              ()      => api.post('/control/resume'),
  getStatus:           ()      => api.get('/control/status'),
  getOttoejectVars:    ()      => api.get('/control/ottoeject/variables'),
  setOttoejectVars:    (vars)  => api.post('/control/ottoeject/variables', vars),
  sendKlipperGcode:    (gcode) => api.post('/control/klipper/gcode', { gcode }),
  getKlipperPosition:  ()      => api.get('/control/klipper/position'),
  getKlipperInfo:      ()      => api.get('/control/klipper/info'),
}

export const printerService = {
  sendFile:             (deviceId, fileId, useAms = true, amsSlot = null) => api.post(`/printer/send/${deviceId}/${fileId}`, null, { params: { use_ams: useAms, ...(amsSlot !== null && amsSlot !== undefined && { ams_slot: amsSlot }) } }),
  sendGcode:            (deviceId, gcode)  => api.post(`/printer/gcode/${deviceId}`, null, { params: { gcode } }),
  getStatus:            (deviceId)         => api.get(`/printer/status/${deviceId}`),
  cameraStreamUrl:      (deviceId)         => `/api/printer/camera/${deviceId}`,
  cameraFrameUrl:       (deviceId)         => `/api/printer/camera/${deviceId}/frame`,
  haCameraStreamUrl:    (deviceId)         => `/api/printer/ha-camera/${deviceId}`,
  haCameraTest:         (deviceId)         => api.get(`/printer/ha-camera/${deviceId}/test`),
  getPlates:            (fileId)           => api.get(`/printer/plates/${fileId}`),
  getHistory:           ()                 => api.get('/printer/history'),
  takeSnapshot:         (deviceId)         => api.post(`/printer/snapshot/${deviceId}`),
  getSnapshots:         ()                 => api.get('/printer/snapshots'),
  getSendDiagnostics:   ()                 => api.get('/printer/send-diagnostics'),
  clearSendDiagnostics: ()                 => api.delete('/printer/send-diagnostics'),
}

export const deviceSettingsService = {
  getSettings:    (deviceId)        => api.get(`/devices/${deviceId}/settings`),
  updateSettings: (deviceId, data)  => api.put(`/devices/${deviceId}/settings`, data),
}

export const rackManagerService = {
  getAll:        ()                    => api.get('/rack-manager/'),
  updateConfig:  (data)                => api.put('/rack-manager/config', data),
  refillMagazine:(value)               => api.post('/rack-manager/magazine/refill', value != null ? { value } : {}),
  updateSlot:    (slotId, data)        => api.put(`/rack-manager/slots/${slotId}`, data),
  clearSlots:    (body)                => api.post('/rack-manager/slots/clear', body ?? {}),
  analyzeFile:   (fileId)              => api.post(`/rack-manager/analyze/${fileId}`),
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
  getVersion:       (channel) => api.get('/system/version', { params: channel ? { channel } : {} }),
  triggerUpdate:    (channel) => api.post('/system/update', channel ? { channel } : {}),
  getNotifications: () => api.get('/system/notifications'),
  saveNotifications:(data) => api.post('/system/notifications', data),
  sendNotification: (data) => api.post('/system/notify', data),
  testNotification: () => api.post('/system/notify/test'),
  exportBackup:     () => api.get('/system/backup'),
  importBackup:     (data) => api.post('/system/backup/restore', data),
  getLangInstalled: () => api.get('/system/lang/installed'),
  importLang:       (pack) => api.post('/system/lang/import', pack),
  deleteLang:       (code) => api.delete(`/system/lang/${code}`),
}

export const autofarmService = {
  start:         (data)  => api.post('/autofarm/start', data),
  getStatus:     ()      => api.get('/autofarm/status'),
  stop:          ()      => api.post('/autofarm/stop'),
  forceReset:    ()      => api.post('/autofarm/force-reset'),
  reorderJobs:   (ids)   => api.put('/autofarm/jobs/reorder', { job_ids: ids }),
  pause:         ()      => api.post('/autofarm/pause'),
  enqueue:       (job)   => api.post('/autofarm/enqueue', job),
  removeJob:     (jobId) => api.delete(`/autofarm/jobs/${jobId}`),
  setJobAms:     (jobId, amsMap) => api.put(`/autofarm/job/${jobId}/ams`, { amsMap }),
  getSequences:  ()      => api.get('/autofarm/sequences'),
  saveSequences: (data)  => api.put('/autofarm/sequences', data),
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
  getTimeline:       (hours = 24) => api.get('/autofarm/timeline', { params: { hours } }),
  getFileFilaments:  (id)    => api.get(`/autofarm/file_filaments/${id}`),
  testCycle:         ()      => api.post('/autofarm/test-cycle'),
  testCycleStop:     ()      => api.post('/autofarm/test-cycle/stop'),
  testCycleStatus:   ()      => api.get('/autofarm/test-cycle/status'),
}

export const projectService = {
  get:  ()      => api.get('/project'),
  save: (data)  => api.put('/project', data),
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
}

export default api
