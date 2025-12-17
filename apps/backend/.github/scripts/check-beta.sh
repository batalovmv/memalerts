#!/bin/bash
# Quick check script for beta deployment
# Run this on the server to verify beta setup

set -e

BETA_DOMAIN="${1:-beta.twitchmemes.ru}"

echo "=========================================="
echo "BETA DEPLOYMENT CHECK"
echo "=========================================="
echo "Beta domain: $BETA_DOMAIN"
echo ""

# 1. Check beta backend
echo "1. Checking beta backend..."
if pm2 list | grep -q "memalerts-api-beta.*online"; then
    echo "✅ Beta backend is running"
    pm2 list | grep memalerts-api-beta
    echo ""
    echo "   Testing health endpoint..."
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3002/health || echo "000")
    if [ "$HTTP_CODE" = "200" ]; then
        echo "   ✅ Health check passed (HTTP $HTTP_CODE)"
    else
        echo "   ❌ Health check failed (HTTP $HTTP_CODE)"
    fi
else
    echo "❌ Beta backend is NOT running"
    echo "   Run: cd /opt/memalerts-backend-beta && pm2 start dist/index.js --name memalerts-api-beta"
fi

echo ""

# 2. Check beta frontend files
echo "2. Checking beta frontend files..."
if [ -d /opt/memalerts-frontend-beta/dist ] && [ -f /opt/memalerts-frontend-beta/dist/index.html ]; then
    echo "✅ Beta frontend files exist"
    FILE_COUNT=$(find /opt/memalerts-frontend-beta/dist -type f 2>/dev/null | wc -l)
    echo "   Files count: $FILE_COUNT"
else
    echo "❌ Beta frontend files NOT found"
    echo "   Expected: /opt/memalerts-frontend-beta/dist/index.html"
fi

echo ""

# 3. Check nginx configuration
echo "3. Checking nginx configuration..."
if sudo grep -q "server_name.*$BETA_DOMAIN" /etc/nginx/sites-available/memalerts 2>/dev/null; then
    echo "✅ Beta domain found in nginx config"
    echo "   Server block:"
    sudo grep -A 2 "server_name.*$BETA_DOMAIN" /etc/nginx/sites-available/memalerts | head -3
else
    echo "❌ Beta domain NOT found in nginx config"
    echo "   Current server_name entries:"
    sudo grep "server_name" /etc/nginx/sites-available/memalerts 2>/dev/null | head -5 || echo "   No config found"
fi

echo ""

# 4. Check nginx status
echo "4. Checking nginx status..."
if sudo systemctl is-active --quiet nginx; then
    echo "✅ Nginx is running"
    
    # Test nginx config
    if sudo nginx -t 2>&1 | grep -q "syntax is ok"; then
        echo "   ✅ Nginx configuration is valid"
    else
        echo "   ❌ Nginx configuration has errors:"
        sudo nginx -t 2>&1 | grep -i error || true
    fi
else
    echo "❌ Nginx is NOT running"
    echo "   Run: sudo systemctl start nginx"
fi

echo ""

# 5. Check SSL certificate
echo "5. Checking SSL certificate..."
if [ -f /etc/nginx/ssl/cloudflare-origin.crt ] && [ -f /etc/nginx/ssl/cloudflare-origin.key ]; then
    echo "✅ SSL certificate files exist"
    
    # Check certificate validity
    if sudo openssl x509 -in /etc/nginx/ssl/cloudflare-origin.crt -noout -checkend 0 2>/dev/null; then
        echo "   ✅ Certificate is valid"
        EXPIRY=$(sudo openssl x509 -in /etc/nginx/ssl/cloudflare-origin.crt -noout -enddate 2>/dev/null | cut -d= -f2)
        echo "   Expires: $EXPIRY"
        
        # Check if certificate includes beta domain
        CERT_DOMAINS=$(sudo openssl x509 -in /etc/nginx/ssl/cloudflare-origin.crt -noout -text 2>/dev/null | grep -i "DNS:" | sed 's/.*DNS://' | tr ',' '\n' | xargs)
        if echo "$CERT_DOMAINS" | grep -q "twitchmemes.ru\|twitchalerts.ru"; then
            echo "   ✅ Certificate includes domain"
            echo "   Domains in certificate: $CERT_DOMAINS"
        else
            echo "   ⚠️  Certificate domain check inconclusive"
        fi
    else
        echo "   ❌ Certificate is invalid or expired"
    fi
else
    echo "❌ SSL certificate files NOT found"
    echo "   Expected: /etc/nginx/ssl/cloudflare-origin.crt"
fi

echo ""

# 6. Check DNS resolution
echo "6. Checking DNS resolution..."
if command -v nslookup > /dev/null 2>&1; then
    if nslookup "$BETA_DOMAIN" > /dev/null 2>&1; then
        echo "✅ DNS resolves for $BETA_DOMAIN"
        RESOLVED_IP=$(nslookup "$BETA_DOMAIN" 2>/dev/null | grep -A 1 "Name:" | tail -1 | awk '{print $2}' || echo "")
        if [ -n "$RESOLVED_IP" ]; then
            echo "   Resolved to: $RESOLVED_IP"
        fi
    else
        echo "❌ DNS does NOT resolve for $BETA_DOMAIN"
        echo "   Please check Cloudflare DNS settings"
        echo "   Add A record: beta -> [YOUR_VPS_IP]"
    fi
elif command -v dig > /dev/null 2>&1; then
    RESOLVED_IP=$(dig "$BETA_DOMAIN" +short 2>/dev/null | head -1)
    if [ -n "$RESOLVED_IP" ]; then
        echo "✅ DNS resolves for $BETA_DOMAIN"
        echo "   Resolved to: $RESOLVED_IP"
    else
        echo "❌ DNS does NOT resolve for $BETA_DOMAIN"
        echo "   Please check Cloudflare DNS settings"
    fi
else
    echo "⚠️  Cannot check DNS (nslookup and dig not available)"
fi

echo ""

# 7. Test local nginx response
echo "7. Testing local nginx response..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -H "Host: $BETA_DOMAIN" http://localhost/ 2>/dev/null || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Nginx responds with HTTP 200"
elif [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    echo "✅ Nginx redirects (HTTP $HTTP_CODE) - normal for HTTPS redirect"
elif [ "$HTTP_CODE" = "502" ]; then
    echo "⚠️  Nginx returns 502 Bad Gateway"
    echo "   Backend might not be running or not responding"
elif [ "$HTTP_CODE" = "000" ]; then
    echo "❌ Cannot connect to nginx"
else
    echo "⚠️  Nginx returned HTTP $HTTP_CODE"
fi

echo ""
echo "=========================================="
echo "SUMMARY"
echo "=========================================="
echo "Beta domain: https://$BETA_DOMAIN"
echo ""
echo "To fix issues:"
echo "1. DNS not resolving: Add A record in Cloudflare"
echo "2. Backend not running: cd /opt/memalerts-backend-beta && pm2 start dist/index.js --name memalerts-api-beta"
echo "3. Frontend missing: Deploy frontend to /opt/memalerts-frontend-beta"
echo "4. Nginx not configured: Run setup-nginx-full.sh script"
echo "5. SSL issues: Check /etc/nginx/ssl/cloudflare-origin.crt"
echo "=========================================="

