# Printloom

**Self-hosted automation for continuous 3D print farms.** Printloom orchestrates a
Bambu Lab X1C and an OTTOeject auto-ejector into a true *lights-out* workflow:
queue jobs, print, eject the finished plate, store it in a rack, and start the next
one — unattended, with live status, cameras and ETA in a clean web UI.

> Runs entirely on your LAN. No cloud account required for the core workflow.

---

## Features

- **Auto Farm** — chain prints end-to-end: grab → load → print → eject → store, fully
  unattended, with a live ETA for the whole remaining queue.
- **Editable eject sequences** — visual sequence editor; every step (OTTOeject macros,
  Bambu moves, waits) is configurable.
- **Rack & magazine manager** — track plate slots, capacity and refill; live status.
- **File library** — folders, per-file print time & filament estimate (parsed from the
  `.3mf`/`.gcode`), bulk queueing with a calculated total.
- **Cameras** — external webcam (WebRTC / HLS / MJPEG) and the built-in X1C chamber
  camera via a Home Assistant proxy (token stays server-side).
- **Live status & control** — temperatures, progress, AMS, chamber light, manual moves.
- **Notifications** — optional Telegram messages on job events.
- **In-app updates** — switch between **Latest** and **Beta** channels and update with
  one click from the System page (see [Updates](#updates)).
- **Backup / restore**, multi-language UI, downloadable language packs.

## Hardware

- **Bambu Lab X1C (P1P/P1S/P2S/X2D) but only tested on X1C** (LAN access code; “LAN Mode Liveview” on for the camera).
- **OTTOeject** running Klipper/Moonraker (the auto-ejector).
- Any host that runs Docker (a small x86/ARM box, NUC, Pi 4/5, or a Proxmox LXC).

---

## Quick start (Docker, recommended)

Uses the prebuilt image from GitHub Container Registry + Watchtower for updates —
no local build, no `git pull` needed for app updates.

```bash
git clone https://github.com/DasKlaus00/printloom.git
cd printloom
cp .env.example .env                          # set a WATCHTOWER_TOKEN secret
cp docker-compose.prod.yml.example docker-compose.prod.yml
docker compose -f docker-compose.prod.yml up -d
```

Open **http://<host-ip>:8000** and follow the in-app setup.

> Setting up a **fresh Debian server** from scratch (Docker + all dependencies)?
> See **[docs/DEBIAN_SETUP.md](docs/DEBIAN_SETUP.md)**.

### Build it yourself instead

```bash
git clone https://github.com/DasKlaus00/printloom.git
cd printloom
docker-compose up -d
```

---

## Updates

Printloom has two release channels:

| Channel    | Image tag | Who it's for                    |
|------------|-----------|---------------------------------|
| **Latest** | `:latest` | Stable releases (default)       |
| **Beta**   | `:beta`   | Newest features, active dev     |

In the **System** page you can:

- **Check** whether a newer build of the active channel is available, and
- **Update / switch channels with one click** — Printloom pulls the chosen image and
  recreates itself (this uses the mounted Docker socket; it also performs the channel
  switch).

In the background, **Watchtower** keeps the active channel up to date automatically.
If you prefer not to give the app Docker access, remove the `docker.sock` mount from
the `printloom` service — Watchtower then still auto-updates the active channel, but
channel switching from the UI is disabled.

---

## Configuration

Everything operational is configured **in the web UI** (printer IP + access code,
OTTOeject, rack, cameras, notifications) and stored in the runtime `db/` volume — so
**no secrets ever enter the image or git**.

Deployment-level settings live in `.env` (see [.env.example](.env.example)): port,
update channel, Watchtower token, optional `GITHUB_TOKEN` (only needed for a *private*
repo/package — a public one needs none).

### Cameras

- **External webcam:** enter a stream URL (Configuration → Cameras). Port `:8889`/`/whep`
  → WebRTC (<1 s), `:8888`/`.m3u8` → HLS, otherwise MJPEG.
- **Built-in X1C camera:** on recent firmware the printer's camera allows only one
  client. Printloom reads it via a **Home Assistant** proxy — enter your HA URL, the
  camera entity and a long-lived token (Configuration → Cameras).

---

## Data & privacy

- Printer access codes, the Telegram token and camera tokens live only in the mounted
  `db/` volume — never in the repository or the Docker image.
- `.env` and `docker-compose.prod.yml` are git-ignored.

## License

Printloom is licensed under the **GNU AGPL-3.0** — see [LICENSE](LICENSE).
Network use counts as distribution: if you run a modified version for others, you must
make your changes available under the same license.

Copyright (C) 2026 the Printloom authors.
