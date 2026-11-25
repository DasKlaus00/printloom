import { describe, it, expect } from 'vitest'
import { isFarmPrinter, pickFarmPrinter } from './farmPrinter'

// Form wie GET /api/devices (DeviceResponse), gekürzt.
const ARM = { id: 1, name: 'OTTOeject', device_type: 'klipper' }
const X1C = { id: 2, name: 'X1C', device_type: 'bambu_lab', model: 'x1c' }
const U1 = { id: 3, name: 'U1', device_type: 'moonraker', model: 'u1' }

describe('Drucker der Farm', () => {
  it('fährt Bambu und Snapmaker U1, nie den Arm', () => {
    expect(isFarmPrinter(X1C)).toBe(true)
    expect(isFarmPrinter(U1)).toBe(true)
    expect(isFarmPrinter(ARM)).toBe(false)
    expect(isFarmPrinter(undefined)).toBe(false)
  })

  it('nimmt das Gerät, das der Server nennt', () => {
    expect(pickFarmPrinter([ARM, X1C, U1], 3)).toBe(U1)
    expect(pickFarmPrinter([ARM, X1C, U1], 2)).toBe(X1C)
  })

  it('ohne Antwort: Bambu vor U1, und nie der Arm', () => {
    expect(pickFarmPrinter([ARM, U1, X1C], null)).toBe(X1C)
    expect(pickFarmPrinter([ARM, U1], null)).toBe(U1)
    expect(pickFarmPrinter([ARM], 1)).toBe(null)
    expect(pickFarmPrinter(undefined, null)).toBe(null)
  })
})
