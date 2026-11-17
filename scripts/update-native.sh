#!/usr/bin/env bash
# Printloom — Update der nativen (Docker-losen) Installation.
# Zieht den Kanal-Branch, aktualisiert die Python-Abhängigkeiten, lädt das
# fertige Frontend und startet den systemd-Dienst neu. Daten (backend/db,
# backend/uploads) bleiben unangetastet.
set -euo pipefail

DIR="${PRINTLOOM_DIR:-$HOME/printloom}"
cd "$DIR"

# Optionales Argument = Kanalwechsel:  update-native.sh beta  |  update-native.sh latest
if [ "${1:-}" = "beta" ] || [ "${1:-}" = "latest" ]; then
  echo "$1" > .printloom-channel
fi
CHANNEL=$(cat .printloom-channel 2>/dev/null || echo latest)
BRANCH=$([ "$CHANNEL" = "beta" ] && echo beta || echo main)
DIST_URL="https://github.com/DasKlaus00/printloom/releases/download/native-$CHANNEL/printloom-frontend-dist.tar.gz"

echo "== Printloom native update ($CHANNEL) =="
git fetch origin
git checkout "$BRANCH"
git pull --ff-only

.venv/bin/pip install -r backend/requirements.txt

# Nur entpacken, was zur Prüfsumme aus demselben Release passt (seit v1.1.75).
fetch_dist() {
  curl -fL "$DIST_URL" -o /tmp/printloom-dist.tar.gz
  WANT=$(curl -fsL "$DIST_URL.sha256" 2>/dev/null | cut -d' ' -f1 || true)
  HAVE=$(sha256sum /tmp/printloom-dist.tar.gz | cut -d' ' -f1)
  if [ -z "$WANT" ] || [ "$WANT" != "$HAVE" ]; then
    rm -f /tmp/printloom-dist.tar.gz
    echo "Prüfsumme fehlt oder falsch — läuft der Build noch? In ein paar Minuten erneut versuchen." >&2
    exit 1
  fi
}
echo "-- Frontend-Build laden --"
fetch_dist
rm -rf frontend/dist
tar xzf /tmp/printloom-dist.tar.gz -C frontend
rm -f /tmp/printloom-dist.tar.gz

sudo systemctl restart printloom
echo "== ✓ Printloom aktualisiert auf v$(cat backend/version.txt) =="
