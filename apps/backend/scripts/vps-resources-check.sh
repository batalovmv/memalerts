#!/bin/bash
set -euo pipefail

DISK_THRESHOLD="${DISK_THRESHOLD:-85}"
MEM_THRESHOLD="${MEM_THRESHOLD:-90}"
UPLOADS_DIR="${UPLOADS_DIR:-/opt/memalerts-backend/uploads}"
TELEGRAM_BOT_TOKEN="${TELEGRAM_BOT_TOKEN:-}"
TELEGRAM_CHAT_ID="${TELEGRAM_CHAT_ID:-}"

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

resolve_telegram_config() {
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    return 0
  fi
  TELEGRAM_BOT_TOKEN="$(load_env_value "/opt/memalerts-backend/.env" "TELEGRAM_BOT_TOKEN")"
  TELEGRAM_CHAT_ID="$(load_env_value "/opt/memalerts-backend/.env" "TELEGRAM_CHAT_ID")"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    return 0
  fi
  TELEGRAM_BOT_TOKEN="$(load_env_value "/opt/memalerts-backend-beta/.env" "TELEGRAM_BOT_TOKEN")"
  TELEGRAM_CHAT_ID="$(load_env_value "/opt/memalerts-backend-beta/.env" "TELEGRAM_CHAT_ID")"
}

alert() {
  local msg="$1"
  echo "[WARN] $msg at $(date)"
  if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
    curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
      -d "chat_id=${TELEGRAM_CHAT_ID}" \
      --data-urlencode "text=WARN: ${msg}" >/dev/null 2>&1 || true
  fi
}

resolve_telegram_config

DISK_USED="$(df / | tail -1 | awk '{print $5}' | tr -d '%')"
if [ "${DISK_USED:-0}" -gt "$DISK_THRESHOLD" ]; then
  alert "Disk usage is ${DISK_USED}% (threshold: ${DISK_THRESHOLD}%)"
fi

MEM_USED="$(free | awk '/Mem:/ {printf "%.0f", $3/$2 * 100}')"
if [ "${MEM_USED:-0}" -gt "$MEM_THRESHOLD" ]; then
  alert "Memory usage is ${MEM_USED}% (threshold: ${MEM_THRESHOLD}%)"
fi

UPLOADS_SIZE="$(du -sh "$UPLOADS_DIR" 2>/dev/null | cut -f1 || echo "N/A")"
echo "[INFO] Uploads size: $UPLOADS_SIZE"

PM2_RUNNING=0
PM2_ERRORED=0
PM2_JSON=""

if command -v pm2 >/dev/null 2>&1; then
  PM2_JSON="$(pm2 jlist 2>/dev/null || true)"
else
  alert "PM2 is not installed"
fi

if [ -n "$PM2_JSON" ]; then
  if command -v jq >/dev/null 2>&1; then
    PM2_RUNNING="$(printf '%s' "$PM2_JSON" | jq 'map(select(.pm2_env.status == "online")) | length')"
    PM2_ERRORED="$(printf '%s' "$PM2_JSON" | jq 'map(select(.pm2_env.status == "errored")) | length')"
  elif command -v node >/dev/null 2>&1; then
    PM2_RUNNING="$(printf '%s' "$PM2_JSON" | node -e "const fs=require('fs');const data=fs.readFileSync(0,'utf8')||'[]';const list=JSON.parse(data);const online=list.filter(i=>i&&i.pm2_env&&i.pm2_env.status==='online').length;console.log(online);")"
    PM2_ERRORED="$(printf '%s' "$PM2_JSON" | node -e "const fs=require('fs');const data=fs.readFileSync(0,'utf8')||'[]';const list=JSON.parse(data);const err=list.filter(i=>i&&i.pm2_env&&i.pm2_env.status==='errored').length;console.log(err);")"
  else
    alert "Neither jq nor node available to parse PM2 status"
  fi
fi

if [ "${PM2_ERRORED:-0}" -gt 0 ]; then
  alert "PM2: $PM2_ERRORED process(es) in errored state"
fi

echo "[INFO] PM2: ${PM2_RUNNING:-0} online, ${PM2_ERRORED:-0} errored"
