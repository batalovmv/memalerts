# 🖥️ VPS Monitoring & Health Checks — План развития

## 📊 Что уже есть

### Health Endpoints (в API)
| Endpoint | Назначение | Статус |
|----------|------------|--------|
| `GET /health` | Базовый health + build info | ✅ Есть |
| `GET /healthz` | Kubernetes-style liveness | ✅ Есть |
| `GET /readyz` | Readiness + DB check | ✅ Есть |
| `GET /health/circuits` | Circuit breaker статусы | ✅ Есть |
| `GET /health/workers` | Worker heartbeats + очереди | ✅ Есть |

### Скрипты мониторинга
| Скрипт | Назначение | Статус |
|--------|------------|--------|
| `scripts/monitor-once.ts` | AI/Outbox/Workers проверка | ✅ Есть |
| `scripts/verify-backup.ts` | Проверка свежести бэкапов | ✅ Есть |
| `scripts/memalerts-healthcheck.sh` | Healthcheck prod+beta | ✅ Есть |
| `scripts/vps-resources-check.sh` | Disk/Memory/PM2 check | ✅ Есть |
| `scripts/ssl-expiry-check.sh` | SSL expiry check | ✅ Есть |
| `scripts/db-redis-check.sh` | Postgres/Redis check | ✅ Есть |
| `scripts/smoke-test-vps.sh` | Smoke tests | ✅ Есть |

### Observability стек (docker-compose)
| Компонент | Назначение | Статус |
|-----------|------------|--------|
| Prometheus | Метрики | ✅ Настроен |
| Grafana | Дашборды + алерты | ✅ 5 дашбордов |
| Jaeger | Distributed tracing | ✅ Настроен |
| Vector → ELK | Централизованные логи | ✅ Настроен |

### PM2
- `memalerts-api` (prod:3001)
- `memalerts-api-beta` (beta:3002)
- `pm2-logrotate` модуль

---

## 🔴 Критичные (добавить первыми)

### 1. Cron: автоматический healthcheck

**Цель:** Каждые 5 минут проверять что API жив, оповещать при падении

**Реализация:**
```bash
# /usr/local/bin/memalerts-healthcheck.sh
#!/bin/bash
set -euo pipefail

PROD_URL="http://127.0.0.1:3001/readyz"
BETA_URL="http://127.0.0.1:3002/readyz"
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"  # Discord/Telegram/Slack webhook

check_health() {
  local name=$1
  local url=$2
  
  if ! curl -fsS --max-time 10 "$url" > /dev/null 2>&1; then
    echo "[ALERT] $name is DOWN at $(date)"
    if [ -n "$ALERT_WEBHOOK" ]; then
      curl -X POST -H "Content-Type: application/json" \
        -d "{\"content\":\"🔴 **$name** is DOWN!\"}" \
        "$ALERT_WEBHOOK"
    fi
    return 1
  fi
  return 0
}

check_health "Production API" "$PROD_URL"
check_health "Beta API" "$BETA_URL"
```

**Cron:**
```cron
*/5 * * * * /usr/local/bin/memalerts-healthcheck.sh >> /var/log/memalerts-healthcheck.log 2>&1
```

**Статус:** ✅ Реализовано

---

### 2. Cron: monitor-once регулярный запуск

**Цель:** Проверять AI jobs, outbox backlog, worker heartbeats

**Реализация:**
```cron
# Каждые 15 минут
*/15 * * * * /bin/bash -lc 'cd /opt/memalerts-backend && pnpm monitor:once' >> /var/log/memalerts-monitor.log 2>&1
```

**Статус:** ✅ Реализовано

---

### 3. Cron: backup verification

**Цель:** Проверять что бэкапы свежие и читаемые

**Реализация:**
```cron
# Каждый час создаем backup
0 * * * * /usr/local/bin/backup-db.sh >> /var/log/memalerts-backup.log 2>&1
# Каждый час (через 10 мин после бэкапа)
10 * * * * /bin/bash -lc 'cd /opt/memalerts-backend && BACKUP_DIR=/backups pnpm backup:verify' >> /var/log/memalerts-backup-verify.log 2>&1
```

**Статус:** ✅ Реализовано (backup-db.sh + verify)

---

## 🟠 Средние (добавить после критичных)

### 4. Скрипт: системные ресурсы

**Цель:** Мониторинг диска, памяти, CPU

**Файл:** `scripts/vps-resources-check.sh`
```bash
#!/bin/bash
set -euo pipefail

DISK_THRESHOLD=85
MEM_THRESHOLD=90
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

alert() {
  local msg=$1
  echo "[WARN] $msg at $(date)"
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"⚠️ $msg\"}" "$ALERT_WEBHOOK"
  fi
}

# Disk usage (root partition)
DISK_USED=$(df / | tail -1 | awk '{print $5}' | tr -d '%')
if [ "$DISK_USED" -gt "$DISK_THRESHOLD" ]; then
  alert "Disk usage is ${DISK_USED}% (threshold: ${DISK_THRESHOLD}%)"
fi

# Memory usage
MEM_USED=$(free | grep Mem | awk '{printf "%.0f", $3/$2 * 100}')
if [ "$MEM_USED" -gt "$MEM_THRESHOLD" ]; then
  alert "Memory usage is ${MEM_USED}% (threshold: ${MEM_THRESHOLD}%)"
fi

# Uploads directory size
UPLOADS_SIZE=$(du -sh /opt/memalerts-backend/uploads 2>/dev/null | cut -f1 || echo "N/A")
echo "[INFO] Uploads size: $UPLOADS_SIZE"

# PM2 process count
PM2_RUNNING=$(pm2 jlist 2>/dev/null | jq 'map(select(.pm2_env.status == "online")) | length' || echo 0)
PM2_ERRORED=$(pm2 jlist 2>/dev/null | jq 'map(select(.pm2_env.status == "errored")) | length' || echo 0)

if [ "$PM2_ERRORED" -gt 0 ]; then
  alert "PM2: $PM2_ERRORED process(es) in errored state"
fi

echo "[INFO] PM2: $PM2_RUNNING online, $PM2_ERRORED errored"
```

**Cron:**
```cron
*/30 * * * * /bin/bash -lc '/opt/memalerts-backend/scripts/vps-resources-check.sh' >> /var/log/memalerts-resources.log 2>&1
```

**Статус:** ✅ Реализовано

---

### 5. Скрипт: SSL certificate expiry

**Цель:** Предупреждать за 14 дней до истечения сертификата

**Файл:** `scripts/ssl-expiry-check.sh`
```bash
#!/bin/bash
set -euo pipefail

DOMAINS="twitchmemes.ru beta.twitchmemes.ru"
WARN_DAYS=14
ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

for domain in $DOMAINS; do
  EXPIRY=$(echo | openssl s_client -servername "$domain" -connect "$domain:443" 2>/dev/null \
    | openssl x509 -noout -enddate 2>/dev/null \
    | cut -d= -f2)
  
  if [ -z "$EXPIRY" ]; then
    echo "[ERROR] Could not get cert for $domain"
    continue
  fi
  
  EXPIRY_EPOCH=$(date -d "$EXPIRY" +%s)
  NOW_EPOCH=$(date +%s)
  DAYS_LEFT=$(( (EXPIRY_EPOCH - NOW_EPOCH) / 86400 ))
  
  echo "[INFO] $domain: cert expires in $DAYS_LEFT days ($EXPIRY)"
  
  if [ "$DAYS_LEFT" -lt "$WARN_DAYS" ]; then
    MSG="SSL cert for $domain expires in $DAYS_LEFT days!"
    echo "[WARN] $MSG"
    if [ -n "$ALERT_WEBHOOK" ]; then
      curl -sS -X POST -H "Content-Type: application/json" \
        -d "{\"content\":\"🔒 $MSG\"}" "$ALERT_WEBHOOK"
    fi
  fi
done
```

**Cron:**
```cron
0 9 * * * /bin/bash -lc '/opt/memalerts-backend/scripts/ssl-expiry-check.sh' >> /var/log/memalerts-ssl.log 2>&1
```

**Статус:** ✅ Реализовано

---

### 6. Скрипт: проверка Postgres + Redis

**Цель:** Убедиться что DB и Redis доступны

**Файл:** `scripts/db-redis-check.sh`
```bash
#!/bin/bash
set -euo pipefail

ALERT_WEBHOOK="${ALERT_WEBHOOK:-}"

alert() {
  local msg=$1
  echo "[ALERT] $msg at $(date)"
  if [ -n "$ALERT_WEBHOOK" ]; then
    curl -sS -X POST -H "Content-Type: application/json" \
      -d "{\"content\":\"🔴 $msg\"}" "$ALERT_WEBHOOK"
  fi
}

# PostgreSQL
if ! pg_isready -h 127.0.0.1 -p 5432 -q; then
  alert "PostgreSQL is not responding!"
else
  echo "[OK] PostgreSQL is ready"
fi

# Redis
if ! redis-cli -h 127.0.0.1 -p 6379 ping > /dev/null 2>&1; then
  alert "Redis is not responding!"
else
  echo "[OK] Redis is ready"
fi
```

**Cron:**
```cron
*/5 * * * * /bin/bash -lc '/opt/memalerts-backend/scripts/db-redis-check.sh' >> /var/log/memalerts-db-redis.log 2>&1
```

**Статус:** ✅ Реализовано

---

## 🟡 Дополнительные (опционально)

### 7. Smoke tests на VPS

**Цель:** E2E проверка критичных endpoint-ов

**Файл:** `scripts/smoke-test-vps.sh`
```bash
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
  else
    printf '%s' "$json" | node -e "const fs=require('fs');const data=fs.readFileSync(0,'utf8');const parsed=JSON.parse(data);if(parsed.status!=='ok'){process.exit(1);}"
  fi
}

echo "=== Smoke Test: $BASE_URL ==="

# Health endpoints
assert_status_ok "$BASE_URL/health"
echo "[OK] /health"

assert_status_ok "$BASE_URL/healthz"
echo "[OK] /healthz"

assert_status_ok "$BASE_URL/readyz"
echo "[OK] /readyz"

if [ -n "$CHANNEL_SLUG" ]; then
  curl -fsS "$BASE_URL/public/channels/$CHANNEL_SLUG" >/dev/null
  echo "[OK] /public/channels/$CHANNEL_SLUG"
fi

echo "=== All smoke tests passed ==="
```

**Статус:** ✅ Реализовано (проверено для prod+beta)

---

### 8. Внешний Uptime мониторинг

**Цель:** Проверять доступность извне (не с VPS)

**Варианты:**
- UptimeRobot (бесплатно до 50 мониторов)
- Healthchecks.io (cron monitoring)
- Better Uptime
- Собственный сервер с curl

**Endpoints для мониторинга:**
- `https://twitchmemes.ru/health`
- `https://beta.twitchmemes.ru/health`
- `https://twitchmemes.ru/readyz`

**Реализация:**
- GitHub Actions: `.github/workflows/external-uptime.yml` (каждые 5 минут)
- Опционально: secret `ALERT_WEBHOOK` для уведомлений

**Статус:** ✅ Реализовано

---

### 9. Log rotation проверка

**Цель:** Убедиться что логи не съедают диск

**Проверить:**
```bash
# PM2 logrotate status
pm2 describe pm2-logrotate

# Nginx logrotate
cat /etc/logrotate.d/nginx

# Размер логов
du -sh /home/deploy/.pm2/logs/
du -sh /var/log/nginx/
```

**Фактический результат (2026-01-18):**
- pm2-logrotate: online, rotateInterval `0 0 * * *`, retain=14, max_size=50M, compress=true
- /home/deploy/.pm2/logs/: 46M
- /var/log/nginx/: 576K

**Статус:** ✅ Проверено

---

### 10. Alerting интеграция

**Цель:** Оповещения в Telegram/Discord/Slack

**Варианты:**
1. **Discord Webhook** — просто, бесплатно
2. **Telegram Bot** — требует бот + chat_id
3. **Slack Incoming Webhook** — корпоративный вариант

**Настройка:**
```bash
# Добавить в /opt/memalerts-backend/.env (на VPS, не в репо!)
ALERT_WEBHOOK=https://discord.com/api/webhooks/xxx/yyy
```

**Статус:** ✅ Реализовано (переменная добавлена, значение можно заполнить позже)

---

## 📋 Чеклист внедрения

| # | Задача | Приоритет | Время | Статус |
|---|--------|-----------|-------|--------|
| 1 | Healthcheck cron (prod+beta) | 🔴 P0 | 15 мин | ✅ |
| 2 | monitor-once cron | 🔴 P0 | 5 мин | ✅ |
| 3 | backup:verify cron | 🔴 P0 | 5 мин | ✅ |
| 4 | Ресурсы (disk/mem/PM2) | 🟠 P1 | 20 мин | ✅ |
| 5 | SSL expiry check | 🟠 P1 | 15 мин | ✅ |
| 6 | DB + Redis check | 🟠 P1 | 10 мин | ✅ |
| 7 | Smoke tests | 🟡 P2 | 15 мин | ✅ |
| 8 | Внешний uptime | 🟡 P2 | 20 мин | ✅ |
| 9 | Log rotation audit | 🟡 P2 | 10 мин | ✅ |
| 10 | Alerting webhook | 🟡 P2 | 15 мин | ✅ |

**Общее время:** ~2 часа

---

## 🚀 Quick Start (минимум для prod)

```bash
# SSH на VPS
ssh deploy@155.212.172.136

# 1. Создать директорию для скриптов
mkdir -p /usr/local/bin

# 2. Healthcheck скрипт
sudo tee /usr/local/bin/memalerts-healthcheck.sh << 'EOF'
#!/bin/bash
curl -fsS --max-time 10 http://127.0.0.1:3001/readyz > /dev/null || echo "[ALERT] Prod API DOWN at $(date)"
curl -fsS --max-time 10 http://127.0.0.1:3002/readyz > /dev/null || echo "[ALERT] Beta API DOWN at $(date)"
EOF
sudo chmod +x /usr/local/bin/memalerts-healthcheck.sh

# 3. Добавить cron
crontab -e
# Добавить строки:
# 0 * * * * /usr/local/bin/backup-db.sh >> /var/log/memalerts-backup.log 2>&1
# */5 * * * * /usr/local/bin/memalerts-healthcheck.sh >> /var/log/memalerts-healthcheck.log 2>&1
# */15 * * * * /bin/bash -lc 'cd /opt/memalerts-backend && pnpm monitor:once' >> /var/log/memalerts-monitor.log 2>&1
# 10 * * * * /bin/bash -lc 'cd /opt/memalerts-backend && BACKUP_DIR=/backups pnpm backup:verify' >> /var/log/memalerts-backup-verify.log 2>&1

# 4. Проверить
crontab -l
```

---

## 📁 Структура файлов на VPS

```
/usr/local/bin/
├── memalerts-healthcheck.sh
├── backup-db.sh (уже установлен)
└── ... другие скрипты

/var/log/
├── memalerts-backup.log
├── memalerts-healthcheck.log
├── memalerts-monitor.log
├── memalerts-backup-verify.log
├── memalerts-resources.log
├── memalerts-db-redis.log
└── memalerts-ssl.log

/opt/memalerts-backend/scripts/
├── memalerts-healthcheck.sh (template)
├── vps-resources-check.sh (новый)
├── ssl-expiry-check.sh (новый)
├── db-redis-check.sh (новый)
└── smoke-test-vps.sh (новый)
```

---

*Создано: 2026-01-17 | Обновлено: 2026-01-18*

