# Memalerts Frontend — Architecture

Цель: сделать кодовую базу **быстрой для поиска**, масштабируемой и удобной для поддержки, сохранив текущее поведение приложения.

## Стек
- React + TypeScript
- Vite
- React Router
- Redux Toolkit
- i18n: `react-i18next`
- API: `axios` (через `src/lib/api.ts`)

## Текущая структура (после рефакторинга)

Основная идея — **feature-based**: доменная логика живёт в `features/*`, а `pages/*` — только тонкие обёртки для роутера.

```
src/
  pages/                    # thin wrappers для роутов (ничего тяжёлого)
  features/                 # доменные фичи (контейнеры/логика/локальный UI)
    dashboard/
    settings/
    streamer-profile/
    submit/
    search/
    landing/
    beta-access/
    stats/
    legal/
  shared/                   # переиспользуемые, нейтральные штуки (без доменной привязки)
    lib/
    ui/
  components/               # текущие “виджеты”/крупные компоненты (legacy, постепенно уводим в features/shared)
  contexts/
  hooks/
  store/
  lib/
```

## Правила
- **`src/pages/*`**: только `export { default } from '@/features/...';`
- **`src/features/*`**: бизнес-логика + экраны/контейнеры.
- **`src/shared/*`**: общие утилиты/компоненты, не зависят от конкретной фичи.

## Что ещё хочется оптимизировать (вернёмся позже)

### 1) Дробление большого `ObsLinksSettings.tsx`
Мы уже вынесли часть в `features/settings/tabs/obs/*`, но можно продолжить:
- вынести секции “Preview”, “Layout”, “Animation”, “Shadow”, “Border”, “Glass”, “Sender” в отдельные компоненты;
- вынести расчёты `overlayStyleJson`/`overlayPreviewParams` в отдельные pure-функции/хуки;
- сделать “feature local ui-kit” для повторяющихся control-компонентов (slider/number input/select).

### 2) Улучшить code splitting (Vite warning про chunk > 500kB)
Сейчас `src/lib/api.ts` импортируется и статически, и динамически, поэтому чанки не делятся как ожидается.
Идея:
- договориться о стратегии: либо **везде static**, либо **точечно lazy** (и убрать смешивание);
- при необходимости добавить `build.rollupOptions.output.manualChunks` в `vite.config.ts` для vendor/UI чанков.

### 3) Привести “крупные компоненты” к новой схеме
Постепенно увести из `src/components/*`:
- `Header`, `MemeModal`, `SubmitModal`, панели dashboard и т.п.
Либо в `shared/ui`, либо в соответствующие `features/*`.

### 4) Доработки UX/перфоманс без изменения поведения
- мемоизация тяжёлых списков/таблиц (search/results, submissions);
- virtualized list там, где нужно;
- единый компактный слой “toast errors” + нормализация ошибок API.

## Деплой
GitHub Actions:
- push в **`develop`** → деплой **beta**
- push в **`main`** → деплой **production**
Также добавлен ручной триггер `workflow_dispatch`.


