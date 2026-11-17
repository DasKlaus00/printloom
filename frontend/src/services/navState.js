/* Seitenleiste eingeklappt? (seit v1.1.69)
   Gespeichert wird nur eine ausdrückliche Wahl (Knopf oben links), wie bei der
   Darstellung (theme.js): '1' eingeklappt, '0' offen. Ohne Wahl richtet sie sich nach
   dem Platz: unter 1280 px eingeklappt. Bis v1.1.68 war sie ohne Wahl immer offen,
   und auf einem 1024er-Bildschirm blieben der Seite rund 800 px. */
export const NAV_KEY = 'ottomat3d_nav_compact'
export const NAV_AUTO_MAX = 1279

export function navCompact(stored, width) {
  if (stored === '1') return true
  if (stored === '0') return false
  return width <= NAV_AUTO_MAX
}
