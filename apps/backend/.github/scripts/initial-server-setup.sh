#!/bin/bash
# Initial server setup - run this ONCE on the server as root
# This script configures sudo for deploy user and sets up basic permissions

set -e

DEPLOY_USER="${1:-deploy}"

echo "Setting up server for user: $DEPLOY_USER"

# Create deploy user if it doesn't exist
if ! id "$DEPLOY_USER" &>/dev/null; then
    echo "Creating user $DEPLOY_USER..."
    useradd -m -s /bin/bash "$DEPLOY_USER"
    usermod -aG sudo "$DEPLOY_USER"
fi

# Configure sudo for nginx and systemctl commands
echo "Configuring sudo for $DEPLOY_USER..."
cat > /etc/sudoers.d/deploy-nginx << EOF
# Allow deploy user to manage nginx and systemd without password
$DEPLOY_USER ALL=(ALL) NOPASSWD: /usr/bin/nginx, /usr/sbin/nginx, /bin/systemctl, /usr/bin/systemctl, /usr/bin/certbot, /usr/bin/apt-get, /usr/bin/apt
EOF

chmod 0440 /etc/sudoers.d/deploy-nginx

# Create application directories
mkdir -p /opt/memalerts-backend
mkdir -p /opt/memalerts-frontend
chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/memalerts-backend
chown -R "$DEPLOY_USER:$DEPLOY_USER" /opt/memalerts-frontend

# Install required packages
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx and certbot..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

if ! command -v node &> /dev/null; then
    echo "Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi

if ! command -v pnpm &> /dev/null; then
    echo "Installing pnpm..."
    npm install -g pnpm
fi

if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2..."
    npm install -g pm2
fi

echo "Server setup complete!"
echo "User $DEPLOY_USER can now run nginx and systemctl commands without password"

