# MemAlerts Frontend

Frontend для MemAlerts — веб‑приложение и OBS overlay для активации мемов через Twitch Channel Points.

## Основные возможности
- **Web**: Twitch OAuth, публичные профили каналов, каталог мемов, активация за монеты, заявки на добавление мемов, админ‑панель/настройки, поиск, RU/EN локализация.
- **Overlay (OBS Browser Source)**: real‑time показ активаций, поддержка image/gif/video/audio, позиционирование/масштаб/звук.

## Документация (4 файла)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — архитектура и принципы структуры кода
- [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) — локальная разработка и отладка
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — деплой, runtime config, GitHub Actions, beta/prod

## Быстрый старт (локально)
### Требования
- Node.js >= 18
- pnpm >= 8

### Установка
```bash
pnpm install
```

### ENV (dev)
В dev можно указать backend URL через `.env`:
```env
VITE_API_URL=http://localhost:3001
```
Для overlay (если запускаете отдельно) — аналогичный `.env` в `overlay/`.

### Запуск
```bash
pnpm dev
# или отдельно:
pnpm dev:web      # http://localhost:5173
pnpm dev:overlay  # http://localhost:5174
```

## Overlay URL
### Dev (порт 5174)
- Token‑режим (рекомендуется): `http://localhost:5174/t/<token>?scale=1&position=center&volume=1`
- Back-compat (slug): `http://localhost:5174/<channelSlug>?scale=1&position=center&volume=1`

### Production (под /overlay/)
- `https://<domain>/overlay/t/<token>?scale=1&position=center&volume=1`

Параметры:
- `scale`: 0.5–2.0
- `position`: center | top | bottom | top-left | top-right | bottom-left | bottom-right | random
- `volume`: 0.0–1.0

## Команды
```bash
pnpm lint
pnpm build
pnpm build:overlay
```
