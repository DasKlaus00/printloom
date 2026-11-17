/* Eingabefelder, die einen Serverwert spiegeln (seit v1.1.64).
   ──────────────────────────────────────────────────────────────────────────────────
   Bis v1.1.63 übernahm ein Feld den Serverwert nur beim Wechsel der Datei. Hatte ein
   anderer Tab inzwischen die Teilenummer geändert, schrieb schon das Hinein- und
   wieder Herausklicken den alten Wert zurück. Jetzt: „dirty" erst nach einer Eingabe,
   gespeichert wird nur dann, und solange es nicht dirty ist, kommt der neue
   Serverwert an. */
import { useEffect, useRef, useState } from 'react'

export function mergeServerValue(local, server, dirty) {
  return dirty ? local : (server ?? '')
}

/* → { value, set(v), commit() }: commit() sagt, ob gespeichert werden soll (und setzt
   den Merker zurück). */
export function useServerField(serverValue) {
  const [value, setValue] = useState(serverValue ?? '')
  const dirty = useRef(false)
  useEffect(() => {
    setValue(v => mergeServerValue(v, serverValue, dirty.current))
  }, [serverValue])
  return {
    value,
    set: (v) => { dirty.current = true; setValue(v) },
    commit: () => { const was = dirty.current; dirty.current = false; return was },
  }
}
