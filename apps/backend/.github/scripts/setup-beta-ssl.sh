#!/bin/bash
# Setup Let's Encrypt SSL certificate for beta subdomain
# This is needed when using DNS-only mode (gray cloud) in Cloudflare
# Cloudflare Origin Certificate only works with Proxy (orange cloud)

set -e

BETA_DOMAIN="${1:-beta.twitchmemes.ru}"

echo "Setting up Let's Encrypt SSL for beta domain: $BETA_DOMAIN"

# Verify sudo works without password
if ! sudo -n true 2>/dev/null; then
    echo "Error: sudo requires password. Please configure sudo without password first:"
    echo "echo 'deploy ALL=(ALL) NOPASSWD: ALL' | sudo tee /etc/sudoers.d/deploy"
    echo "sudo chmod 0440 /etc/sudoers.d/deploy"
    exit 1
fi

# Install certbot if not installed
if ! command -v certbot &> /dev/null; then
    echo "Installing certbot..."
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-nginx
fi

# Check if nginx config exists
if [ ! -f /etc/nginx/sites-available/memalerts ]; then
    echo "❌ Nginx config not found: /etc/nginx/sites-available/memalerts"
    echo "Please run setup-nginx-full.sh first"
    exit 1
fi

# Check if beta domain is in nginx config
if ! sudo grep -q "server_name.*$BETA_DOMAIN" /etc/nginx/sites-available/memalerts; then
    echo "❌ Beta domain not found in nginx config"
    echo "Please run setup-nginx-full.sh first to configure beta domain"
    exit 1
fi

# Backup current config
echo "Backing up nginx config..."
sudo cp /etc/nginx/sites-available/memalerts /etc/nginx/sites-available/memalerts.backup.$(date +%s)

# Temporarily update beta server block to use HTTP only (for certbot verification)
echo "Preparing nginx config for Let's Encrypt..."
sudo sed -i "s|ssl_certificate /etc/nginx/ssl/cloudflare-origin.crt;|# ssl_certificate /etc/nginx/ssl/cloudflare-origin.crt;|" /etc/nginx/sites-available/memalerts
sudo sed -i "s|ssl_certificate_key /etc/nginx/ssl/cloudflare-origin.key;|# ssl_certificate_key /etc/nginx/ssl/cloudflare-origin.key;|" /etc/nginx/sites-available/memalerts

# Find beta server block and temporarily change listen 443 to listen 80
sudo sed -i "/server_name.*$BETA_DOMAIN/,/^}/ s|listen 443 ssl http2;|listen 80;|" /etc/nginx/sites-available/memalerts

# Test nginx config
echo "Testing nginx config..."
if ! sudo nginx -t; then
    echo "❌ Nginx config test failed. Restoring backup..."
    sudo cp /etc/nginx/sites-available/memalerts.backup.* /etc/nginx/sites-available/memalerts
    exit 1
fi

# Reload nginx
sudo systemctl reload nginx

# Get Let's Encrypt certificate
echo "Getting Let's Encrypt certificate for $BETA_DOMAIN..."
echo "This requires the domain to be accessible from the internet (DNS-only mode in Cloudflare)"
echo ""

CERTBOT_OUTPUT=$(sudo certbot --nginx -d "$BETA_DOMAIN" --non-interactive --agree-tos --email admin@twitchmemes.ru --redirect 2>&1)
CERTBOT_STATUS=$?

if [ $CERTBOT_STATUS -eq 0 ]; then
    echo "✅ Let's Encrypt certificate obtained successfully!"
    echo ""
    echo "Certbot output:"
    echo "$CERTBOT_OUTPUT"
    
    # Test nginx config after certbot
    if sudo nginx -t; then
        sudo systemctl reload nginx
        echo ""
        echo "✅ HTTPS is now enabled for beta domain!"
        echo "Beta site is accessible at: https://$BETA_DOMAIN"
    else
        echo "❌ Nginx config test failed after certbot"
        exit 1
    fi
else
    echo "❌ Could not get SSL certificate"
    echo "Certbot output:"
    echo "$CERTBOT_OUTPUT"
    echo ""
    echo "Common issues:"
    echo "1. Domain must be accessible from the internet (DNS-only mode)"
    echo "2. Port 80 must be open and accessible"
    echo "3. Domain must resolve to this server's IP"
    echo ""
    echo "To get SSL certificate manually, run:"
    echo "sudo certbot --nginx -d $BETA_DOMAIN"
    echo ""
    echo "Restoring nginx config..."
    sudo cp /etc/nginx/sites-available/memalerts.backup.* /etc/nginx/sites-available/memalerts
    sudo nginx -t && sudo systemctl reload nginx
    exit 1
fi

echo ""
echo "=========================================="
echo "✅ Beta SSL setup completed!"
echo "=========================================="
echo "Beta domain: https://$BETA_DOMAIN"
echo ""
echo "Note: Let's Encrypt certificates expire in 90 days"
echo "Certbot will automatically renew them"
echo "To check renewal status: sudo certbot renew --dry-run"

