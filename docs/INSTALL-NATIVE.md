# Native installation (no Docker)

Runs Printloom directly as a **systemd service** — for devices where Docker is
too heavy (e.g. **Raspberry Pi Zero 2 W**, 512 MB RAM) or simply not wanted.
Works on any apt-based 64-bit Linux with systemd (Raspberry Pi OS, Debian,
Ubuntu — arm64 **and** amd64).

> **Prefer Docker when you can** — it is the primary, most-tested way to run
> Printloom (`docker-compose.simple.yml.example`). Use the native install for
> low-memory devices.

## Install (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/DasKlaus00/printloom/main/scripts/install-native.sh | bash
```

Then open `http://<device-ip>:8000`.

Options (environment variables before the command):

| Variable | Default | Meaning |
|---|---|---|
| `PRINTLOOM_CHANNEL` | `latest` | Release channel (`latest` or `beta`) |
| `PRINTLOOM_PORT` | `8000` | HTTP port |
| `PRINTLOOM_DIR` | `~/printloom` | Install directory |
| `PRINTLOOM_FFMPEG` | `auto` | Camera transcoder: `1` force install, `0` skip, `auto` = only with ≥ 700 MB RAM |

Example (beta channel on port 8080):

```bash
PRINTLOOM_CHANNEL=beta PRINTLOOM_PORT=8080 bash scripts/install-native.sh
```

## What the script does

1. Installs `git`, `python3-venv`, `curl` via apt (Python 3.11/3.12 required — included in Debian 12 / Ubuntu 24.04).
2. Clones the repo to `~/printloom` and creates a Python virtualenv (all dependencies install as prebuilt wheels — nothing compiles).
3. Downloads the **prebuilt frontend** from the rolling release asset (`native-latest` / `native-beta`) — low-memory devices cannot run the Vite build themselves.
4. Installs `ffmpeg` only on devices with enough RAM (see table above). Without ffmpeg, disable the camera in *System → Camera* (power-saving mode).
5. Creates and starts the `printloom` systemd service. On devices with < 700 MB RAM the service gets memory limits (`MemoryMax=380M`) so it can never starve other services (e.g. **Klipper** on the same machine — Printloom restarts instead).

Data (devices, racks, sequences, queue, uploads) lives in
`~/printloom/backend/db` and `~/printloom/backend/uploads` and survives updates.

## Update

```bash
bash ~/printloom/scripts/update-native.sh          # update current channel
bash ~/printloom/scripts/update-native.sh beta     # switch to beta + update
bash ~/printloom/scripts/update-native.sh latest   # switch to latest + update
```

The System page shows available updates; installing runs via the command above
(no one-click update without Docker).

## Service management

```bash
sudo systemctl status printloom     # status
journalctl -u printloom -f          # live logs
sudo systemctl restart printloom    # restart
sudo systemctl disable --now printloom   # stop + remove from autostart
```

## Tips for 512 MB devices (Pi Zero 2 W)

- Use **Raspberry Pi OS Lite (64-bit)** — no desktop.
- Enable zram swap: `sudo apt install zram-tools` (then set `PERCENT=150` in `/etc/default/zramswap` and restart the service).
- Keep the camera disabled (*System → Camera*).
- If Klipper/Moonraker runs on the same device: expect a snappier UI on a Pi 4+ — the Zero 2 W works, but it is tight.
