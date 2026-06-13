#!/bin/bash
# Printloom manual update script
# Run: bash update.sh

set -e

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "=== Printloom Update ==="
echo "Pulling latest image..."
docker compose -f "$COMPOSE_FILE" pull printloom

echo "Restarting container..."
docker compose -f "$COMPOSE_FILE" up -d --no-deps printloom

echo "Removing old images..."
docker image prune -f

echo "=== Done ==="
docker compose -f "$COMPOSE_FILE" ps
