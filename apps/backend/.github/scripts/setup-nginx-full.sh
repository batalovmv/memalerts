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

# Check and remove ANY configurations that reference our domain (including SSL)
echo "Checking for all configurations with our domain..."
for config_file in /etc/nginx/sites-available/* /etc/nginx/sites-enabled/*; do
    if [ -f "$config_file" ] && grep -q "twitchmemes.ru" "$config_file" 2>/dev/null; then
        echo "Removing configuration with our domain from: $config_file"
        sudo rm -f "$config_file"
        # Also remove from sites-enabled if it's a symlink
        sudo rm -f "/etc/nginx/sites-enabled/$(basename "$config_file")" 2>/dev/null || true
    fi
done

# Also check for any SSL configurations created by certbot
if [ -d /etc/letsencrypt/renewal ]; then
    if [ -f /etc/letsencrypt/renewal/twitchmemes.ru.conf ]; then
        echo "Found certbot renewal config, but certificates don't exist yet"
        echo "This is OK - we'll get certificates after nginx is running"
    fi
fi

# Remove any certbot-created nginx configs if they exist
if [ -f /etc/nginx/sites-available/memalerts-le-ssl.conf ] || [ -f /etc/nginx/sites-enabled/memalerts-le-ssl.conf ]; then
    echo "Removing certbot-created SSL configs..."
    sudo rm -f /etc/nginx/sites-available/memalerts-le-ssl.conf
    sudo rm -f /etc/nginx/sites-enabled/memalerts-le-ssl.conf
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

# Verify the config file doesn't have SSL
if grep -q "ssl_certificate" /etc/nginx/sites-available/memalerts; then
    echo "ERROR: New config file contains SSL! This should not happen."
    exit 1
fi

# Enable site
sudo ln -sf /etc/nginx/sites-available/memalerts /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Double check no SSL configs are enabled
echo "Verifying no SSL configs are enabled..."
for enabled_file in /etc/nginx/sites-enabled/*; do
    if [ -f "$enabled_file" ] && grep -q "ssl_certificate.*twitchmemes.ru" "$enabled_file" 2>/dev/null; then
        echo "WARNING: Found SSL config in enabled file: $enabled_file"
        sudo rm -f "$enabled_file"
    fi
done

# Test nginx configuration (HTTP only for now)
echo "Testing nginx configuration..."
NGINX_TEST_OUTPUT=$(sudo nginx -t 2>&1)
NGINX_TEST_STATUS=$?

if [ $NGINX_TEST_STATUS -ne 0 ]; then
    echo "Error: Nginx configuration test failed!"
    echo "Test output:"
    echo "$NGINX_TEST_OUTPUT"
    
    # Check if error is about SSL certificate
    if echo "$NGINX_TEST_OUTPUT" | grep -q "ssl_certificate.*twitchmemes.ru"; then
        echo "Found SSL certificate error. Searching for all SSL references..."
        sudo grep -r "ssl_certificate.*twitchmemes.ru" /etc/nginx/ 2>/dev/null || echo "No SSL references found in grep"
        
        # List all nginx config files
        echo "All nginx config files:"
        sudo find /etc/nginx -name "*.conf" -o -name "*memalerts*" 2>/dev/null | while read file; do
            echo "Checking: $file"
            if sudo grep -q "twitchmemes.ru" "$file" 2>/dev/null; then
                echo "Found reference in: $file"
                sudo cat "$file"
            fi
        done
        
        echo "Removing all nginx configs and trying again..."
        sudo rm -f /etc/nginx/sites-available/memalerts
        sudo rm -f /etc/nginx/sites-enabled/memalerts
        
        # Recreate config
        sudo cp /tmp/memalerts-nginx.conf /etc/nginx/sites-available/memalerts
        sudo ln -sf /etc/nginx/sites-available/memalerts /etc/nginx/sites-enabled/memalerts
        
        # Test again
        if ! sudo nginx -t; then
            echo "Still failing after cleanup. Exiting."
            exit 1
        fi
    else
        echo "Configuration file:"
        sudo cat /etc/nginx/sites-available/memalerts || echo "Config file not found"
        exit 1
    fi
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
# Only try if domain is not an IP and nginx is running successfully
if [[ ! $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    # Check if nginx is running
    if systemctl is-active --quiet nginx; then
        echo "Getting SSL certificate for domain: $DOMAIN"
        echo "Note: Domain DNS must be pointing to this server for certbot to work"
        # Wait a moment for nginx to be fully ready
        sleep 3
        
        # Try to get certificate, but don't fail if it doesn't work
        sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect 2>&1 || {
            echo "Could not get SSL certificate. This is normal if:"
            echo "  1. Domain DNS is not fully propagated yet"
            echo "  2. Domain is not pointing to this server"
            echo "  3. Port 80 is not accessible from internet"
            echo ""
            echo "Nginx is running on HTTP. You can get SSL certificate later by running:"
            echo "sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
            echo ""
            echo "For now, site is accessible via HTTP at: http://$DOMAIN"
        }
        
        # Only reload if certbot succeeded (it updates the config automatically)
        if [ -f /etc/letsencrypt/live/$DOMAIN/fullchain.pem ]; then
            echo "SSL certificate obtained successfully, reloading nginx..."
            sudo systemctl reload nginx || true
        fi
    else
        echo "Nginx is not running, skipping SSL certificate setup"
    fi
else
    echo "Domain is an IP address. Skipping SSL certificate. For HTTPS, use a domain name."
fi

echo "Nginx configured successfully!"
echo "Frontend should be accessible at: https://$DOMAIN"
echo "API should be accessible at: https://$DOMAIN (same domain)"

