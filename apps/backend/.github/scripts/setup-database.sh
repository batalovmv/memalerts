#!/bin/bash
# Script to setup database and user for memalerts

set -e

DB_NAME="memalerts"
DB_USER="memalerts_user"
DB_PASSWORD="14ypanxPtHNnwIoHhwCB"

echo "Setting up PostgreSQL database for memalerts..."

# Check if PostgreSQL is running
if ! systemctl is-active --quiet postgresql; then
    echo "Starting PostgreSQL..."
    systemctl start postgresql
    sleep 2
fi

# Create user if it doesn't exist
echo "Creating database user..."
sudo -u postgres psql << EOF
DO \$\$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '$DB_USER') THEN
        CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';
        RAISE NOTICE 'User $DB_USER created';
    ELSE
        RAISE NOTICE 'User $DB_USER already exists';
        -- Update password in case it changed
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

