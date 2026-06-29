import { filamentService } from './api'
import { colorLabel } from './colorNames'
import { pushToast } from './toast'

/* Lernt neue Filamente aus den aktiven AMS-Slots und toastet jede NEUE Entdeckung
   („Material · Farbe hinzugefügt"). Server-Endpoint ist idempotent (dedupe), daher
   gefahrlos wiederholt aufrufbar. amsSlots: [{type, color}]. */
export async function learnFromAms(amsSlots) {
  const slots = (amsSlots || [])
    .filter(s => s && s.type)
    .map(s => ({ type: s.type, color: s.color }))
  if (!slots.length) return []
  try {
    const r = await filamentService.learn(slots)
    const added = r.data?.added || []
    for (const f of added) {
      const name = colorLabel(f.color_hex)
      pushToast(`${f.material}${name ? ' · ' + name : ''} hinzugefügt`, 'success')
    }
    if (added.length) window.dispatchEvent(new CustomEvent('printloom:filamentsLearned'))
    return added
  } catch {
    return []
  }
}
