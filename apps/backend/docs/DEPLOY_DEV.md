# Deploy (dev) — памятка (beta/prod)

Эта памятка отражает **реальные триггеры деплоя** в текущем CI/CD:

- **beta**: `push` в ветку **`main`** → деплой на VPS (порт **3002**, PM2 **`memalerts-api-beta`**, директория **`/opt/memalerts-backend-beta`**)
- **production**: `push` тега **`prod-*`** → деплой на VPS (порт **3001**, PM2 **`memalerts-api`**, директория **`/opt/memalerts-backend`**)

Источник истины: `.github/workflows/ci-cd-selfhosted.yml` (см. также `DEPLOYMENT.md` и `docs/SELF_HOSTED_RUNNER.md`).

## Быстрый деплой (beta)

Обычный сценарий (изменил код → залил в `main` → self-hosted runner сам выкатит beta):

```bash
git switch main \
  && git pull --rebase \
  && git add -A \
  && git commit -m "dev: <короткое описание>" \
  && git push origin main
```

### Важно: деплой может быть пропущен

Workflow для beta **может пропустить деплой**, если между коммитами не было “релевантных” изменений (проверяются пути вроде `src/`, `prisma/`, `scripts/`, `.github/`, `package.json`, `tsconfig.json`).

Чтобы **форсировать деплой** (например, нужен рестарт/подтянуть env/секреты/перезапуск джобов):

- добавить маркер в commit message: **`deploy`** или **`[deploy]`**
- или запустить workflow вручную (**workflow_dispatch**) с `force_deploy=true`

## Быстрый деплой (production)

Production деплоится **только по тегу** `prod-*`. Дополнительно есть guard: **тег обязан указывать на текущий `origin/main` (beta HEAD)** — иначе workflow откажется деплоить.

Команды:

```bash
git switch main && git pull --rebase
TAG="prod-$(date +%Y%m%d-%H%M)"
git tag "$TAG"
git push origin "$TAG"
```

Если вы не в bash (Windows PowerShell), просто придумай имя вручную:

- `prod-20260105-1530`

и запушь тег:

```bash
git push origin prod-20260105-1530
```

## Мини-чеклист (чтобы не выстрелить себе в ногу)

- **Изоляция beta/prod (критично)**:
  - beta cookie: **`token_beta`**, prod cookie: **`token`**
  - на VPS у beta и prod должны быть **разные JWT secrets** (значение `JWT_SECRET` в `/opt/memalerts-backend/.env` и `/opt/memalerts-backend-beta/.env` должно отличаться)
  - CORS/origins должны оставаться изолированными (beta не принимает prod фронт и наоборот)
- **Prisma миграции**:
  - если beta и prod делят одну БД, миграции должны быть **backward-compatible (expand/contract)**
  - в репо есть guard на destructive SQL (`pnpm migrations:check`)
- **`/internal/*`**:
  - нельзя ослаблять **localhost-only** и проверку `x-memalerts-internal`
  - nginx не должен проксировать эти пути наружу
- **`.env` на VPS**:
  - деплой делает `rsync` **без** `.env`, т.е. env должен существовать на сервере заранее (workflow может “upsert”-ить только некоторые ключи из GitHub Secrets)

## Быстрая диагностика на VPS (если нужно)

- SSH: `ssh deploy@155.212.172.136`
- PM2:
  - prod: `pm2 status memalerts-api` / `pm2 logs memalerts-api --lines 200`
  - beta: `pm2 status memalerts-api-beta` / `pm2 logs memalerts-api-beta --lines 200`








