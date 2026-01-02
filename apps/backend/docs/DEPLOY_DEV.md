# Deploy (dev) — памятка

## Ветки и окружения (критично)

- **`main` → beta** (VPS порт 3002, PM2 `memalerts-api-beta`)
- **`develop` → production** (VPS порт 3001, PM2 `memalerts-api`)

Перед пушем убедись, что ты находишься в правильной ветке, чтобы не задеплоить случайно не туда.

## Быстрый деплой (beta)

```bash
git switch main \
  && git pull \
  && git add -A \
  && git commit -m "dev: <короткое описание>" \
  && git push origin main
```

## Быстрый деплой (production)

```bash
git switch develop \
  && git pull \
  && git add -A \
  && git commit -m "dev: <короткое описание>" \
  && git push origin develop
```

## Мини-чеклист перед коммитом

- Не ломать изоляцию beta/prod (CORS, cookie `token` vs `token_beta`, разные `JWT_SECRET` на VPS).
- Если менялись Prisma схемы/миграции — миграции должны быть **backward-compatible** (expand/contract).
- Не ослаблять безопасность `/internal/*` (localhost-only + `x-memalerts-internal`).







