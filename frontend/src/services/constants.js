/* Kleine Konstanten, die mehrere Seiten brauchen (seit v1.1.77). Bis v1.1.76 holte
   der Setup-Assistent TIMEZONES aus Configuration.jsx und App.jsx den Setup-Schlüssel
   aus Setup.jsx — damit landeten beide Seiten im Start-Bundle, obwohl man sie selten
   öffnet. */

/** Gesetzt, sobald der Setup-Assistent durch ist oder ein Gerät existiert. */
export const SETUP_DONE_KEY = 'ottomat3d_setup_done'

/* Häufige Zeitzonen für die Auswahl (IANA). Die erkannte Browser-Zone wird bei
   Bedarf vorangestellt, damit sie immer wählbar ist. */
export const TIMEZONES = [
  'Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich', 'Europe/London', 'Europe/Paris',
  'Europe/Amsterdam', 'Europe/Madrid', 'Europe/Rome', 'Europe/Warsaw', 'Europe/Prague',
  'Europe/Stockholm', 'Europe/Helsinki', 'Europe/Athens', 'Europe/Istanbul', 'Europe/Moscow',
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
  'America/Sao_Paulo', 'Asia/Dubai', 'Asia/Kolkata', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney',
]
