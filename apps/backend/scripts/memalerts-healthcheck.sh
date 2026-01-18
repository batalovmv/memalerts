#!/bin/bash
set -euo pipefail

PROD_URL="${PROD_URL:-http://127.0.0.1:3001/readyz}"
BETA_URL="${BETA_URL:-http://127.0.0.1:3002/readyz}"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

load_env_value() {
  local file="$1"
  local key="$2"
  local line
  local value
  if [ ! -f "$file" ]; then
    return 0
  fi
  line="$(grep -E "^[[:space:]]*${key}[[:space:]]*=" "$file" | tail -n 1 || true)"
  if [ -z "$line" ]; then
    return 0
  fi
  value="${line#*=}"
  value="$(printf '%s' "$value" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"
  if [ "${value#\"}" != "$value" ] && [ "${value%\"}" != "$value" ]; then
    value="${value%\"}"
    value="${value#\"}"
  fi
  if [ "${value#\'}" != "$value" ] && [ "${value%\'}" != "$value" ]; then
    value="${value%\'}"
    value="${value#\'}"
  fi
  value="${value%%#*}"
  value="$(printf '%s' "$value" | xargs)"
  printf '%s' "$value"
}

resolve_alert_webhook() {
  if [ -n "$ALERT_WEBHOOK" ]; then
    return 0
  fi
  ALERT_WEBHOOK="$(load_env_value "/opt/memalerts-backend/.env" "ALERT_WEBHOOK")"
  if [ -n "$ALERT_WEBHOOK" ]; then
    return 0
  fi
  ALERT_WEBHOOK="$(load_env_value "/opt/memalerts-backend-beta/.env" "ALERT_WEBHOOK")"
}

send_alert() {
  local message="$1"
  if [ -z "$ALERT_WEBHOOK" ]; then
    return 0
  fi
  curl -sS -X POST -H "Content-Type: application/json" \
    -d "{\"content\":\"${message}\"}" \
    "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
}

check_health() {
  local name="$1"
  local url="$2"
  if ! curl -fsS --max-time 10 "$url" > /dev/null 2>&1; then
    echo "[ALERT] ${name} is DOWN at $(date)"
    send_alert "ALERT: ${name} is DOWN"
    return 1
  fi
  return 0
}

resolve_alert_webhook

status=0
if ! check_health "Production API" "$PROD_URL"; then
  status=1
fi
if ! check_health "Beta API" "$BETA_URL"; then
  status=1
fi

exit "$status"
