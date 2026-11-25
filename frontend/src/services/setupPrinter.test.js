import { describe, it, expect } from 'vitest'
import { driverOf, canSave, devicePayload, nameForModel, setupPrinter,
         moonrakerPrinters, armCandidates } from './setupPrinter'

// Form wie GET /api/devices/models (printer_models.public_list), gekürzt.
const MODELS = [
  { id: 'x1c', label: 'Bambu Lab X1 Carbon', driver: 'bambu' },
  { id: 'p1s', label: 'Bambu Lab P1S', driver: 'bambu' },
  { id: 'u1', label: 'Snapmaker U1', driver: 'moonraker' },
]
const FORM = { name: 'Bambu X1C', model: '', ip_address: '', serial_number: '', access_code: '', port: '' }

describe('Startkonfiguration: Drucker', () => {
  it('kennt den Treiber des Modells, ohne Modell Bambu', () => {
    expect(driverOf(MODELS, 'u1')).toBe('moonraker')
    expect(driverOf(MODELS, 'p1s')).toBe('bambu')
    expect(driverOf(MODELS, '')).toBe('bambu')
    expect(driverOf([], 'u1')).toBe('bambu')   // Modelle noch nicht geladen
  })

  it('der U1 braucht keinen Access-Code, ein Bambu schon', () => {
    const f = { ...FORM, ip_address: '192.0.2.30' }
    expect(canSave(f, 'moonraker')).toBe(true)
    expect(canSave(f, 'bambu')).toBe(false)
    expect(canSave({ ...f, access_code: '12345678' }, 'bambu')).toBe(true)
    expect(canSave({ ...f, ip_address: '  ' }, 'moonraker')).toBe(false)
  })

  it('legt den U1 als Moonraker-Gerät an, ohne Seriennummer und ohne leeren Schlüssel', () => {
    const p = devicePayload({ ...FORM, name: 'Snapmaker U1', model: 'u1', ip_address: ' 192.0.2.30 ' }, 'moonraker')
    expect(p).toEqual({ name: 'Snapmaker U1', device_type: 'moonraker', ip_address: '192.0.2.30',
                        port: 7125, model: 'u1' })
    const k = devicePayload({ ...FORM, model: 'u1', ip_address: '192.0.2.30', port: '80', access_code: 'abc' }, 'moonraker')
    expect(k.port).toBe(80)
    expect(k.access_code).toBe('abc')
  })

  it('ein Bambu bleibt wie bisher (MQTT über 8883 mit TLS)', () => {
    const p = devicePayload({ ...FORM, model: 'x1c', ip_address: '192.0.2.5', serial_number: '00M1', access_code: '12345678' }, 'bambu')
    expect(p).toMatchObject({ device_type: 'bambu_lab', port: 8883, mqtt_port: 8883, use_tls: true,
                              serial_number: '00M1', access_code: '12345678', model: 'x1c' })
  })

  it('der Name folgt dem Modell, solange ihn niemand geändert hat', () => {
    expect(nameForModel('Bambu X1C', MODELS, '', 'u1')).toBe('Snapmaker U1')
    expect(nameForModel('Snapmaker U1', MODELS, 'u1', 'p1s')).toBe('Bambu Lab P1S')
    expect(nameForModel('Werkstatt links', MODELS, '', 'u1')).toBe('Werkstatt links')
    expect(nameForModel('Snapmaker U1', MODELS, 'u1', '')).toBe('Bambu X1C')
  })

  it('ein Bambu gilt zuerst als eingerichtet, sonst der U1, nie der Arm', () => {
    const arm = { id: 1, device_type: 'klipper' }
    const u1 = { id: 2, device_type: 'moonraker' }
    const x1 = { id: 3, device_type: 'bambu_lab' }
    expect(setupPrinter([arm, u1, x1])).toBe(x1)
    expect(setupPrinter([arm, u1])).toBe(u1)
    expect(setupPrinter([arm])).toBe(null)
  })

  it('die Netzwerk-Suche trennt den U1 vom Arm', () => {
    // Form wie GET /api/devices/discover → klipper[] (discovery.py)
    const found = [
      { ip: '192.0.2.30', port: 7125, hostname: 'u1', source: 'scan', kind: 'printer' },
      { ip: '192.0.2.40', port: 7125, hostname: 'ottoeject', source: 'scan', kind: 'arm' },
      { ip: '192.0.2.41', port: 7125, hostname: null, source: 'scan', kind: 'unknown' },
    ]
    expect(moonrakerPrinters(found).map(k => k.ip)).toEqual(['192.0.2.30'])
    expect(armCandidates(found).map(k => k.ip)).toEqual(['192.0.2.40', '192.0.2.41'])
    expect(moonrakerPrinters(undefined)).toEqual([])
  })
})
