#!/bin/bash
# Initial server setup script
# Run this once on a fresh server

set -e

echo "Setting up server for memalerts-backend..."

# Update system
apt-get update
apt-get upgrade -y

# Install required packages
apt-get install -y \
    curl \
    git \
    postgresql \
    postgresql-contrib \
    nginx \
    certbot \
    python3-certbot-nginx \
    build-essential

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Install pnpm
npm install -g pnpm

# Install PM2
npm install -g pm2

# Create deploy user if it doesn't exist
if ! id "deploy" &>/dev/null; then
    useradd -m -s /bin/bash deploy
    usermod -aG sudo deploy
    echo "User 'deploy' created"
fi

# Configure sudo without password for deploy user
echo "deploy ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/deploy
chmod 0440 /etc/sudoers.d/deploy
echo "Sudo configured for deploy user"

# Create application directory
mkdir -p /opt/memalerts-backend
chown deploy:deploy /opt/memalerts-backend

# Setup PostgreSQL
systemctl start postgresql
systemctl enable postgresql

# Create database and user (adjust as needed)
sudo -u postgres psql << EOF
CREATE DATABASE memalerts;
CREATE USER memalerts_user WITH PASSWORD 'change_this_password';
GRANT ALL PRIVILEGES ON DATABASE memalerts TO memalerts_user;
\q
EOF

echo "Server setup complete!"
echo "Next steps:"
echo "1. Update PostgreSQL password in DATABASE_URL"
echo "2. Clone repository to /opt/memalerts-backend"
echo "3. Run setup-nginx.sh script"
echo "4. Configure GitHub Secrets"
echo "5. Push to main branch to trigger deployment"

