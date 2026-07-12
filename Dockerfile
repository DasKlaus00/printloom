# Build stage — läuft IMMER nativ auf der Build-Maschine ($BUILDPLATFORM):
# der Vite-Build erzeugt architektur-unabhängiges JS/CSS; ihn unter QEMU für
# arm64 zu emulieren würde den Multi-Arch-CI-Build nur unnötig verlangsamen.
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install

COPY frontend/ .
RUN npm run build

# Backend stage
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy backend requirements
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/app ./app
COPY backend/version.txt ./version.txt

# Runtime data dirs. db/ is intentionally NOT copied from the build context so
# no personal data (printer access codes, Telegram token, marketplace token,
# SQLite DB) is ever baked into the public image. It is created empty here and
# normally mounted as a volume; defaults are generated in code on first run.
RUN mkdir -p /app/uploads /app/db

# Copy frontend build
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Speicherverbrauch zähmen: Diese App nutzt viele kurzlebige Worker-Threads
# (MQTT/FTP/Kamera über run_in_executor). glibc legt pro Thread eine eigene
# malloc-Arena an → der belegte Speicher (RSS) bläht sich auf und wird kaum an
# das OS zurückgegeben. Arenen begrenzen und freigegebenen Speicher früher
# zurückgeben senkt den Verbrauch deutlich, ohne Funktionsverlust.
ENV MALLOC_ARENA_MAX=2 \
    MALLOC_TRIM_THRESHOLD_=131072 \
    PYTHONUNBUFFERED=1

# Expose ports
EXPOSE 8000 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start the application
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
