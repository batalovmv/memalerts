# Self-hosted runner (VPS) — to spend almost no GitHub minutes

Goal: move deployment (and optionally CI) to a **self-hosted runner** on your VPS, so GitHub Actions runs on your machine and **does not consume GitHub minutes**.

This repo includes a workflow for that: `.github/workflows/ci-cd-selfhosted.yml`.

## 1) Prepare the VPS (one-time)

- Make sure these directories exist:
  - `/opt/memalerts-backend` (production)
  - `/opt/memalerts-backend-beta` (beta)
- Each directory must have its own `.env`:
  - production: cookie `token`, **its own** `JWT_SECRET`
  - beta: cookie `token_beta`, a **different** `JWT_SECRET` (environment isolation)

Important: the workflow **does not sync `.env`** (it’s excluded from `rsync`). The `.env` must already exist on the VPS.

The VPS must also have installed:

- `node` (the workflow uses Node **20**)
- `pnpm`
- `pm2`
- `rsync`
- `docker` (workflow tests start `postgres:16` as a service)

And the runner user must be able to run Docker without `sudo` (typically: add the user to the `docker` group).

## 2) Install GitHub Actions Runner on the VPS

Do this on the VPS as user `deploy` (or another user that has access to `/opt/*`).

1) In GitHub: **Settings → Actions → Runners → New self-hosted runner**  
Choose Linux x64 and follow GitHub’s instructions (they will provide the current download URL/token).

2) Labels matter  
The workflow expects a runner with these labels:

- `self-hosted`
- `linux`
- `x64`
- `memalerts-vps`

The `memalerts-vps` label is added during runner configuration (flag `--labels memalerts-vps`).

## 3) Permissions (`rsync` + `/opt`)

`ci-cd-selfhosted.yml` syncs code into `/opt/...` via `sudo rsync`.

The runner user must be able to run `sudo` without a password for `rsync` (or for all commands, if you already configured deploy that way):

```bash
sudo visudo -f /etc/sudoers.d/deploy
```

Add a line (example):

```text
deploy ALL=(ALL) NOPASSWD: /usr/bin/rsync
```

If you plan to use the `[nginx-full]` option (see below), you’ll also need to allow running `.github/scripts/setup-nginx-full.sh` via `sudo`.

A simpler-but-broader alternative (the repo has `.github/scripts/configure-sudo.sh`) is to allow `NOPASSWD: ALL` for `deploy`. It’s more convenient, but **less secure**.

## 4) What will happen now

- **pull request into `main`** → the workflow runs **tests on the self-hosted runner** (Docker + Postgres)
- **push to `main`** → the workflow runs tests and then deploys **beta** (port 3002)
  - the deploy **may be skipped** if there are no “relevant” changes in the push (see `ci-cd-selfhosted.yml`)
  - you can **force a deploy**:
    - manually via `workflow_dispatch` with `force_deploy=true`
    - or by including `deploy` / `[deploy]` in the commit message
- **tag `prod-*`** → the workflow runs tests and then deploys **production** (port 3001)
  - there is a guard: the **prod tag must point to the current `origin/main` HEAD** (so you don’t deploy something “older than beta”)

### How to release production (via tag)

On your local machine:

```bash
git switch main && git pull
git tag prod-2026-01-05
git push origin prod-2026-01-05
```

### Optional: “nuclear” nginx

If `head_commit.message` contains the `[nginx-full]` marker, the beta deploy will run:

- `sudo bash .github/scripts/setup-nginx-full.sh <domain> 3001 3002`

This is a **dangerous operation** (it rewrites nginx configs). Use it only when you explicitly want to fully rebuild nginx on the VPS.

Note: in the current setup there is only one workflow — `ci-cd-selfhosted.yml` — so both PR checks and deployment run on the self-hosted runner.


