# Printloom Developer Guide

## For Contributors & Extension Development

### Table of Contents
1. [Project Structure](#project-structure)
2. [Development Setup](#development-setup)
3. [Adding Features](#adding-features)
4. [Code Standards](#code-standards)
5. [Testing](#testing)
6. [Common Tasks](#common-tasks)
7. [Debugging](#debugging)

---

## Project Structure

### Backend Architecture

```python
# FastAPI app structure
app/
├── main.py              # Entry point, app setup, router registration
├── models/models.py     # SQLAlchemy ORM models
├── schemas/schemas.py   # Pydantic request/response models
├── routers/             # API endpoint handlers
│   ├── devices.py       # Device CRUD
│   ├── config.py        # Rack configuration
│   ├── files.py         # File upload/management
│   ├── queue.py         # Queue operations
│   └── control.py       # Macro execution
├── services/            # Business logic
│   ├── bambu_mqtt.py    # Bambu Lab connection
│   ├── moonraker.py     # Klipper API connection
│   └── queue_manager.py # Queue processing
└── db/database.py       # Database configuration
```

### Frontend Architecture

```jsx
src/
├── main.jsx             # Entry point
├── App.jsx              # Root component, routing
├── index.css            # Global Tailwind styles
├── components/          # Reusable components
│   ├── Navigation.jsx   # Sidebar
│   ├── RackVisualization.jsx
│   └── QueuePanel.jsx
├── pages/               # Full-page components
│   ├── Dashboard.jsx
│   ├── Configuration.jsx
│   ├── FileLibrary.jsx
│   └── ManualControls.jsx
└── services/
    └── api.js           # Axios instance & endpoints
```

---

## Development Setup

### Backend Development

```bash
# Navigate to backend
cd backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Install additional dev tools
pip install pytest pytest-asyncio black flake8

# Run development server
python -m uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend Development

```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Start dev server (hot reload)
npm run dev

# Build for production
npm run build

# Lint code
npm run lint
```

### Full Stack Development (with Docker)

```bash
# Start all services with Docker
docker-compose up

# View logs
docker-compose logs -f printloom

# Restart after code changes
docker-compose restart printloom
```

---

## Adding Features

### Adding a New API Endpoint

#### Step 1: Create Database Model (if needed)

In `backend/app/models/models.py`:

```python
from sqlalchemy import Column, String, Integer, DateTime
from datetime import datetime

class MyNewModel(Base):
    __tablename__ = "my_table"
    
    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), unique=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

#### Step 2: Create Pydantic Schema

In `backend/app/schemas/schemas.py`:

```python
from pydantic import BaseModel
from datetime import datetime

class MyModelCreate(BaseModel):
    name: str

class MyModelResponse(BaseModel):
    id: int
    name: str
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True
```

#### Step 3: Create Router

Create `backend/app/routers/my_feature.py`:

```python
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.database import get_db
from app.models.models import MyNewModel
from app.schemas.schemas import MyModelCreate, MyModelResponse

router = APIRouter()

@router.get("/", response_model=list[MyModelResponse])
async def list_items(db: Session = Depends(get_db)):
    """Get all items"""
    items = db.query(MyNewModel).all()
    return items

@router.post("/", response_model=MyModelResponse)
async def create_item(item: MyModelCreate, db: Session = Depends(get_db)):
    """Create new item"""
    db_item = MyNewModel(**item.dict())
    db.add(db_item)
    db.commit()
    db.refresh(db_item)
    return db_item

@router.get("/{item_id}", response_model=MyModelResponse)
async def get_item(item_id: int, db: Session = Depends(get_db)):
    """Get specific item"""
    item = db.query(MyNewModel).filter(MyNewModel.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item
```

#### Step 4: Register Router in Main App

In `backend/app/main.py`:

```python
from app.routers import my_feature

app.include_router(my_feature.router, prefix="/api/my-feature", tags=["My Feature"])
```

#### Step 5: Create Frontend Service

In `frontend/src/services/api.js`:

```javascript
export const myFeatureService = {
    listItems: () => api.get('/my-feature'),
    getItem: (id) => api.get(`/my-feature/${id}`),
    createItem: (data) => api.post('/my-feature', data),
    updateItem: (id, data) => api.put(`/my-feature/${id}`, data),
    deleteItem: (id) => api.delete(`/my-feature/${id}`),
}
```

#### Step 6: Create React Component

Create `frontend/src/pages/MyFeature.jsx`:

```jsx
import React, { useState, useEffect } from 'react'
import { myFeatureService } from '../services/api'

function MyFeature() {
    const [items, setItems] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState(null)

    useEffect(() => {
        loadItems()
    }, [])

    const loadItems = async () => {
        try {
            const res = await myFeatureService.listItems()
            setItems(res.data)
            setError(null)
        } catch (err) {
            setError('Failed to load items')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    const handleCreate = async (name) => {
        try {
            await myFeatureService.createItem({ name })
            loadItems()
            setError(null)
        } catch (err) {
            setError('Failed to create item')
        }
    }

    if (loading) return <div>Loading...</div>

    return (
        <div className="card">
            <h2 className="text-2xl font-bold mb-4">My Feature</h2>
            {error && <div className="error">{error}</div>}
            {/* Component UI */}
        </div>
    )
}

export default MyFeature
```

#### Step 7: Add to Navigation

In `frontend/src/components/Navigation.jsx`:

```jsx
const pages = [
    // ... existing pages
    { id: 'my-feature', label: 'My Feature', icon: '⚙️' },
]
```

---

## Code Standards

### Python

```python
# Use type hints
def process_item(item_id: int) -> dict:
    """Process an item with detailed docstring.
    
    Args:
        item_id: The ID of the item to process
        
    Returns:
        dict: Result with status and data
    """
    pass

# Format with black
# black app/

# Lint with flake8
# flake8 app/

# Use descriptive variable names
rack_config = get_rack_configuration()
not: cfg = get_rack_configuration()

# Add error handling
try:
    result = operation()
except SpecificException as e:
    logger.error(f"Operation failed: {str(e)}")
    raise HTTPException(status_code=400, detail=str(e))
```

### JavaScript/React

```jsx
// Use functional components
function MyComponent({ prop1, prop2 }) {
    const [state, setState] = useState(null)

    useEffect(() => {
        // Side effects
    }, [])

    return (
        <div className="component">
            {/* JSX */}
        </div>
    )
}

// Use descriptive names
const isConnected = device.status === 'active'
not: const ic = device.status === 'active'

// Add error boundaries
try {
    const response = await api.call()
} catch (error) {
    setError(error.message)
    console.error(error)
}

// Use Tailwind classes
className="bg-dark-800 text-dark-50 rounded px-4 py-2"
```

---

## Testing

### Backend Testing

```python
# Create test file: backend/tests/test_devices.py

import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_get_devices():
    """Test listing devices"""
    response = client.get("/api/devices")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_create_device():
    """Test creating device"""
    device_data = {
        "name": "Test Printer",
        "device_type": "bambu_lab",
        "ip_address": "192.168.1.100",
        "port": 8883,
        "serial_number": "12345",
        "access_code": "12345"
    }
    response = client.post("/api/devices", json=device_data)
    assert response.status_code == 200
    assert response.json()["name"] == "Test Printer"
```

Run tests:
```bash
cd backend
pytest

# With coverage
pytest --cov=app
```

### Frontend Testing

```bash
# Install testing library
npm install -D vitest @testing-library/react @testing-library/jest-dom

# Create test file: src/components/Navigation.test.jsx
# Add tests
# Run: npm test
```

---

## Common Tasks

### Add New Macro

In `backend/app/routers/control.py`:

```python
VALID_MACROS = {
    # ... existing macros
    "MY_NEW_MACRO",
}

macro_descriptions = {
    # ... existing descriptions
    "MY_NEW_MACRO": "Description of what this macro does",
}
```

Then use via API: `POST /api/control/macro` with `{"macro_name": "MY_NEW_MACRO"}`

### Add New Status Display

In `frontend/src/pages/Dashboard.jsx`:

```jsx
<div className="card">
    <h2 className="text-2xl font-bold mb-4">New Status</h2>
    <div className="text-3xl font-bold text-blue-400">
        {data.new_status}
    </div>
</div>
```

### Modify Database Schema

```python
# 1. Update model in backend/app/models/models.py
class MyModel(Base):
    __tablename__ = "my_table"
    # Add new columns

# 2. Delete existing database (data loss!)
rm backend/db/printloom.db

# 3. Restart application
docker-compose restart
```

### Add Environment Variable

1. Add to `.env.example`
2. Add to `docker-compose.yml` environment
3. Use in code: `os.getenv("VAR_NAME", "default_value")`

---

## Debugging

### Backend Debugging

```python
# Use logging
import logging
logger = logging.getLogger(__name__)

logger.debug("Debug message")
logger.info("Info message")
logger.warning("Warning message")
logger.error("Error message")

# Print debugging
print(f"Debug: {variable}")

# Use debugger
import pdb; pdb.set_trace()
```

View logs:
```bash
docker-compose logs -f printloom
```

### Frontend Debugging

```javascript
// Console logging
console.log('Debug:', variable)
console.error('Error:', error)

// React DevTools
// Install: https://react-devtools-tutorial.vercel.app/

// Check API responses
// Open: http://localhost:8000/docs

// Network debugging
// Chrome DevTools → Network tab
```

### Database Debugging

```bash
# Connect to SQLite database
sqlite3 backend/db/printloom.db

# List tables
.tables

# Query
SELECT * FROM devices;

# Exit
.quit
```

---

## Git Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes
# Test locally
# Commit
git add .
git commit -m "Add my feature"

# Push
git push origin feature/my-feature

# Create pull request
# Request review
# Merge after approval
```

---

## Performance Optimization

### Backend
```python
# Use async functions
async def get_data():
    # Non-blocking operations

# Use database indexes
class Device(Base):
    ip_address = Column(String(255), index=True)

# Cache frequent queries
from functools import lru_cache

@lru_cache
def get_config():
    return db.query(Config).first()
```

### Frontend
```jsx
// Use React.memo for expensive components
const MemoizedComponent = React.memo(MyComponent)

// Use useMemo for expensive calculations
const expensiveValue = useMemo(() => {
    return calculateExpensiveValue(data)
}, [data])

// Use useCallback for stable functions
const handleClick = useCallback(() => {
    // Handle click
}, [dependency])

// Code splitting
const LazyComponent = React.lazy(() => import('./Component'))
```

---

## Monitoring & Logging

### Application Logging

```python
# Configure logging
import logging

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
```

### Error Tracking

```python
# Add Sentry for production
import sentry_sdk
sentry_sdk.init("YOUR_SENTRY_DSN")
```

---

## Release Checklist

- [ ] All tests passing
- [ ] Code reviewed
- [ ] Documentation updated
- [ ] Version bumped
- [ ] Docker image built
- [ ] docker-compose.yml updated
- [ ] README.md updated
- [ ] CHANGELOG.md updated
- [ ] Deployment tested

---

## Resources

- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)
- [SQLAlchemy Documentation](https://docs.sqlalchemy.org/)
- [Tailwind CSS Documentation](https://tailwindcss.com/)
- [Docker Documentation](https://docs.docker.com/)

---

**Happy Contributing! 🚀**
