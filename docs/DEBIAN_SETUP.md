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

Nichts nötig — `docker-compose.yml` funktioniert ohne `.env`. Optional, als
Variablen vor dem Startbefehl oder in einer `.env` neben der Compose-Datei:

- `PRINTLOOM_CHANNEL=latest` (stabil) **oder** `beta`. Lässt sich später auch im
  WebUI umschalten.
- `PORT=8000` (Standard; nur ändern, wenn 8000 belegt ist).

Läuft Printloom hinter einem Reverse-Proxy mit Anmeldung (z. B. authentik), in
`docker-compose.yml` den Port nur lokal veröffentlichen (`"127.0.0.1:8000:8000"`) —
sonst führt :8000 am Proxy vorbei.

---

## 5. Starten

```bash
docker compose up -d
```

Beim ersten Start lädt Docker das Image aus ghcr (kann 1–2 Min dauern). Status:

```bash
docker compose ps
docker compose logs -f printloom   # Strg+C zum Beenden
```

Sobald der Container `healthy` ist:

**→ http://<server-ip>:8000 im Browser öffnen** (z. B. http://192.168.1.20:8000).

---

## 6. Firewall (optional, empfohlen)

```bash
sudo ufw allow OpenSSH
sudo ufw allow 8000/tcp
sudo ufw enable
sudo ufw status
```

> **Achtung:** Docker trägt veröffentlichte Ports selbst in iptables ein und geht damit
> an ufw vorbei — `ufw deny 8000` sperrt den Port NICHT. Wer Printloom nur über einen
> Reverse-Proxy erreichbar machen will, veröffentlicht den Port nur lokal
> (`"127.0.0.1:8000:8000"` in `docker-compose.yml`, siehe README → Security).

---

## 7. Erste Einrichtung im WebUI

Alles Weitere passiert in der Oberfläche (keine Configs auf der Konsole). Beim
ersten Aufruf öffnet sich der **Setup-Assistent** (später unter System → Einrichtung);
er führt durch Komponenten, Drucker, OTTOeject, Regal und Kalibrierung. Einzeln:

1. **Konfiguration → Geräte:** den Drucker anlegen — IP, Seriennummer, **Access-Code**
   (am Drucker: Einstellungen → WLAN) — und die OTTOeject (Moonraker-IP, Port `7125`).
   Für die Kamera am Drucker „LAN Mode Liveview" einschalten.
2. **Konfiguration → Allgemein → Regal-Konfiguration:** Regale, Fächer, Magazin.
3. **Drucker** (Seitenleiste): Positionen einmessen, jede Bewegung einzeln testen.
4. **Konfiguration → Kameras** (optional): externe Webcam-URL; die Drucker-Kamera liest
   Printloom direkt, der Home-Assistant-Weg (HA-URL, Entity, Long-Lived-Token) ist
   optional. Auf schwachen Rechnern dort „Kamera komplett deaktivieren".

Geräte-Daten (Access-Code, Tokens) liegen nur im gemounteten `db/`-Volume —
nie im Image oder in git.

---

## 8. Updates

- **Nur auf Knopfdruck — kein automatisches Hintergrund-Update.**
- **Im WebUI (System-Seite):** Kanal **Latest/Beta** wählen → **„Update installieren /
  wechseln"** (mit Backup-Hinweis). Printloom zieht das passende Image und startet sich
  neu (über den gemounteten Docker-Socket — erledigt auch den Kanalwechsel).
- **Manuell auf der Konsole** (Fallback):

  ```bash
  cd ~/printloom
  docker compose pull
  docker compose up -d
  ```

---

## 9. Nützliche Befehle

```bash
# Logs
docker compose logs -f printloom

# Neustart / Stop
docker compose restart
docker compose down

# Backup: am einfachsten über System → Backup in der Oberfläche (Zugangsdaten nur
# auf Wunsch, dann mit Passwort verschlüsselt). Eine Dateikopie wie hier enthält
# Access-Codes und Tokens im KLARTEXT — entsprechend sicher aufbewahren.
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
| Kamera „belegt"/kein Bild | „LAN Mode Liveview" am Drucker an? Hält ein anderer Client (Bambu Studio, Handy) die X1-Kamera, den HA-Weg nehmen — README → Cameras. |
| Image-Pull schlägt fehl (401/403) | Das ghcr-Package ist öffentlich; bei einem privaten Fork auf dem Host einmal `docker login ghcr.io` ausführen (ein `GITHUB_TOKEN` in `.env` erreicht den Docker-Dienst nicht). |
