/* Welche Sprachen lassen sich im Sprachen-Store anfragen? (seit v1.1.93)

   Alle Sprachen nach ISO 639-1. Nicht anfragbar ist, was es schon gibt (gleicher Code)
   oder was einer vorhandenen Sprache ähnelt (gleiche Grundsprache, z. B. zh-tw neben
   zh-cn): So entscheidet es auch die Aufnahme neuer Pakete — eine ähnliche Sprache wird
   nicht zusätzlich gebaut. Namen kommen aus Intl.DisplayNames in der Sprache der
   Oberfläche; ohne Intl bleibt der Code. */
import { PACKS, normalizeCode } from './catalog'

export const ISO_639_1 = (
  'aa ab ae af ak am an ar as av ay az ba be bg bi bm bn bo br bs ca ce ch co cr cs cu cv cy ' +
  'da de dv dz ee el en eo es et eu fa ff fi fj fo fr fy ga gd gl gn gu gv ha he hi ho hr ht ' +
  'hu hy hz ia id ie ig ii ik io is it iu ja jv ka kg ki kj kk kl km kn ko kr ks ku kv kw ky ' +
  'la lb lg li ln lo lt lu lv mg mh mi mk ml mn mr ms mt my na nb nd ne ng nl nn no nr nv ny ' +
  'oc oj om or os pa pi pl ps pt qu rm rn ro ru rw sa sc sd se sg si sk sl sm sn so sq sr ss ' +
  'st su sv sw ta te tg th ti tk tl tn to tr ts tt tw ty ug uk ur uz ve vi vo wa wo xh yi yo za zh zu'
).split(' ')

const base = (code) => normalizeCode(code).split('-')[0]

/* → { state: 'exists' | 'similar' | 'ok', pack } — pack = das vorhandene Paket. */
export function requestState(code, packs = PACKS) {
  const c = normalizeCode(code)
  const same = packs.find(p => p.code === c)
  if (same) return { state: 'exists', pack: same }
  const similar = packs.find(p => base(p.code) === base(c))
  if (similar) return { state: 'similar', pack: similar }
  return { state: 'ok', pack: null }
}

export function languageName(code, loc) {
  try {
    return new Intl.DisplayNames([loc, 'en'], { type: 'language', fallback: 'none' }).of(code) || code
  } catch {
    return code
  }
}

/* Anfragbare Sprachen, nach Namen sortiert: [{code, name}]. */
export function requestableLanguages(loc, packs = PACKS) {
  return ISO_639_1
    .filter(code => requestState(code, packs).state === 'ok')
    .map(code => ({ code, name: languageName(code, loc) }))
    .sort((a, b) => a.name.localeCompare(b.name, loc))
}
