# Deployment (beta/prod) + promotion

## Ключевая идея
Один и тот же билд должен работать и на **beta**, и на **production**, а различия окружения задаются **runtime config** файлом:
- `dist/config.json` (доступен как `GET /config.json`)

Это снижает риск “beta frontend ходит в prod API” и упрощает promotion.

## Runtime config (`/config.json`)
Файл генерируется на этапе deploy в GitHub Actions и кладётся в `dist/config.json`.

Поля:
- `apiBaseUrl`: базовый URL для REST (рекомендуется `""` → same-origin)
- `socketUrl`: базовый URL для Socket.IO (рекомендуется `""` → same-origin)
- `uploadsBaseUrl`: базовый URL для `/uploads/*`
  - `""` → same-origin
  - `"https://..."` → отдельный домен/хост для uploads
- `publicBaseUrl`: базовый URL для share links (обычно `""`)

## GitHub Actions
Workflows:
- `.github/workflows/ci-cd.yml` — GitHub-hosted runner (PR checks: lint + build)
- `.github/workflows/ci-cd-selfhosted.yml` — self-hosted runner на VPS (sync → build → deploy)

Логика:
- **build**: lint + build web/overlay, публикует артефакты (`web-dist`, `overlay-dist`) — только в `ci-cd.yml` (для PR/ручного запуска)
- **deploy-beta**: (push в `main`) пишет `dist/config.json`, деплоит в `/opt/memalerts-frontend-beta`
- **deploy (prod)**: (tag `prod-*`) пишет `dist/config.json`, деплоит в `/opt/memalerts-frontend`

Дополнительно:
- Используются GitHub **Environments**: `beta` и `production`
  - для `production` можно включить manual approval (required reviewers)
  - это делает выпуск на `main` управляемым и безопасным
- Включена `concurrency`, чтобы не было параллельных деплоев одного окружения.

## Secrets (GitHub)
Минимально необходимые для деплоя:
- `VPS_HOST`
- `VPS_USER` (обычно `deploy`)
- `VPS_SSH_KEY`
- `VPS_PORT` (опционально)
- `DOMAIN` (если используется в backend nginx скрипте)

Для uploads (опционально, но важно при разнесённых доменах):
- `UPLOADS_BASE_URL` — для production (например `https://twitchmemes.ru`)
- `UPLOADS_BASE_URL_BETA` — для beta (если uploads живут на другом домене; иначе можно не задавать, возьмётся `UPLOADS_BASE_URL`)

## Nginx / сервер
Deploy кладёт статику:
- prod: `/opt/memalerts-frontend/dist` и `/opt/memalerts-frontend/overlay/dist`
- beta: `/opt/memalerts-frontend-beta/dist` и `/opt/memalerts-frontend-beta/overlay/dist`

Важно:
- Workflow пытается запускать nginx setup‑скрипт из backend репозитория: `/opt/memalerts-backend/.github/scripts/setup-nginx-full.sh`
- Если backend ещё не задеплоен/скрипта нет — deploy упадёт (это ожидаемо; порядок деплоя важен).

## Promotion strategy (рекомендовано)
1) Работаете в `main` → автоматически деплоится beta (job `deploy-beta`).
2) Когда готово к релизу: создаёте тег `prod-*` (например `prod-2025-12-25` или `prod-1.0.10`).
3) Push тега запускает production deploy; job `deploy-production` можно защитить manual approval через GitHub Environments.
4) В `ci-cd.yml` production deploy использует артефакты из build job этого же workflow run (без пересборки на сервере).
5) В `ci-cd-selfhosted.yml` билд выполняется на VPS (self-hosted runner), без скачивания артефактов.

## Runbook: как безопасно перенести beta → основной домен (main)
Цель: вы разрабатываете в `main` (beta), тестируете beta, затем **одним действием** (создание тега `prod-*` + approve deploy) переносите ту же версию на основной домен.

### 0) Предусловия (делается один раз)
1) **GitHub Environments**
   - `beta`
   - `production` (рекомендуется включить `required reviewers`, чтобы прод деплой был только по апруву)
2) **Secrets заполнены**
   - VPS: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT` (если не 22)
   - Домены: `DOMAIN` (если backend nginx‑скрипт использует его для TLS/сервернейма)
   - Uploads (если /uploads не same-origin):
     - `UPLOADS_BASE_URL` (prod)
     - `UPLOADS_BASE_URL_BETA` (beta, опционально)
3) **Backend уже задеплоен**
   - На сервере доступен `/opt/memalerts-backend/.github/scripts/setup-nginx-full.sh` (иначе frontend deploy упадёт по ожидаемой причине).

### 1) Работа в beta (main)
1) Пушите изменения в `main`.
2) CI запускается и деплоит beta (job `deploy-beta`).
3) Вы тестируете beta на поддомене `beta.<domain>`.

Рекомендованный “smoke checklist” перед релизом:
- Авторизация (Twitch OAuth) и редирект обратно в приложение.
- Открытие `/channel/:slug` и загрузка списка мемов (scroll / search / modal).
- Активация мема и проверка real-time событий (баланс/activation/overlay).
- Overlay (`/overlay/...`) открывается и показывает активации.
- Основные админ‑операции (если применимо): заявки, approve/reject, настройки.

### 2) Promotion в production (main) через CI/CD
1) Убедитесь, что нужный коммит уже в `main` и beta проверена.
2) Создаёте тег вида **`prod-*`** (например `prod-1.0.10`) на этот коммит и пушите тег.
3) Запустится workflow и job **Deploy to VPS (Production)**.
   - Если включён manual approval в `production` environment — подтверждаете деплой.

Почему это “не ломает”:
- Production deploy **не пересобирает** проект заново: он берёт **тот же артефакт**, который собрался/прошёл lint в этом workflow run.
- Различия окружения идут только через `dist/config.json` (runtime config).

### 3) Что важно про `config.json` (чтобы не было cross-domain)
В продакшене и в бете **по умолчанию** используется same-origin:
- `apiBaseUrl: ""`
- `socketUrl: ""`

Это значит:
- beta фронт будет ходить в beta API (same-origin beta домена)
- prod фронт будет ходить в prod API (same-origin основного домена)

Единственное типичное исключение — uploads:
- если `/uploads/*` отдаются с другого домена, то задайте `UPLOADS_BASE_URL`/`UPLOADS_BASE_URL_BETA`.
- если uploads уже проксируются/сервятся на том же домене — оставляйте пустыми.

### 4) Post-deploy проверка production
После деплоя на `main`:
- Откройте основной домен в “инкогнито” (чистые куки/кеш) и пройдите короткий smoke checklist (см. выше).
- Проверьте overlay на основном домене.

### 5) Rollback (если что-то пошло не так)
Самый быстрый путь без ручных ssh-правок:
1) В GitHub откатить `main` на предыдущий стабильный коммит (revert merge commit).
2) Пуш в `main` запустит workflow и задеплоит предыдущую версию.

Если нужно точечно “переехать” только конфигом (редкий случай):
- проверьте, не сломаны ли значения `UPLOADS_BASE_URL` / `DOMAIN` в secrets (runtime config влияет без пересборки только через `config.json`).


