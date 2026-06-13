# Printloom auf einem frischen Debian-Server einrichten

Schritt-für-Schritt von der **nackten Debian-Installation** bis zur laufenden
Printloom-Instanz — inklusive Docker und allen Abhängigkeiten. Getestet für
**Debian 12 (bookworm)**; funktioniert sinngemäß auch in einem Proxmox-LXC und
auf Ubuntu 22.04/24.04.

> Alle Befehle als normaler Benutzer mit `sudo`. Wo `sudo` fehlt, läuft der Befehl
> als root (z. B. im LXC-Konsolen-Login).

---

## 0. Voraussetzungen

- Debian 12, frisch installiert, mit Internetzugang.
- Ein Benutzerkonto mit `sudo`-Rechten.
- Die IP des Servers im LAN (z. B. `192.168.1.20`) — gleiches Netz wie X1C + OTTOeject.

Prüfen, dass du online bist und welche IP der Server hat:

```bash
ip -4 addr show | grep inet
ping -c2 github.com
```

---

## 1. System aktualisieren & Basis-Pakete

```bash
sudo apt update && sudo apt -y upgrade
sudo apt -y install ca-certificates curl gnupg git ufw
```

---

## 2. Docker Engine + Compose-Plugin installieren (offizielles Repo)

Nicht das alte `docker.io`-Paket aus Debian nehmen — wir nutzen die offizielle
Docker-Quelle (aktuell, inkl. `docker compose` v2).

```bash
# Docker-GPG-Schlüssel
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/debian/gpg \
  | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# Docker-APT-Quelle (nutzt automatisch deinen Debian-Codenamen, z. B. bookworm)
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
  https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Installieren
sudo apt update
sudo apt -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Dienst aktivieren + starten
sudo systemctl enable --now docker
```

> **Ubuntu statt Debian?** In den beiden `curl`/`echo`-Befehlen oben
> `linux/debian` durch `linux/ubuntu` ersetzen.

### Docker ohne `sudo` benutzen (empfohlen)

```bash
sudo usermod -aG docker $USER
# Danach einmal ab- und wieder anmelden (oder `newgrp docker`), dann testen:
docker run --rm hello-world
```

Du solltest „Hello from Docker!" sehen. Version prüfen:

```bash
docker --version
docker compose version
```

---

## 3. Printloom holen

```bash
cd ~
git clone https://github.com/DasKlaus00/printloom.git
cd printloom
```

---

## 4. Konfigurieren

```bash
cp .env.example .env
cp docker-compose.prod.yml.example docker-compose.prod.yml
nano .env
```

In der `.env` mindestens setzen:

- `WATCHTOWER_TOKEN=` → **einen eigenen geheimen Wert** (frei wählbar, z. B. mit
  `openssl rand -hex 16` erzeugen). Muss in beiden Compose-Diensten gleich sein —
  das erledigt die Vorlage automatisch über die Variable.
- `PRINTLOOM_CHANNEL=latest` (stabil) **oder** `beta`. Lässt sich später auch im
  WebUI umschalten.
- `PORT=8000` (Standard; nur ändern, wenn 8000 belegt ist).
- `GITHUB_TOKEN=` leer lassen (nur nötig, falls das ghcr-Package privat ist).

Speichern: `Strg+O`, `Enter`, `Strg+X`.

---

## 5. Starten

```bash
docker compose -f docker-compose.prod.yml up -d
```

Beim ersten Start lädt Docker das Image aus ghcr (kann 1–2 Min dauern). Status:

```bash
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f printloom   # Strg+C zum Beenden
```

Sobald der Container `healthy` ist:

**→ http://<server-ip>:8000** im Browser öffnen** (z. B. http://192.168.1.20:8000).**

---

## 6. Firewall (optional, empfohlen)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8000/tcp
sudo ufw enable
sudo ufw status
```

---

## 7. Erste Einrichtung im WebUI

Alles Weitere passiert in der Oberfläche (keine Configs auf der Konsole):

1. **Konfiguration → Drucker:** X1C hinzufügen — IP, Seriennummer, **Access-Code**
   (am Drucker: Einstellungen → WLAN). „LAN Mode Liveview" am Drucker einschalten.
2. **Konfiguration → OTTOeject:** Moonraker-IP + Port (`7125`) des Ejectors.
3. **Rack Manager:** Fächer/Magazin einrichten.
4. **Konfiguration → Kameras** (optional): externe Webcam-URL und/oder die
   X1C-Kamera über Home Assistant (HA-URL, Entity, Long-Lived-Token).

Geräte-Daten (Access-Code, Tokens) liegen nur im gemounteten `db/`-Volume —
nie im Image oder in git.

---

## 8. Updates

- **Im WebUI (System-Seite):** Kanal **Latest/Beta** wählen → **„Update installieren /
  wechseln"**. Printloom zieht das passende Image und startet sich neu (über den
  gemounteten Docker-Socket — erledigt auch den Kanalwechsel).
- **Automatisch:** Watchtower aktualisiert den aktiven Kanal im Hintergrund (alle 5 Min).
- **Manuell auf der Konsole** (Fallback):

  ```bash
  cd ~/printloom
  docker compose -f docker-compose.prod.yml pull
  docker compose -f docker-compose.prod.yml up -d
  ```

---

## 9. Nützliche Befehle

```bash
# Logs
docker compose -f docker-compose.prod.yml logs -f printloom

# Neustart / Stop
docker compose -f docker-compose.prod.yml restart
docker compose -f docker-compose.prod.yml down

# Backup der Daten (Geräte, Rack, Sequenzen, Queue, Uploads)
tar czf ~/printloom-backup-$(date +%F).tar.gz -C ~/printloom backend/db backend/uploads

# Plattenplatz aufräumen (alte Images)
docker image prune -f
```

---

## Troubleshooting

| Symptom | Ursache / Lösung |
|---|---|
| `permission denied … docker.sock` | Schritt 2: `usermod -aG docker $USER`, dann neu anmelden. |
| WebUI nicht erreichbar | `docker compose ... ps` (healthy?), Firewall Port 8000, richtige IP? |
| In-App-Update tut nichts | Docker-Socket-Mount im `printloom`-Service vorhanden? (`/var/run/docker.sock`). |
| Kamera „belegt"/kein Bild | Nur ein Client gleichzeitig an der X1C — siehe README → Kameras (HA-Proxy). |
| Image-Pull schlägt fehl (401/403) | ghcr-Package privat → in `.env` `GITHUB_TOKEN` setzen oder Package public stellen. |
