# Self-hosted runner (VPS) — чтобы почти не тратить GitHub minutes

Цель: перенести деплой (и при желании CI) на **self-hosted runner** на VPS, чтобы GitHub Actions выполнялись на вашей машине и **не списывали GitHub minutes**.

В репозитории для этого есть workflow: `.github/workflows/ci-cd-selfhosted.yml`.

## 1) Подготовка VPS (один раз)

- Убедитесь, что есть директории:
  - `/opt/memalerts-backend` (production)
  - `/opt/memalerts-backend-beta` (beta)
- В каждой директории должен быть свой `.env`:
  - production: cookie `token`, `JWT_SECRET`
  - beta: cookie `token_beta`, **отдельный** `JWT_SECRET` (и прочая изоляция окружений)

Также нужны `pm2`, `node`, `pnpm` на VPS (как у вас сейчас для обычного деплоя).

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

## 4) Что теперь будет происходить

- **push в `main`** → self-hosted workflow деплоит **beta** (порт 3002)
- **tag `prod-*`** → self-hosted workflow деплоит **production** (порт 3001)

PR-проверки остаются в `.github/workflows/ci-cd.yml` (их можно тоже перенести на self-hosted при желании).


