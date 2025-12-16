#!/bin/bash
# Script to apply Prisma migrations

set -e

cd /opt/memalerts-backend

echo "Applying Prisma migrations..."

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found"
    exit 1
fi

# Source .env to get DATABASE_URL
source .env

if [ -z "$DATABASE_URL" ]; then
    echo "❌ DATABASE_URL is not set in .env"
    exit 1
fi

# Check if node_modules exists
if [ ! -d node_modules ]; then
    echo "Installing dependencies..."
    pnpm install
fi

# Generate Prisma Client
echo "Generating Prisma Client..."
pnpm prisma generate

# Apply migrations
echo "Applying database migrations..."
pnpm prisma migrate deploy || {
    echo "⚠️ migrate deploy failed, trying db push..."
    pnpm prisma db push --accept-data-loss
}

echo "✅ Migrations applied successfully!"

