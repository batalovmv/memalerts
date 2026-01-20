#!/bin/bash
# Disable beta canary traffic split and return to stable port.

set -euo pipefail

BACKEND_PORT="${1:-3002}"

NGINX_SITE="/etc/nginx/sites-available/memalerts"
CANARY_CONF="/etc/nginx/conf.d/memalerts-beta-canary.conf"

if [ ! -f "$NGINX_SITE" ]; then
  echo "Nginx config not found: $NGINX_SITE"
  exit 1
fi

sudo rm -f "$CANARY_CONF"
sudo sed -i "s|proxy_pass \\$memalerts_beta_upstream;|proxy_pass http://127.0.0.1:${BACKEND_PORT};|g" "$NGINX_SITE"

sudo nginx -t
sudo systemctl reload nginx

echo "✅ Canary disabled; routed to ${BACKEND_PORT}"
