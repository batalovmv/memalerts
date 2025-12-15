#!/bin/bash
# Full nginx setup for memalerts with API proxy
# Run this once on the server to configure nginx

set -e

DOMAIN="${1:-twitchmemes.ru}"
BACKEND_PORT="${2:-3001}"

echo "Setting up nginx for domain: $DOMAIN"

# Install nginx and certbot if not installed
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

# Create nginx configuration
cat > /etc/nginx/sites-available/memalerts << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # SSL configuration (will be updated by certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

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

# Enable site
ln -sf /etc/nginx/sites-available/memalerts /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

# Get SSL certificate
if [[ ! $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Getting SSL certificate for domain: $DOMAIN"
    certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || {
        echo "Warning: Could not get SSL certificate. You may need to configure it manually."
    }
else
    echo "Domain is an IP address. For HTTPS with IP, consider using a domain name."
fi

# Reload nginx
systemctl reload nginx
systemctl enable nginx

echo "Nginx configured successfully!"
echo "Frontend should be accessible at: https://$DOMAIN"
echo "API should be accessible at: https://$DOMAIN (same domain)"

