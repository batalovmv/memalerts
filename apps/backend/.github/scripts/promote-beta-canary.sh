#!/bin/bash
# Promote beta canary to full traffic (switch nginx to canary port).

set -euo pipefail

BACKEND_PORT="${1:-3002}"
CANARY_PORT="${2:-3003}"

NGINX_SITE="/etc/nginx/sites-available/memalerts"
CANARY_CONF="/etc/nginx/conf.d/memalerts-beta-canary.conf"

if [ ! -f "$NGINX_SITE" ]; then
  echo "Nginx config not found: $NGINX_SITE"
  exit 1
fi

sudo rm -f "$CANARY_CONF"
sudo sed -i "s|proxy_pass \\$memalerts_beta_upstream;|proxy_pass http://127.0.0.1:${CANARY_PORT};|g" "$NGINX_SITE"
sudo sed -i "s|proxy_pass http://localhost:${BACKEND_PORT};|proxy_pass http://127.0.0.1:${CANARY_PORT};|g" "$NGINX_SITE"

sudo nginx -t
sudo systemctl reload nginx

echo "✅ Canary promoted: 100% -> ${CANARY_PORT}"
