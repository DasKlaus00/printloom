# Printloom Deployment Guide

## Local Deployment (Recommended for Home Use)

### Prerequisites
- Docker and Docker Compose
- Local network with Bambu Lab X1C and Klipper device
- Minimum 500MB free disk space (for Docker images)
- 2GB free RAM (recommended)

### Step 1: Clone and Navigate
```bash
git clone <repository-url>
cd DIY
```

### Step 2: Verify Setup
```bash
bash verify.sh
```

### Step 3: Start Application
```bash
# Quick start
bash start.sh

# Or manual start
docker-compose up -d

# Monitor startup
docker-compose logs -f
```

### Step 4: Access Application
- **Frontend**: http://localhost:3000
- **API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs (Swagger UI)

### Step 5: Configure Devices
Follow the **QUICKSTART.md** guide to configure your Bambu Lab X1C and Klipper devices.

---

## Docker Deployment Details

### Building Images
```bash
# Build all images
docker-compose build

# Build without cache (fresh build)
docker-compose build --no-cache

# Build specific service
docker-compose build printloom
```

### Running Services
```bash
# Start in background
docker-compose up -d

# Start with logs
docker-compose up

# Stop services
docker-compose stop

# Stop and remove containers
docker-compose down

# Remove everything including volumes
docker-compose down -v
```

### Volume Persistence
Data is stored in local volumes:
- **uploads**: `./backend/uploads/` - Uploaded 3D model files
- **database**: `./backend/db/` - SQLite database

These persist between restarts.

### Container Health Checks
The application includes health checks:
```bash
# Check container status
docker-compose ps

# View health status
docker-compose logs printloom
```

---

## Network Configuration

### Port Mapping
```
Container → Host
3000      → 3000 (Frontend/Vite)
8000      → 8000 (FastAPI)
```

### LAN Access
To access from another machine on your network:

**Frontend**: `http://<YOUR-MACHINE-IP>:3000`
**API**: `http://<YOUR-MACHINE-IP>:8000`

Find your machine's IP:
```bash
# Linux/Mac
ifconfig

# Windows
ipconfig

# Docker container
docker inspect printloom-app | grep "IPAddress"
```

### Firewall Configuration
Allow these ports through your firewall:
- TCP 3000 (Frontend)
- TCP 8000 (API)

---

## Production Considerations

### 1. Authentication
Add authentication layer (currently not implemented):
```python
# Add to backend/app/routers/
# Implement JWT or API key authentication
```

### 2. Environment Variables
Create `.env` file with sensitive data:
```bash
cp .env.example .env
# Edit .env with your settings
```

Update `docker-compose.yml`:
```yaml
services:
  printloom:
    env_file: .env
```

### 3. Database Security
For production, consider:
- Backup SQLite database regularly
- Use PostgreSQL instead of SQLite for better concurrency
- Encrypt sensitive data (access codes)

### 4. MQTT Security
Current setup:
- Bambu Lab: TLS enabled, authentication via access code
- Klipper: No TLS (LAN only)

For production:
- Implement proper certificate management
- Use VPN for remote access
- Implement rate limiting

### 5. Reverse Proxy (Nginx)
For production with domain name:

```nginx
upstream printloom_api {
    server localhost:8000;
}

upstream printloom_frontend {
    server localhost:3000;
}

server {
    listen 80;
    server_name printloom.local;

    # Redirect to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name printloom.local;

    ssl_certificate /etc/ssl/certs/printloom.crt;
    ssl_certificate_key /etc/ssl/private/printloom.key;

    # Frontend
    location / {
        proxy_pass http://printloom_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # API
    location /api/ {
        proxy_pass http://printloom_api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 6. Logging and Monitoring
```bash
# View all logs
docker-compose logs -f

# View specific service
docker-compose logs -f printloom

# Export logs
docker-compose logs printloom > app.log

# Monitor resource usage
docker stats printloom
```

### 7. Backup Strategy
```bash
#!/bin/bash
# backup.sh

BACKUP_DIR="./backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p $BACKUP_DIR

# Backup database
cp backend/db/printloom.db $BACKUP_DIR/printloom_$TIMESTAMP.db.backup

# Backup uploaded files
tar -czf $BACKUP_DIR/uploads_$TIMESTAMP.tar.gz backend/uploads/

echo "Backup completed: $BACKUP_DIR/"
```

---

## Troubleshooting Deployment

### Container won't start
```bash
# Check logs
docker-compose logs printloom

# Rebuild images
docker-compose build --no-cache

# Try with verbose output
docker-compose up --no-detach
```

### Port already in use
```bash
# Find process using port
lsof -i :3000
lsof -i :8000

# Change ports in docker-compose.yml
ports:
  - "3001:3000"  # Change 3000 to 3001
  - "8001:8000"  # Change 8000 to 8001
```

### Permission denied errors
```bash
# Fix volume permissions
sudo chown -R $USER:$USER backend/db
sudo chown -R $USER:$USER backend/uploads
```

### Out of disk space
```bash
# Check disk usage
docker system df

# Clean up Docker
docker system prune -a

# Remove old images
docker image prune
```

### Network issues
```bash
# Test network connectivity
docker-compose exec printloom ping 8.8.8.8

# Check container network
docker network inspect DIY_printloom-network
```

---

## Upgrade Procedure

### Update Application
```bash
# Pull latest changes
git pull origin main

# Rebuild images
docker-compose build --no-cache

# Stop running containers
docker-compose down

# Start updated version
docker-compose up -d

# Check status
docker-compose logs -f
```

### Database Migrations
Currently using auto-migrations with SQLAlchemy. Existing data should persist.

For manual schema updates:
```bash
# Backup database first!
cp backend/db/printloom.db backend/db/printloom.db.backup

# Delete database to force recreation (WARNING: data loss!)
rm backend/db/printloom.db

# Restart
docker-compose restart
```

---

## Performance Optimization

### For Large Print Farms (10+ active jobs)

1. **Database**: Migrate to PostgreSQL
   ```yaml
   # docker-compose.yml
   services:
     postgres:
       image: postgres:15
       environment:
         POSTGRES_PASSWORD: <secure-password>
       volumes:
         - postgres_data:/var/lib/postgresql/data
   ```

2. **Caching**: Add Redis
   ```bash
   pip install redis
   ```

3. **Queue Processing**: Implement Celery
   ```bash
   pip install celery
   ```

4. **WebSockets**: Real-time updates
   ```bash
   pip install python-socketio
   ```

---

## Security Checklist

- [ ] Change default ports if needed
- [ ] Set up firewall rules
- [ ] Use HTTPS with valid certificates
- [ ] Implement authentication
- [ ] Encrypt sensitive data in database
- [ ] Regular backups
- [ ] Keep Docker updated
- [ ] Monitor logs for errors
- [ ] Use VPN for remote access
- [ ] Restrict file upload sizes

---

## Monitoring

### Health Checks
```bash
# Check API health
curl http://localhost:8000/api/health

# Check response
{"status": "healthy"}
```

### Uptime Monitoring
For production, use external monitoring:
- Uptime Robot (free)
- Sentry for error tracking
- NewRelic for performance

---

## Disaster Recovery

### Data Loss Prevention
```bash
# Automated daily backup
0 2 * * * /home/user/printloom/backup.sh
```

### Restore from Backup
```bash
# Stop application
docker-compose down

# Restore database
cp backups/printloom_*.db.backup backend/db/printloom.db

# Restore files
tar -xzf backups/uploads_*.tar.gz -C ./

# Start application
docker-compose up -d
```

---

## Support

For issues:
1. Check logs: `docker-compose logs -f`
2. Review ARCHITECTURE.md for system design
3. Check README.md for API documentation
4. Open issue on repository with logs

---

**Printloom v1.0 - Deployment Guide Complete**
