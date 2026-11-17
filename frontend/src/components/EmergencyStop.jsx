import { useEffect, useState } from 'react'
import { useLanguage } from '../services/i18n'
import { confirmDialog } from '../services/confirm'
import {
  getEmergency, subscribeEmergency, triggerEmergencyStop, resumeAfterEmergency, dismissArmWarning,
} from '../services/emergency'

/* Notaus-Knopf für jede Seite. `compact` = kleine Form für Kopfzeile und Handy.
   Bis v1.1.42 gab es den Knopf nur in der Steuerung: Wer auf der Auto-Farm-Seite
   stand, musste erst die Seite wechseln, um den Arm anzuhalten. */
export default function EmergencyStop({ compact = false }) {
  const { tr } = useLanguage()
  const [st, setSt] = useState(getEmergency)

  useEffect(() => subscribeEmergency(setSt), [])

  // KEINE Rückfrage: ein Notaus, der erst „Sind Sie sicher?" fragt, kostet genau die
  // Sekunde, um die es geht. Die Vorsicht gehört an „Fortsetzen".
  const stop = () => { triggerEmergencyStop() }
  const resume = async () => {
    if (!(await confirmDialog({
      title: tr('Betrieb fortsetzen?'),
      message: tr('Klipper wird neu gestartet und die Geräte werden freigegeben. Die Farm startet NICHT von selbst; die erste Bewegung fährt eine Referenzfahrt. Ist der Arbeitsbereich frei?'),
      confirmLabel: tr('Freigeben'),
    }))) return
    resumeAfterEmergency()
  }

  const warning = st.armWarning === 'not_stopped'
    ? tr('ARM NICHT ANGEHALTEN — Klipper hat den Notaus nicht bestätigt. Strom des OTTOeject trennen!')
    : st.armWarning === 'unreachable'
      ? tr('Notaus konnte nicht gesendet werden ({0}). Strom des OTTOeject trennen!', st.feedback?.text || '?')
      : ''

  const icon = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6"/>
    </svg>
  )

  const banner = warning && (
    <div role="alert"
      className={`flex items-start gap-3 px-4 py-3 rounded-lg border-2 border-red-600 bg-red-950 text-red-200 text-sm font-semibold
                  ${compact ? 'fixed top-14 right-3 left-3 sm:left-auto sm:w-[26rem] z-[9997] shadow-xl' : ''}`}>
      <span className="flex-1">⚠ {warning}</span>
      <button onClick={dismissArmWarning} className="text-red-400 hover:text-red-200 text-xs font-normal">
        {tr('Verstanden')}
      </button>
    </div>
  )

  if (compact) {
    return (
      <>
        <div className="flex items-center gap-1.5">
          <button onClick={stop} className="btn btn-danger btn-sm" title={tr('Notaus: Arm sofort anhalten')}>
            {icon}<span>{tr('Notaus')}</span>
          </button>
          {st.active && (
            <button onClick={resume} className="btn btn-ghost btn-sm" title={tr('▶ Betrieb fortsetzen')}
              aria-label={tr('▶ Betrieb fortsetzen')}>
              {/* Auf dem Handy ist die Kopfzeile sonst zu breit; „Notaus" bleibt ausgeschrieben. */}
              <span className="sm:hidden" aria-hidden="true">▶</span>
              <span className="hidden sm:inline">{tr('Fortsetzen')}</span>
            </button>
          )}
        </div>
        {banner}
      </>
    )
  }

  // Kein eigenes Banner in der großen Form: Die kompakte Form in der Kopfzeile (bzw.
  // Handy-Ansicht) zeigt es schon, sonst stünde es in der Steuerung doppelt.
  return (
    <>
      <div className="flex gap-3">
        <button onClick={stop} className="flex-1 btn btn-danger">
          {icon}{tr('Notaus')}
        </button>
        <button onClick={resume} disabled={!st.active} className="flex-1 btn btn-ghost disabled:opacity-30">
          {tr('▶ Betrieb fortsetzen')}
        </button>
      </div>
    </>
  )
}
