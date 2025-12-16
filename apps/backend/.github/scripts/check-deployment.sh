#!/bin/bash
# Script to check deployment status and verify functionality

set -e

echo "=========================================="
echo "Deployment Status Check"
echo "=========================================="

# Check PM2 status
echo ""
echo "1. Checking PM2 status..."
pm2 status || {
    echo "❌ PM2 is not running or not installed"
    exit 1
}

# Check if backend process is running
if pm2 list | grep -q "memalerts-api"; then
    echo "✅ Backend process 'memalerts-api' is running"
    pm2 describe memalerts-api | grep -E "status|uptime|restarts" || true
else
    echo "❌ Backend process 'memalerts-api' is not found"
    exit 1
fi

# Check backend health endpoint
echo ""
echo "2. Checking backend health endpoint..."
HEALTH_RESPONSE=$(curl -s http://localhost:3001/health || echo "FAILED")
if echo "$HEALTH_RESPONSE" | grep -q '"status":"ok"'; then
    echo "✅ Backend health check passed"
    echo "Response: $HEALTH_RESPONSE"
else
    echo "❌ Backend health check failed"
    echo "Response: $HEALTH_RESPONSE"
    exit 1
fi

# Check if port 3001 is listening
echo ""
echo "3. Checking if port 3001 is listening..."
if netstat -tuln 2>/dev/null | grep -q ":3001 " || ss -tuln 2>/dev/null | grep -q ":3001 "; then
    echo "✅ Port 3001 is listening"
else
    echo "❌ Port 3001 is not listening"
    exit 1
fi

# Check database connection
echo ""
echo "4. Checking database connection..."
cd /opt/memalerts-backend
if [ -f .env ]; then
    source .env
    if [ -n "$DATABASE_URL" ]; then
        if pnpm prisma db execute --stdin <<< "SELECT 1;" > /dev/null 2>&1; then
            echo "✅ Database connection successful"
        else
            echo "⚠️  Database connection test failed (may need prisma generate)"
        fi
    else
        echo "⚠️  DATABASE_URL not set in .env"
    fi
else
    echo "⚠️  .env file not found"
fi

# Check migrations status
echo ""
echo "5. Checking database migrations..."
if command -v pnpm &> /dev/null && [ -f package.json ]; then
    cd /opt/memalerts-backend
    MIGRATION_STATUS=$(pnpm prisma migrate status 2>&1 || echo "FAILED")
    if echo "$MIGRATION_STATUS" | grep -q "Database schema is up to date"; then
        echo "✅ All migrations applied"
    else
        echo "⚠️  Migration status:"
        echo "$MIGRATION_STATUS"
    fi
else
    echo "⚠️  Cannot check migrations (pnpm not available)"
fi

# Check frontend files
echo ""
echo "6. Checking frontend files..."
if [ -d /opt/memalerts-frontend/dist ] && [ -f /opt/memalerts-frontend/dist/index.html ]; then
    echo "✅ Frontend files exist"
    echo "Files count: $(find /opt/memalerts-frontend/dist -type f | wc -l)"
else
    echo "❌ Frontend files not found"
    exit 1
fi

# Check Nginx status
echo ""
echo "7. Checking Nginx status..."
if systemctl is-active --quiet nginx; then
    echo "✅ Nginx is running"
    
    # Test Nginx config
    if sudo nginx -t 2>&1 | grep -q "syntax is ok"; then
        echo "✅ Nginx configuration is valid"
    else
        echo "❌ Nginx configuration has errors"
        sudo nginx -t
        exit 1
    fi
else
    echo "❌ Nginx is not running"
    exit 1
fi

# Check Nginx access to backend
echo ""
echo "8. Testing Nginx proxy to backend..."
NGINX_TEST=$(curl -s -o /dev/null -w "%{http_code}" http://localhost/health || echo "000")
if [ "$NGINX_TEST" = "200" ]; then
    echo "✅ Nginx can proxy to backend"
else
    echo "⚠️  Nginx proxy test returned: $NGINX_TEST"
fi

echo ""
echo "=========================================="
echo "✅ Deployment check completed!"
echo "=========================================="

