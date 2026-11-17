import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { getTranslationTemplate, tr, trProblem } from './i18n'

/* Wächter gegen stillen Rückfall auf Deutsch.
   ──────────────────────────────────────────
   tr('…') gibt den deutschen Quelltext zurück, wenn kein Eintrag existiert. Das
   ist gewollt (nichts geht kaputt), macht ein Vergessen aber unsichtbar: die
   englische Oberfläche zeigt dann einfach Deutsch. Dieser Test sammelt alle
   Texte, die zur Laufzeit durch tr() laufen können, und besteht nur, wenn zu
   jedem eine englische Fassung hinterlegt ist.

   Mitgesammelt werden auch die Meldungs-VORLAGEN aus dem Backend: das Backend
   kennt die eingestellte Sprache nicht und schickt Vorlage + Werte mit (siehe
   geometry_check.problem / trProblem). */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.resolve(HERE, '..')
const BACKEND = path.resolve(HERE, '../../../backend')

const SKIP = new Set(['i18n.js', 'changelog.js'])

function sourceFiles(dir) {
  const out = []
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') out.push(...sourceFiles(p)) }
    else if (/\.jsx?$/.test(e.name) && !SKIP.has(e.name) && !/\.test\.jsx?$/.test(e.name)) out.push(p)
  }
  return out
}

// Texte mit mindestens einem Buchstaben — reine Symbole („—", „…") brauchen nichts.
const HAS_LETTER = /[A-Za-zÄÖÜäöüß]/

function frontendKeys() {
  const keys = new Map()
  for (const f of sourceFiles(SRC)) {
    const src = fs.readFileSync(f, 'utf8')
    const rel = path.relative(SRC, f)
    const patterns = [
      // tr('…') / translate('…')
      /\b(?:tr|translate)\(\s*'((?:\\.|[^'\\])*)'/g,
      // Label-Tabellen: der Wert wird an der Anzeigestelle durch tr(variable) geschickt
      /\b(?:label|label_de|desc|hint|title|name|badge|reason|note)\s*:\s*'((?:\\.|[^'\\])*)'/g,
      // sequenceData: s(1, 'app_op', 'Tür öffnen', …)
      /\bs\(\s*\d+\s*,\s*'[a-z_]+'\s*,\s*'((?:\\.|[^'\\])*)'/g,
    ]
    for (const re of patterns) {
      let m
      while ((m = re.exec(src))) {
        const key = m[1].replace(/\\'/g, "'")
        if (HAS_LETTER.test(key) && !keys.has(key)) keys.set(key, rel)
      }
    }
  }
  return keys
}

// Python-Stringliterale, die im Quelltext direkt aufeinander folgen, gehören zusammen.
const pyJoin = (s) => [...s.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(x => x[1]).join('')

function backendKeys() {
  const keys = new Map()
  const files = ['app/services/geometry_check.py', 'app/services/farm_layout.py',
                 'app/routers/autofarm.py', 'app/routers/devices.py', 'app/routers/files.py',
                 'app/routers/filaments.py', 'app/routers/control.py']
  for (const rel of files) {
    const p = path.join(BACKEND, rel)
    if (!fs.existsSync(p)) continue
    const src = fs.readFileSync(p, 'utf8')
    let m
    const reProblem = /\bproblem\(\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*((?:"(?:\\.|[^"\\])*"\s*)+)/g
    while ((m = reProblem.exec(src))) {
      const key = pyJoin(m[1])
      if (HAS_LETTER.test(key) && !keys.has(key)) keys.set(key, rel)
    }
    const reTpl = /\btpl\s*=\s*\(([\s\S]*?)\)\s*\n/g
    while ((m = reTpl.exec(src))) {
      for (const part of m[1].split(/\bif\b|\belse\b/)) {
        const key = pyJoin(part)
        if (key && HAS_LETTER.test(key) && !keys.has(key)) keys.set(key, rel)
      }
    }
    // Feste Meldungen (kein f-String): apiError schickt sie durch tr() (seit v1.1.66).
    const reHttp = /HTTPException\(\s*(?:status_code=)?\d+\s*,\s*(?:detail=)?"((?:\\.|[^"\\])*)"\s*\)/g
    while ((m = reHttp.exec(src))) {
      const key = m[1]
      if (HAS_LETTER.test(key) && /[a-zäöü]/.test(key) && !/^[A-Z_]+$/.test(key) && !keys.has(key)) keys.set(key, rel)
    }
    const reNote = /entry\["note"\]\s*=\s*"((?:\\.|[^"\\])*)"/g
    while ((m = reNote.exec(src))) {
      const key = m[1]
      if (HAS_LETTER.test(key) && !keys.has(key)) keys.set(key, rel)
    }
  }
  return keys
}

// Alle Quelltexte als ein String: Frontend (ohne i18n.js und Tests), Backend, Plugin.
function allSources() {
  const out = []
  const walk = (dir, rx) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { if (!['node_modules', '__pycache__', 'tests'].includes(e.name)) walk(p, rx) }
      else if (rx.test(e.name) && !/\.test\.jsx?$/.test(e.name) && e.name !== 'i18n.js') out.push(fs.readFileSync(p, 'utf8'))
    }
  }
  walk(SRC, /\.jsx?$/)
  walk(path.join(BACKEND, 'app'), /\.py$/)
  walk(path.resolve(BACKEND, '..', 'orca-plugin'), /\.py$/)
  return out.join('\n')
}

describe('i18n', () => {
  const en = getTranslationTemplate()

  it('übersetzt jeden Text der Oberfläche ins Englische', () => {
    const missing = [...frontendKeys()].filter(([k]) => en[k] == null)
      .map(([k, where]) => `${where}: ${k}`)
    expect(missing, `${missing.length} Text(e) ohne englische Fassung`).toEqual([])
  })

  it('übersetzt auch die Meldungs-Vorlagen aus dem Backend', () => {
    const keys = backendKeys()
    if (!keys.size) return          // Frontend allein ausgecheckt → nichts zu prüfen
    const missing = [...keys].filter(([k]) => en[k] == null)
      .map(([k, where]) => `${where}: ${k}`)
    expect(missing, `${missing.length} Backend-Vorlage(n) ohne englische Fassung`).toEqual([])
  })

  it('jeder englische Eintrag wird noch benutzt (keine Waisen)', () => {
    // Seit v1.1.76. Benutzt = einer der Sammler oben findet ihn, oder er steht wörtlich
    // in einer Quelldatei (Frontend, Backend, Plugin). Bis v1.1.75 lagen ~290 Einträge
    // entfernter Seiten im Start-Bundle.
    if (!fs.existsSync(BACKEND)) return   // Frontend allein: Backend-Texte nicht prüfbar
    const used = new Set([...frontendKeys().keys(), ...backendKeys().keys()])
    const all = allSources()
    const waisen = Object.keys(en).filter(k => !used.has(k) && !all.includes(k)
      && !all.includes(k.replace(/'/g, "\\'")) && !all.includes(k.replace(/"/g, '\\"')))
    expect(waisen, `${waisen.length} englische Einträge ohne Verwendung`).toEqual([])
  })

  it('hat keinen Schlüssel doppelt (der zweite würde den ersten still ersetzen)', () => {
    const src = fs.readFileSync(path.join(HERE, 'i18n.js'), 'utf8').replace(/\r\n/g, '\n')
    const start = src.indexOf('const EN_STRINGS = {')
    // Ende des Blocks: die erste Zeile, die nur aus „}" besteht (nicht ein fester Eintrag)
    const end = src.indexOf('\n}\n', start)
    const block = src.slice(start, end > 0 ? end : undefined)
    const seen = new Set()
    const dupes = []
    // Eintrags-genau, nicht zeilenweise: es gibt Zeilen mit mehreren Einträgen.
    const re = /'((?:\\.|[^'\\])*)'\s*:\s*(?:\r?\n\s*)?'((?:\\.|[^'\\])*)'/g
    let m
    while ((m = re.exec(block))) {
      const k = m[1]
      if (seen.has(k)) dupes.push(k)
      seen.add(k)
    }
    expect(dupes).toEqual([])
  })

  it('setzt Platzhalter der Reihe nach ein', () => {
    expect(tr('Fach {0}-{1}', 2, 3)).toBe('Fach 2-3')
  })

  it('fällt bei fehlendem Eintrag auf den deutschen Quelltext zurück', () => {
    expect(tr('Diesen Satz gibt es garantiert nicht')).toBe('Diesen Satz gibt es garantiert nicht')
  })

  it('füllt Backend-Meldungen aus Vorlage und Werten', () => {
    const p = { template: 'Regal {0} hat nur {1} Fächer', params: [2, 6], message: 'egal' }
    expect(trProblem(p)).toBe('Regal 2 hat nur 6 Fächer')
  })

  it('nimmt bei einer Meldung ohne Vorlage den mitgelieferten Text', () => {
    expect(trProblem({ message: 'Alter Server ohne Vorlage' })).toBe('Alter Server ohne Vorlage')
  })
})
