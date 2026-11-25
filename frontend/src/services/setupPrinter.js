/* Startkonfiguration, Schritt „Drucker": Was das gewählte Modell zum Verbinden braucht.

   Ein Bambu meldet sich per MQTT mit Seriennummer und Access-Code (Port 8883, TLS).
   Der Snapmaker U1 spricht Moonraker im Heimnetz: nur die Adresse; einen API-Schlüssel
   braucht er nur, wenn am Drucker eine Anmeldung eingerichtet ist. Bis v1.1.85 legte
   der Assistent auch einen U1 als Bambu an — mit Pflicht-Access-Code, und das Gerät
   blieb tot. Der Treiber kommt aus dem Backend (printer_models.py, Feld `driver`). */

export const MOONRAKER_PORT = 7125

/** „bambu" oder „moonraker" für das gewählte Modell. Kein Modell → Bambu (wie bisher). */
export const driverOf = (models, modelId) =>
  (models || []).find(m => m.id === modelId)?.driver || 'bambu'

const text = (v) => String(v ?? '').trim()

/** Darf gespeichert werden? Bambu braucht Adresse und Access-Code, der U1 nur die Adresse. */
export function canSave(form, driver) {
  if (!text(form.ip_address)) return false
  return driver === 'moonraker' || !!text(form.access_code)
}

/** Was an POST /api/devices geht. */
export function devicePayload(form, driver) {
  const ip = text(form.ip_address)
  if (driver === 'moonraker') {
    const key = text(form.access_code)
    return {
      name: form.name || 'Snapmaker U1', device_type: 'moonraker', ip_address: ip,
      port: +form.port || MOONRAKER_PORT, model: form.model || 'u1',
      ...(key ? { access_code: key } : {}),   // leer = keine Anmeldung, nicht ''
    }
  }
  return {
    name: form.name || 'Bambu X1C', device_type: 'bambu_lab', ip_address: ip,
    port: 8883, mqtt_port: 8883, use_tls: true,
    serial_number: form.serial_number, access_code: form.access_code, model: form.model || '',
  }
}

/** Ein Name, den niemand selbst getippt hat, folgt dem Modell; ein eigener bleibt. */
export function nameForModel(name, models, prevModel, nextModel) {
  const label = (id) => (models || []).find(m => m.id === id)?.label
  const untouched = ['', 'Bambu X1C', label(prevModel)].includes(name)
  return untouched ? (label(nextModel) || 'Bambu X1C') : name
}

/** Welcher Drucker gilt im Assistenten als eingerichtet? Ein Bambu zuerst — nur den
    fährt die Farm bisher. */
export const setupPrinter = (devices) =>
  (devices || []).find(d => d.device_type === 'bambu_lab')
  || (devices || []).find(d => d.device_type === 'moonraker') || null

/* Die Netzwerk-Suche meldet jedes Moonraker-Gerät mit `kind` (discovery.moonraker_kind):
   ein Drucker mit Extruder (U1) gehört in den Schritt „Drucker", alles andere zum Arm. */
export const moonrakerPrinters = (found) => (found || []).filter(k => k.kind === 'printer')
export const armCandidates = (found) => (found || []).filter(k => k.kind !== 'printer')
