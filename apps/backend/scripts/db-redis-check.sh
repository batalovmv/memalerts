#!/bin/bash
set -euo pipefail

PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-5432}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
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

alert() {
  local msg="$1"
  echo "[ALERT] $msg at $(date)"
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"ALERT: $msg\"}" "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
  fi
}

resolve_alert_webhook

if command -v pg_isready >/dev/null 2>&1; then
  if pg_isready -h "$PGHOST" -p "$PGPORT" -q; then
    echo "[OK] PostgreSQL is ready"
  else
    alert "PostgreSQL is not responding on ${PGHOST}:${PGPORT}"
  fi
else
  alert "pg_isready is not installed"
fi

if command -v redis-cli >/dev/null 2>&1; then
  if redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
    echo "[OK] Redis is ready"
  else
    alert "Redis is not responding on ${REDIS_HOST}:${REDIS_PORT}"
  fi
else
  alert "redis-cli is not installed"
fi
