# Printloom — Installation auf Proxmox LXC

Diese Anleitung beschreibt die vollständige Installation von Printloom auf einem
Proxmox-Server als LXC-Container mit Docker, inklusive automatischer OTA-Updates via GitHub.

---

## Voraussetzungen

- Proxmox VE 7.x oder 8.x
- Internetzugang auf dem Proxmox-Host
- GitHub-Account (kostenlos)
- Das Printloom-Repository auf GitHub (z. B. `deinname/printloom`)

---

## Schritt 1 — GitHub Repository einrichten

### 1.1 Repo erstellen

1. Gehe auf [github.com/new](https://github.com/new)
2. Name: `printloom` (oder beliebig)
3. Sichtbarkeit: **Public** (für kostenlose GitHub Container Registry)
4. Erstellen

### 1.2 Code pushen

Auf deinem Entwicklungs-PC (wo der Code liegt):

```bash
cd /path/to/printloom
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/DasKlaus00/printloom.git
git push -u origin main
```

### 1.3 GitHub Actions aktivieren

GitHub Actions ist automatisch aktiv. Der Workflow unter `.github/workflows/docker-publish.yml`
baut das Docker-Image bei jedem Push auf `main` und veröffentlicht es unter:

```
ghcr.io/dasklaus00/printloom:latest
```

**Ersten Build überprüfen:**
- GitHub → Repository → Tab "Actions" → "Build & Publish Docker Image"
- Muss grün werden (ca. 3–5 Minuten)

### 1.4 GitHub Personal Access Token erstellen

Der Token wird für zwei Dinge benötigt:
- Docker-Image von GHCR pullen (privates Repo)
- Versionscheck in der System-Seite

1. GitHub → Profil (oben rechts) → **Settings**
2. **Developer settings** → **Personal access tokens** → **Tokens (classic)**
3. **Generate new token (classic)**
   - Note: `printloom-deploy`
   - Expiration: nach Bedarf (z. B. 1 Jahr)
   - Scopes: **`read:packages`** + **`repo`** aktivieren
4. Token kopieren und sicher speichern — wird in Schritt 4 benötigt

---

## Schritt 2 — Proxmox LXC erstellen

### 2.1 LXC-Template herunterladen

In der Proxmox-Weboberfläche:
1. **Storage** (z. B. `local`) → **CT Templates** → **Templates**
2. `ubuntu-22.04-standard` herunterladen

### 2.2 LXC-Container erstellen

1. **Create CT** → ID vergeben (z. B. `200`)
2. **Template:** `ubuntu-22.04-standard`
3. **Disk:** mind. 10 GB (empfohlen: 20 GB)
4. **CPU:** mind. 2 Cores
5. **RAM:** mind. 1024 MB (empfohlen: 2048 MB)
6. **Netzwerk:** DHCP oder feste IP vergeben
7. **Fertigstellen** → Container starten

### 2.3 LXC für Docker vorbereiten

Im Proxmox-Shell des LXC oder über SSH:

```bash
# Nesting aktivieren (für Docker innerhalb LXC)
# → Proxmox Weboberfläche → Container → Options → Features → "Nesting" aktivieren
# Container danach neu starten
```

---

## Schritt 3 — Docker installieren

Im LXC-Container (SSH oder Proxmox Console):

```bash
# System aktualisieren
apt update && apt upgrade -y

# Abhängigkeiten
apt install -y ca-certificates curl gnupg

# Docker GPG-Key hinzufügen
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

# Docker Repository hinzufügen
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | tee /etc/apt/sources.list.d/docker.list > /dev/null

# Docker installieren
apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Docker starten und autostart aktivieren
systemctl enable --now docker

# Testen
docker run --rm hello-world
```

---

## Schritt 4 — Printloom deployen

### 4.1 Deployment-Verzeichnis erstellen

```bash
mkdir -p /opt/printloom/{uploads,db}
cd /opt/printloom
```

### 4.2 Konfigurationsdatei erstellen

```bash
cat > .env << 'EOF'
# Port (Standard 8000)
PORT=8000

# GitHub Token für Versionscheck (aus Schritt 1.4) — optional, aber empfohlen
GITHUB_TOKEN=DEIN_TOKEN_HIER
EOF
```

### 4.3 docker-compose.prod.yml herunterladen

```bash
curl -o docker-compose.prod.yml \
  https://raw.githubusercontent.com/DasKlaus00/printloom/main/docker-compose.prod.yml
```

Oder manuell erstellen — Inhalt aus dem Repository kopieren.

### 4.4 Bei GHCR einloggen (Privates Repo — einmalig)

```bash
# TOKEN = der Personal Access Token aus Schritt 1.4
echo "DEIN_TOKEN" | docker login ghcr.io -u DasKlaus00 --password-stdin
```

Dieser Login bleibt gespeichert. Watchtower nutzt ihn automatisch für automatische Updates.

### 4.5 Container starten

```bash
# Starten
docker compose -f docker-compose.prod.yml up -d

# Status prüfen
docker compose -f docker-compose.prod.yml ps
docker logs printloom-app
```

### 4.6 Weboberfläche aufrufen

```
http://LXC-IP-ADRESSE:8000
```

---

## Schritt 5 — Printloom konfigurieren

1. **Configuration** → **Add Device**
   - **Bambu Lab X1C:** IP-Adresse, Access Code (aus Bambulab-App: Gerät → Netzwerk)
   - **OTTOeject (Klipper):** IP-Adresse des Raspberry Pi, Port `7125`

2. **Rack Manager:** Anzahl Fächer und Höhe einstellen

3. **File Library:** Erste `.3mf`-Datei hochladen und testen

---

## Schritt 6 — OTA Updates

### Per Knopfdruck in der App (empfohlen)

Watchtower ist bereits im `docker-compose.prod.yml` enthalten und wartet auf einen manuellen Trigger.

```
Printloom → System → "Auf Updates prüfen" → "Update installieren"
```

**Ablauf:**
1. Die App sendet einen HTTP-Request an Watchtower
2. Watchtower zieht das neue Image von ghcr.io
3. Alter Container wird gestoppt, neuer gestartet
4. Seite lädt automatisch neu
5. Datenbankdateien und Uploads bleiben erhalten (Volumes)

### Manuell (ohne Watchtower)

```bash
cd /opt/printloom
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

---

## Schritt 7 — Beta-Kanal

Neue Features landen zuerst im Beta-Image (`:beta`), bevor sie auf Latest kommen.

### Umstellen auf Beta

In der App: **System → Release-Kanal → Beta** → **"Beta aktualisieren"** drücken.

Oder manuell — in der `docker-compose.prod.yml` das Tag ändern:

```yaml
image: ghcr.io/dasklaus00/printloom:beta   # statt :latest
```

```bash
docker compose -f docker-compose.prod.yml up -d --pull always
```

Zurück auf Latest: Tag wieder auf `:latest` setzen und Container neu starten.

---

## Troubleshooting

### Logs ansehen
```bash
docker logs printloom-app --tail 50 -f
docker logs printloom-watchtower --tail 20
```

### Container neu starten
```bash
docker compose -f docker-compose.prod.yml restart printloom
```

### Daten zurücksetzen (Achtung: löscht alle Jobs und Dateien)
```bash
docker compose -f docker-compose.prod.yml down
rm -rf /opt/printloom/db/* /opt/printloom/uploads/*
docker compose -f docker-compose.prod.yml up -d
```

### Image manuell aktualisieren
```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

### Autostart nach Reboot sicherstellen
```bash
# Docker Daemon
systemctl enable docker

# Container laufen mit restart: unless-stopped
# → starten automatisch nach Neustart
```

---

## Verzeichnisstruktur auf dem Server

```
/opt/printloom/
├── docker-compose.prod.yml   # Deployment-Konfiguration
├── .env                      # GitHub Repo + Port
├── update.sh                 # Manuelles Update-Script
├── uploads/                  # Hochgeladene .3mf/.gcode Dateien (persistent)
└── db/                       # Datenbank + Rack-Status (persistent)
    ├── printloom.db
    ├── rack_slots.json
    └── print_history.json
```

---

## Update-Flow Übersicht

```
Entwicklung (Windows/Mac)
        │
        │  git push origin main
        ▼
GitHub Repository
        │
        │  GitHub Actions (.github/workflows/docker-publish.yml)
        │  → Docker Image bauen
        │  → Push nach ghcr.io/dasklaus00/printloom:latest
        ▼
GitHub Container Registry (ghcr.io)
        │
        │  "Update installieren"-Button in der App
        │  → HTTP-Request an Watchtower
        │  → Watchtower zieht neues Image
        ▼
Proxmox LXC → Docker → printloom-app (neu gestartet)
        │
        ▼
http://LXC-IP:8000
```
