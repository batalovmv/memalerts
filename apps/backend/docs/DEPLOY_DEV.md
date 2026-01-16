# Deploy (dev) — cheat sheet (beta/prod)

This cheat sheet reflects the **actual deploy triggers** in the current CI/CD:

- **beta**: `push` to branch **`main`** → deploy to VPS (port **3002**, PM2 **`memalerts-api-beta`**, directory **`/opt/memalerts-backend-beta`**)
- **production**: `push` a tag **`prod-*`** → deploy to VPS (port **3001**, PM2 **`memalerts-api`**, directory **`/opt/memalerts-backend`**)

Source of truth: `.github/workflows/ci-cd-selfhosted.yml` (see also `DEPLOYMENT.md` and `docs/SELF_HOSTED_RUNNER.md`).

## Quick deploy (beta)

Typical workflow (change code → push to `main` → self-hosted runner deploys beta automatically):

```bash
git switch main \
  && git pull --rebase \
  && git add -A \
  && git commit -m "dev: <short description>" \
  && git push origin main
```

### Important: deploy can be skipped

The beta workflow **may skip deploy** if there were no “relevant” changes between commits (it checks paths like `src/`, `prisma/`, `scripts/`, `.github/`, `package.json`, `tsconfig.json`).

To **force a deploy** (e.g. you need a restart / pull env/secrets / restart jobs):

- add a marker to the commit message: **`deploy`** or **`[deploy]`**
- or run the workflow manually (**workflow_dispatch**) with `force_deploy=true`

## Quick deploy (production)

Production deploys **only via a tag** `prod-*`. There is also a guard: **the tag must point to the current `origin/main` (beta HEAD)** — otherwise the workflow will refuse to deploy.

Commands:

```bash
git switch main && git pull --rebase
TAG="prod-$(date +%Y%m%d-%H%M)"
git tag "$TAG"
git push origin "$TAG"
```

If you’re not in bash (Windows PowerShell), just pick a name manually:

- `prod-20260105-1530`

and push the tag:

```bash
git push origin prod-20260105-1530
```

## Mini checklist (to avoid shooting yourself in the foot)

- **Beta/prod isolation (critical)**:
  - beta cookie: **`token_beta`**, prod cookie: **`token`**
  - on the VPS, beta and prod must have **different JWT secrets** (`JWT_SECRET` in `/opt/memalerts-backend/.env` and `/opt/memalerts-backend-beta/.env` must differ)
  - CORS/origins must remain isolated (beta must not accept the prod frontend and vice versa)
- **Prisma migrations**:
  - if beta and prod share one DB, migrations must be **backward-compatible (expand/contract)**
  - the repo has a guard against destructive SQL (`pnpm migrations:check`)
  - see `docs/migrations.md` for lint rules and safe patterns
- **`/internal/*`**:
  - do not weaken **localhost-only** and the `x-memalerts-internal` check
  - nginx must not proxy these paths externally
- **`.env` on the VPS**:
  - deploy uses `rsync` **without** `.env`, so the env file must already exist on the server (the workflow can only “upsert” some keys from GitHub Secrets)

## Quick diagnostics on the VPS (if needed)

- SSH: `ssh deploy@155.212.172.136`
- PM2:
  - prod: `pm2 status memalerts-api` / `pm2 logs memalerts-api --lines 200`
  - beta: `pm2 status memalerts-api-beta` / `pm2 logs memalerts-api-beta --lines 200`








