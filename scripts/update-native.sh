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

echo "-- Frontend-Build laden --"
curl -fL "$DIST_URL" -o /tmp/printloom-dist.tar.gz
rm -rf frontend/dist
tar xzf /tmp/printloom-dist.tar.gz -C frontend
rm -f /tmp/printloom-dist.tar.gz

sudo systemctl restart printloom
echo "== ✓ Printloom aktualisiert auf v$(cat backend/version.txt) =="
