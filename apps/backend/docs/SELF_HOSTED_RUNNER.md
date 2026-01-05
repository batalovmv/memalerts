# Self-hosted runner (VPS) — чтобы почти не тратить GitHub minutes

Цель: перенести деплой (и при желании CI) на **self-hosted runner** на VPS, чтобы GitHub Actions выполнялись на вашей машине и **не списывали GitHub minutes**.

В репозитории для этого есть workflow: `.github/workflows/ci-cd-selfhosted.yml`.

## 1) Подготовка VPS (один раз)

- Убедитесь, что есть директории:
  - `/opt/memalerts-backend` (production)
  - `/opt/memalerts-backend-beta` (beta)
- В каждой директории должен быть свой `.env`:
  - production: cookie `token`, **свой** `JWT_SECRET`
  - beta: cookie `token_beta`, **другой** `JWT_SECRET` (изоляция окружений)

Важно: workflow **не синхронизирует `.env`** (он исключён из `rsync`). На VPS `.env` должен существовать заранее.

Также на VPS должны быть установлены:

- `node` (workflow использует Node **20**)
- `pnpm`
- `pm2`
- `rsync`
- `docker` (тесты в workflow поднимают `postgres:16` как service)

И runner-пользователь должен уметь запускать Docker без `sudo` (обычно: добавить в группу `docker`).

## 2) Установка GitHub Actions Runner на VPS

Делайте это на VPS под пользователем `deploy` (или другим, у которого есть доступ к `/opt/*`).

1) В GitHub: **Settings → Actions → Runners → New self-hosted runner**  
Выберите Linux x64 и следуйте инструкциям GitHub (они дадут актуальную ссылку/токен).

2) Важно про лейблы  
Workflow ожидает runner с лейблами:

- `self-hosted`
- `linux`
- `x64`
- `memalerts-vps`

Лейбл `memalerts-vps` добавляется при конфигурации runner (флаг `--labels memalerts-vps`).

## 3) Права (rsync + /opt)

`ci-cd-selfhosted.yml` синхронизирует код в `/opt/...` через `sudo rsync`.

Нужно, чтобы runner-пользователь мог выполнять `sudo` без пароля для `rsync` (или для всех команд, если вы уже так настроили deploy):

```bash
sudo visudo -f /etc/sudoers.d/deploy
```

Добавьте строку (пример):

```text
deploy ALL=(ALL) NOPASSWD: /usr/bin/rsync
```

Если планируете пользоваться опцией `[nginx-full]` (см. ниже), дополнительно понадобится разрешить запуск `.github/scripts/setup-nginx-full.sh` через `sudo`.

Альтернатива “простая, но широкая” (в репозитории есть скрипт `.github/scripts/configure-sudo.sh`) — разрешить `NOPASSWD: ALL` для `deploy`. Это удобнее, но **менее безопасно**.

## 4) Что теперь будет происходить

- **pull request в `main`** → workflow прогонит **tests на self-hosted runner** (Docker + Postgres)
- **push в `main`** → workflow прогонит tests и затем деплоит **beta** (порт 3002)
  - деплой **может быть пропущен**, если в пуше нет “релевантных” изменений (см. `ci-cd-selfhosted.yml`)
  - **форсить деплой** можно:
    - вручную через `workflow_dispatch` с `force_deploy=true`
    - или коммит‑сообщением с маркером `deploy` / `[deploy]`
- **tag `prod-*`** → workflow прогонит tests и затем деплоит **production** (порт 3001)
  - есть guard: **prod tag обязан указывать на текущий `origin/main` HEAD** (чтобы не деплоить “старее, чем beta”)

### Как зарелизить production (через тег)

На локальной машине:

```bash
git switch main && git pull
git tag prod-2026-01-05
git push origin prod-2026-01-05
```

### Опционально: “nuclear” nginx

Если в `head_commit.message` есть маркер `[nginx-full]`, beta‑деплой выполнит:

- `sudo bash .github/scripts/setup-nginx-full.sh <domain> 3001 3002`

Это **опасная операция** (переписывает nginx конфиги). Использовать только когда осознанно хотите полностью перестроить nginx на VPS.

Примечание: в текущей конфигурации единственный workflow — `ci-cd-selfhosted.yml`, поэтому и PR checks, и деплой — на self-hosted runner.


