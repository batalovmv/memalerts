#!/bin/bash
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://127.0.0.1:3001}}"
CHANNEL_SLUG="${CHANNEL_SLUG:-}"

assert_status_ok() {
  local url="$1"
  local json
  json="$(curl -fsS --max-time 10 "$url")"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$json" | jq -e '.status == "ok"' >/dev/null
  elif command -v node >/dev/null 2>&1; then
    printf '%s' "$json" | node -e "const fs=require('fs');const data=fs.readFileSync(0,'utf8');const parsed=JSON.parse(data);if(parsed.status!=='ok'){process.exit(1);}"
  else
    echo "[ERROR] jq or node is required to parse JSON"
    return 1
  fi
}

echo "=== Smoke Test: $BASE_URL ==="

assert_status_ok "$BASE_URL/health"
echo "[OK] /health"

assert_status_ok "$BASE_URL/healthz"
echo "[OK] /healthz"

assert_status_ok "$BASE_URL/readyz"
echo "[OK] /readyz"

if [ -n "$CHANNEL_SLUG" ]; then
  curl -fsS --max-time 10 "$BASE_URL/public/channels/$CHANNEL_SLUG" >/dev/null
  echo "[OK] /public/channels/$CHANNEL_SLUG"
fi

echo "=== All smoke tests passed ==="
