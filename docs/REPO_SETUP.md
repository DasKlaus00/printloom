# Printloom — frisches öffentliches Repo anlegen (wenn der Trockentest passt)

Ziel: ein **sauberes** Repo `DasKlaus00/printloom` mit **einem** Initial-Commit
(kein Altverlauf, keine Zwischenversionen), Branches **`main`** + **`beta`**,
und automatischen Image-Builds nach ghcr.

> **Erst NACH dem Trockentest ausführen.** Diese Schritte laden Code hoch.

---

## 1. Repo auf GitHub anlegen
- Neues Repo: **`printloom`** unter dem Account `DasKlaus00`.
- **Leer** lassen (kein README/License/.gitignore von GitHub — wir bringen alles mit).
- Sichtbarkeit: **zunächst privat** (so können wir nach dem Push noch prüfen, dass
  nichts Privates drin ist), später auf **public** stellen.

## 2. Sauberen Initial-Commit erzeugen (ohne Altverlauf)
Im vorbereiteten Projektordner:

```bash
cd ~/printloom            # bzw. der Ordner mit dem vorbereiteten Code

# Sicherstellen, dass keine lokale Privatdatei mitgeht (sind in .gitignore,
# hier nur zur Kontrolle):
git status --ignored --short | grep -E '\.env$|docker-compose\.prod\.yml$|backend/db/|backend/uploads/' || true

# Frischen Verlauf anlegen
rm -rf .git
git init
git add -A
git status            # PRÜFEN: keine .env, kein docker-compose.prod.yml, keine *.db,
                      # keine backend/db|uploads-Inhalte (außer macro_configs.json)
git commit -m "Printloom 1.0.0 — initial public release"
git branch -M main
git remote add origin https://github.com/DasKlaus00/printloom.git
git push -u origin main
```

## 3. Beta-Branch anlegen
```bash
git branch beta
git push -u origin beta
```

## 4. GitHub-Einstellungen
- **Actions aktivieren** (falls nachgefragt). Der Workflow
  `.github/workflows/docker-publish.yml` baut bei jedem Push:
  - `main` → `ghcr.io/dasklaus00/printloom:latest` (+ `:main`)
  - `beta` → `ghcr.io/dasklaus00/printloom:beta`
  - Tag `vX.Y.Z` → `:X.Y.Z`
- Nach dem ersten Build: **Package-Sichtbarkeit** auf **Public** stellen
  (GitHub → Profil → Packages → printloom → Package settings → Change visibility),
  dann braucht niemand ein Token zum Ziehen.
- Wenn alles geprüft ist: **Repo-Sichtbarkeit auf Public** (Settings → General → Danger Zone).

## 5. Lizenz/Branding prüfen
- `LICENSE` = AGPL-3.0 (liegt bei). In der „How to apply"-Sektion ganz unten ist nur
  der generische Vorlagentext — optional Jahr/Name eintragen.
- Kein `ottomat`/`bottomat3e` mehr im Code (nur interne localStorage-Keys
  `printloom_*` und der Marktplatz-Token-Präfix `om4d_` bleiben — beides bewusst).

## Branch-Strategie (für später)
- **Entwicklung** auf `beta` → erzeugt `:beta`, im WebUI als Beta-Kanal testbar.
- Wenn stabil: `beta` → `main` mergen → erzeugt `:latest`.
- Release markieren: `git tag vX.Y.Z && git push origin vX.Y.Z`
  (vorher `backend/version.txt` **und** `frontend/src/version.js` hochzählen —
  davon hängt die In-App-Versionsanzeige + der Update-Checker ab).
