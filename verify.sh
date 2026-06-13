#!/bin/bash

# Verification script to ensure Printloom is properly set up

echo "🔍 Printloom Setup Verification"
echo "==============================="
echo ""

# Check Docker
echo "Checking Docker installation..."
if command -v docker &> /dev/null; then
    echo "✓ Docker is installed"
    docker --version
else
    echo "✗ Docker is NOT installed"
    exit 1
fi

echo ""
echo "Checking Docker Compose..."
if command -v docker-compose &> /dev/null; then
    echo "✓ Docker Compose is installed"
    docker-compose --version
else
    echo "✗ Docker Compose is NOT installed"
    exit 1
fi

# Check required directories
echo ""
echo "Checking project structure..."

required_files=(
    "Dockerfile"
    "docker-compose.yml"
    "README.md"
    "QUICKSTART.md"
    "backend/requirements.txt"
    "backend/app/main.py"
    "frontend/package.json"
    "frontend/index.html"
)

all_exist=true
for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✓ Found: $file"
    else
        echo "✗ Missing: $file"
        all_exist=false
    fi
done

if [ "$all_exist" = false ]; then
    echo ""
    echo "Some files are missing. Make sure you're in the DIY directory."
    exit 1
fi

# Check Node.js
echo ""
echo "Checking Node.js (for frontend development)..."
if command -v node &> /dev/null; then
    echo "✓ Node.js is installed"
    node --version
else
    echo "ℹ Node.js is not installed (only needed for frontend development)"
fi

# Check Python
echo ""
echo "Checking Python (for backend development)..."
if command -v python3 &> /dev/null; then
    echo "✓ Python 3 is installed"
    python3 --version
else
    echo "ℹ Python 3 is not installed (only needed for backend development)"
fi

echo ""
echo "==============================="
echo "✅ All checks passed!"
echo ""
echo "Ready to deploy. Run:"
echo ""
echo "  docker-compose up -d"
echo ""
echo "Or use the start script:"
echo ""
echo "  bash start.sh"
echo ""
