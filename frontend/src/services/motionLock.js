import { useCallback, useState } from 'react'
import { autofarmService } from './api'
import { useFarmStatusStream } from './useFarmStatusStream'
import { useAutoRefresh } from './useAutoRefresh'
import { tr } from './i18n'

/* Wer hat gerade den Arm oder den Drucker? Dieselbe Regel wie im Backend
   (autofarm.motion_owner): Das Backend lehnt ohnehin mit 409 ab, die Oberfläche
   sperrt die Knöpfe nur vorher, damit niemand ins Leere klickt.
   - arm: Joggen, G-code, Drucker-Tab. Eine PAUSIERTE Farm gibt den Arm frei.
   - printer: Bett, Kalibrierung, AMS, Direktdruck. Auch eine pausierte Farm sperrt,
     denn dann kann der Arm noch im Bauraum stehen. */
export function motionLockReason(farm, stress) {
  if (stress?.running) return { arm: 'stress', printer: 'stress' }
  if (farm?.running) return { arm: farm.paused ? null : 'farm', printer: 'farm_printer' }
  return { arm: null, printer: null }
}

function text(key) {
  if (key === 'stress') return tr('Stresstest läuft — erst stoppen')
  if (key === 'farm') return tr('Auto Farm läuft — erst pausieren oder stoppen')
  if (key === 'farm_printer') return tr('Auto Farm läuft — Drucker-Befehle erst nach dem Stopp')
  return null
}

/* { arm, printer }: null = frei, sonst der Grund als Text. Den Stresstest-Status
   holt der Hook nur, solange die Seite sichtbar ist (usePageActive). */
export function useMotionLock() {
  const [farm, setFarm] = useState(null)
  const [stress, setStress] = useState(null)
  useFarmStatusStream(setFarm)
  // useCallback: useAutoRefresh hängt am Funktions-Objekt. Eine neue Funktion je
  // Render startete den Effekt neu, der sofort fragte, die Antwort renderte neu …
  // (v1.1.44: Anfrage-Schleife, solange Drucker-Tab oder Bibliothek offen war).
  const loadStress = useCallback(() => {
    autofarmService.stressStatus()
      .then(r => setStress(r.data))
      .catch(e => console.warn('Stresstest-Status:', e?.message || e))
  }, [])
  useAutoRefresh(loadStress, 5000)
  const r = motionLockReason(farm, stress)
  return { arm: text(r.arm), printer: text(r.printer) }
}
