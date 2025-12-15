#!/bin/bash
# Script to setup nginx with HTTPS for memalerts-backend
# Run this once on the server to configure nginx

set -e

DOMAIN="${1:-155.212.172.136}"
BACKEND_PORT="${2:-3001}"

echo "Setting up nginx for domain: $DOMAIN"

# Install nginx if not installed
if ! command -v nginx &> /dev/null; then
    echo "Installing nginx..."
    apt-get update
    apt-get install -y nginx certbot python3-certbot-nginx
fi

# Create nginx configuration
cat > /etc/nginx/sites-available/memalerts-backend << EOF
server {
    listen 80;
    server_name $DOMAIN;

    # Redirect HTTP to HTTPS
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    # SSL configuration (will be updated by certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # Proxy to backend
    location / {
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
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/memalerts-backend /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

# If domain is not an IP, get SSL certificate
if [[ ! $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Getting SSL certificate for domain: $DOMAIN"
    certbot --nginx -d $DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN || {
        echo "Warning: Could not get SSL certificate. You may need to configure it manually."
        echo "For IP addresses, you may need to use a self-signed certificate or Cloudflare."
    }
else
    echo "Domain is an IP address. For HTTPS with IP, consider:"
    echo "1. Using a domain name with Let's Encrypt"
    echo "2. Using Cloudflare Tunnel"
    echo "3. Using a self-signed certificate (not recommended for production)"
    
    # Create self-signed certificate for IP (not recommended but works)
    echo "Creating self-signed certificate for IP..."
    mkdir -p /etc/nginx/ssl
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/nginx/ssl/memalerts.key \
        -out /etc/nginx/ssl/memalerts.crt \
        -subj "/CN=$DOMAIN" \
        -addext "subjectAltName=IP:$DOMAIN" || {
        echo "Could not create self-signed certificate"
        exit 1
    }
    
    # Update nginx config to use self-signed cert
    sed -i "s|ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;|ssl_certificate /etc/nginx/ssl/memalerts.crt;|" /etc/nginx/sites-available/memalerts-backend
    sed -i "s|ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;|ssl_certificate_key /etc/nginx/ssl/memalerts.key;|" /etc/nginx/sites-available/memalerts-backend
    
    nginx -t
fi

# Reload nginx
systemctl reload nginx
systemctl enable nginx

echo "Nginx configured successfully!"
echo "Backend should be accessible at: https://$DOMAIN"

