#!/bin/bash
# Script to check database configuration

echo "=== PostgreSQL Status ==="
systemctl status postgresql --no-pager | head -15

echo ""
echo "=== PostgreSQL Version ==="
psql --version 2>/dev/null || echo "psql not found in PATH"

echo ""
echo "=== Database List ==="
sudo -u postgres psql -c "\l" 2>/dev/null || echo "Cannot list databases"

echo ""
echo "=== Users List ==="
sudo -u postgres psql -c "\du" 2>/dev/null || echo "Cannot list users"

echo ""
echo "=== Check memalerts database ==="
sudo -u postgres psql -c "\c memalerts" -c "\dt" 2>/dev/null || echo "Cannot connect to memalerts database"

echo ""
echo "=== Current .env DATABASE_URL (masked) ==="
if [ -f /opt/memalerts-backend/.env ]; then
    grep "DATABASE_URL" /opt/memalerts-backend/.env | sed 's/:[^@]*@/:***@/g' || echo "DATABASE_URL not found in .env"
else
    echo ".env file not found at /opt/memalerts-backend/.env"
fi

echo ""
echo "=== Test connection with current DATABASE_URL ==="
if [ -f /opt/memalerts-backend/.env ]; then
    cd /opt/memalerts-backend
    source .env
    if [ -n "$DATABASE_URL" ]; then
        # Extract connection details
        echo "Testing connection..."
        # Try to connect using psql
        PGPASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
        PGUSER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
        PGHOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
        PGPORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
        PGDB=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')
        
        echo "Host: $PGHOST"
        echo "Port: $PGPORT"
        echo "Database: $PGDB"
        echo "User: $PGUSER"
        
        export PGPASSWORD
        psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDB" -c "SELECT version();" 2>&1 | head -5
    else
        echo "DATABASE_URL is not set in .env"
    fi
fi


