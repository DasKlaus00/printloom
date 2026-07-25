# Prompt für Claude Code — Printloom-Update-API zur bestehenden Website hinzufügen

> **So benutzt du diese Datei:** Öffne Claude Code im Verzeichnis deiner Website
> (`printloom.alexsz.de`) und füge den Text ab „--- PROMPT START ---" als Aufgabe ein.
> Der Abschnitt danach ist reine Referenz und muss nicht mitkopiert werden — er ist
> aber im Prompt verlinkt, falls du ihn mitgeben willst.

---

--- PROMPT START ---

## Aufgabe

Erweitere diese bestehende Website um eine **kleine, lesende JSON-API**, aus der sich
die selbst gehostete Steuerungs-Software **Printloom** optionale Inhalte holt:
Hinweise zu bekannten Problemen, Sprachpakete, Drucker-Profile und Bewegungs-Sequenzen.

Wichtig zum Verständnis: Printloom läuft bei den Nutzern **im eigenen Netzwerk** (Docker
oder als Windows-App) und verbindet sich **nur, wenn der Nutzer es ausdrücklich
einschaltet** — die Abfrage ist opt-in und wird vorher mit einem Warnhinweis bestätigt.
Die API muss deshalb:

- **rein lesend** sein (nur `GET`), ohne Anmeldung, ohne Cookies, ohne Tracking,
- **keine** Nutzerdaten annehmen oder auswerten (kein Analytics, keine Zählpixel,
  keine IP-Protokollierung über das hinaus, was dein Webserver ohnehin tut),
- **stabil** bleiben: das unten definierte Schema ist ein Versprechen. Neue Felder
  hinzufügen ist erlaubt, bestehende umbenennen/entfernen **nicht** (sonst brechen
  Installationen, die nicht aktualisiert wurden).

Das Abrufen macht der Printloom-**Server** (Python/httpx), nicht der Browser des
Nutzers. CORS ist daher nicht nötig — schadet aber auch nicht.

## Zu bauen: 3 Endpunkte

### 1. `GET /api/v1/notices.json` — bekannte Probleme & Hinweise

Damit kann ich Nutzer vor einem Fehler warnen, **ohne** eine neue Programmversion zu
veröffentlichen. Antwort:

```json
{
  "notices": [
    {
      "id": "158-camera-p1s",
      "severity": "warning",
      "title": "P1S-Kamera zeigt nur Standbilder",
      "text": "Technisch bedingt (der P1S hat keinen Videostream). Kein Fehler.",
      "versions": ["1.0.157", "1.0.158"],
      "url": "https://printloom.alexsz.de/hinweise/p1s-kamera"
    }
  ]
}
```

Feldregeln (Printloom prüft das streng nach und wirft ungültige Einträge weg):

| Feld | Pflicht | Regel |
|---|---|---|
| `id` | empfohlen | eindeutiger Text, max. 80 Zeichen. Fehlt er, wird der Titel benutzt. |
| `severity` | nein | genau `info`, `warning` oder `critical`. Alles andere wird zu `info`. |
| `title` | **ja** | max. 200 Zeichen. **Ohne Titel wird der Eintrag verworfen.** |
| `text` | nein | max. 2000 Zeichen, Klartext (kein HTML, wird nicht gerendert). |
| `versions` | nein | Liste von Versions-Strings. **Leer/fehlt = gilt für alle Versionen.** Printloom zeigt einen Eintrag nur, wenn die eigene Version enthalten ist. |
| `url` | nein | muss mit `http://` oder `https://` beginnen, sonst wird sie entfernt. |

Maximal 100 Einträge; die Antwort muss **kleiner als 2 MB** sein.

### 2. `GET /api/v1/library/index.json` — Katalog

Nur ein Verzeichnis, **keine** Inhalte:

```json
{
  "items": [
    { "id": "lang-fr", "kind": "language", "name": "Français",
      "description": "Französische Übersetzung", "author": "…", "version": "1.0",
      "path": "languages/fr.json" },
    { "id": "seq-x1c-standard", "kind": "sequence", "name": "X1C · Standard-Halterung",
      "description": "Getesteter Ablauf für X1C mit Magazin", "version": "3",
      "path": "sequences/x1c-standard.json" }
  ]
}
```

| Feld | Pflicht | Regel |
|---|---|---|
| `id` | **ja** | eindeutig über den ganzen Katalog, max. 120 Zeichen |
| `kind` | **ja** | genau `language`, `profile` oder `sequence` — andere Werte werden verworfen |
| `name` | **ja** | Anzeigename, max. 200 Zeichen |
| `path` | **ja** | **relativer** Pfad unter `/api/v1/library/`. Darf **kein** `..` und **kein** `://` enthalten (wird sonst verworfen). |
| `description` / `author` / `version` | nein | Text (1000 / 120 / 40 Zeichen) |

### 3. `GET /api/v1/library/<path>` — ein einzelner Inhalt

`<path>` ist exakt der `path` aus dem Katalog. Beispiel: `path: "languages/fr.json"`
→ `GET /api/v1/library/languages/fr.json`.

Das Format richtet sich nach `kind`:

**`language`** — Sprachpaket:
```json
{
  "code": "fr",
  "name": "Français",
  "strings": { "Speichern": "Enregistrer", "Abbrechen": "Annuler" }
}
```
`code` ist Pflicht, und **entweder** `strings` **oder** `translations` muss ein
nicht-leeres Objekt sein. `strings` bildet den **deutschen Quelltext** auf die
Übersetzung ab (Printloom ist auf Deutsch geschrieben).

**`profile`** — Drucker-/Setup-Profil. Muss mindestens eines dieser Felder haben:
`geometry`, `rack_config`, `name`, `printer`. Am besten so, wie Printloom es selbst
exportiert (Profile-Seite → Export) — dann passt es garantiert.

**`sequence`** — Bewegungsablauf:
```json
{
  "name": "X1C · Standard",
  "description": "Wechsel mit Magazin",
  "steps": [
    { "type": "app_op", "value": "open_door" },
    { "type": "app_op", "value": "eject" },
    { "type": "delay",  "seconds": 3 },
    { "type": "app_op", "value": "grab_magazine" }
  ]
}
```
`steps` muss eine **nicht-leere Liste** sein und **jeder** Schritt braucht ein
`type`-Feld. Gültige `type`-Werte: `macro`, `app_op`, `gcode`, `klipper_gcode`,
`delay`, `send_homing_file`, `wait_homing`, `wait_bambu_idle`, `bambu_move`,
`send_file`, `send_file_fixed`, `wait_print`, `wait_print_failed`, `wait_pause`,
`clear_error`. Bei `app_op` sind für `value` erlaubt: `open_door`, `close_door`,
`move_to_printer`, `eject`, `place`, `grab`, `grab_magazine`, `store`.

⚠ **Sequenzen steuern echte Mechanik.** Veröffentliche nur Abläufe, die du selbst
getestet hast. Printloom zeigt sie dem Nutzer vor dem Übernehmen als Vorschau mit
Warnhinweis und übernimmt **nie** automatisch — aber falsche Koordinaten können
trotzdem Hardware beschädigen.

## Technische Anforderungen

- `Content-Type: application/json` (UTF-8). Bei Erfolg **HTTP 200** — alles andere
  behandelt Printloom als Fehler und benutzt seinen lokalen Zwischenspeicher.
- Antwort **< 2 MB** (Printloom bricht größere Antworten ab).
- Sinnvolle Caching-Header, z. B. `Cache-Control: public, max-age=1800`.
  Printloom cacht selbst 6 Stunden und schickt keine Conditional Requests.
- `HEAD`/`GET` genügen; keine `POST`-Endpunkte für diese drei Routen.
- Die Pfade müssen **genau** so lauten (inkl. `/api/v1/`), da sie in der App
  festverdrahtet sind.

## Pflege-Oberfläche (bitte mitbauen)

Ich will Hinweise und Katalog-Einträge **ohne Deploy** ändern können. Baue dafür das,
was zur bestehenden Website am besten passt:

- Wenn es schon ein Backend/CMS/Admin gibt: dort eine geschützte Seite „Printloom-API"
  mit Formularen für Hinweise (Titel, Schweregrad, Text, betroffene Versionen, Link)
  und für Katalog-Einträge (Datei-Upload + Metadaten).
- Wenn die Website statisch ist: die JSON-Dateien in einem klar benannten Ordner
  (`public/api/v1/...`) ablegen und im README dokumentieren, wie ich sie ändere.

Zusätzlich: eine **Validierung** vor dem Veröffentlichen, die genau die obigen Regeln
prüft (Pflichtfelder, erlaubte `severity`/`kind`-Werte, `path` ohne `..`/`://`,
`steps` nicht leer, jeder Schritt mit `type`). Lieber beim Speichern einen Fehler
zeigen als eine kaputte Datei ausliefern.

## Optional (nur wenn einfach): Diagnose-Upload

Printloom kann ein **Diagnose-ZIP** erzeugen (Konfiguration ohne Zugangsdaten, Logs).
Aktuell lädt der Nutzer es herunter und schickt es mir selbst. Falls du es leicht
einbauen kannst, hätte ich gern:

- `POST /api/v1/diagnostics` (multipart, Feld `file`), max. 20 MB, nur ZIP
- Antwort: `{ "code": "PL-7F3K2" }` — ein kurzer Code, den der Nutzer mir nennt
- Ablage außerhalb des Web-Roots, **nicht** öffentlich abrufbar, Löschung nach 30 Tagen
- Rate-Limit (z. B. 5 Uploads pro IP und Stunde)

Wenn das mehr als eine überschaubare Ergänzung ist: **weglassen** und mir sagen, warum.

## Ausdrücklich NICHT bauen

- Kein Analytics, kein Tracking, keine Zählung von Abrufen pro Installation
- Keine Anmeldung/Registrierung für die drei GET-Endpunkte
- Keine Fernsteuerung, keine Endpunkte, die Befehle an Printloom-Installationen senden
- Keine Speicherung von Drucker- oder Nutzerdaten

## Abschluss

Sag mir am Ende:
1. welche Dateien/Routen du angelegt hast,
2. wie ich Hinweise und Katalog-Einträge pflege (konkrete Schritte),
3. `curl`-Beispiele für alle drei Endpunkte, damit ich sie testen kann,
4. ob du den Diagnose-Upload gebaut hast (und falls nicht, warum).

--- PROMPT END ---

---

## Referenz: wie Printloom das benutzt (nicht Teil der Prompt)

- Freischaltung: **System → Online-Dienste**. Standardmäßig ist **alles aus**; ohne
  Zustimmung + Schalter macht das Backend **keinen einzigen** externen Request.
- Client-Seite: [`backend/app/services/online.py`](../backend/app/services/online.py)
  (Einstellungen, Cache, Schema-Prüfung) und
  [`backend/app/routers/online.py`](../backend/app/routers/online.py) (Endpunkte).
- Cache: 6 Stunden in `db/online_cache.json`. Bei Netz-/Serverfehler zeigt die App den
  letzten Stand plus Fehlertext — nie eine leere Seite.
- Server-Adresse: `online_settings.json` → `server_url`
  (Standard `https://printloom.alexsz.de`).
- Die Update-Prüfung selbst geht weiter an **GitHub/ghcr**, nicht an diese Website —
  sie hängt nur am selben Opt-in-Schalter.
