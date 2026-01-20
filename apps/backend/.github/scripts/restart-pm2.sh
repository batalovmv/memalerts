#!/bin/bash
# Script to properly restart backend with PM2

set -e

cd /opt/memalerts-backend

echo "Restarting backend with PM2..."

# Stop all PM2 processes
pm2 stop all 2>/dev/null || true

# Delete all processes
pm2 delete all 2>/dev/null || true

# Kill any process using port 3001
echo "Checking for processes on port 3001..."
PID=$(lsof -ti:3001 2>/dev/null || true)
if [ -n "$PID" ]; then
    echo "Killing process $PID on port 3001..."
    kill -9 $PID 2>/dev/null || true
    sleep 2
fi

# Check if dist/index.js exists
if [ ! -f dist/index.js ]; then
    echo "❌ dist/index.js not found. Building project..."
    pnpm install
    pnpm build
    pnpm prisma generate
fi

# Start backend with PM2
echo "Starting PM2 process..."
pm2 start dist/index.js --name memalerts-api --update-env

# Save PM2 configuration
pm2 save

# Wait a moment
sleep 3

# Check status
echo ""
echo "PM2 Status:"
pm2 list

echo ""
echo "Recent logs:"
pm2 logs memalerts-api --lines 20 --nostream

# Test health endpoint
echo ""
echo "Testing health endpoint..."
sleep 2
curl -f http://localhost:3001/health && echo "" || echo "❌ Health check failed"


