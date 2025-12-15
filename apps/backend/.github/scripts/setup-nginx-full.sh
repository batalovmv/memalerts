#!/bin/bash
# Full nginx setup for memalerts with API proxy
# Run this once on the server to configure nginx

set -e

DOMAIN="${1:-twitchmemes.ru}"
BACKEND_PORT="${2:-3001}"

echo "Setting up nginx for domain: $DOMAIN"

# Verify sudo works without password
if ! sudo -n true 2>/dev/null; then
    echo "Error: sudo requires password. Please configure sudo without password first:"
    echo "echo 'deploy ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/deploy"
    echo "sudo chmod 0440 /etc/sudoers.d/deploy"
    exit 1
fi

echo "✅ Sudo configuration verified"

# Install nginx and certbot if not installed
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    sudo apt-get update
    sudo apt-get install -y nginx certbot python3-certbot-nginx
fi

# Stop nginx completely before reconfiguring
if systemctl is-active --quiet nginx; then
    echo "Stopping nginx before reconfiguration..."
    sudo systemctl stop nginx || true
    sleep 1
fi

# Remove ALL old configurations to start fresh
echo "Removing old nginx configurations..."
sudo rm -f /etc/nginx/sites-available/memalerts
sudo rm -f /etc/nginx/sites-enabled/memalerts
sudo rm -f /etc/nginx/sites-enabled/default

# Verify nginx config is clean (no SSL references)
if [ -f /etc/nginx/nginx.conf ]; then
    if grep -q "ssl_certificate.*twitchmemes.ru" /etc/nginx/nginx.conf 2>/dev/null; then
        echo "Warning: Found SSL references in main nginx.conf, but continuing..."
    fi
fi

# Create nginx configuration - start with HTTP only (no SSL)
cat > /tmp/memalerts-nginx.conf << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Frontend static files
    root /opt/memalerts-frontend/dist;
    index index.html;

    # Backend routes (auth, webhooks, etc.) - proxy first
    location ~ ^/(auth|webhooks|channels|me|wallet|memes|submissions|admin|uploads|health) {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # WebSocket support for Socket.IO
    location /socket.io/ {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Frontend routes
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # Static assets
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# Ensure frontend directory exists
mkdir -p /opt/memalerts-frontend/dist
if [ ! -f /opt/memalerts-frontend/dist/index.html ]; then
  echo "<!DOCTYPE html><html><head><title>MemAlerts</title></head><body><h1>Frontend deploying...</h1></body></html>" > /opt/memalerts-frontend/dist/index.html
fi

# Copy configuration to nginx directory
sudo cp /tmp/memalerts-nginx.conf /etc/nginx/sites-available/memalerts
rm -f /tmp/memalerts-nginx.conf

# Enable site
sudo ln -sf /etc/nginx/sites-available/memalerts /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration (HTTP only for now)
echo "Testing nginx configuration..."
if ! sudo nginx -t; then
    echo "Error: Nginx configuration test failed!"
    echo "Configuration file:"
    sudo cat /etc/nginx/sites-available/memalerts || echo "Config file not found"
    echo "Checking for SSL references..."
    sudo grep -r "ssl_certificate.*twitchmemes.ru" /etc/nginx/ 2>/dev/null || echo "No SSL references found"
    exit 1
fi

# Start nginx with HTTP config first
echo "Starting nginx with HTTP configuration..."
sudo systemctl start nginx || {
    echo "Failed to start nginx, checking status..."
    sudo systemctl status nginx || true
    exit 1
}
sudo systemctl enable nginx

# Get SSL certificate (certbot will automatically update config to HTTPS)
if [[ ! $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Getting SSL certificate for domain: $DOMAIN"
    echo "Note: Domain must be pointing to this server for certbot to work"
    # Wait a moment for nginx to start
    sleep 2
    sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect || {
        echo "Warning: Could not get SSL certificate. This is normal if:"
        echo "  1. Domain DNS is not configured yet"
        echo "  2. Domain is not pointing to this server"
        echo "You can run manually later: sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
    }
    # Reload nginx after certbot updates config
    sudo systemctl reload nginx || true
else
    echo "Domain is an IP address. Skipping SSL certificate. For HTTPS, use a domain name."
fi

echo "Nginx configured successfully!"
echo "Frontend should be accessible at: https://$DOMAIN"
echo "API should be accessible at: https://$DOMAIN (same domain)"

