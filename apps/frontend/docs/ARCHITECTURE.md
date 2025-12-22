# Architecture

Цель: сделать кодовую базу **быстрой для поиска**, масштабируемой и удобной для поддержки, сохраняя предсказуемое поведение и хороший UX.

## Стек
- React + TypeScript
- Vite
- React Router
- Redux Toolkit
- i18n: `react-i18next`
- API: `axios` (обёртка в `src/lib/api.ts`)
- Real-time: `socket.io-client` (см. `src/contexts/SocketContext.tsx`)

## Структура
Основная идея — **feature-based**: доменная логика живёт в `features/*`, а `pages/*` — тонкие обёртки для роутера.

```
src/
  pages/                    # thin wrappers для роутов (ничего тяжёлого)
  features/                 # доменные фичи (экраны/контейнеры/локальный UI)
    dashboard/
    settings/
    streamer-profile/
    submit/
    search/
    landing/
    beta-access/
    stats/
    legal/
  shared/                   # нейтральные переиспользуемые вещи (без доменной привязки)
    lib/
    ui/
  components/               # крупные виджеты (legacy; постепенно уводим в features/shared)
  contexts/
  hooks/
  store/
  lib/
overlay/                    # отдельное Vite-приложение (OBS overlay)
```

## Правила слоёв
- **`src/pages/*`**: только `export { default } from '@/features/...';`
- **`src/features/*`**: бизнес‑логика + страницы/контейнеры.
- **`src/shared/*`**: общие утилиты/компоненты, не зависят от конкретной фичи.

## Runtime config и окружения (beta/prod)
Чтобы избежать “beta frontend ходит в prod API” (и наоборот), окружение не “вшивается” в сборку:
- Web при старте грузит `GET /config.json` (`src/lib/runtimeConfig.ts`) и применяет `apiBaseUrl` через `setApiBaseUrl()` до первого рендера (`src/main.tsx`).
- Для статики `/uploads/*` используется единый резолвер `resolveMediaUrl()` (`src/lib/urls.ts`), который читает `uploadsBaseUrl` из runtime config.
- Overlay использует тот же `GET /config.json` (см. `overlay/runtimeConfig.ts`) и резолвит медиа/сокет через `overlay/urls.ts`.

Формат `config.json` описан в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Перфоманс‑заметки (high level)
- **Code splitting по роутам**: `src/App.tsx` использует `React.lazy`/`Suspense`, чтобы не тянуть админку/профиль/поиск в initial bundle.
- **Списки/превью**: `MemeCard` лениво грузит медиа через `IntersectionObserver`, чтобы не “плавить” браузер на больших каталогах.
- **User interaction tracking**: единый `useHasUserInteracted()` (`src/lib/userInteraction.ts`), чтобы не плодить document‑listeners на каждую карточку.


