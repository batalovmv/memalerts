# Архитектура фронтенда (refactored)

Цель: сделать кодовую базу предсказуемой, легко поддерживаемой и безопасной для изменений, опираясь на контрактный API и строгие слои.

## Базовые принципы
- **Contract-first**: все типы API берём из `@memalerts/api-contracts`, никаких локальных DTO.
- **Runtime validation**: ответы API валидируются через `schema.parse()` в `shared/api/client.ts`.
- **Explicit over implicit**: optional и nullable различаются, `as any/as unknown` запрещены без комментария.
- **Layered architecture**: зависимости только вниз по слоям (см. ниже).
- **Единый формат ответов**: `{ success: true, data: ... }` и `{ success: false, error: ... }`.

## Структура и слои
```
src/
  App.tsx
  main.tsx
  pages/                    # thin wrappers для роутов
  features/                 # сценарии/фичи, orchestration + state
    meme-catalog/
      api/
      model/
      ui/
  entities/                 # доменные сущности (UI + model)
    meme/
  shared/                   # базовые, независимые от домена модули
    api/                    # ApiClient + legacy helper'ы
    config/                 # runtime config, urls
    lib/
    ui/
  widgets/                  # крупные композиции
  components/               # legacy re-exports (миграция по мере необходимости)
  contexts/
  hooks/
  store/
overlay/                    # отдельное Vite-приложение (OBS overlay)
```

### Правила зависимостей
- **pages** → только композиция роутов, без бизнес-логики.
- **features** → могут использовать `entities`, `shared`, `widgets`.
- **entities** → могут использовать только `shared`.
- **shared** → не зависит от доменных слоёв.
- **widgets** → композиция `features`/`entities`/`shared`.

## API слой
- **Единый клиент**: `src/shared/api/client.ts` использует `@memalerts/api-contracts` и `zod` для парсинга.
- **Hooks**: `features/*/api` (например `features/meme-catalog/api/useMemes.ts`) — единственное место сетевых запросов в фичах.
- **Ошибки**: использовать `ApiError` и коды из контракта, без ad-hoc строк.
- **Legacy**: старые хелперы (`shared/api/httpClient.ts`, `src/lib/api.ts`) допустимы только для не мигрированных модулей.

## Runtime config и окружения
- `GET /config.json` загружается до первого рендера (`src/main.tsx`).
- `shared/config/runtimeConfig.ts` хранит `apiBaseUrl` и `uploadsBaseUrl`.
- `resolveMediaUrl()` читает `uploadsBaseUrl` для корректных ссылок на медиа.
- Overlay использует такой же runtime config, но свой entrypoint.

## Как добавлять новую фичу/endpoint
1. Добавить Zod-схему в `packages/api-contracts`.
2. Создать hook в `features/*/api` с `apiClient` + контрактной схемой.
3. Использовать только типы из `@memalerts/api-contracts` в UI и модели.
4. Добавить тесты контрактов при изменении схем.

## Запрещено
- Локальные типы для API ответов.
- Прямые вызовы `axios` вне `apiClient`.
- `as any` / `as unknown` без объясняющего комментария.
