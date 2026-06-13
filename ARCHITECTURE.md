# Printloom Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Printloom Application                   │
├──────────────────────────┬──────────────────────────────┤
│      Frontend (React)     │      Backend (FastAPI)       │
│  • Dashboard             │  • Device Management          │
│  • Rack Visualization    │  • Queue Processing           │
│  • File Library          │  • MQTT Handler               │
│  • Configuration         │  • Moonraker API Client       │
│  • Manual Controls       │  • Database Models            │
└──────────────────────────┴──────────────────────────────┘
         │                           │
         └───────────┬───────────────┘
                     │
         ┌───────────┴────────────┐
         │                        │
      (HTTP)                  (REST API)
         │                        │
    ┌────▼─────┐           ┌─────▼─────┐
    │  Vite    │           │  Uvicorn  │
    │ Port 3000│           │ Port 8000 │
    └──────────┘           └───────────┘
         │
         └───────────────┬────────────────┐
                    (MQTT)          (REST/HTTP)
                         │                  │
                    ┌────▼──────┐    ┌──────▼────┐
                    │ Bambu Lab │    │  Klipper  │
                    │    X1C    │    │/Mainsail  │
                    │ (MQTT 8883)    │(Port 7125)│
                    └───────────┘    └───────────┘
                         │                  │
                    [Printer]         [OTTOeject]
```

## Component Architecture

### Backend Structure

```
backend/
├── app/
│   ├── main.py                 # FastAPI app initialization
│   ├── models/
│   │   └── models.py           # SQLAlchemy ORM models
│   ├── schemas/
│   │   └── schemas.py          # Pydantic request/response schemas
│   ├── routers/
│   │   ├── devices.py          # Device configuration endpoints
│   │   ├── config.py           # Rack configuration endpoints
│   │   ├── files.py            # File upload/management endpoints
│   │   ├── queue.py            # Print queue endpoints
│   │   └── control.py          # Macro execution endpoints
│   ├── services/
│   │   ├── bambu_mqtt.py       # Bambu Lab MQTT client
│   │   ├── moonraker.py        # Klipper API client
│   │   └── queue_manager.py    # Print queue logic
│   └── db/
│       └── database.py         # SQLAlchemy setup
├── db/
│   └── printloom.db            # SQLite database (persisted)
├── uploads/
│   └── [uploaded files]        # 3D model files (persisted)
└── requirements.txt            # Python dependencies
```

### Frontend Structure

```
frontend/
├── src/
│   ├── main.jsx               # React entry point
│   ├── App.jsx                # Main app component
│   ├── index.css              # Tailwind CSS
│   ├── components/
│   │   ├── Navigation.jsx     # Sidebar navigation
│   │   ├── RackVisualization.jsx  # Rack UI
│   │   └── QueuePanel.jsx     # Queue display
│   ├── pages/
│   │   ├── Dashboard.jsx      # Main dashboard
│   │   ├── Configuration.jsx  # Device config UI
│   │   ├── FileLibrary.jsx    # File management
│   │   └── ManualControls.jsx # Macro buttons
│   └── services/
│       └── api.js             # API client (Axios)
├── index.html                 # HTML entry
├── vite.config.js            # Vite configuration
├── tailwind.config.js        # Tailwind configuration
├── postcss.config.js         # PostCSS configuration
└── package.json              # npm dependencies
```

## Data Flow

### Print Job Workflow

```
User Upload
    ↓
File Library (Storage)
    ↓
Select Slot + Add to Queue
    ↓
Queue Item Created (pending)
    ↓
Queue Manager Process
    ├─ Send file to Bambu Lab (MQTT/FTP)
    │
    ├─ Start Print (MQTT command)
    │
    ├─ Monitor Progress (MQTT messages)
    │
    ├─ Detect Completion
    │
    └─ Trigger OTTOeject Sequence
        ├─ Open Door (Moonraker API)
        ├─ Eject Plate (Moonraker API)
        ├─ Store to Slot (Moonraker API)
        └─ Close Door (Moonraker API)
            ↓
        Load Next Job from Queue
            ↓
        Repeat...
```

## Database Schema

```
devices
├── id (PK)
├── name (unique)
├── device_type (enum: bambu_lab, klipper, otto)
├── ip_address
├── port
├── serial_number (Bambu Lab)
├── access_code (Bambu Lab)
├── mqtt_port
├── use_tls
└── is_active

rack_configuration
├── id (PK)
├── num_slots (1-6)
└── klipper_device_id (FK)

rack_slots
├── id (PK)
├── rack_id (FK)
├── slot_number (1-6, bottom to top)
├── status (free, occupied, printing)
└── current_job_id (FK)

uploaded_files
├── id (PK)
├── filename (unique, internal)
├── original_filename
├── file_type (.3mf, .stl, .gcode)
├── file_path
└── file_size

print_jobs
├── id (PK)
├── file_id (FK)
├── assigned_slot
├── status (pending, uploading, starting, printing, completed, failed)
├── printer_id (FK)
├── progress (0-100)
├── current_layer
├── total_layers
├── estimated_time_remaining
├── mqtt_message_id
├── error_message
├── started_at
└── completed_at

queue
├── id (PK)
├── job_id (FK, unique)
├── position (order in queue)
└── status

system_config
├── id (PK)
├── key (unique)
└── value
```

## API Architecture

### REST Endpoints Structure

```
/api/
├── /health                    # Health check
├── /devices                   # Device management
│   ├── GET /                  # List devices
│   ├── POST /                 # Add device
│   ├── PUT /{id}              # Update device
│   ├── DELETE /{id}           # Remove device
│   └── POST /{id}/test        # Test connection
├── /config                    # Configuration
│   ├── GET /rack              # Get rack config
│   ├── PUT /rack              # Update rack
│   ├── GET /slot/{id}         # Get slot status
│   └── PUT /slot/{id}/status  # Update slot
├── /files                     # File management
│   ├── POST /upload           # Upload file
│   ├── GET /                  # List files
│   ├── GET /{id}              # Get file info
│   ├── DELETE /{id}           # Delete file
│   └── GET /search/{name}     # Search files
├── /queue                     # Print queue
│   ├── GET /                  # Get queue
│   ├── POST /add              # Add job
│   ├── PUT /reorder           # Reorder queue
│   ├── DELETE /remove/{id}    # Remove job
│   ├── GET /next              # Next pending job
│   ├── PUT /job/{id}/status   # Update job status
│   └── GET /job/{id}          # Get job details
└── /control                   # Macro control
    ├── POST /macro            # Execute macro
    ├── GET /macros            # List macros
    ├── GET /macro/{name}      # Get macro info
    ├── POST /emergency-stop   # E-stop
    ├── POST /resume           # Resume
    └── GET /status            # System status
```

## MQTT Communication

### Bambu Lab Topics

**Subscribe to:**
- `device/{SERIAL}/report` - Printer status/progress updates

**Publish to:**
- `device/{SERIAL}/request` - Send commands to printer

### Message Format Example

```json
{
  "print": {
    "mc_percent": 45,
    "layer_num": 25,
    "total_layer_num": 100,
    "gcode_state": "RUNNING",
    "estimated_time": 2400
  }
}
```

## Authentication (LAN Only)

### Bambu Lab MQTT
- Username: `bblp`
- Password: [Access Code from app]
- TLS: Port 8883 (encrypted)

### Klipper/Moonraker
- No authentication (local network assumed trusted)
- REST API on port 7125

## Docker Deployment

### Multi-stage Build

1. **Frontend Build Stage**
   - Node 20 Alpine
   - Build React with Vite
   - Output to dist/

2. **Backend Runtime Stage**
   - Python 3.11 Slim
   - Install dependencies
   - Copy frontend dist for serving
   - Run Uvicorn

### Volumes

- `/app/uploads` → File storage
- `/app/db` → SQLite database

### Network

- Internal bridge network
- Services communicate via service names
- Exposed ports: 3000 (frontend), 8000 (API)

## Performance Considerations

- **Queue Processing**: Async operations recommended
- **MQTT**: Non-blocking event handler
- **Database**: SQLite adequate for single machine, consider PostgreSQL for multi-machine
- **File Uploads**: Streaming for large files recommended
- **Real-time Updates**: WebSocket implementation for live progress (future)

## Security Notes

- All credentials stored in database (use .env for secrets in production)
- MQTT uses TLS for Bambu Lab
- No authentication on API (add for production)
- File upload validation (type checking)
- Cross-origin requests enabled (restrict for production)

---

**Architecture Version 1.0 - Fully Documented**
