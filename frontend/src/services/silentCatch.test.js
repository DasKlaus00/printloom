import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/* Wächter: keine neuen stillen Fehler in der Oberfläche.
   ──────────────────────────────────────────────────────
   Ein leeres `catch {}` oder `.catch(() => {})` verschluckt einen Fehler, ohne dass
   ihn je jemand sieht. Die vorhandenen werden nach und nach behandelt. Dieser Test
   sorgt dafür, dass keine neuen dazukommen. Ein `catch { /* … *\/ }` mit Kommentar
   zählt nicht: Dort hat jemand begründet, warum nichts zu tun ist.

   BASELINE darf nur sinken, nie steigen. */
const BASELINE = 97   // Stand 17.11.2026 (v1.1.48)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')

// catch {}, catch (e) {}, .catch(() => {}), .catch(e => {}) — nur wirklich leere.
const EMPTY = /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(\(\s*[\w$]*\s*\)|[\w$]+)\s*=>\s*\{\s*\}\s*\)/g

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...sourceFiles(p)) }
    else if (/\.jsx?$/.test(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

export function silentCatches(text) {
  return (text.match(EMPTY) || []).length
}

describe('stille catch-Blöcke', () => {
  it('kommen nicht neu dazu', () => {
    const where = []
    let total = 0
    for (const f of sourceFiles(SRC)) {
      const n = silentCatches(fs.readFileSync(f, 'utf8'))
      if (n) { total += n; where.push(`${path.relative(SRC, f)}: ${n}`) }
    }
    expect(total, `Leere catch-Blöcke (erlaubt ${BASELINE}):\n${where.join('\n')}`).toBeLessThanOrEqual(BASELINE)
  })

  it('zählt leere Blöcke, aber keine begründeten oder behandelten', () => {
    expect(silentCatches('try { a() } catch {}')).toBe(1)
    expect(silentCatches('try { a() } catch (e) { }')).toBe(1)
    expect(silentCatches('p.catch(() => {})')).toBe(1)
    expect(silentCatches('p.catch(e => {})')).toBe(1)
    expect(silentCatches('try { a() } catch { /* Absicht */ }')).toBe(0)
    expect(silentCatches('p.catch(e => console.warn(e))')).toBe(0)
  })
})
