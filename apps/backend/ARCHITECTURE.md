# Архитектура backend (refactored)

Цель: единые API контракты, строгая валидация, понятные слои и предсказуемый формат ответов.

## Базовые принципы
- **Contract-first**: API схемы и типы только из `@memalerts/api-contracts`.
- **Runtime validation**: входные данные валидируются в `api/middleware/validation.ts`.
- **Единый формат ответов**: `{ success: true, data: ... }` или `{ success: false, error: ... }`.
- **Layered architecture**: handler → service → repository → prisma.
- **Fail fast**: бизнес-ошибки через `AppError`, без silent fallback.

## Структура
```
src/
  api/
    middleware/             # validation, auth, apiErrorHandler
    v1/
      memes/
        router.ts
        handlers.ts
        mappers.ts
  domain/                   # бизнес-логика (новые модули)
    meme/
      MemeService.ts
      MemeRepository.ts
  infrastructure/           # prisma, redis, storage, external clients
  shared/                   # общие ошибки, helpers
  utils/
  controllers/              # legacy endpoints (постепенная миграция)
  routes/                   # legacy routing
  services/                 # legacy service layer
```

## Поток запроса (v1)
1. Router регистрирует endpoint и применяет `validateRequest` с Zod схемами.
2. Handler вызывает сервис домена и собирает ответ по контракту.
3. Service содержит бизнес-логику и использует repository.
4. Repository делает запросы через Prisma.
5. Ошибки ловятся `apiErrorHandler` и превращаются в `ErrorResponse`.

Пример: `src/api/v1/memes/*` + `src/domain/meme/*`.

## Контракты и ответы
- Все типы берём из `@memalerts/api-contracts` (см. `packages/api-contracts`).
- Мапперы (`api/v1/.../mappers.ts`) приводят модели БД к контрактным формам.
- `AppError` используется для бизнес-ошибок с корректными кодами.

## Legacy зоны
Часть модулей ещё остаётся в `controllers/`, `routes/`, `services/`. Новые endpoints добавляются только в `api/v1` + `domain`, старые постепенно мигрируются.

## Персонализированные рекомендации (legacy)
- Эндпоинт: `GET /channels/:slug/memes/personalized` (legacy controller `src/controllers/viewer/personalizedMemes.ts`).
- Exploration: параметр `exploration` задаёт долю случайных мемов (0..0.3, default 0.1).

## Как добавить новый endpoint
1. Создать схемы в `packages/api-contracts`.
2. Добавить `router.ts` + `handlers.ts` в `api/v1`.
3. Реализовать сервис и репозиторий в `domain`.
4. Сделать mapper для контрактного ответа.
5. Добавить тесты контрактов и обновить существующие.
