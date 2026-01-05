# VPS: структура и запуск MemAlerts (production + beta)

Этот документ описывает **как реально устроен VPS** `155.212.172.136` для MemAlerts: что где лежит, чем управляется, какие порты/домены, где логи и как диагностировать проблемы.

## Доступ

- **SSH**: `ssh deploy@155.212.172.136`
- Пользователь `deploy` состоит в группах `sudo` и `docker`.

## TL;DR (что важно знать)

- **Два инстанса backend API**:
  - **production**: Node/PM2 процесс `memalerts-api`, порт **3001**, директория `/opt/memalerts-backend`
  - **beta**: Node/PM2 процесс `memalerts-api-beta`, порт **3002**, директория `/opt/memalerts-backend-beta`
- **Nginx** принимает внешний трафик на **80/443**, отдаёт frontend и проксирует API/WebSocket на `localhost:3001`/`localhost:3002`.
- **Firewall (UFW)**: внешний доступ к `3001/3002` **запрещён**, наружу открыты `80/443/22` (и `1500/1501` под ispmanager).
- **PostgreSQL** и **Redis** подняты как systemd-сервисы и слушают **только localhost**:
  - Postgres: `127.0.0.1:5432`
  - Redis: `127.0.0.1:6379`
- **Логи**:
  - Nginx: `/var/log/nginx/*`
  - PM2: `/home/deploy/.pm2/logs/*` (+ ротация через `pm2-logrotate`)
- **Важно про `.env`**: `.env` лежит на VPS внутри `/opt/memalerts-backend/.env` и `/opt/memalerts-backend-beta/.env` и **не синкается rsync’ом** при деплое. Значения секретов не должны попадать в репозиторий.

## Версии на сервере (актуально на 2026‑01‑05)

- **OS**: Ubuntu 24.04.3 LTS (Noble)
- **Node.js**: v18.19.1
- **pnpm**: 10.26.0
- **PM2**: 6.0.14

## Layout `/opt` (что где лежит)

Основные директории:

- **Backend**
  - `/opt/memalerts-backend` — production backend (код + `dist/` + `node_modules/` + `uploads/` + `.env`)
  - `/opt/memalerts-backend-beta` — beta backend (код + `dist/` + `node_modules/` + `uploads/` + `.env`)
- **Frontend**
  - `/opt/memalerts-frontend` — production frontend (Vite build в `dist/`, overlay build в `overlay/dist/`)
  - `/opt/memalerts-frontend-beta` — beta frontend (аналогично)
- **Backups**
  - `/opt/backups` — локальные “снапшоты” (в т.ч. копии `.env`!), относиться как к секретам.
- **containerd**
  - `/opt/containerd` — системное (не MemAlerts).

## Nginx (reverse proxy + static)

### Где конфиги

- Главный конфиг: `/etc/nginx/nginx.conf`
- Site конфиг MemAlerts: `/etc/nginx/sites-available/memalerts`
  - включён через symlink: `/etc/nginx/sites-enabled/memalerts`
- Rate-limit zones: `/etc/nginx/conf.d/memalerts-rate-limit.conf`

### Домены и проксирование

- **production домен**: `twitchmemes.ru` (+ `www.twitchmemes.ru`)
  - frontend root: `/opt/memalerts-frontend/dist`
  - overlay root: `/opt/memalerts-frontend/overlay/dist` под путём `/overlay/`
  - backend proxy: `http://localhost:3001`
- **beta домен**: `beta.twitchmemes.ru`
  - frontend root: `/opt/memalerts-frontend-beta/dist`
  - overlay root: `/opt/memalerts-frontend-beta/overlay/dist` под путём `/overlay/`
  - backend proxy: `http://localhost:3002`

### WebSocket (Socket.IO)

В обоих server blocks есть `location /socket.io/` с `Upgrade/Connection` заголовками и большими таймаутами (long-lived соединения).

### Uploads (статика)

`/uploads/*` раздаётся **напрямую nginx’ом**:

- alias: `/opt/memalerts-backend/uploads/`
- выставлены CORS заголовки **только** для `twitchmemes.ru` и `beta.twitchmemes.ru`
- кеширование: `expires 1y` + `Cache-Control: public, immutable`

### TLS / Certbot

- Сертификаты: `/etc/letsencrypt/live/*`
- Автообновление: `certbot.timer` (systemd timer)

Полезно:

- `sudo nginx -t`
- `sudo systemctl reload nginx`

## Firewall / Fail2ban

### UFW

UFW включён, дефолт: **deny incoming**.

- **ALLOW IN**: `80/tcp`, `443/tcp`, `22/tcp`, `1500,1501/tcp`
- **DENY IN**: `3001/tcp`, `3002/tcp` (и для IPv6 тоже)

### Fail2ban

Активные jail’ы:

- `sshd`
- `nginx-req-limit`:
  - logpath: `/var/log/nginx/error.log`
  - банит по “limiting requests” (nginx limit_req)

## Backend: как запускается и чем управляется

### PM2 (основное)

PM2 под пользователем **`deploy`** управляет процессами:

- `memalerts-api` — production API (порт 3001)
- `memalerts-api-beta` — beta API (порт 3002)
- `memalerts-chatbot` — чат-бот раннер (общий, работает отдельно от API)
- `memalerts-vkvideo-chatbot-beta` — VKVideo runner
- `memalerts-youtube-chatbot-beta` — YouTube runner
- module: `pm2-logrotate` — ротация логов

Команды:

- **статус**: `pm2 status`
- **логи**: `pm2 logs memalerts-api --lines 200` / `pm2 logs memalerts-api-beta --lines 200`
- **рестарт**: `pm2 restart memalerts-api` / `pm2 restart memalerts-api-beta`
- **сохранить список процессов**: `pm2 save`

### Важно: на сервере есть второй PM2 под root (legacy)

На VPS присутствует systemd unit `pm2-root.service` (PM2_HOME = `/root/.pm2`), и там сейчас виден `memalerts-chatbot`, а `memalerts-api` в состоянии `errored`.

Это выглядит как **исторический артефакт**. Для MemAlerts “истиной” считается PM2 под **`deploy`** (логи/процессы/версии совпадают с деплоем).

Рекомендация:

- **не использовать** root-PM2 для управления MemAlerts
- при необходимости “прибрать” — сначала убедиться, что нет полезных root-процессов, затем планово отключать (это операционная задача, делайте осознанно).

### `.env` на VPS

Файлы окружения:

- production: `/opt/memalerts-backend/.env`
- beta: `/opt/memalerts-backend-beta/.env`

Важно:

- деплой (workflow) делает `rsync` **без** `.env`
- на beta и prod должны быть **разные секреты** для изоляции (в частности JWT), см. `DEPLOYMENT.md`

## DB и Redis

- Postgres: systemd (`postgresql.service`), слушает `127.0.0.1:5432`
- Redis: systemd (`redis-server.service`), слушает `127.0.0.1:6379`

Проверки:

- `sudo systemctl status postgresql`
- `sudo systemctl status redis-server`

## Логи и диагностика

### Nginx

- Логи: `/var/log/nginx/access.log`, `/var/log/nginx/error.log` (+ ротированные `.gz`)
- Логи systemd: `sudo journalctl -u nginx -n 200 --no-pager`

### PM2 / Node процессы

- Логи: `/home/deploy/.pm2/logs/*`
- Ротация:
  - файлы формата `*-out__YYYY-MM-DD.log` и `*-error__YYYY-MM-DD.log`
  - текущее: `*-out.log`, `*-error.log`

### Healthchecks

Изнутри сервера:

- `curl -fsS http://127.0.0.1:3001/health`
- `curl -fsS http://127.0.0.1:3002/health`

### Где смотреть, если “что-то упало”

- `pm2 status`
- `pm2 logs memalerts-api --lines 200`
- `pm2 logs memalerts-api-beta --lines 200`
- `sudo tail -n 200 /var/log/nginx/error.log`
- `sudo ufw status verbose`

## Деплой / обновления

Источник истины по деплою — `DEPLOYMENT.md` и `.github/workflows/ci-cd-selfhosted.yml`.

Ключевые факты:

- деплой синкает код в `/opt/memalerts-backend*`
- затем `pnpm install`, `pnpm build`, `pnpm prisma migrate deploy`
- затем рестартит процесс через PM2 (`pm2 start dist/index.js --name ...`)

## Backups

`/opt/backups` содержит локальные снапшоты (в т.ч. `.env`).

Важно:

- считать это **секретным содержимым**
- это **не** бэкап базы данных (по крайней мере, в найденной структуре там лежат файлы проекта)


