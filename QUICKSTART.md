# Printloom Quick Start Guide

## 🚀 5-Minute Setup

### 1. Prerequisites
- Docker and Docker Compose installed
- Bambu Lab X1C on your local network
- Klipper/Mainsail system with OTTOeject configured
- Your network's local IP addresses

### 2. Start the Application

```bash
# Navigate to project directory
cd DIY

# Start with Docker Compose
docker-compose up -d

# Wait 15-20 seconds for services to start
sleep 20

# Check if running
docker-compose ps
```

**Access Points:**
- Frontend: http://localhost:3000
- API: http://localhost:8000
- API Docs (Swagger): http://localhost:8000/docs

### 3. Configure Devices

1. Open http://localhost:3000
2. Click **Configuration** in the sidebar
3. Click **+ Add Device**

#### Device 1: Bambu Lab X1C
```
Name: Bambu Lab X1C
Type: Bambu Lab X1C
IP Address: 192.168.x.xxx (your printer's IP)
Port: 8883
Serial Number: Check printer settings or box
Access Code: From Bambu Lab app
Use TLS: ✓ (enabled)
```

4. Click **Add Device**
5. Click **Test Connection** to verify

#### Device 2: Klipper/Mainsail
```
Name: Klipper OTTOeject
Type: Klipper/Mainsail
IP Address: 192.168.x.xxx (your Klipper host IP)
Port: 7125
(no other fields needed)
```

6. Click **Add Device**
7. Click **Test Connection**

### 4. Configure Rack

1. Still in **Configuration** tab
2. Find "Rack Configuration" section
3. Set **Number of Slots** (usually 6 for OTTOeject)
4. Click **Update Rack Configuration**

### 5. Upload Files

1. Click **File Library** in sidebar
2. Click the upload area
3. Select your .3mf, .stl, or .gcode files
4. Files will appear in the list

### 6. Create Print Queue

1. In **File Library**, next to each file:
   - Select a **Slot** (1-6, bottom to top)
   - Click **Add to Queue**

2. Go to **Dashboard** to see:
   - Rack visualization
   - Queue status
   - Print progress

### 7. Manual Testing (Optional)

1. Click **Manual Controls** in sidebar
2. Click macro buttons to test OTTOeject movements:
   - **OTTOEJECT_HOME** - Home the arm
   - **GRAB_FROM_SLOT_1** - Test grabbing
   - **STORE_TO_SLOT_1** - Test storage
   - **OPEN_DOOR_BAMBU_X_ONE_C** - Test door
   - etc.

---

## 📝 Finding Your Device Information

### Bambu Lab X1C Serial Number
1. Open Bambu Lab app
2. Device settings
3. Look for "SN:" (serial number starts with "00M04A...")

### Bambu Lab Access Code
1. Open Bambu Lab app
2. Device settings
3. Look for "LAN Connection Key" or similar

### Device IP Addresses
```bash
# Use your router's admin panel, or:
# On Linux/Mac:
arp -a

# On Windows:
arp -a

# Or check connected devices in your router settings
```

### Klipper/Mainsail Port
- Default is usually **7125** for Moonraker API
- Check your Klipper config if different

---

## ⚙️ Troubleshooting

### Application won't start
```bash
# Check logs
docker-compose logs -f

# Rebuild images
docker-compose build --no-cache
docker-compose up -d
```

### Can't reach Bambu Lab
- [ ] Verify IP address is correct
- [ ] Check printer is on same WiFi network
- [ ] Confirm Serial Number and Access Code
- [ ] Ensure Port 8883 is accessible

### Can't reach Klipper
- [ ] Verify IP address and port 7125
- [ ] Check Moonraker is running
- [ ] Verify firewall allows port 7125

### Database/File errors
```bash
# Reset database and uploads
rm -rf backend/db/*.db
rm -rf backend/uploads/*
docker-compose restart
```

---

## 🎛️ Regular Usage

### Adding new prints
1. **File Library** → Upload files
2. Assign to slot and add to queue
3. Watch **Dashboard** for progress

### Emergency stop
- **Manual Controls** → **EMERGENCY STOP**
- All devices will be disabled
- Click **Resume Operations** when ready

### View queue
- **Dashboard** shows current queue
- Click **Remove** to delete jobs
- Drag slots in **Manual Controls** to reorder

---

## 📦 Docker Commands

```bash
# Start
docker-compose up -d

# Stop
docker-compose down

# View logs
docker-compose logs -f

# Rebuild
docker-compose build --no-cache
docker-compose up -d

# Remove everything (including data!)
docker-compose down -v

# Check status
docker-compose ps
```

---

## 🔌 Klipper Macro Setup

Make sure these macros are defined in your Klipper printer.cfg:

```gcode
[gcode_macro GRAB_FROM_SLOT_1]
gcode:
  # Add your G-code here

[gcode_macro STORE_TO_SLOT_1]
gcode:
  # Add your G-code here

[gcode_macro OPEN_DOOR_BAMBU_X_ONE_C]
gcode:
  # Add your G-code here

# etc... (see README.md for full list)
```

Then restart Klipper for changes to take effect.

---

## 🆘 Need Help?

1. Check logs: `docker-compose logs -f printloom-app`
2. View API docs: http://localhost:8000/docs
3. Check README.md for detailed information
4. Verify network connectivity with ping

---

**You're ready to automate! 🤖🖨️**
