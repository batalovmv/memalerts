#!/bin/bash
# Script to start backend with PM2

set -e

cd /opt/memalerts-backend

echo "Checking if backend is built..."
if [ ! -f dist/index.js ]; then
    echo "❌ Backend is not built. Building now..."
    pnpm install
    pnpm build
    pnpm prisma generate
fi

echo "Starting backend with PM2..."

# Stop and delete existing process if it exists
pm2 stop memalerts-api 2>/dev/null || true
pm2 delete memalerts-api 2>/dev/null || true

# Start backend
pm2 start dist/index.js --name memalerts-api --update-env

# Save PM2 configuration
pm2 save

# Wait a moment
sleep 3

# Check status
if pm2 list | grep -q "memalerts-api.*online"; then
    echo "✅ Backend is running"
    pm2 list | grep memalerts-api
    echo ""
    echo "Recent logs:"
    pm2 logs memalerts-api --lines 20 --nostream
else
    echo "❌ Backend failed to start"
    echo "Full logs:"
    pm2 logs memalerts-api --lines 50 --nostream
    exit 1
fi

