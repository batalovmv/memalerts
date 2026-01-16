# VPS: MemAlerts layout and operation (production + beta)

This document describes the **real-world VPS setup** for MemAlerts on `155.212.172.136`: what lives where, what controls what, which ports/domains are used, where logs are, and how to diagnose common issues.

## Access

- **SSH**: `ssh deploy@155.212.172.136`
- The `deploy` user is a member of `sudo` and `docker`.

## TL;DR (key facts)

- **Two backend API instances**:
  - **production**: Node/PM2 process `memalerts-api`, port **3001**, directory `/opt/memalerts-backend`
  - **beta**: Node/PM2 process `memalerts-api-beta`, port **3002**, directory `/opt/memalerts-backend-beta`
- **Nginx** accepts external traffic on **80/443**, serves the frontend, and proxies API/WebSocket to `localhost:3001` / `localhost:3002`.
- **Firewall (UFW)**: external access to `3001/3002` is **blocked**; only `80/443/22` are open publicly (and `1500/1501` for ispmanager).
- **PostgreSQL** and **Redis** run as systemd services and listen on **localhost only**:
  - Postgres: `127.0.0.1:5432`
  - Redis: `127.0.0.1:6379`
- **Beta isolation**: beta uses a **separate DB** (`memalerts_beta`) and a **separate uploads dir** (`/opt/memalerts-backend-beta/uploads`).
- **Logs**:
  - Nginx: `/var/log/nginx/*`
  - PM2: `/home/deploy/.pm2/logs/*` (with rotation via `pm2-logrotate`)
- **Important `.env` note**: `.env` lives on the VPS at `/opt/memalerts-backend/.env` and `/opt/memalerts-backend-beta/.env` and is **not synced by rsync** during deploy. Secrets must never be committed to the repo.

## Server versions (as of 2026-01-06)

- **OS**: Ubuntu 24.04.3 LTS (Noble)
- **Node.js**: v20.19.6 for MemAlerts PM2 processes (system `node` is still v18.19.1)
- **pnpm**: 10.26.0
- **PM2**: 6.0.14

## `/opt` layout (what lives where)

Main directories:

- **Backend**
  - `/opt/memalerts-backend` — production backend (source + `dist/` + `node_modules/` + `uploads/` + `.env`)
  - `/opt/memalerts-backend-beta` — beta backend (source + `dist/` + `node_modules/` + `uploads/` + `.env`)
- **Frontend**
  - `/opt/memalerts-frontend` — production frontend (Vite build in `dist/`, overlay build in `overlay/dist/`)
  - `/opt/memalerts-frontend-beta` — beta frontend (same layout)
  - build-time env: `/opt/memalerts-frontend/.env` and `/opt/memalerts-frontend-beta/.env` (e.g. `VITE_API_URL`); change → rebuild (`pnpm build` + `pnpm build:overlay`)
- **Backups**
  - `/opt/backups` — local “snapshots” (including `.env` copies). Treat as secrets.
- **containerd**
  - `/opt/containerd` — system directory (not MemAlerts).

## Nginx (reverse proxy + static)

### Config locations

- Main config: `/etc/nginx/nginx.conf`
- MemAlerts site config: `/etc/nginx/sites-available/memalerts`
  - enabled via symlink: `/etc/nginx/sites-enabled/memalerts`
- Rate-limit zones: `/etc/nginx/conf.d/memalerts-rate-limit.conf`

### If API returns SPA `index.html` (common misroute)

Symptom:

- `curl -i https://beta.twitchmemes.ru/me/preferences` returns `200 text/html` with `<!doctype html>` (SPA),
  instead of `401/403/200 application/json`.

Cause:

- Nginx `location / { try_files ... /index.html; }` catches API routes because API `location` proxy blocks are missing
  (or ordered after the SPA fallback).

Fix (idempotent patcher):

```bash
sudo /opt/memalerts-backend/scripts/patch-nginx-in-place.py \
  --prod-domain twitchmemes.ru \
  --beta-domain beta.twitchmemes.ru \
  --prod-backend-dir /opt/memalerts-backend \
  --beta-backend-dir /opt/memalerts-backend-beta

sudo nginx -t && sudo systemctl reload nginx
```

The patcher will also ensure `/internal/*` is **not** exposed publicly (returns 404).

### Domains and proxying

- **production domain**: `twitchmemes.ru` (+ `www.twitchmemes.ru`)
  - frontend root: `/opt/memalerts-frontend/dist`
  - overlay root: `/opt/memalerts-frontend/overlay/dist` at `/overlay/`
  - backend proxy: `http://localhost:3001`
- **beta domain**: `beta.twitchmemes.ru`
  - frontend root: `/opt/memalerts-frontend-beta/dist`
  - overlay root: `/opt/memalerts-frontend-beta/overlay/dist` at `/overlay/`
  - backend proxy: `http://localhost:3002`

### WebSocket (Socket.IO)

Both server blocks include `location /socket.io/` with `Upgrade/Connection` headers and generous timeouts (long-lived connections).

### Uploads (static)

`/uploads/*` is served **directly by Nginx**:

- production alias: `/opt/memalerts-backend/uploads/`
- beta alias: `/opt/memalerts-backend-beta/uploads/`
- CORS headers are set **only** for `twitchmemes.ru` and `beta.twitchmemes.ru`
- caching: `expires 1y` + `Cache-Control: public, immutable`

### TLS / Certbot

- Certificates: `/etc/letsencrypt/live/*`
- Auto-renewal: `certbot.timer` (systemd timer)

Useful commands:

- `sudo nginx -t`
- `sudo systemctl reload nginx`

## Firewall / Fail2ban

### UFW

UFW is enabled; default policy is **deny incoming**.

- **ALLOW IN**: `80/tcp`, `443/tcp`, `22/tcp`, `1500,1501/tcp`
- **DENY IN**: `3001/tcp`, `3002/tcp` (including IPv6)

### Fail2ban

Active jails:

- `sshd`
- `nginx-req-limit`:
  - logpath: `/var/log/nginx/error.log`
  - bans based on “limiting requests” (Nginx `limit_req`)

## Backend: how it runs and what controls it

### PM2 (primary)

PM2 under the **`deploy`** user manages these processes:

- `memalerts-api` — production API (port 3001)
- `memalerts-api-beta` — beta API (port 3002)
- `memalerts-chatbot` — chat-bot runner (separate from the API)
- `memalerts-vkvideo-chatbot-beta` — VKVideo runner
- `memalerts-youtube-chatbot-beta` — YouTube runner
- module: `pm2-logrotate` — log rotation

Commands:

- **status**: `pm2 status`
- **logs**: `pm2 logs memalerts-api --lines 200` / `pm2 logs memalerts-api-beta --lines 200`
- **restart**: `pm2 restart memalerts-api` / `pm2 restart memalerts-api-beta`
- **save process list**: `pm2 save`

### Important: there is also a legacy root PM2 on the server

The VPS has a systemd unit `pm2-root.service` (PM2_HOME = `/root/.pm2`). It currently shows `memalerts-chatbot`, while `memalerts-api` is in `errored` state.

This appears to be a **historical artifact**. For MemAlerts, the source of truth is the PM2 instance under **`deploy`** (logs/processes/versions match the deploy workflow).

Recommendation:

- do **not** use root-PM2 to manage MemAlerts
- if you want to “clean it up”, first confirm there are no useful root-owned processes, then disable it in a planned way (operational task; do it consciously).

### `.env` on the VPS

Environment files:

- production: `/opt/memalerts-backend/.env`
- beta: `/opt/memalerts-backend-beta/.env`

Important:

- deploy workflow uses `rsync` **without** `.env`
- beta and production must use **different secrets** for isolation (especially JWT); see `DEPLOYMENT.md`

## DB and Redis

- Postgres: systemd (`postgresql.service`), listens on `127.0.0.1:5432`
- Redis: systemd (`redis-server.service`), listens on `127.0.0.1:6379`

Checks:

- `sudo systemctl status postgresql`
- `sudo systemctl status redis-server`

### Current DB layout (production + beta)

- production DB: `memalerts` (from `/opt/memalerts-backend/.env`)
- beta DB: `memalerts_beta` (from `/opt/memalerts-backend-beta/.env`)

### Import production data into beta (incl. uploads)

1) Stop beta services (API + bots).
2) `pg_dump` production DB and restore into `memalerts_beta`.
3) `rsync` uploads from `/opt/memalerts-backend/uploads/` → `/opt/memalerts-backend-beta/uploads/`.
4) Run `pnpm prisma migrate deploy` in `/opt/memalerts-backend-beta`.
5) Start beta services.

## Logs and diagnostics

### Nginx

- Logs: `/var/log/nginx/access.log`, `/var/log/nginx/error.log` (plus rotated `.gz`)
- systemd logs: `sudo journalctl -u nginx -n 200 --no-pager`

### PM2 / Node processes

- Logs: `/home/deploy/.pm2/logs/*`
- Rotation:
  - files like `*-out__YYYY-MM-DD.log` and `*-error__YYYY-MM-DD.log`
  - current files: `*-out.log`, `*-error.log`

### Healthchecks

From inside the server:

- `curl -fsS http://127.0.0.1:3001/health`
- `curl -fsS http://127.0.0.1:3002/health`

### Where to look when something is down

- `pm2 status`
- `pm2 logs memalerts-api --lines 200`
- `pm2 logs memalerts-api-beta --lines 200`
- `sudo tail -n 200 /var/log/nginx/error.log`
- `sudo ufw status verbose`

## Deploy / updates

The deploy source of truth is `DEPLOYMENT.md` and `.github/workflows/ci-cd-selfhosted.yml`.

Key facts:

- deploy syncs code into `/opt/memalerts-backend*`
- then runs `pnpm install`, `pnpm build`, `pnpm prisma migrate deploy`
- then restarts via PM2 (`pm2 start dist/index.js --name ...`)

## Backups

`/opt/backups` contains local snapshots (including `.env`).

Important:

- treat it as **sensitive** content
- this is **not** a database backup (at least in the currently observed structure, it contains project files)


