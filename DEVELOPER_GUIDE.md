# Printloom — Entwickler-Leitfaden

Für alle, die am Code mitarbeiten. Nutzer-Doku steht in der [README](README.md),
Einrichtung eines Servers in [docs/DEBIAN_SETUP.md](docs/DEBIAN_SETUP.md), die
Installation ohne Docker in [docs/INSTALL-NATIVE.md](docs/INSTALL-NATIVE.md).

Sprache im Projekt ist **Deutsch**: Kommentare, Commits, Oberfläche (Englisch über
`tr()`). Changelog zweisprachig.

## Inhalt

1. [Aufbau](#aufbau)
2. [Lokal entwickeln](#lokal-entwickeln)
3. [Arbeitsweise und Releases](#arbeitsweise-und-releases)
4. [Regeln im Code](#regeln-im-code)
5. [Testing](#testing)
6. [Sprachen (i18n)](#sprachen-i18n)
7. [Design](#design)

---

## Aufbau

```
backend/                 FastAPI (Python 3.11), SQLite + JSON-Dateien unter db/
  app/main.py            App, Router, Herkunfts-Sperre, Auslieferung des Frontends
  app/paths.py           Datenordner je Laufzeit (Docker /app, nativ, Dev backend/)
  app/routers/           HTTP-Endpunkte
    autofarm.py          Farm-Zyklus (globaler _farm), Warteschlange, Sequenzen
    printer.py           Bambu-Drucker: Status, Kamera, Einstellungen
    control.py           OTTOeject: Bewegung, Geometrie, Notaus-Sperre
    system.py            Version, Update, Backup, Diagnose
    rack_manager.py …    Regal, Dateien, Projekte, Profile, Filamente, Push
  app/services/          Logik ohne HTTP — hier gehört Neues hin
    bambu_manager.py     EINE persistente MQTT-Verbindung je Drucker
    ottoeject_motion.py  G-code-Erzeugung, Geometrie
    print_file.py        .3mf/.gcode lesen (Platten, Höhe, Filament, AMS-Zuordnung)
    ams_match.py         AMS-Abgleich (Material + Farbe)
    rack_store.py        Regal-Datei mit Sperre
    credentials.py       Was ist ein Geheimnis, Backup-Verschlüsselung
    updater.py           Update über den Docker-Socket (Helfer-Container)
  tests/                 pytest
frontend/                React 18 + Vite + Tailwind
  src/pages/             Seiten
  src/components/        Navigation, Layout-Bausteine
  src/services/          api.js, i18n.js, theme.js, Rechenlogik
desktop/                 Windows-Paket (PyInstaller + Inno Setup)
scripts/                 Native Linux-Installation (install-/update-native.sh)
```

Datenordner: `PRINTLOOM_DATA_DIR`, sonst `/app` (Docker) bzw. `backend/` (Dev).
Die Tests setzen ihn in `backend/tests/conftest.py` auf einen Temp-Ordner.

## Lokal entwickeln

```bash
# Backend auf :8000
cd backend
python -m venv venv && source venv/bin/activate     # Windows: venv\Scripts\activate
pip install -r requirements.txt -r requirements-dev.txt
python -m uvicorn app.main:app --port 8000

# Frontend auf :3000 (Vite leitet /api an :8000 weiter)
cd frontend
npm install
npx vite --port 3000
```

Python 3.11 oder 3.12 nehmen — mit neueren Versionen gibt es für einige Pakete
(pydantic-core) noch keine fertigen Wheels.

Image selbst bauen: `docker build -t printloom:dev .`, dann in `docker-compose.yml`
`image: printloom:dev` eintragen.

## Arbeitsweise und Releases

**Kanäle.** `beta` → Image `:beta`, `main` + Tags `vX.Y.Z` → `:latest`. Jeder Push
auf `beta` startet `.github/workflows/docker-publish.yml`: erst die Tests
(`tests.yml`), dann der Multi-Arch-Build (amd64 + arm64), 3–8 Minuten.

**Änderungen** kommen über einen Zweig und einen Pull Request nach `beta`:

```bash
git switch -c claude/<thema> beta      # bzw. <name>/<thema>
# … Änderungen, Tests …
git push -u printloom claude/<thema>
# Pull Request nach beta öffnen — tests.yml läuft am PR
```

**Jedes Release:**

1. Version in `backend/version.txt` (ohne Zeilenumbruch am Ende) und
   `frontend/src/version.js`.
2. Eintrag oben in `frontend/src/changelog.js`, `de` und `en`, für Nutzer geschrieben.
3. Englische Fassung jedes neuen `tr('…')`-Textes in `frontend/src/services/i18n.js`.
4. Commit `vX.Y.Z — <Kurzbeschreibung>`, Stichpunkte darunter.
5. Backend-Tests, Frontend-Tests, `npm run lint:ci`, `npm run build` — alles grün.

**Stabil machen** — erst nach einem Test auf der echten Farm: GitHub → Actions →
**„Promote (Beta → Stabil)"** → Version eingeben. Der Workflow setzt den Tag,
spult `main` vor und taggt das getestete Beta-Image als `:latest` um (kein
Neubau). Er läuft nur, wenn `promote.yml` schon auf `main` liegt — beim ersten
Mal also noch von Hand:

```bash
git tag vX.Y.Z <beta-commit> && git push printloom vX.Y.Z
git push printloom beta:main
```

**Versionsanzeige.** Die Version steht als Label `org.opencontainers.image.version`
im Image. Die App liest es für „v1.1.x verfügbar" und meldet „wird gebaut", solange
`version.txt` im Branch neuer ist als das Image.

## Regeln im Code

- Jedes Feature bringt Tests mit. Tests nutzen die **echte Datenform** — ein
  Platzhalter mit falscher Form hat in v1.1.37 einen HTTP-500 verdeckt.
- Keine neuen stillen `except Exception: pass` — behandeln oder loggen.
- Kommentare erklären das WARUM.
- Eine Quelle je Zahl: kein zweiter Ort für denselben Wert.
- Die Bewegung bemessen, nicht den Ruhezustand. Unbekannt ist nicht Null.
- Alles, was ins Internet geht, ist Opt-in mit Hinweis (`services/online.py`).
  Keine Telemetrie.
- Heruntergeladene Sequenzen und Profile nie automatisch anwenden — sie bewegen
  Hardware.
- Keine Geheimnisse in Logs, Diagnose-Paket oder Backup ohne ausdrücklichen
  Wunsch. Was ein Geheimnis ist, entscheidet `services/credentials.py`.
- Printloom hat keine eigene Anmeldung (Reverse-Proxy mit Anmeldung davor, z. B.
  authentik). Deshalb: kein CORS, Oberfläche und API vom selben Server, und
  schreibende Anfragen von fremden Seiten sperrt `main.py` über `Sec-Fetch-Site`.
- Windows-Checkout: Dateien mit CRLF (autocrlf), `.sh` immer LF (`.gitattributes`).

---

## Testing

Beide Suiten laufen bei jedem Pull Request (`tests.yml`) und vor jedem Image-Build
(`docker-publish.yml` ruft `tests.yml` auf). Lokal:

```bash
# Backend (pytest)
cd backend
python -m pytest -q
python -m pyflakes app | grep "undefined name"      # der CI-Wächter

# Nur eine Datei / ein Test
python -m pytest tests/test_geometry_check.py -q
python -m pytest -k "magazin" -q

# Frontend
cd frontend
npm test              # vitest
npm run lint:ci       # nur Absturz-Regeln
npm run build
```

### Was getestet wird — und was nicht

Die Suite deckt bewusst die Stellen ab, an denen ein Fehler **Hardware bewegt
oder Zusagen bricht**, nicht die Menge an Code:

| Datei | Warum sie existiert |
|---|---|
| `test_geometry_check.py` | Bewegung außerhalb der Achse wird nicht gesendet; ohne bekannte Achsgrenzen wird nichts nach oben blockiert |
| `test_plate_source.py`   | Griff-Reihenfolge mit/ohne Magazin + reservierte Quell-Fächer (Kollisionsschutz) |
| `test_rack_logic.py` / `test_slotlogic.py` | Fach-Belegung nach Objekthöhe, Betriebszeiten, Start-Countdown |
| `test_notaus_sperre.py` / `test_emergency_stop.py` | Nach dem Notaus bewegt sich nichts, bis man freigibt |
| `test_online.py`         | OHNE Zustimmung + Schalter geht KEIN Request nach außen |
| `test_backup.py`         | Backup vollständig; Zugangsdaten nur auf Wunsch, verschlüsselt; Einspielen löscht keine |
| `test_diagnostics.py`    | keine Geheimnisse im Diagnose-ZIP |
| `test_http_safety.py`    | keine CORS-Freigabe, fremde Seiten dürfen nicht schreiben |
| `test_update_check.py`   | Version aus dem Image-Label, „wird gebaut", Update ohne Docker-Socket |
| `test_camera.py` / `test_camera_hub.py` | richtiges Kamera-Protokoll je Modell; ein Producer je Drucker |
| `test_printer_models.py` | Modell-Erkennung: lieber „unbekannt" als falsch |
| `test_bambu_settings.py` | Report lesen (unbekannt ≠ aus) + MQTT-Befehle |
| `test_migration.py`      | neue Spalten in bestehender DB (sonst „no such column" beim Nutzer) |

### Konventionen

- **Reine Logik zuerst.** Was ohne FastAPI/MQTT läuft, gehört in einen Service
  (`app/services/…`) und wird direkt getestet.
- **Fehlende Abhängigkeiten überspringen, nicht crashen:** Tests, die FastAPI
  brauchen, beginnen mit `pytest.importorskip("fastapi")`.
- **Kein Netz, keine echten Pfade.** Externe Aufrufe werden per `monkeypatch`
  ersetzt (siehe `FakeHttpx` in `test_online.py`), Dateien liegen in `tmp_path`.
- **Der Docstring sagt, WARUM der Test da ist** — idealerweise der konkrete
  Fehlerfall, den er verhindert. Ein Test ohne Schadensbild ist meist überflüssig.

### Frontend

Vitest liegt in `frontend/` (`npm test` = `vitest run`, `npm run test:watch`).
Getestet werden vor allem die Rechenteile (`src/services/…`), nicht das Markup.

`src/services/i18n.test.js` ist ein Wächter, kein Logik-Test: er liest die
Quelldateien und schlägt fehl, sobald ein übersetzbarer Text ohne englische
Fassung dazukommt.

---

## Sprachen (i18n)

Die App ist auf **Deutsch geschrieben**; der deutsche Quelltext IST der
Übersetzungs-Schlüssel. `tr('Fach {0}', n)` gibt in einer anderen Sprache die
hinterlegte Fassung zurück und sonst den deutschen Text — ein vergessener
Eintrag macht also nichts kaputt, er bleibt nur deutsch. Genau das macht ihn
unsichtbar, deshalb der Test.

**Regeln**

- Jeder sichtbare Text läuft durch `tr(…)`. Auch `title=`, `placeholder=`,
  `alert`/Toast und Fehlermeldungen.
- `tr` gibt es zweimal: als Rückgabe von `useLanguage()` (in Komponenten) und
  als freie Funktion `import { tr } from './services/i18n'` — für Modul-Konstanten,
  Service-Dateien und Klassen-Komponenten. Beide sind dasselbe.
- **Gespeicherte Daten werden nicht übersetzt.** Sequenz-Bezeichnungen liegen
  deutsch in `sequences.json`; übersetzt wird nur die ANZEIGE (`tr(step.label)`),
  das Eingabefeld zeigt weiter den echten Wert.
- Datum/Uhrzeit über `locale()` formatieren, nie mit festem `'de-DE'`.
- Neue englische Einträge kommen in `EN_STRINGS` in
  `frontend/src/services/i18n.js`. **Keine doppelten Schlüssel** — bei einem
  Duplikat gewinnt still der letzte.

**Backend-Meldungen**

Das Backend kennt die eingestellte Sprache nicht (die steht im Browser). Texte,
die in der Oberfläche landen, gehen deshalb als **Vorlage + Werte** raus:

```python
from app.services.geometry_check import problem
problem("too_close", "warning",
        "„{0}“ und „{1}“ stehen {2} mm auseinander", [a, b, d])
```

`message` bleibt der fertige deutsche Satz (Logs, ältere Clients), `template`
und `params` sind das Übersetzbare. Die Oberfläche rendert das mit
`trProblem(p)`; Werte, die selbst Text sind, laufen dabei nochmal durch `tr()`.

Fehler, auf die die Oberfläche reagieren muss, kommen als fester Code im
`detail` (`FREMDE_HERKUNFT`, `BACKUP_PASSWORT_FALSCH`) statt als Satz, den
das Frontend per Muster erkennen müsste.

Nicht übersetzt ist bewusst das **Farm-Log** (`farm_status.log`): technische
Ablaufprotokolle mit hunderten Zeilen, die beim Suchen nach Fehlern helfen —
dafür wäre eine Vorlage je Zeile mehr Last als Nutzen.

---

## Design

Seit v1.1.36 im Stil der „Prüfplanung". Farben kommen aus CSS-Variablen:
`tailwind.config.js` lenkt `surface`, `blue` (Akzent Marineblau), `red`, `emerald`,
`amber`, `violet` auf Skalen um. Werte nicht in `index.css` von Hand ändern, sondern
in `frontend/scripts/theme_vars.py`, dann `python scripts/theme_vars.py`.

- surface: 950 Seite · 900 Mulde · 800 Block · 700 Linie · 500/400 gedämpfte Schrift · 100 Text
- Klassen: `card`, `section-label`, `btn btn-primary|btn-ghost|btn-secondary|btn-danger|btn-success`,
  `badge-*`, `pill`, `segmented`, `rack-slot-*`
- Darstellung Hell / Dunkel / System (`services/theme.js`), Standard System. Gespeichert
  wird nur eine ausdrückliche Wahl; das Vorab-Skript in `index.html` hat dieselbe Logik.
