# Printloom — Projektwissen für Claude Code

Selbst gehostete Steuerung für eine unbeaufsichtigte 3D-Druckfarm: ein Bambu-Lab-Drucker
(getestet X1C) plus OTTOeject-Auswurfroboter (Klipper/Moonraker auf BTT SKR Pico).
Warteschlange → drucken → Platte auswerfen → ins Regal → nächste Platte → nächster Job.
Sprache im Projekt: **Deutsch** (Code-Kommentare, Commits, Changelog zweisprachig de/en).

## Repo und Kanäle

- GitHub: `DasKlaus00/printloom` (öffentlich, AGPL-3.0). Lokales Remote heißt `printloom`.
- `beta` → Image `ghcr.io/dasklaus00/printloom:beta` (Beta-Kanal). Änderungen kommen über
  einen Zweig `claude/<thema>` und einen Pull Request nach `beta` (Tests laufen am PR).
- `main` + Tags `vX.Y.Z` → `:latest` (stabiler Kanal). Nur nach Test auf der echten Farm:
  Actions → „Promote (Beta → Stabil)" (`promote.yml`) — setzt den Tag, spult `main` vor
  und taggt das getestete Beta-Image um. Läuft erst, wenn `promote.yml` auf `main` liegt;
  bis dahin von Hand (`git tag vX.Y.Z && git push printloom vX.Y.Z`, `git push printloom beta:main`).
- Jeder Push auf `beta`/`main` startet `.github/workflows/docker-publish.yml`:
  erst Tests (`tests.yml`), dann Multi-Arch-Build (amd64 + arm64), ca. 3–8 Minuten.
  Die Version steht als Label im Image; solange `version.txt` neuer ist als das Image,
  zeigt die App „wird gebaut".
- Remote `alt-bottomat3e` = altes Vorgänger-Repo (Ottomat), nur Historie, nicht benutzen.

## Aufbau

- `backend/` — FastAPI (Python 3.11), SQLite + JSON-Dateien unter `db/`.
  Große Brocken: `app/routers/autofarm.py` (~4 150 Zeilen, Farm-Zyklus, globaler `_farm`),
  `app/services/ottoeject_motion.py` (G-code-Erzeugung, Geometrie), `routers/printer.py`,
  `routers/system.py` (Version, Update, Backup, Diagnose).
- `frontend/` — React 18 + Vite + Tailwind. Seiten in `src/pages/`, Navigation in
  `src/components/Navigation.jsx`, Layout/Kopfzeile in `src/App.jsx`.
- `desktop/`, `scripts/install-native.sh` — native Windows-/Linux-Varianten (kaum genutzt).
- Datenordner: `PRINTLOOM_DATA_DIR` (sonst Docker `/app`, Dev `backend/`). Tests setzen
  ihn in `backend/tests/conftest.py` auf einen Temp-Ordner — nie echte Daten anfassen.

## Befehle

```bash
# Backend
cd backend && python -m pytest -q
cd backend && python -m pyflakes app | grep "undefined name"   # CI-Wächter
# Frontend
cd frontend && npm test            # vitest
cd frontend && npm run lint:ci     # nur Absturz-Regeln; 16 bekannte Warnungen sind ok
cd frontend && npm run build
# Dev: Backend auf :8000, Vite auf :3000 (Proxy /api → 8000)
cd backend && python -m uvicorn app.main:app --port 8000
cd frontend && npx vite --port 3000
```

## Jedes Release

1. Version in `backend/version.txt` (OHNE Zeilenumbruch am Ende) und `frontend/src/version.js`.
2. Eintrag oben in `frontend/src/changelog.js`, `de` und `en`, für Nutzer geschrieben.
3. Jeder neue `tr('…')`-Text braucht die englische Fassung in `frontend/src/services/i18n.js`
   (der Test `i18n.test.js` schlägt sonst fehl).
4. Commit-Nachricht: `vX.Y.Z — <Kurzbeschreibung>` auf Deutsch, Stichpunkte darunter.
5. Backend-Tests, Frontend-Tests, `lint:ci`, Build — alles grün, dann Zweig pushen und
   Pull Request nach `beta`.

## Design (seit v1.1.36, Stil der „Prüfplanung")

- Farben kommen aus CSS-Variablen: `tailwind.config.js` lenkt `surface`, `blue` (= Akzent
  Marineblau), `red`, `emerald`, `amber`, `violet` und Verwandte auf Skalen um.
  Werte NICHT in `index.css` von Hand ändern, sondern in `frontend/scripts/theme_vars.py`,
  dann `python scripts/theme_vars.py`.
- surface: 950 Seite · 900 Mulde · 800 Block · 700 Linie · 500/400 gedämpfte Schrift · 100 Text.
  Status: 900/950 Tönung (Hintergrund), 700/800 Rahmen, 600 Vollton mit weißer Schrift, 300/400 Schrift.
- Klassen: `card`, `section-label` (Block-Überschrift), `btn btn-primary|btn-ghost|btn-secondary|
  btn-danger|btn-success`, `badge-*`, `pill`, `segmented`, `rack-slot-*`.
  Seitenüberschrift: `text-[1.45rem] font-semibold text-surface-100`.
- Darstellung: Hell / Dunkel / System (`services/theme.js`), Standard **System**.
  Gespeichert wird nur eine ausdrückliche Wahl (`printloom_theme_choice`); Vorab-Skript in
  `index.html` hat dieselbe Logik — beide zusammen ändern.

## Regeln, die im Code gelten

- Jedes Feature bringt Tests mit. Tests nutzen die **echte Datenform** — ein Platzhalter mit
  falscher Form hat in v1.1.37 einen HTTP-500 im Stresstest verdeckt
  (`_farm_printer()` liefert die Block-ID, nicht den Block).
- Keine neuen stillen `except Exception: pass` — behandeln oder loggen.
- Kommentare erklären das WARUM.
- Eine Quelle je Zahl (keine zweite Stelle für denselben Wert).
- Die Bewegung bemessen, nicht den Ruhezustand. Unbekannt ist nicht Null.
- Alles, was ins Internet geht, ist Opt-in mit Hinweis. Keine Telemetrie.
- Keine eigene Anmeldung — die läuft am Reverse-Proxy (authentik). Kein CORS; schreibende
  Anfragen fremder Seiten sperrt `main.py` über `Sec-Fetch-Site`.
- Zugangsdaten nie in Logs, Diagnose-Paket oder Backup ohne ausdrücklichen Wunsch. Was
  ein Geheimnis ist, entscheidet `services/credentials.py`.
- Heruntergeladene Sequenzen/Profile nie automatisch anwenden — sie bewegen Hardware.
- Windows-Checkout: Dateien mit CRLF (autocrlf). `.sh` immer LF (`.gitattributes`).
