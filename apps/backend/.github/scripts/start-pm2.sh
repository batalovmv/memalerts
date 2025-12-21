#!/bin/bash
# Script to start backend with PM2

set -e

cd /opt/memalerts-backend

echo "Starting backend with PM2..."

# Check if dist/index.js exists
if [ ! -f dist/index.js ]; then
    echo "❌ dist/index.js not found. Building project..."
    pnpm install
    pnpm build
    pnpm prisma generate
fi

# Stop and delete existing process if it exists
pm2 stop memalerts-api 2>/dev/null || true
pm2 delete memalerts-api 2>/dev/null || true

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


