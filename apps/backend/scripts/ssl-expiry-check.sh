#!/bin/bash
set -euo pipefail

DOMAINS="${DOMAINS:-twitchmemes.ru beta.twitchmemes.ru}"
WARN_DAYS="${WARN_DAYS:-14}"
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
    -d "{\"content\":\"WARN: ${message}\"}" \
    "$ALERT_WEBHOOK" >/dev/null 2>&1 || true
}

resolve_alert_webhook

for domain in $DOMAINS; do
  EXPIRY="$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | cut -d= -f2)"

  if [ -z "$EXPIRY" ]; then
    echo "[ERROR] Could not get cert for $domain"
    send_alert "Could not get cert for $domain"
    continue
  fi

  EXPIRY_EPOCH="$(date -d "$EXPIRY" +%s)"
  NOW_EPOCH="$(date +%s)"
  DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))

  echo "[INFO] $domain: cert expires in $DAYS_LEFT days ($EXPIRY)"

  if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
    MSG="SSL cert for $domain expires in $DAYS_LEFT days"
    echo "[WARN] $MSG"
    send_alert "$MSG"
  fi
done
