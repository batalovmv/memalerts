# AI Assistant Guide — Руководство для AI-ассистентов

> Этот документ содержит всю необходимую информацию для AI-ассистентов (Claude, Codex, Cursor и др.), работающих с проектом MemAlerts.
>
> **ПРОЧИТАЙ ПОЛНОСТЬЮ перед началом работы.**

---

## TL;DR для быстрого старта

1. **Типы**: Все API типы только из `@memalerts/api-contracts` — не создавай локальные!
2. **Legacy**: Папки `controllers/`, `routes/`, `services/` — НЕ УДАЛЯТЬ (ещё используются)
3. **Инструменты**: Есть `gh` CLI и доступ к VPS
4. **Тесты**: `pnpm --filter @memalerts/backend test`
5. **Сборка**: `pnpm build:contracts` после изменения типов

---

## Обзор проекта

**MemAlerts** — платформа для активации мемов на стримах через channel points и другие механики.

```
memalerts-monorepo/
├── apps/
│   ├── backend/          # Express API, Socket.IO, боты чатов
│   └── frontend/         # React SPA + OBS overlay
├── packages/
│   ├── api-contracts/    # Zod schemas для API (ЕДИНЫЙ ИСТОЧНИК ТИПОВ)
│   └── shared/           # Общие утилиты
└── CLAUDE.md             # ТЫ ЗДЕСЬ
```

---

## Доступные инструменты

### VPS доступ
- **SSH**: Доступ к production/beta серверам через команды в терминале
- **База данных**: PostgreSQL доступна через Prisma CLI

### GitHub CLI
- **gh CLI** установлен и авторизован
- Используй для: PR, issues, checks, releases
- Примеры:
  ```bash
  gh pr create --title "..." --body "..."
  gh pr list
  gh issue view 123
  gh run list
  ```

### Основные команды

```bash
# Установка зависимостей
pnpm install

# Разработка
pnpm dev              # Все приложения
pnpm dev:backend      # Только backend
pnpm dev:frontend     # Только frontend

# Сборка
pnpm build
pnpm build:contracts  # Пересобрать api-contracts

# Тесты
pnpm --filter @memalerts/backend test
pnpm --filter @memalerts/frontend test

# База данных
cd apps/backend
npx prisma migrate dev    # Применить миграции
npx prisma generate       # Сгенерировать клиент
npx prisma studio         # GUI для БД
```

---

## Архитектура

### Принципы (ОБЯЗАТЕЛЬНО соблюдать)

1. **Contract-first**: Все API типы ТОЛЬКО из `@memalerts/api-contracts`
2. **Runtime validation**: Входные данные валидируются через Zod
3. **Единый формат ответов**:
   - Success: `{ success: true, data: ... }`
   - Error: `{ success: false, error: { code, message, details? } }`
4. **Layered architecture**:
   - Backend: `handler → service → repository → prisma`
   - Frontend: `page → feature → entity → shared`

### Backend структура

```
apps/backend/src/
├── api/                    # НОВАЯ структура (v1 API)
│   ├── middleware/         # validation, auth, apiErrorHandler
│   └── v1/
│       └── memes/          # router, handlers, mappers
├── domain/                 # Бизнес-логика
│   └── meme/
│       ├── MemeService.ts
│       └── MemeRepository.ts
├── controllers/            # LEGACY (не удалять без миграции!)
├── routes/                 # LEGACY routing
├── services/               # LEGACY services
└── utils/
    └── retryTransaction.ts # Retry для concurrent transactions
```

### Frontend структура

```
apps/frontend/src/
├── pages/              # Тонкие обёртки для роутов
├── features/           # Фичи со своими api/model/ui
│   └── meme-catalog/
│       └── api/
│           └── useMemes.ts  # Typed hooks с api-contracts
├── entities/           # Доменные сущности
│   └── meme/
├── shared/
│   └── api/
│       └── client.ts   # Typed API client с Zod validation
└── widgets/
```

---

## ЗАПРЕЩЕНО (что нельзя удалять/ломать)

### Критические файлы

| Файл | Причина |
|------|---------|
| `packages/api-contracts/` | Единый источник типов для всего проекта |
| `apps/backend/src/api/` | Новая API структура |
| `apps/backend/src/domain/` | Domain layer (Service + Repository) |
| `apps/backend/prisma/schema.prisma` | Схема БД |
| `apps/backend/src/utils/retryTransaction.ts` | Retry logic для concurrent operations |
| `.github/workflows/` | CI/CD pipelines |

### Legacy код (НЕ УДАЛЯТЬ без полной миграции)

```
apps/backend/src/controllers/   # Старые endpoints, ещё используются
apps/backend/src/routes/        # Старый routing
apps/backend/src/services/      # Старые сервисы
```

**Причина**: Эти модули обслуживают endpoints, которые ещё не мигрированы на новую структуру `api/v1`. Удаление сломает production.

### Правила при изменениях

1. **Перед удалением файла** — проверь что он не используется:
   ```bash
   # Поиск импортов
   grep -r "from '.*filename'" apps/ packages/
   ```

2. **При изменении API типов** — обнови в правильном порядке:
   1. `packages/api-contracts/` — схема
   2. `pnpm build:contracts` — пересборка
   3. Backend handlers/mappers
   4. Frontend hooks

3. **При изменении Prisma schema**:
   ```bash
   cd apps/backend
   npx prisma migrate dev --name описание_изменения
   npx prisma generate
   ```

---

## API контракты

### Где определены типы

```
packages/api-contracts/src/
├── common/
│   ├── pagination.ts    # PaginationQuery, PaginationMeta
│   ├── errors.ts        # ErrorCode, ApiError
│   └── responses.ts     # createSuccessSchema, createPaginatedSchema
├── entities/
│   ├── meme.ts          # MemeListItem, MemeDetail, etc.
│   ├── channel.ts
│   ├── user.ts
│   └── submission.ts
├── endpoints/
│   └── memes/
│       ├── list.ts      # ListChannelMemesQuery/Response
│       ├── get.ts       # GetMemeResponse
│       └── activate.ts  # ActivateMemeBody/Response
└── index.ts             # Реэкспорт всего
```

### Как добавить новый endpoint

1. Создать схемы в `packages/api-contracts/src/endpoints/`
2. Экспортировать из `index.ts`
3. `pnpm build:contracts`
4. Создать `router.ts` + `handlers.ts` в `apps/backend/src/api/v1/`
5. Реализовать service/repository в `domain/`
6. Создать frontend hook в `features/*/api/`

---

## Тестирование

### Backend тесты

```bash
cd apps/backend
pnpm test                    # Все тесты
pnpm test -- --grep "meme"   # Фильтр по имени
```

**Важно**: Тесты используют реальную БД. Перед запуском:
- Убедись что PostgreSQL запущен
- Проверь `DATABASE_URL` в `.env`

### Frontend тесты

```bash
cd apps/frontend
pnpm test
```

### Contract тесты

```bash
cd packages/api-contracts
pnpm test
```

---

## Деплой

| Среда | Триггер | URL |
|-------|---------|-----|
| Beta | Push в `main` | beta.twitchmemes.ru |
| Production | Push тега `prod-*` | twitchmemes.ru |

### Создание релиза

```bash
git tag prod-v1.2.3
git push origin prod-v1.2.3
```

### Проверка статуса деплоя

```bash
gh run list --limit 5
gh run view <run-id>
```

---

## Частые ошибки и решения

### "Cannot find module '@memalerts/api-contracts'"

```bash
pnpm build:contracts
# или
cd packages/api-contracts && pnpm build
```

### "P2034: Transaction conflict" при активации мема

Это нормально при concurrent requests. Код уже обёрнут в `withRetry()`:
```typescript
// apps/backend/src/utils/retryTransaction.ts
await withRetry(() => prisma.$transaction(...), { maxRetries: 3 });
```

### "EPERM" при `prisma generate` на Windows

Добавь исключение в Windows Defender:
```
node_modules\.prisma\
node_modules\@prisma\
```

---

## Стиль кода

### TypeScript

- Используй типы из `@memalerts/api-contracts`, не создавай локальные DTO
- `as any` / `as unknown` только с комментарием почему
- Prefer `interface` для объектов, `type` для unions

### Именование

- Файлы: `camelCase.ts` для модулей, `PascalCase.tsx` для React компонентов
- Переменные: `camelCase`
- Константы: `SCREAMING_SNAKE_CASE`
- Типы/интерфейсы: `PascalCase`

### Коммиты

```
feat: добавить фичу X
fix: исправить баг Y
refactor: переработать модуль Z
test: добавить тесты для W
docs: обновить документацию
```

---

## Контакты и ресурсы

- **GitHub**: [memalerts-monorepo](../../)
- **CI/CD**: `.github/workflows/`
- **Документация**:
  - Backend: `apps/backend/ARCHITECTURE.md`
  - Frontend: `apps/frontend/docs/ARCHITECTURE.md`
  - План рефакторинга: `ARCHITECTURE_REFACTORING_PLAN.md`

---

*Последнее обновление: 2026-01-26*
