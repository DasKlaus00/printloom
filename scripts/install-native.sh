#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Printloom — native Installation OHNE Docker (systemd-Dienst).
#
# Für Geräte, auf denen Docker zu schwer ist (z. B. Raspberry Pi Zero 2 W mit
# 512 MB RAM) oder schlicht nicht gewünscht ist. Läuft auf jedem apt-basierten
# 64-bit-Linux mit systemd (Raspberry Pi OS, Debian, Ubuntu; arm64 & amd64).
#
# Aufruf (einzeiler):
#   curl -fsSL https://raw.githubusercontent.com/DasKlaus00/printloom/main/scripts/install-native.sh | bash
#
# Optionen über Umgebungsvariablen:
#   PRINTLOOM_CHANNEL=beta    Kanal (latest|beta), Standard: latest
#   PRINTLOOM_PORT=8000       HTTP-Port, Standard: 8000
#   PRINTLOOM_DIR=~/printloom Installationsverzeichnis
#   PRINTLOOM_FFMPEG=0|1      Kamera-Transcoder erzwingen/aus; Standard: auto
#                             (installiert ffmpeg nur bei >= 700 MB RAM)
#
# Update später:  bash ~/printloom/scripts/update-native.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CHANNEL="${PRINTLOOM_CHANNEL:-latest}"
BRANCH=$([ "$CHANNEL" = "beta" ] && echo beta || echo main)
DIR="${PRINTLOOM_DIR:-$HOME/printloom}"
PORT="${PRINTLOOM_PORT:-8000}"
REPO="https://github.com/DasKlaus00/printloom.git"
DIST_URL="https://github.com/DasKlaus00/printloom/releases/download/native-$CHANNEL/printloom-frontend-dist.tar.gz"

echo "== Printloom native install ($CHANNEL) → $DIR =="

# ── Grundpakete ──────────────────────────────────────────────────────────────
sudo apt-get update -y
sudo apt-get install -y git python3 python3-venv python3-pip curl

# Python-Version prüfen (Abhängigkeiten liefern fertige Wheels für 3.9–3.12).
PYV=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
case "$PYV" in
  3.9|3.10|3.11|3.12) ;;
  *) echo "WARNUNG: Python $PYV ist ungetestet (empfohlen: 3.11/3.12) — Installation kann fehlschlagen." ;;
esac

# ── Repo holen / aktualisieren ───────────────────────────────────────────────
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch origin
  git -C "$DIR" checkout "$BRANCH"
  git -C "$DIR" pull --ff-only
else
  git clone -b "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR"
echo "$CHANNEL" > .printloom-channel

# ── Python-Umgebung ──────────────────────────────────────────────────────────
python3 -m venv .venv
.venv/bin/pip install --upgrade pip wheel >/dev/null
.venv/bin/pip install -r backend/requirements.txt

# ── Fertiges Frontend laden (Zero 2 W & Co. können Vite nicht selbst bauen) ──
echo "-- Frontend-Build laden ($DIST_URL) --"
curl -fL "$DIST_URL" -o /tmp/printloom-dist.tar.gz
rm -rf frontend/dist
mkdir -p frontend
tar xzf /tmp/printloom-dist.tar.gz -C frontend
rm -f /tmp/printloom-dist.tar.gz

# ── ffmpeg (Kamera) — nur wenn genug RAM oder erzwungen ─────────────────────
MEMKB=$(awk '/MemTotal/{print $2}' /proc/meminfo)
WANT_FFMPEG="${PRINTLOOM_FFMPEG:-auto}"
if [ "$WANT_FFMPEG" = "1" ] || { [ "$WANT_FFMPEG" = "auto" ] && [ "$MEMKB" -ge 700000 ]; }; then
  sudo apt-get install -y ffmpeg || echo "WARNUNG: ffmpeg-Installation fehlgeschlagen — Kamera bleibt aus."
else
  echo "ffmpeg übersprungen (wenig RAM oder PRINTLOOM_FFMPEG=0)."
  echo "→ In Printloom unter System → Kamera den Energiesparmodus aktivieren."
fi

# ── systemd-Dienst ───────────────────────────────────────────────────────────
# Auf knappen Geräten (< 700 MB) Speichergrenzen setzen: notfalls stirbt und
# restartet Printloom — nie ein anderer Dienst (z. B. Klipper) auf dem Gerät.
LIMITS=""
if [ "$MEMKB" -lt 700000 ]; then
  LIMITS="MemoryHigh=280M
MemoryMax=380M"
  echo "Wenig RAM erkannt ($((MEMKB/1024)) MB) → Speichergrenzen für den Dienst gesetzt."
  echo "Tipp für 512-MB-Geräte: zram aktivieren (sudo apt install zram-tools)."
fi

sudo tee /etc/systemd/system/printloom.service >/dev/null <<EOF
[Unit]
Description=Printloom (native, ohne Docker)
After=network-online.target
Wants=network-online.target

[Service]
User=$USER
WorkingDirectory=$DIR/backend
Environment=PRINTLOOM_RUNTIME=native-linux
Environment=PYTHONUNBUFFERED=1
Environment=MALLOC_ARENA_MAX=2
ExecStart=$DIR/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port $PORT
Restart=on-failure
RestartSec=5
$LIMITS

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now printloom

# ── Fertig ───────────────────────────────────────────────────────────────────
IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo ""
echo "== Fertig! Printloom läuft: http://${IP:-<geräte-ip>}:$PORT =="
echo "   Status:  sudo systemctl status printloom"
echo "   Logs:    journalctl -u printloom -f"
echo "   Update:  bash $DIR/scripts/update-native.sh"
