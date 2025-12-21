## Memalerts Frontend: Deployment & Release Guide

### Environments
- **Beta**: `beta.twitchmemes.ru` (branch: `develop`)
- **Production**: `twitchmemes.ru` (branch: `main`)

Deployments are automated by **GitHub Actions** (see `.github/workflows/ci-cd.yml`).

### Server layout (VPS)
- Web (prod): `/opt/memalerts-frontend/dist`
- Overlay (prod): `/opt/memalerts-frontend/overlay/dist`
- Web (beta): `/opt/memalerts-frontend-beta/dist`
- Overlay (beta): `/opt/memalerts-frontend-beta/overlay/dist`

### Important: atomic deploy
Frontend deploy must be **atomic** to avoid stale hashed assets:
- Before copying new `dist`, remove previous:
  - `/opt/memalerts-frontend/dist`
  - `/opt/memalerts-frontend/overlay/dist`

Beta already follows the same approach.

### Release flow (recommended)
1. Merge changes into `develop` → GitHub Actions deploys beta.
2. Verify `beta.twitchmemes.ru` is healthy.
3. Promote `develop` → `main` via PR.
4. Merge PR → GitHub Actions deploys production.

### Smoke checks (frontend)
- App loads and routes work (SPA)
- OAuth login redirects correctly
- Socket.IO stays connected
- Overlay loads under `/overlay/` and receives config

### Rollback
- Revert the merge commit on `main` → CI/CD redeploys the previous version.



