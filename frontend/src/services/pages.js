/* Eine Seitentabelle für Adresse, Tab-Titel und Seitenleiste (seit v1.1.77).
   Bis v1.1.76 standen dieselben Seiten in vier Listen (PATH_TO_PAGE, PAGE_TO_PATH,
   pageTitle in App.jsx, buildGroups in Navigation.jsx) — „Filamente" hatte deshalb
   keinen Tab-Titel. Titel und Gruppen sind deutscher Quelltext; angezeigt wird
   über tr(). Ohne `group` steht eine Seite nicht in der Seitenleiste. */

export const NAV_GROUPS = [
  { id: 'main',  label: null },
  { id: 'jobs',  label: 'Aufträge' },
  { id: 'setup', label: 'Einrichtung' },
]

export const PAGES = [
  // '/mobile' war eine eigene Handy-Ansicht (bis v1.1.76); die Startseite ist fürs Handy ausgelegt.
  { id: 'dashboard',     path: '/dashboard',     title: 'Dashboard',        group: 'main',  icon: 'dashboard', extraPaths: ['/', '/mobile'] },
  { id: 'autofarm',      path: '/autofarm',      title: 'Auto Farm',        group: 'main',  icon: 'autofarm' },
  { id: 'steuerung',     path: '/steuerung',     title: 'Steuerung',        group: 'main',  icon: 'controls' },
  { id: 'history',       path: '/history',       title: 'Historie',         group: 'main',  icon: 'history' },
  { id: 'files',         path: '/files',         title: 'Datei-Bibliothek', group: 'jobs',  icon: 'files' },
  { id: 'projekt',       path: '/projekt',       title: 'Projekt',          group: 'jobs',  icon: 'projekt' },
  { id: 'library',       path: '/bibliothek',    title: 'Bibliothek',       group: 'jobs',  icon: 'library' },
  // „Farm-Layout" ist seit v1.1.8 Teil des Drucker-Tabs — alte Lesezeichen landen dort.
  { id: 'drucker',       path: '/drucker',       title: 'Drucker',          group: 'setup', icon: 'drucker', extraPaths: ['/layout'] },
  { id: 'sequence',      path: '/sequence',      title: 'Sequenz-Editor',   group: 'setup', icon: 'sequence' },
  { id: 'profiles',      path: '/profiles',      title: 'Profile',          group: 'setup', icon: 'profiles' },
  { id: 'filamente',     path: '/filamente',     title: 'Filamente',        group: 'setup', icon: 'filamente' },
  { id: 'configuration', path: '/configuration', title: 'Konfiguration',    group: 'setup', icon: 'config' },
  { id: 'system',        path: '/system',        title: 'System',           group: 'setup', icon: 'system' },
  // Ohne Eintrag in der Seitenleiste: über System bzw. die Farm erreichbar.
  { id: 'analyze',       path: '/analyze',       title: 'Datei-Analyse' },
  { id: 'diagnose',      path: '/diagnose',      title: 'AMS-Diagnose' },
  { id: 'rack',          path: '/rack',          title: 'Regal' },
  { id: 'setup',         path: '/setup',         title: 'Setup-Assistent' },
]

export const PATH_TO_PAGE = Object.fromEntries(
  PAGES.flatMap(p => [[p.path, p.id], ...(p.extraPaths || []).map(x => [x, p.id])]))

export const PAGE_TO_PATH = Object.fromEntries(PAGES.map(p => [p.id, p.path]))

/** Seiten-ID zur Adresse; Unbekanntes landet auf der Startseite. */
export const pageForPath = (pathname) => PATH_TO_PAGE[pathname] ?? 'dashboard'

/** Deutscher Titel einer Seite ('' wenn unbekannt) — angezeigt über tr(). */
export const pageTitle = (id) => PAGES.find(p => p.id === id)?.title ?? ''

/** Gruppen der Seitenleiste mit ihren Seiten, in Tabellen-Reihenfolge. */
export const navGroups = () =>
  NAV_GROUPS.map(g => ({ ...g, pages: PAGES.filter(p => p.group === g.id) }))
