# Build stage
FROM node:20-alpine AS frontend-build

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

# Expose ports
EXPOSE 8000 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

# Start the application
CMD ["python", "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
