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
echo "Stopping nginx..."
sudo systemctl stop nginx 2>/dev/null || true
sleep 2

# NUCLEAR OPTION: Remove ALL site configurations first
echo "Removing ALL nginx site configurations..."
sudo rm -f /etc/nginx/sites-available/*
sudo rm -f /etc/nginx/sites-enabled/*
sudo rm -f /etc/nginx/sites-enabled/default

# Find and remove ALL configs with SSL references to our domain or Let's Encrypt
echo "Scanning ALL nginx configs for SSL references..."
find /etc/nginx -type f -name "*.conf" 2>/dev/null | while read config_file; do
    if [ -f "$config_file" ] && [ "$config_file" != "/etc/nginx/nginx.conf" ]; then
        # Check for any SSL reference to our domain or Let's Encrypt path
        if grep -qE "twitchmemes\.ru|ssl_certificate.*live/twitchmemes|ssl_certificate.*letsencrypt.*twitchmemes|/etc/letsencrypt/live/twitchmemes" "$config_file" 2>/dev/null; then
            echo "Found SSL reference in: $config_file"
            echo "Removing: $config_file"
            sudo rm -f "$config_file"
        fi
    fi
done

# Check main nginx.conf for includes or SSL references
echo "Checking main nginx.conf..."
if sudo grep -qE "twitchmemes\.ru|ssl_certificate.*live/twitchmemes|ssl_certificate.*letsencrypt.*twitchmemes" /etc/nginx/nginx.conf 2>/dev/null; then
    echo "WARNING: Found SSL references in main nginx.conf!"
    echo "This is unusual. Main config should not have domain-specific SSL."
    # Try to backup and create clean main config
    sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup.$(date +%s)
    # Remove SSL lines from main config (be careful here)
    sudo sed -i '/ssl_certificate.*twitchmemes/d' /etc/nginx/nginx.conf 2>/dev/null || true
fi

# Remove any certbot-created configs and renewal configs
echo "Removing certbot-created configs..."
sudo rm -f /etc/nginx/sites-available/*-le-ssl.conf
sudo rm -f /etc/nginx/sites-enabled/*-le-ssl.conf
sudo rm -f /etc/nginx/conf.d/*twitchmemes* 2>/dev/null || true

# List all remaining configs for debugging
echo "Remaining nginx configs:"
sudo ls -la /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null || true
echo "Configs in conf.d:"
sudo ls -la /etc/nginx/conf.d/ 2>/dev/null || true

# Verify no SSL configs remain by testing nginx
echo "Verifying cleanup by testing nginx config..."
NGINX_TEST=$(sudo nginx -t 2>&1)
NGINX_TEST_STATUS=$?

if [ $NGINX_TEST_STATUS -ne 0 ]; then
    echo "Nginx test failed. Output:"
    echo "$NGINX_TEST"
    
    if echo "$NGINX_TEST" | grep -qE "ssl_certificate.*twitchmemes|ssl_certificate.*letsencrypt.*twitchmemes|/etc/letsencrypt/live/twitchmemes"; then
        echo "ERROR: Still found SSL references after cleanup!"
        echo ""
        echo "Searching for remaining SSL configs..."
        sudo grep -rE "ssl_certificate.*twitchmemes|ssl_certificate.*letsencrypt.*twitchmemes|/etc/letsencrypt/live/twitchmemes" /etc/nginx/ 2>/dev/null || true
        echo ""
        echo "NUCLEAR OPTION: Removing ALL configs in conf.d and sites..."
        sudo rm -f /etc/nginx/conf.d/*
        sudo rm -f /etc/nginx/sites-available/*
        sudo rm -f /etc/nginx/sites-enabled/*
        echo "All site configs removed. Will create fresh config."
    else
        echo "Nginx test failed for non-SSL reason. Continuing anyway..."
    fi
else
    echo "✅ Nginx config test passed - no SSL errors found"
fi

# Check if Cloudflare Origin Certificate is provided via environment
USE_CLOUDFLARE_CERT=false
echo "Checking for Cloudflare Origin Certificate..."
echo "CLOUDFLARE_CERT length: ${#CLOUDFLARE_CERT}"
echo "CLOUDFLARE_KEY length: ${#CLOUDFLARE_KEY}"

if [ -n "$CLOUDFLARE_CERT" ] && [ -n "$CLOUDFLARE_KEY" ] && [ "${#CLOUDFLARE_CERT}" -gt 100 ] && [ "${#CLOUDFLARE_KEY}" -gt 100 ]; then
    USE_CLOUDFLARE_CERT=true
    echo "✅ Using Cloudflare Origin Certificate"
    
    # Create certificate directory
    sudo mkdir -p /etc/nginx/ssl
    
    # Save certificate and key
    echo "$CLOUDFLARE_CERT" | sudo tee /etc/nginx/ssl/cloudflare-origin.crt > /dev/null
    echo "$CLOUDFLARE_KEY" | sudo tee /etc/nginx/ssl/cloudflare-origin.key > /dev/null
    
    # Set proper permissions
    sudo chmod 644 /etc/nginx/ssl/cloudflare-origin.crt
    sudo chmod 600 /etc/nginx/ssl/cloudflare-origin.key
    sudo chown root:root /etc/nginx/ssl/cloudflare-origin.*
    
    # Verify files were created
    if [ -f /etc/nginx/ssl/cloudflare-origin.crt ] && [ -f /etc/nginx/ssl/cloudflare-origin.key ]; then
        echo "✅ Cloudflare Origin Certificate installed successfully"
    else
        echo "❌ Failed to create certificate files"
        USE_CLOUDFLARE_CERT=false
    fi
else
    echo "⚠️  Cloudflare Origin Certificate not provided or invalid"
    echo "Will use Let's Encrypt instead (requires DNS-only mode)"
fi

# Create nginx configuration
if [ "$USE_CLOUDFLARE_CERT" = true ]; then
    # Configuration with Cloudflare Origin Certificate (HTTPS)
    cat > /tmp/memalerts-nginx.conf << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;
    return 301 https://\$server_name\$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # Cloudflare Origin Certificate
    ssl_certificate /etc/nginx/ssl/cloudflare-origin.crt;
    ssl_certificate_key /etc/nginx/ssl/cloudflare-origin.key;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-RSA-AES128-SHA256:ECDHE-RSA-AES256-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Frontend static files
    root /opt/memalerts-frontend/dist;
    index index.html;

    # Backend routes (auth, webhooks, etc.) - proxy first
    # Use exact match for /me to ensure it's caught before location /
    # location = has highest priority in Nginx
    # IMPORTANT: proxy_pass without trailing slash preserves the URI
    location = /me {
        proxy_pass http://localhost:$BACKEND_PORT/me;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        proxy_cache_bypass \$http_upgrade;
        proxy_pass_header Set-Cookie;
        proxy_cookie_path / /;
        proxy_intercept_errors off;
        proxy_next_upstream off;
        proxy_redirect off;
    }
    
    # Other backend routes
    location ~ ^/(auth|webhooks|channels|wallet|memes|submissions|admin|uploads|health|socket\.io) {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        proxy_cache_bypass \$http_upgrade;
        
        # Pass Set-Cookie headers from backend
        proxy_pass_header Set-Cookie;
        proxy_cookie_path / /;
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
    # IMPORTANT: This must come AFTER all backend routes
    # try_files will try to find the file, and if not found, serve index.html
    # This should NOT match /me because location = /me has higher priority
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
else
    # Configuration without SSL (HTTP only, will get Let's Encrypt later)
    cat > /tmp/memalerts-nginx.conf << EOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # Frontend static files
    root /opt/memalerts-frontend/dist;
    index index.html;

    # Backend routes (auth, webhooks, etc.) - proxy first
    # Use exact match for /me to ensure it's caught before location /
    # location = has highest priority in Nginx
    # IMPORTANT: proxy_pass without trailing slash preserves the URI
    location = /me {
        proxy_pass http://localhost:$BACKEND_PORT/me;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        proxy_cache_bypass \$http_upgrade;
        proxy_pass_header Set-Cookie;
        proxy_cookie_path / /;
        proxy_intercept_errors off;
        proxy_next_upstream off;
        proxy_redirect off;
    }
    
    # Other backend routes
    location ~ ^/(auth|webhooks|channels|wallet|memes|submissions|admin|uploads|health|socket\.io) {
        proxy_pass http://localhost:$BACKEND_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Cookie \$http_cookie;
        proxy_cache_bypass \$http_upgrade;
        
        # Pass Set-Cookie headers from backend
        proxy_pass_header Set-Cookie;
        proxy_cookie_path / /;
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
    # IMPORTANT: This must come AFTER all backend routes
    # try_files will try to find the file, and if not found, serve index.html
    # This should NOT match /me because location = /me has higher priority
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
fi

# Ensure frontend directory exists
mkdir -p /opt/memalerts-frontend/dist
if [ ! -f /opt/memalerts-frontend/dist/index.html ]; then
  echo "<!DOCTYPE html><html><head><title>MemAlerts</title></head><body><h1>Frontend deploying...</h1></body></html>" > /opt/memalerts-frontend/dist/index.html
fi

# Copy configuration to nginx directory
sudo cp /tmp/memalerts-nginx.conf /etc/nginx/sites-available/memalerts
rm -f /tmp/memalerts-nginx.conf

# Verify the config file was created
if [ ! -f /etc/nginx/sites-available/memalerts ]; then
    echo "ERROR: Failed to create nginx config file!"
    exit 1
fi

# Only check for Let's Encrypt SSL if not using Cloudflare (Cloudflare cert is OK)
if [ "$USE_CLOUDFLARE_CERT" != true ]; then
    if grep -qE "ssl_certificate.*letsencrypt|ssl_certificate.*/etc/letsencrypt" /etc/nginx/sites-available/memalerts; then
        echo "ERROR: New config file contains Let's Encrypt SSL! This should not happen."
        exit 1
    fi
else
    echo "✅ Config file created (Cloudflare SSL is expected)"
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
    echo "ERROR: Nginx configuration test failed!"
    echo "Test output:"
    echo "$NGINX_TEST_OUTPUT"
    
    # Check if error is about SSL certificate
    if echo "$NGINX_TEST_OUTPUT" | grep -q "ssl_certificate.*twitchmemes.ru"; then
        echo "SSL certificate error detected. Performing deep cleanup..."
        
        # Remove ALL configs again
        sudo rm -f /etc/nginx/sites-available/memalerts*
        sudo rm -f /etc/nginx/sites-enabled/memalerts*
        
        # Find and remove any file with SSL reference
        sudo find /etc/nginx -type f -name "*.conf" 2>/dev/null | while read file; do
            if sudo grep -q "ssl_certificate.*twitchmemes.ru" "$file" 2>/dev/null; then
                echo "Removing SSL config from: $file"
                # Try to remove just SSL lines, or remove file if it's a site config
                if [[ "$file" == *"sites-"* ]]; then
                    sudo rm -f "$file"
                else
                    echo "Warning: SSL reference in main config file: $file"
                fi
            fi
        done
        
        # Recreate clean HTTP config
        sudo cp /tmp/memalerts-nginx.conf /etc/nginx/sites-available/memalerts
        sudo ln -sf /etc/nginx/sites-available/memalerts /etc/nginx/sites-enabled/memalerts
        
        # Test again
        echo "Retesting after deep cleanup..."
        if ! sudo nginx -t; then
            echo "FATAL: Still failing after deep cleanup!"
            echo "Remaining config files:"
            sudo ls -la /etc/nginx/sites-available/ /etc/nginx/sites-enabled/ 2>/dev/null || true
            exit 1
        fi
    else
        echo "Non-SSL configuration error:"
        echo "Configuration file:"
        sudo cat /etc/nginx/sites-available/memalerts || echo "Config file not found"
        exit 1
    fi
fi

echo "✅ Nginx configuration test passed!"

# Start nginx with HTTP config first
echo "Starting nginx with HTTP configuration..."
sudo systemctl start nginx || {
    echo "Failed to start nginx, checking status..."
    sudo systemctl status nginx || true
    exit 1
}
sudo systemctl enable nginx

# Ensure nginx is reloaded to apply any changes
echo "Reloading nginx to ensure configuration is applied..."
sudo systemctl reload nginx || sudo systemctl restart nginx

# Get SSL certificate via Let's Encrypt (only if not using Cloudflare cert)
if [ "$USE_CLOUDFLARE_CERT" != true ] && [[ ! $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    # Verify nginx is running on HTTP first
    if ! systemctl is-active --quiet nginx; then
        echo "ERROR: Nginx is not running after HTTP setup!"
        exit 1
    fi
    
    echo "=========================================="
    echo "Getting Let's Encrypt SSL certificate for HTTPS"
    echo "Domain: $DOMAIN"
    echo "=========================================="
    
    # Wait for nginx to be fully ready
    sleep 3
    
    # Get SSL certificate - certbot will automatically:
    # 1. Get certificate from Let's Encrypt
    # 2. Update nginx config to use HTTPS
    # 3. Add redirect from HTTP to HTTPS
    echo "Running certbot to get SSL certificate..."
    CERTBOT_OUTPUT=$(sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos --email admin@$DOMAIN --redirect 2>&1)
    CERTBOT_STATUS=$?
    
    if [ $CERTBOT_STATUS -eq 0 ]; then
        echo "✅ SSL certificate obtained successfully!"
        echo "Certbot output:"
        echo "$CERTBOT_OUTPUT"
        
        # Certbot automatically updated nginx config, test it
        echo "Testing updated nginx configuration with SSL..."
        if sudo nginx -t; then
            echo "✅ SSL configuration is valid, reloading nginx..."
            sudo systemctl reload nginx
            echo "✅ HTTPS is now enabled!"
            echo "Site is accessible at: https://$DOMAIN"
        else
            echo "WARNING: SSL config test failed after certbot"
            echo "Nginx is still running on HTTP"
        fi
    else
        echo "❌ Could not get SSL certificate"
        echo "Certbot output:"
        echo "$CERTBOT_OUTPUT"
        echo ""
        echo "Nginx is running on HTTP. To get SSL certificate manually, run:"
        echo "sudo certbot --nginx -d $DOMAIN -d www.$DOMAIN"
    fi
elif [ "$USE_CLOUDFLARE_CERT" = true ]; then
    echo "✅ Using Cloudflare Origin Certificate - HTTPS is configured!"
    echo "Site is accessible at: https://$DOMAIN"
elif [[ $DOMAIN =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Domain is an IP address. Cannot get SSL certificate for IP."
    echo "Use a domain name for HTTPS support."
fi

echo "Nginx configured successfully!"
echo "Frontend should be accessible at: https://$DOMAIN"
echo "API should be accessible at: https://$DOMAIN (same domain)"

# Verify that /me location is in the config
echo "Verifying /me location in config..."
if grep -q "location.*/me" /etc/nginx/sites-available/memalerts; then
    echo "✅ Found 'location ... /me' in config"
    echo "Location block:"
    sudo grep -A 10 "location.*/me" /etc/nginx/sites-available/memalerts || true
else
    echo "❌ ERROR: 'location ... /me' NOT found in config!"
    echo "Config file contents:"
    sudo cat /etc/nginx/sites-available/memalerts | grep -A 10 "location" || true
    exit 1
fi

# Explicitly reload nginx after config creation to ensure it's active
echo "Reloading Nginx after config creation..."
sudo -n nginx -t && sudo -n systemctl reload nginx || sudo -n systemctl restart nginx
echo "✅ Nginx reloaded successfully"

