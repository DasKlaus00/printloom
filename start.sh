#!/bin/bash

# Printloom Startup Script

set -e

echo "🚀 Starting Printloom..."

# Check if Docker is installed
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Desktop or Docker Engine."
    exit 1
fi

echo "📦 Building application..."
docker-compose build

echo "🔧 Starting services..."
docker-compose up -d

echo ""
echo "✅ Printloom is starting..."
echo ""
echo "📍 Access the application:"
echo "   Frontend: http://localhost:3000"
echo "   API: http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "💡 To view logs: docker-compose logs -f"
echo "🛑 To stop: docker-compose down"
echo ""
