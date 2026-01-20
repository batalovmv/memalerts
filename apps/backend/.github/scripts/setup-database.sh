#!/bin/bash
# Script to setup database and user for memalerts
# Automatically extracts credentials from DATABASE_URL in .env

set -e

# Check if .env exists
if [ ! -f /opt/memalerts-backend/.env ]; then
    echo "❌ .env file not found at /opt/memalerts-backend/.env"
    echo "Cannot setup database without DATABASE_URL"
    exit 1
fi

# Source .env to get DATABASE_URL
cd /opt/memalerts-backend
source .env

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL is not set in .env"
    exit 1
fi

# Extract database credentials from DATABASE_URL
# Format: postgresql://user:password@host:port/database?schema=public
DB_USER=$(echo $DATABASE_URL | sed -n 's/.*:\/\/\([^:]*\):.*/\1/p')
DB_PASSWORD=$(echo $DATABASE_URL | sed -n 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/p')
DB_HOST=$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo $DATABASE_URL | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_NAME=$(echo $DATABASE_URL | sed -n 's/.*\/\([^?]*\).*/\1/p')

if [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ] || [ -z "$DB_NAME" ]; then
    echo "❌ Cannot parse DATABASE_URL. Expected format: postgresql://user:password@host:port/database?schema=public"
    echo "Current DATABASE_URL: ${DATABASE_URL:0:50}..."
    exit 1
fi

echo "Extracted from DATABASE_URL:"
echo "  User: $DB_USER"
echo "  Host: ${DB_HOST:-localhost}"
echo "  Port: ${DB_PORT:-5432}"
echo "  Database: $DB_NAME"

echo "Setting up PostgreSQL database for memalerts..."

# Check if PostgreSQL is running
if ! systemctl is-active --quiet postgresql; then
    echo "Starting PostgreSQL..."
    systemctl start postgresql
    sleep 2
fi

# Create user if it doesn't exist
echo "Creating database user '$DB_USER'..."
sudo -u postgres psql << EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
        RAISE NOTICE 'User $DB_USER created';
    ELSE
        RAISE NOTICE 'User $DB_USER already exists, updating password...';
        -- Update password in case it changed in DATABASE_URL
        ALTER USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
    END IF;
END
\$\$;
EOF

# Create database if it doesn't exist
echo "Creating database..."
sudo -u postgres psql << EOF
SELECT 'CREATE DATABASE $DB_NAME'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$DB_NAME')\gexec
EOF

# Grant privileges
echo "Granting privileges..."
sudo -u postgres psql << EOF
GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;
ALTER DATABASE $DB_NAME OWNER TO $DB_USER;
EOF

# Grant schema privileges (important for Prisma)
echo "Granting schema privileges..."
sudo -u postgres psql -d $DB_NAME << EOF
GRANT ALL ON SCHEMA public TO $DB_USER;
ALTER SCHEMA public OWNER TO $DB_USER;
EOF

echo "✅ Database setup complete!"
echo "Database: $DB_NAME"
echo "User: $DB_USER"
echo "Password: $DB_PASSWORD"

# Test connection
echo ""
echo "Testing connection..."
export PGPASSWORD=$DB_PASSWORD
psql -U $DB_USER -d $DB_NAME -h localhost -c "SELECT version();" || {
    echo "❌ Connection test failed"
    exit 1
}

echo "✅ Connection test successful!"

