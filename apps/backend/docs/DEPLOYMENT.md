## Memalerts Backend: Deployment & Release Guide

### Environments
- **Beta**: `beta.twitchmemes.ru` (branch: `develop`)
- **Production**: `twitchmemes.ru` (branch: `main`)

Deployments are automated by **GitHub Actions** (see `.github/workflows/ci-cd.yml`).

### Server layout (VPS)
- Backend (prod): `/opt/memalerts-backend` → PM2 process `memalerts-api` (PORT=3001)
- Backend (beta): `/opt/memalerts-backend-beta` → PM2 process `memalerts-api-beta` (PORT=3002)
- NGINX vhost: `/etc/nginx/sites-available/memalerts`

### Logging policy (do not break this)
- Debug logging is **opt-in** and controlled by env: `DEBUG_LOGS=1`.
  - Beta deploy sets `DEBUG_LOGS=1`
  - Production deploy must not set it
- Debug endpoints (e.g. `/debug-ip`) must only exist when debug is enabled.

### Release flow (recommended)
1. Work in feature branches → PR to `develop` (beta).
2. Verify beta (`beta.twitchmemes.ru`) is healthy.
3. Create PR: `develop` → `main`.
4. Merge PR → CI/CD deploys production automatically.

### Smoke checks (backend)
Production:
- `GET https://twitchmemes.ru/health` returns `{ "status": "ok" }`
- Twitch OAuth callback works (`/auth/twitch/callback`)
- WebSocket (Socket.IO) works (`/socket.io/`)
- No debug spam in prod logs:
  - `pm2 logs memalerts-api` should NOT contain `[DEBUG]`, `[DEBUG_IP]`, `[BETA_ACCESS_DEBUG]`

Beta:
- Same checks, plus debug logs should appear when needed (because `DEBUG_LOGS=1`).

### Rollback
Preferred:
- Revert the merge commit on `main` (revert PR is safest) → CI/CD redeploys.



