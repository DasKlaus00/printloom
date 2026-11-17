import { describe, it, expect } from 'vitest'
import { safeHref } from './safeUrl'

describe('Links aus fremden Daten', () => {
  it('javascript: und data: werden nicht verlinkt', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull()
    expect(safeHref(' JavaScript:alert(1)')).toBeNull()
    expect(safeHref('data:text/html,x')).toBeNull()
    expect(safeHref('')).toBeNull()
    expect(safeHref(undefined)).toBeNull()
  })
  it('http(s) bleibt', () => {
    expect(safeHref('https://example.org/x')).toBe('https://example.org/x')
    expect(safeHref('HTTP://host.lan/y')).toBe('HTTP://host.lan/y')
  })
})
