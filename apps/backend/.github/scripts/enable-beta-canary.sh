#!/bin/bash
# Enable beta canary traffic split in nginx (10% by default).

set -euo pipefail

BACKEND_PORT="${1:-3002}"
CANARY_PORT="${2:-3003}"
CANARY_PERCENT="${3:-10}"

NGINX_SITE="/etc/nginx/sites-available/memalerts"
CANARY_CONF="/etc/nginx/conf.d/memalerts-beta-canary.conf"

if [ ! -f "$NGINX_SITE" ]; then
  echo "Nginx config not found: $NGINX_SITE"
  exit 1
fi

sudo tee "$CANARY_CONF" > /dev/null << EOF
map \$memalerts_beta_bucket \$memalerts_beta_upstream {
  default http://127.0.0.1:${BACKEND_PORT};
  stable http://127.0.0.1:${BACKEND_PORT};
  canary http://127.0.0.1:${CANARY_PORT};
}

split_clients "\${remote_addr}\${http_user_agent}" \$memalerts_beta_bucket {
  ${CANARY_PERCENT}% canary;
  * stable;
}
EOF

sudo sed -i "s|proxy_pass http://localhost:${BACKEND_PORT};|proxy_pass \\$memalerts_beta_upstream;|g" "$NGINX_SITE"
sudo sed -i "s|proxy_pass http://127.0.0.1:${BACKEND_PORT};|proxy_pass \\$memalerts_beta_upstream;|g" "$NGINX_SITE"

sudo nginx -t
sudo systemctl reload nginx

echo "✅ Canary enabled: ${CANARY_PERCENT}% -> ${CANARY_PORT}"
