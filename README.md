# Printloom

https://printloom.alexsz.de/

**Disclaimer: The software was written almost entirely using Claude**

**This is still a work in Progress**

if you need help:
https://discord.gg/REfB9bXKdZ



**Self-hosted automation for continuous 3D print farms.** Printloom orchestrates a
Bambu Lab X1C and an OTTOeject auto-ejector into a true *lights-out* workflow:
queue jobs, print, eject the finished plate, store it in a rack, and start the next
one unattended, with live status, cameras and ETA in a clean web UI.

> Runs entirely on your LAN. No cloud account required for the core workflow.
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/2aaff6b7-44ae-41be-a96a-998cc376ecc9" />
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/f624d827-13db-453b-b8a9-50525e2ebb88" />
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/06ff074d-98bc-4993-bcca-471d0afddc4a" />
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/a8e1bd0c-b009-490b-878e-86e18c0082b1" />
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/8b0d572d-e08a-4837-83f1-76a1d07b2151" />
<img width="3200" height="1750" alt="image" src="https://github.com/user-attachments/assets/d6fb14c6-b43c-4f15-85c7-ecb14c3c1552" />

---

## Features

- **Auto Farm** — chain prints end-to-end: grab → load → print → eject → store, fully
  unattended, with a live ETA for the whole remaining queue.
- **Editable eject sequences** — visual sequence editor; every step (OTTOeject macros,
  Bambu moves, waits) is configurable.
- **Rack & magazine manager** — track plate slots, capacity and refill; live status.
- **File library** — folders, per-file print time & filament estimate (parsed from the
  `.3mf`/`.gcode`), bulk queueing with a calculated total.
- **Cameras** — external webcam (WebRTC / HLS / MJPEG) and the printer's own camera:
  X1 series directly over RTSPS, P1/A1 over Bambu's port-6000 stream. One connection per
  printer, shared by all viewers. A Home Assistant proxy is optional.
- **Live status & control** — temperatures, progress, AMS, chamber light, manual moves.
- **Notifications** — Web Push to the browsers you subscribe (job done, errors, pauses).
- **In-app updates** — switch between **Latest** and **Beta** channels and update with
  one click from the System page (see [Updates](#updates)).
- **OrcaSlicer plugin** (OrcaSlicer 2.5+, download from the System page) — checks every
  print right after slicing against your farm (arm collision zone, rack height, spools),
  sends it to the queue with Orca's own *Send* button and shows farm and printer in a
  Printloom tab inside Orca.
- **Backup / restore** — credentials (access codes, tokens) only on request and
  optionally password-encrypted; multi-language UI, downloadable language packs.

## Hardware

- **Bambu Lab printer** — tested on the **X1 Carbon**. Also recognized: X1, X1E, P1S,
  P1P, A1, A1 mini and H2D (geometry templates for X1C, P1S, P1P and A1). Needs the LAN
  access code; for the camera, "LAN Mode Liveview" must be on.
- **OTTOeject** running Klipper/Moonraker (the auto-ejector).
- A host for Printloom: anything that runs Docker (a small x86/ARM box, NUC, Pi 4/5, a
  Proxmox LXC), a Windows PC (native app, see below) or a Linux box without Docker
  ([docs/INSTALL-NATIVE.md](docs/INSTALL-NATIVE.md)).

---

## Quick start (Docker)

Uses the prebuilt image from GitHub Container Registry. One-click updates from the
web UI — no local build, no `git pull`, no token and no extra config needed.

```bash
git clone https://github.com/DasKlaus00/printloom.git
cd printloom
docker compose up -d
```

Open **http://<host-ip>:8000** and follow the in-app setup.

> Setting up a **fresh Debian server** from scratch (Docker + all dependencies)?
> See **[docs/DEBIAN_SETUP.md](docs/DEBIAN_SETUP.md)**.

## Windows app

The [GitHub releases](https://github.com/DasKlaus00/printloom/releases) carry a
Windows installer (`Printloom-Setup-X.Y.Z.exe`, with a `.sha256` checksum next to it)
and a portable `.exe`. Printloom then runs as a tray app and opens in your browser at
**http://127.0.0.1:8756**. Its data (database, uploads, settings) lives in
`%APPDATA%\Printloom`. Updates come from the **System** page: the app downloads the
installer of the newest release, checks its checksum and only then starts it.

---

## Updates

Printloom has two release channels:

| Channel    | Image tag  | Who it's for              |
|------------|------------|---------------------------|
| **Latest** | `:latest`  | Stable releases (default) |
| **Beta**   | `:beta`    | active dev                |

Updates happen **only when you press the button** — there is **no automatic
background update**. In the **System** page you can:

- **Check** whether a newer build of the active channel is available, and
- **Update / switch channels with one click** — after a short *back-up-your-config*
  reminder, Printloom pulls the chosen image and recreates itself (this uses the
  mounted Docker socket; it also performs the channel switch).

To pick the beta channel from the CLI instead: `PRINTLOOM_CHANNEL=beta docker compose up -d`.

If you prefer not to give the app Docker access, remove the `docker.sock` mount from
the `printloom` service — updating then needs a manual `docker compose pull && docker compose up -d`.

---

## Configuration

Everything operational is configured **in the web UI** (printer IP + access code,
OTTOeject, rack, cameras) and stored in the runtime `db/` volume — so
**no secrets ever enter the image or git**.

Optional deployment settings are plain environment variables (no `.env` required):
`PRINTLOOM_CHANNEL` (`latest`/`beta`) and `PORT` (default `8000`). The update channel
can also be switched live in the web UI.

### Security

Printloom has **no login of its own** — it is meant for your LAN. If you make it
reachable from outside, put it behind a reverse proxy with authentication (e.g.
authentik) and publish the port only locally (`"127.0.0.1:8000:8000"` in
`docker-compose.yml`), otherwise port 8000 bypasses the proxy.

Other websites open in your browser cannot change anything: write requests must come
from Printloom's own page (`Sec-Fetch-Site` over https, the `Origin` header over
http). Printloom only answers to addresses that belong to your network: IP addresses,
names without a dot, `.local`, `.lan`, `.home.arpa`, `.internal`, `fritz.box`. That
stops DNS rebinding (a foreign page pointing its own name at your farm). If you open
Printloom under another name over plain http, or call the API from scripts or Home
Assistant by such a name, list it in `PRINTLOOM_ALLOWED_HOSTS` (comma-separated,
`*.example.com` allowed), or let the script send the header `Sec-Printloom-Client: <name>`
(the OrcaSlicer plugin does). Over https behind a proxy browsers work without. A plain-http
reverse proxy must pass the browser's `Host` on, including the port (nginx:
`proxy_set_header Host $http_host;`, Apache: `ProxyPreserveHost On`). Printloom may
only be shown in an iframe on its own pages; for Home Assistant, set
`PRINTLOOM_FRAME_ANCESTORS` (e.g. `https://ha.example.com`).

### Securing the OTTOeject

Moonraker on the OTTOeject accepts commands without a login from every address listed
under `trusted_clients` — by default that is your whole private network
(`192.168.0.0/16`, `10.0.0.0/8`, …). Anything on your LAN can then move the arm, even
while a print is running. Narrow it down in `moonraker.conf` on the OTTOeject:

```ini
[authorization]
trusted_clients:
    192.168.1.20      # the Printloom host
    127.0.0.0/8
cors_domains:
    http://ottoeject.local   # only the UIs you actually use (Mainsail)
```

Do not forward Moonraker's port (7125) to the internet.

### Cameras

- **External webcam:** enter a stream URL (Configuration → Cameras). Port `:8889`/`/whep`
  → WebRTC (<1 s), `:8888`/`.m3u8` → HLS, otherwise MJPEG.
- **Printer camera:** Printloom reads it directly — X1 series over RTSPS (needs
  `ffmpeg`; the Docker image and the Windows app ship it), P1/A1 over port 6000. It
  keeps one connection per printer and shares it. If another client (Bambu Studio,
  Handy) holds the camera, use the **Home Assistant** proxy instead: HA URL, camera
  entity and a long-lived token (Configuration → Cameras; the token stays on the server).
- **Weak hosts** (Raspberry Pi Zero/3): converting the X1 stream takes a full CPU. Turn
  the camera off under Configuration → Cameras → "Kamera komplett deaktivieren".

### OrcaSlicer plugin

1. **System → OrcaSlicer-Plugin → Download** (the plugin always matches your Printloom).
2. In OrcaSlicer 2.5+: *Plugins → Install local plugin* → the downloaded file.
3. In the new **Printloom** tab, enter the address of your Printloom page (behind
   authentik: user + app password).
4. For *Send*/*Print*: *Preferences → Developer → Experimental features → "Use printer
   agents instead of print hosts"*, then pick **Printloom** as printer agent in the
   printer profile (*Basic information → Advanced*).

---

## License

Printloom is licensed under the **GNU AGPL-3.0** — see [LICENSE](LICENSE).
Network use counts as distribution: if you run a modified version for others, you must
make your changes available under the same license.

Copyright (C) 2026 the Printloom authors.
