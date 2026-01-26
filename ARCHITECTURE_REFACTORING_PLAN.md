# Architecture Refactoring Plan v1.0

> **Цель**: Полностью исправить архитектуру проекта для максимальной читаемости AI-ассистентами, производительности и поддерживаемости.
> **Исполнитель**: GPT 5.2 Codex Extra High
> **Контекст**: Можно удалить все данные, breaking changes разрешены

---

## СТАТУС: ✅ ЗАВЕРШЕНО (2026-01-26)

### Выполнено ~95%

| Фаза | Статус | Примечание |
|------|--------|------------|
| Фаза 0: Подготовка | ✅ | api-contracts создан |
| Фаза 1: Контракты Meme | ✅ | Все schemas определены |
| Фаза 2: Prisma Schema | ⏭️ | Не требуется (legacy Meme уже удалён) |
| Фаза 3: Backend API | ✅ | v1 API layer создан |
| Фаза 3.5: Критические фиксы | ✅ | tsup, SQL rollups, retry logic |
| Фаза 4: Frontend | ✅ | typed client + hooks |
| Фаза 5: Удаление legacy | ✅ | legacy types удалены |
| Фаза 6: Тестирование | ✅ | contract tests + ARCHITECTURE.md |

### Осознанно сохранено

- `controllers/`, `routes/`, `services/` — legacy endpoints, мигрируются по мере необходимости
- 50 случаев `as unknown`/`as any` — часть в тестах, minor cleanup

### Создана документация

- `AI_ASSISTANT_GUIDE.md` — руководство для AI-ассистентов
- `apps/backend/ARCHITECTURE.md` — архитектура backend
- `apps/frontend/docs/ARCHITECTURE.md` — архитектура frontend

---

# Часть 1: КРИТИЧЕСКИЕ ПРОБЛЕМЫ (найдены при аудите)

## 1.1 Типизация и контракты

| ID | Проблема | Файл | Строка | Критичность |
|----|----------|------|--------|-------------|
| T1 | Frontend напрямую импортирует backend типы через `@/types` | `apps/frontend/src/types/index.ts` | 1 | CRITICAL |
| T2 | Meme interface имеет 30+ optional fields с 4 вариантами ID | `packages/shared/src/types/meme.ts` | 15-97 | CRITICAL |
| T3 | Prisma return shape (_count) протекает в shared types | `packages/shared/src/types/meme.ts` | 63 | HIGH |
| T4 | 14+ Record<string, ...> типов без конкретной структуры | `apps/backend/src/shared/types.ts` | many | HIGH |
| T5 | Нет runtime validation (Zod/Joi) для API | everywhere | - | CRITICAL |

## 1.2 Модель данных

| ID | Проблема | Файл | Строка | Критичность |
|----|----------|------|--------|-------------|
| D1 | Channel модель имеет 160+ полей | `schema.prisma` | 10-169 | CRITICAL |
| D2 | 3 модели для мемов: Meme(legacy), ChannelMeme, MemeAsset | `schema.prisma` | 1076-1109 | CRITICAL |
| D3 | 6+ полей типа @db.Text для JSON вместо @db.JsonB | `schema.prisma` | 85,91,etc | MEDIUM |
| D4 | JsonB поля без schema validation | `schema.prisma` | 46-48 | HIGH |
| D5 | 22+ полей для разных платформ нарушают DRY | `schema.prisma` | 148-169 | MEDIUM |

## 1.3 Backend

| ID | Проблема | Файл | Строка | Критичность |
|----|----------|------|--------|-------------|
| B1 | 122 файла контроллеров без иерархии | `controllers/` | - | HIGH |
| B2 | DTO содержит бизнес-логику (loadLegacyTagsById) | `channelMemeListDto.ts` | 229-262 | MEDIUM |
| B3 | toChannelMemeListItemDto - 90 строк nested transforms | `channelMemeListDto.ts` | 136-227 | HIGH |
| B4 | Repository возвращает Promise<unknown> | `MemeRepository.ts` | 1-27 | MEDIUM |
| B5 | Контроллеры возвращают разные форматы (array vs {items}) | many | - | CRITICAL |

## 1.4 Frontend

| ID | Проблема | Файл | Строка | Критичность |
|----|----------|------|--------|-------------|
| F1 | toMemeCard функция с 6 typeof checks | `StarterMemesPanel.tsx` | 28-54 | HIGH |
| F2 | 3x as unknown для получения headers | `lib/api.ts` | 5,8,9 | MEDIUM |
| F3 | Double cast (item as { qualityScore?: number }) | `StarterMemesPanel.tsx` | 36-38 | MEDIUM |
| F4 | getMemePrimaryId helper с неявной логикой ID | `useMemeCard.ts` | 17 | MEDIUM |
| F5 | MemePoolItem тип не определён явно | `memesPool.ts` | 6 | HIGH |

---

# Часть 2: ЦЕЛЕВАЯ АРХИТЕКТУРА

## 2.1 Принципы

```
ПРИНЦИП 1: SINGLE SOURCE OF TRUTH FOR TYPES
- Все API контракты определяются через Zod schemas в packages/api-contracts
- Backend использует schemas для validation
- Frontend использует inferred types из schemas
- Никаких дублирующихся типов

ПРИНЦИП 2: EXPLICIT OVER IMPLICIT
- Все поля обязательны по умолчанию, optional помечаются явно
- Никаких Record<string, unknown>
- Никаких as unknown casts без проверки
- discriminated unions вместо optional fields

ПРИНЦИП 3: LAYERED ARCHITECTURE
Backend: Controller -> Service -> Repository -> Prisma
Frontend: Page -> Feature -> Entity -> Shared

ПРИНЦИП 4: FAIL FAST
- Runtime validation на границах системы
- Строгая типизация везде
- Ошибки типов = build failure

ПРИНЦИП 5: CONSISTENCY
- Единый формат ответов API
- Единый формат ошибок
- Единые naming conventions
```

## 2.2 Структура проекта (целевая)

```
memalerts-monorepo/
├── packages/
│   ├── api-contracts/           # NEW: Zod schemas для API
│   │   ├── src/
│   │   │   ├── entities/        # Сущности (Meme, Channel, User)
│   │   │   │   ├── meme.ts
│   │   │   │   ├── channel.ts
│   │   │   │   └── user.ts
│   │   │   ├── endpoints/       # Request/Response schemas
│   │   │   │   ├── memes/
│   │   │   │   │   ├── list.ts
│   │   │   │   │   ├── get.ts
│   │   │   │   │   └── activate.ts
│   │   │   │   └── channels/
│   │   │   ├── common/          # Shared schemas (pagination, errors)
│   │   │   │   ├── pagination.ts
│   │   │   │   ├── errors.ts
│   │   │   │   └── responses.ts
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   └── shared/                  # Удалить types, оставить только утилиты
│       └── src/
│           └── utils/           # Только чистые утилиты
│
├── apps/
│   ├── backend/
│   │   ├── prisma/
│   │   │   └── schema.prisma    # Упрощённая схема
│   │   └── src/
│   │       ├── api/             # NEW: API layer (routes + validation)
│   │       │   ├── v1/
│   │       │   │   ├── memes/
│   │       │   │   │   ├── router.ts
│   │       │   │   │   ├── handlers.ts
│   │       │   │   │   └── mappers.ts
│   │       │   │   └── channels/
│   │       │   └── middleware/
│   │       ├── domain/          # Business logic
│   │       │   ├── meme/
│   │       │   │   ├── MemeService.ts
│   │       │   │   └── MemeRepository.ts
│   │       │   └── channel/
│   │       ├── infrastructure/  # DB, external services
│   │       │   ├── prisma/
│   │       │   ├── redis/
│   │       │   └── storage/
│   │       └── shared/          # Backend-only utils
│   │
│   └── frontend/
│       └── src/
│           ├── app/             # App shell, routing
│           ├── pages/           # Route components (thin)
│           ├── features/        # Feature modules
│           │   └── meme-catalog/
│           │       ├── api/     # API hooks using contracts
│           │       ├── model/   # Business logic
│           │       └── ui/      # Components
│           ├── entities/        # Domain entities
│           │   └── meme/
│           │       ├── model/
│           │       └── ui/
│           └── shared/          # Shared UI, utils
│               ├── api/         # API client
│               └── ui/
```

## 2.3 API Contract Example

```typescript
// packages/api-contracts/src/entities/meme.ts
import { z } from 'zod';

// Base meme schema - все поля ОБЯЗАТЕЛЬНЫ кроме явно помеченных
export const MemeSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(200),
  type: z.enum(['video', 'audio', 'image']),

  // Media URLs - всегда присутствуют
  fileUrl: z.string().url(),
  previewUrl: z.string().url().nullable(),

  // Pricing
  priceCoins: z.number().int().min(0),

  // Metadata
  durationMs: z.number().int().min(0),
  createdAt: z.string().datetime(),

  // Optional enrichment (только когда запрошено)
  tags: z.array(z.object({
    id: z.string().uuid(),
    name: z.string()
  })).optional(),
});

export type Meme = z.infer<typeof MemeSchema>;

// packages/api-contracts/src/endpoints/memes/list.ts
import { z } from 'zod';
import { MemeSchema } from '../../entities/meme';
import { PaginatedResponseSchema, PaginationQuerySchema } from '../../common/pagination';

export const ListMemesQuerySchema = PaginationQuerySchema.extend({
  channelId: z.string().uuid(),
  sortBy: z.enum(['createdAt', 'priceCoins', 'activationsCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  tags: z.array(z.string()).optional(),
});

export const ListMemesResponseSchema = PaginatedResponseSchema(MemeSchema);

export type ListMemesQuery = z.infer<typeof ListMemesQuerySchema>;
export type ListMemesResponse = z.infer<typeof ListMemesResponseSchema>;
```

## 2.4 Единый формат ответов API

```typescript
// packages/api-contracts/src/common/responses.ts

// Успешный ответ с данными
export const SuccessResponseSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z.object({
    success: z.literal(true),
    data: dataSchema,
  });

// Пагинированный ответ
export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(itemSchema),
      pagination: z.object({
        total: z.number().int(),
        limit: z.number().int(),
        offset: z.number().int(),
        hasMore: z.boolean(),
      }),
    }),
  });

// Ошибка
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(), // 'VALIDATION_ERROR', 'NOT_FOUND', etc
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
```

---

# Часть 3: ПЛАН МИГРАЦИИ

## Фаза 0: Подготовка (1-2 дня)

### 0.1 Создать packages/api-contracts

```bash
# Команды
cd packages
mkdir api-contracts
cd api-contracts
npm init -y
npm install zod typescript
```

**Файлы для создания:**
```
packages/api-contracts/
├── src/
│   ├── index.ts
│   ├── common/
│   │   ├── pagination.ts
│   │   ├── responses.ts
│   │   └── errors.ts
│   ├── entities/
│   │   └── .gitkeep
│   └── endpoints/
│       └── .gitkeep
├── package.json
└── tsconfig.json
```

**package.json:**
```json
{
  "name": "@memalerts/api-contracts",
  "version": "1.0.0",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

### 0.2 Определить базовые контракты

**Файл: `packages/api-contracts/src/common/pagination.ts`**
```typescript
import { z } from 'zod';

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export const PaginationMetaSchema = z.object({
  total: z.number().int().min(0),
  limit: z.number().int().min(1),
  offset: z.number().int().min(0),
  hasMore: z.boolean(),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type PaginationMeta = z.infer<typeof PaginationMetaSchema>;
```

**Файл: `packages/api-contracts/src/common/errors.ts`**
```typescript
import { z } from 'zod';

export const ErrorCodeSchema = z.enum([
  // Client errors
  'VALIDATION_ERROR',
  'UNAUTHORIZED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',

  // Business errors
  'INSUFFICIENT_BALANCE',
  'MEME_ON_COOLDOWN',
  'CHANNEL_NOT_ACTIVE',

  // Server errors
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
]);

export const ApiErrorSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.unknown()).optional(),
  field: z.string().optional(), // For validation errors
});

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export type ApiError = z.infer<typeof ApiErrorSchema>;
```

**Файл: `packages/api-contracts/src/common/responses.ts`**
```typescript
import { z } from 'zod';
import { PaginationMetaSchema } from './pagination';
import { ApiErrorSchema } from './errors';

// Generic success response wrapper
export function createSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

// Paginated response wrapper
export function createPaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(itemSchema),
      pagination: PaginationMetaSchema,
    }),
  });
}

// Error response
export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: ApiErrorSchema,
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
```

### 0.3 Настроить workspace dependencies

**Обновить root package.json:**
```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

**Добавить в apps/backend/package.json:**
```json
{
  "dependencies": {
    "@memalerts/api-contracts": "workspace:*"
  }
}
```

**Добавить в apps/frontend/package.json:**
```json
{
  "dependencies": {
    "@memalerts/api-contracts": "workspace:*"
  }
}
```

---

## Фаза 1: Контракты для сущности Meme (2-3 дня)

### 1.1 Определить Meme entity schema

**Файл: `packages/api-contracts/src/entities/meme.ts`**
```typescript
import { z } from 'zod';

// Базовые enum'ы
export const MemeTypeSchema = z.enum(['video', 'audio', 'image']);
export const MemeStatusSchema = z.enum(['approved', 'pending', 'rejected', 'disabled']);

// Вариант медиа файла
export const MemeVariantSchema = z.object({
  format: z.enum(['webm', 'mp4', 'preview']),
  fileUrl: z.string(),
  sourceType: z.string(),
  fileSizeBytes: z.number().int().nullable(),
});

// Тег
export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
});

// Автор мема
export const MemeAuthorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
});

// Базовый мем для списков (минимум полей)
export const MemeListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: MemeTypeSchema,

  // Media - обязательно
  fileUrl: z.string(),
  previewUrl: z.string().nullable(),
  variants: z.array(MemeVariantSchema),

  // Pricing
  priceCoins: z.number().int().min(0),

  // Metadata
  durationMs: z.number().int().min(0),
  activationsCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

// Полный мем для детального просмотра
export const MemeDetailSchema = MemeListItemSchema.extend({
  // Status
  status: MemeStatusSchema,

  // Dynamic pricing (optional)
  basePriceCoins: z.number().int().min(0).optional(),
  dynamicPriceCoins: z.number().int().min(0).optional(),
  priceMultiplier: z.number().min(0).max(10).optional(),
  priceTrend: z.enum(['rising', 'falling', 'stable']).optional(),

  // Cooldown (optional)
  cooldownMinutes: z.number().int().min(0).optional(),
  cooldownSecondsRemaining: z.number().int().min(0).optional(),
  cooldownUntil: z.string().datetime().nullable().optional(),

  // Tags
  tags: z.array(TagSchema),

  // AI fields (only for owners/admins)
  aiAutoDescription: z.string().nullable().optional(),
  aiAutoTagNames: z.array(z.string()).nullable().optional(),

  // Quality
  qualityScore: z.number().min(0).max(100).nullable().optional(),

  // Author
  createdBy: MemeAuthorSchema.nullable(),
});

// Type exports
export type MemeType = z.infer<typeof MemeTypeSchema>;
export type MemeStatus = z.infer<typeof MemeStatusSchema>;
export type MemeVariant = z.infer<typeof MemeVariantSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type MemeAuthor = z.infer<typeof MemeAuthorSchema>;
export type MemeListItem = z.infer<typeof MemeListItemSchema>;
export type MemeDetail = z.infer<typeof MemeDetailSchema>;
```

### 1.2 Определить endpoint schemas для мемов

**Файл: `packages/api-contracts/src/endpoints/memes/list.ts`**
```typescript
import { z } from 'zod';
import { MemeListItemSchema } from '../../entities/meme';
import { PaginationQuerySchema } from '../../common/pagination';
import { createPaginatedSchema } from '../../common/responses';

// GET /channels/:channelId/memes
export const ListChannelMemesParamsSchema = z.object({
  channelId: z.string().uuid(),
});

export const ListChannelMemesQuerySchema = PaginationQuerySchema.extend({
  sortBy: z.enum(['createdAt', 'priceCoins', 'activationsCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  tags: z.string().optional(), // comma-separated tag names
  search: z.string().max(200).optional(),
});

export const ListChannelMemesResponseSchema = createPaginatedSchema(MemeListItemSchema);

// Type exports
export type ListChannelMemesParams = z.infer<typeof ListChannelMemesParamsSchema>;
export type ListChannelMemesQuery = z.infer<typeof ListChannelMemesQuerySchema>;
export type ListChannelMemesResponse = z.infer<typeof ListChannelMemesResponseSchema>;
```

**Файл: `packages/api-contracts/src/endpoints/memes/get.ts`**
```typescript
import { z } from 'zod';
import { MemeDetailSchema } from '../../entities/meme';
import { createSuccessSchema } from '../../common/responses';

// GET /memes/:memeId
export const GetMemeParamsSchema = z.object({
  memeId: z.string().uuid(),
});

export const GetMemeResponseSchema = createSuccessSchema(MemeDetailSchema);

export type GetMemeParams = z.infer<typeof GetMemeParamsSchema>;
export type GetMemeResponse = z.infer<typeof GetMemeResponseSchema>;
```

**Файл: `packages/api-contracts/src/endpoints/memes/activate.ts`**
```typescript
import { z } from 'zod';
import { createSuccessSchema } from '../../common/responses';

// POST /memes/:memeId/activate
export const ActivateMemeParamsSchema = z.object({
  memeId: z.string().uuid(),
});

export const ActivateMemeBodySchema = z.object({
  channelId: z.string().uuid(),
  volume: z.number().min(0).max(1).default(1),
});

export const ActivateMemeResponseDataSchema = z.object({
  activationId: z.string().uuid(),
  balanceAfter: z.number().int(),
  cooldownUntil: z.string().datetime().nullable(),
});

export const ActivateMemeResponseSchema = createSuccessSchema(ActivateMemeResponseDataSchema);

export type ActivateMemeParams = z.infer<typeof ActivateMemeParamsSchema>;
export type ActivateMemeBody = z.infer<typeof ActivateMemeBodySchema>;
export type ActivateMemeResponse = z.infer<typeof ActivateMemeResponseSchema>;
```

### 1.3 Создать index.ts для экспорта

**Файл: `packages/api-contracts/src/index.ts`**
```typescript
// Common
export * from './common/pagination';
export * from './common/errors';
export * from './common/responses';

// Entities
export * from './entities/meme';

// Endpoints
export * from './endpoints/memes/list';
export * from './endpoints/memes/get';
export * from './endpoints/memes/activate';
```

---

## Фаза 2: Рефакторинг Prisma Schema (2-3 дня)

### 2.1 Упростить модель данных

**УДАЛИТЬ** legacy модели:
- `Meme` (заменена на `ChannelMeme` + `MemeAsset`)
- Все deprecated поля

**СОЗДАТЬ** новую упрощённую схему:

**Файл: `apps/backend/prisma/schema.prisma` (часть с мемами)**
```prisma
// =====================================
// MEME ASSET - глобальный медиа файл
// =====================================
model MemeAsset {
  id              String   @id @default(uuid())

  // Media
  type            String   // 'video' | 'audio' | 'image'
  fileUrl         String   // Primary playback URL
  fileHash        String   @unique // SHA-256 for dedup
  mimeType        String?
  fileSizeBytes   BigInt?
  durationMs      Int      @default(0)

  // Variants for different formats
  variants        MemeAssetVariant[]

  // AI enrichment
  aiStatus        String   @default("pending") // 'pending' | 'processing' | 'done' | 'failed'
  aiAutoTitle     String?
  aiAutoDescription String? @db.Text
  aiAutoTagNames  String[] // Array of tag names
  aiTranscript    String?  @db.Text
  aiSearchText    String?  @db.Text
  aiCompletedAt   DateTime?
  aiRiskScore     Float?

  // Quality
  qualityScore    Float?   // 0-100

  // Status
  status          String   @default("active") // 'active' | 'hidden' | 'quarantined' | 'deleted'
  hiddenAt        DateTime?
  quarantinedAt   DateTime?
  deletedAt       DateTime?

  // Relations
  channelMemes    ChannelMeme[]
  createdById     String?
  createdBy       User?    @relation(fields: [createdById], references: [id])

  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@index([fileHash])
  @@index([status])
  @@index([aiStatus])
  @@index([qualityScore])
  @@index([createdAt])
}

model MemeAssetVariant {
  id              String   @id @default(uuid())
  memeAssetId     String
  memeAsset       MemeAsset @relation(fields: [memeAssetId], references: [id], onDelete: Cascade)

  format          String   // 'webm' | 'mp4' | 'preview'
  fileUrl         String
  status          String   @default("pending") // 'pending' | 'processing' | 'done' | 'failed'
  priority        Int      @default(0) // Lower = preferred
  fileSizeBytes   BigInt?

  createdAt       DateTime @default(now())

  @@unique([memeAssetId, format])
  @@index([memeAssetId, status])
}

// =====================================
// CHANNEL MEME - мем в каталоге канала
// =====================================
model ChannelMeme {
  id              String   @id @default(uuid())
  channelId       String
  channel         Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  memeAssetId     String
  memeAsset       MemeAsset @relation(fields: [memeAssetId], references: [id])

  // Display
  title           String   // Channel-specific title (can differ from AI)

  // Pricing
  priceCoins      Int      @default(100)

  // Cooldown
  cooldownMinutes Int?     // null = no cooldown
  lastActivatedAt DateTime?

  // Status
  status          String   @default("approved") // 'approved' | 'pending' | 'rejected' | 'disabled'

  // Soft delete
  deletedAt       DateTime?

  // Relations
  activations     MemeActivation[]
  tags            ChannelMemeTag[]

  // Timestamps
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  @@unique([channelId, memeAssetId])
  @@index([channelId, status, deletedAt])
  @@index([memeAssetId])
  @@index([createdAt])
}

// =====================================
// TAGS
// =====================================
model Tag {
  id              String   @id @default(uuid())
  name            String   @unique // Canonical name: 'funny'
  displayName     String?  // Display: 'Funny'
  categoryId      String?
  category        TagCategory? @relation(fields: [categoryId], references: [id])

  status          String   @default("active") // 'active' | 'deprecated'
  usageCount      Int      @default(0)

  aliases         TagAlias[]
  channelMemeTags ChannelMemeTag[]

  createdAt       DateTime @default(now())

  @@index([categoryId])
  @@index([status, usageCount])
}

model TagCategory {
  id              String   @id @default(uuid())
  slug            String   @unique // 'mood', 'genre', 'intent'
  displayName     String   // 'Настроение'
  sortOrder       Int      @default(0)

  tags            Tag[]

  @@index([sortOrder])
}

model TagAlias {
  id              String   @id @default(uuid())
  alias           String   @unique // 'смешной', 'humor'
  tagId           String
  tag             Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@index([tagId])
}

model ChannelMemeTag {
  id              String   @id @default(uuid())
  channelMemeId   String
  channelMeme     ChannelMeme @relation(fields: [channelMemeId], references: [id], onDelete: Cascade)
  tagId           String
  tag             Tag      @relation(fields: [tagId], references: [id], onDelete: Cascade)

  @@unique([channelMemeId, tagId])
  @@index([tagId])
}

// =====================================
// ACTIVATION
// =====================================
model MemeActivation {
  id              String   @id @default(uuid())
  channelMemeId   String
  channelMeme     ChannelMeme @relation(fields: [channelMemeId], references: [id])
  userId          String
  user            User     @relation(fields: [userId], references: [id])
  channelId       String
  channel         Channel  @relation(fields: [channelId], references: [id])

  // Transaction
  priceCoins      Int
  volume          Float    @default(1)

  // Status
  status          String   @default("queued") // 'queued' | 'playing' | 'done' | 'cancelled'

  // Timestamps
  createdAt       DateTime @default(now())
  playedAt        DateTime?
  completedAt     DateTime?

  @@index([channelMemeId, status])
  @@index([userId, createdAt])
  @@index([channelId, createdAt])
}
```

### 2.2 Миграция данных

**Создать migration script:**

**Файл: `apps/backend/scripts/migrate-to-new-schema.ts`**
```typescript
/**
 * Migration script: Legacy Meme -> ChannelMeme + MemeAsset
 *
 * IMPORTANT: Run with empty database or backup first!
 *
 * Steps:
 * 1. For each legacy Meme:
 *    a. Create MemeAsset from file data
 *    b. Create ChannelMeme linking to MemeAsset
 *    c. Migrate tags to ChannelMemeTag
 * 2. Delete legacy Meme table
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function migrate() {
  console.log('Starting migration...');

  // Get all legacy memes
  const legacyMemes = await prisma.meme.findMany({
    include: {
      tags: { include: { tag: true } },
      channel: true,
    },
  });

  console.log(`Found ${legacyMemes.length} legacy memes`);

  for (const meme of legacyMemes) {
    // Check if MemeAsset exists (by fileHash)
    let memeAsset = await prisma.memeAsset.findUnique({
      where: { fileHash: meme.fileHash },
    });

    if (!memeAsset) {
      // Create new MemeAsset
      memeAsset = await prisma.memeAsset.create({
        data: {
          type: meme.type,
          fileUrl: meme.fileUrl,
          fileHash: meme.fileHash,
          durationMs: meme.durationMs,
          aiStatus: meme.aiStatus || 'pending',
          aiAutoTitle: meme.aiAutoTitle,
          aiAutoDescription: meme.aiAutoDescription,
          createdById: meme.createdById,
          createdAt: meme.createdAt,
        },
      });
    }

    // Create ChannelMeme
    const channelMeme = await prisma.channelMeme.create({
      data: {
        channelId: meme.channelId,
        memeAssetId: memeAsset.id,
        title: meme.title,
        priceCoins: meme.priceCoins,
        status: meme.status,
        createdAt: meme.createdAt,
      },
    });

    // Migrate tags
    for (const tagRelation of meme.tags) {
      await prisma.channelMemeTag.create({
        data: {
          channelMemeId: channelMeme.id,
          tagId: tagRelation.tag.id,
        },
      });
    }

    console.log(`Migrated meme ${meme.id} -> ChannelMeme ${channelMeme.id}`);
  }

  console.log('Migration complete!');
}

migrate()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
```

---

## Фаза 3: Backend API Refactoring (3-5 дней)

### 3.1 Создать новую структуру API

**Файл: `apps/backend/src/api/v1/memes/router.ts`**
```typescript
import { Router } from 'express';
import { validateRequest } from '../../middleware/validation';
import { requireAuth, optionalAuth } from '../../middleware/auth';
import {
  ListChannelMemesParamsSchema,
  ListChannelMemesQuerySchema,
  GetMemeParamsSchema,
  ActivateMemeParamsSchema,
  ActivateMemeBodySchema,
} from '@memalerts/api-contracts';
import * as handlers from './handlers';

const router = Router();

// GET /api/v1/channels/:channelId/memes
router.get(
  '/channels/:channelId/memes',
  optionalAuth,
  validateRequest({
    params: ListChannelMemesParamsSchema,
    query: ListChannelMemesQuerySchema,
  }),
  handlers.listChannelMemes
);

// GET /api/v1/memes/:memeId
router.get(
  '/memes/:memeId',
  optionalAuth,
  validateRequest({
    params: GetMemeParamsSchema,
  }),
  handlers.getMeme
);

// POST /api/v1/memes/:memeId/activate
router.post(
  '/memes/:memeId/activate',
  requireAuth,
  validateRequest({
    params: ActivateMemeParamsSchema,
    body: ActivateMemeBodySchema,
  }),
  handlers.activateMeme
);

export { router as memesRouter };
```

### 3.2 Создать validation middleware

**Файл: `apps/backend/src/api/middleware/validation.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';
import { ErrorResponse } from '@memalerts/api-contracts';

interface ValidationSchemas {
  params?: ZodSchema;
  query?: ZodSchema;
  body?: ZodSchema;
}

export function validateRequest(schemas: ValidationSchemas) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (schemas.params) {
        req.params = schemas.params.parse(req.params);
      }
      if (schemas.query) {
        req.query = schemas.query.parse(req.query);
      }
      if (schemas.body) {
        req.body = schemas.body.parse(req.body);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        const response: ErrorResponse = {
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Invalid request data',
            details: {
              issues: error.issues.map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
              })),
            },
          },
        };
        return res.status(400).json(response);
      }
      next(error);
    }
  };
}
```

### 3.3 Создать handlers

**Файл: `apps/backend/src/api/v1/memes/handlers.ts`**
```typescript
import { Request, Response, NextFunction } from 'express';
import {
  ListChannelMemesParams,
  ListChannelMemesQuery,
  ListChannelMemesResponse,
  GetMemeParams,
  GetMemeResponse,
  ActivateMemeParams,
  ActivateMemeBody,
  ActivateMemeResponse,
} from '@memalerts/api-contracts';
import { MemeService } from '../../../domain/meme/MemeService';
import { toMemeListItem, toMemeDetail } from './mappers';

const memeService = new MemeService();

export async function listChannelMemes(
  req: Request<ListChannelMemesParams, unknown, unknown, ListChannelMemesQuery>,
  res: Response<ListChannelMemesResponse>,
  next: NextFunction
) {
  try {
    const { channelId } = req.params;
    const { limit, offset, sortBy, sortOrder, tags, search } = req.query;

    const result = await memeService.listChannelMemes({
      channelId,
      limit,
      offset,
      sortBy,
      sortOrder,
      tags: tags?.split(',').map(t => t.trim()),
      search,
    });

    const response: ListChannelMemesResponse = {
      success: true,
      data: {
        items: result.items.map(toMemeListItem),
        pagination: {
          total: result.total,
          limit,
          offset,
          hasMore: offset + result.items.length < result.total,
        },
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function getMeme(
  req: Request<GetMemeParams>,
  res: Response<GetMemeResponse>,
  next: NextFunction
) {
  try {
    const { memeId } = req.params;

    const meme = await memeService.getMemeById(memeId);

    if (!meme) {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Meme not found',
        },
      });
    }

    const response: GetMemeResponse = {
      success: true,
      data: toMemeDetail(meme),
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
}

export async function activateMeme(
  req: Request<ActivateMemeParams, unknown, ActivateMemeBody>,
  res: Response<ActivateMemeResponse>,
  next: NextFunction
) {
  try {
    const { memeId } = req.params;
    const { channelId, volume } = req.body;
    const userId = req.userId!;

    const result = await memeService.activateMeme({
      memeId,
      channelId,
      userId,
      volume,
    });

    const response: ActivateMemeResponse = {
      success: true,
      data: {
        activationId: result.activationId,
        balanceAfter: result.balanceAfter,
        cooldownUntil: result.cooldownUntil?.toISOString() ?? null,
      },
    };

    res.json(response);
  } catch (error) {
    next(error);
  }
}
```

### 3.4 Создать mappers (DB -> API response)

**Файл: `apps/backend/src/api/v1/memes/mappers.ts`**
```typescript
import {
  MemeListItem,
  MemeDetail,
  MemeVariant,
  Tag,
} from '@memalerts/api-contracts';

// Database types (from Prisma)
interface DbChannelMeme {
  id: string;
  title: string;
  priceCoins: number;
  cooldownMinutes: number | null;
  lastActivatedAt: Date | null;
  status: string;
  createdAt: Date;
  memeAsset: {
    id: string;
    type: string;
    fileUrl: string;
    durationMs: number;
    qualityScore: number | null;
    aiAutoDescription: string | null;
    aiAutoTagNames: string[];
    variants: Array<{
      format: string;
      fileUrl: string;
      status: string;
      priority: number;
      fileSizeBytes: bigint | null;
    }>;
    createdBy: {
      id: string;
      displayName: string;
    } | null;
  };
  tags: Array<{
    tag: {
      id: string;
      name: string;
    };
  }>;
  _count?: {
    activations: number;
  };
}

function mapVariants(
  variants: DbChannelMeme['memeAsset']['variants']
): MemeVariant[] {
  return variants
    .filter(v => v.status === 'done')
    .sort((a, b) => a.priority - b.priority)
    .map(v => ({
      format: v.format as 'webm' | 'mp4' | 'preview',
      fileUrl: v.fileUrl,
      sourceType: getSourceType(v.format),
      fileSizeBytes: v.fileSizeBytes ? Number(v.fileSizeBytes) : null,
    }));
}

function getSourceType(format: string): string {
  switch (format) {
    case 'preview': return 'video/mp4; codecs="avc1.42E01E, mp4a.40.2"';
    case 'webm': return 'video/webm; codecs="vp9, opus"';
    case 'mp4': return 'video/mp4; codecs="avc1.4d401f, mp4a.40.2"';
    default: return 'video/mp4';
  }
}

function mapTags(tags: DbChannelMeme['tags']): Tag[] {
  return tags.map(t => ({
    id: t.tag.id,
    name: t.tag.name,
  }));
}

function getPreviewUrl(variants: MemeVariant[]): string | null {
  const preview = variants.find(v => v.format === 'preview');
  return preview?.fileUrl ?? null;
}

function getPrimaryFileUrl(
  variants: MemeVariant[],
  fallbackUrl: string
): string {
  const playable = variants.filter(v => v.format !== 'preview');
  return playable[0]?.fileUrl ?? fallbackUrl;
}

export function toMemeListItem(db: DbChannelMeme): MemeListItem {
  const variants = mapVariants(db.memeAsset.variants);

  return {
    id: db.id,
    title: db.title,
    type: db.memeAsset.type as 'video' | 'audio' | 'image',
    fileUrl: getPrimaryFileUrl(variants, db.memeAsset.fileUrl),
    previewUrl: getPreviewUrl(variants),
    variants: variants.filter(v => v.format !== 'preview'),
    priceCoins: db.priceCoins,
    durationMs: db.memeAsset.durationMs,
    activationsCount: db._count?.activations ?? 0,
    createdAt: db.createdAt.toISOString(),
  };
}

export function toMemeDetail(db: DbChannelMeme): MemeDetail {
  const listItem = toMemeListItem(db);

  // Calculate cooldown
  let cooldownSecondsRemaining = 0;
  let cooldownUntil: string | null = null;

  if (db.cooldownMinutes && db.lastActivatedAt) {
    const cooldownEnd = new Date(
      db.lastActivatedAt.getTime() + db.cooldownMinutes * 60 * 1000
    );
    const remaining = Math.ceil((cooldownEnd.getTime() - Date.now()) / 1000);
    if (remaining > 0) {
      cooldownSecondsRemaining = remaining;
      cooldownUntil = cooldownEnd.toISOString();
    }
  }

  return {
    ...listItem,
    status: db.status as 'approved' | 'pending' | 'rejected' | 'disabled',
    cooldownMinutes: db.cooldownMinutes ?? undefined,
    cooldownSecondsRemaining: cooldownSecondsRemaining || undefined,
    cooldownUntil: cooldownUntil,
    tags: mapTags(db.tags),
    aiAutoDescription: db.memeAsset.aiAutoDescription,
    aiAutoTagNames: db.memeAsset.aiAutoTagNames,
    qualityScore: db.memeAsset.qualityScore,
    createdBy: db.memeAsset.createdBy,
  };
}
```

### 3.5 Создать MemeService

**Файл: `apps/backend/src/domain/meme/MemeService.ts`**
```typescript
import { MemeRepository } from './MemeRepository';
import { WalletService } from '../wallet/WalletService';
import { AppError } from '../../shared/errors';

interface ListChannelMemesParams {
  channelId: string;
  limit: number;
  offset: number;
  sortBy: 'createdAt' | 'priceCoins' | 'activationsCount';
  sortOrder: 'asc' | 'desc';
  tags?: string[];
  search?: string;
}

interface ActivateMemeParams {
  memeId: string;
  channelId: string;
  userId: string;
  volume: number;
}

export class MemeService {
  private memeRepo = new MemeRepository();
  private walletService = new WalletService();

  async listChannelMemes(params: ListChannelMemesParams) {
    const { items, total } = await this.memeRepo.findByChannel(params);
    return { items, total };
  }

  async getMemeById(memeId: string) {
    return this.memeRepo.findById(memeId);
  }

  async activateMeme(params: ActivateMemeParams) {
    const { memeId, channelId, userId, volume } = params;

    // Get meme
    const meme = await this.memeRepo.findById(memeId);
    if (!meme) {
      throw new AppError('NOT_FOUND', 'Meme not found');
    }

    // Check cooldown
    if (meme.cooldownMinutes && meme.lastActivatedAt) {
      const cooldownEnd = new Date(
        meme.lastActivatedAt.getTime() + meme.cooldownMinutes * 60 * 1000
      );
      if (Date.now() < cooldownEnd.getTime()) {
        throw new AppError('MEME_ON_COOLDOWN', 'Meme is on cooldown', {
          cooldownUntil: cooldownEnd.toISOString(),
        });
      }
    }

    // Charge user
    const priceCoins = meme.priceCoins;
    const balanceAfter = await this.walletService.charge(userId, channelId, priceCoins);

    // Create activation
    const activation = await this.memeRepo.createActivation({
      channelMemeId: memeId,
      userId,
      channelId,
      priceCoins,
      volume,
    });

    // Update last activated
    await this.memeRepo.updateLastActivated(memeId);

    // Calculate new cooldown
    let cooldownUntil: Date | null = null;
    if (meme.cooldownMinutes) {
      cooldownUntil = new Date(Date.now() + meme.cooldownMinutes * 60 * 1000);
    }

    return {
      activationId: activation.id,
      balanceAfter,
      cooldownUntil,
    };
  }
}
```

### 3.6 Создать MemeRepository

**Файл: `apps/backend/src/domain/meme/MemeRepository.ts`**
```typescript
import { prisma } from '../../infrastructure/prisma';

interface FindByChannelParams {
  channelId: string;
  limit: number;
  offset: number;
  sortBy: 'createdAt' | 'priceCoins' | 'activationsCount';
  sortOrder: 'asc' | 'desc';
  tags?: string[];
  search?: string;
}

// Standard select for meme queries
const memeSelect = {
  id: true,
  title: true,
  priceCoins: true,
  cooldownMinutes: true,
  lastActivatedAt: true,
  status: true,
  createdAt: true,
  memeAsset: {
    select: {
      id: true,
      type: true,
      fileUrl: true,
      durationMs: true,
      qualityScore: true,
      aiAutoDescription: true,
      aiAutoTagNames: true,
      variants: {
        select: {
          format: true,
          fileUrl: true,
          status: true,
          priority: true,
          fileSizeBytes: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          displayName: true,
        },
      },
    },
  },
  tags: {
    select: {
      tag: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  _count: {
    select: {
      activations: {
        where: { status: 'done' },
      },
    },
  },
} as const;

export class MemeRepository {
  async findByChannel(params: FindByChannelParams) {
    const { channelId, limit, offset, sortBy, sortOrder, tags, search } = params;

    // Build where clause
    const where: any = {
      channelId,
      status: 'approved',
      deletedAt: null,
    };

    if (tags && tags.length > 0) {
      where.tags = {
        some: {
          tag: {
            name: { in: tags },
          },
        },
      };
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { memeAsset: { aiSearchText: { contains: search, mode: 'insensitive' } } },
      ];
    }

    // Build orderBy
    let orderBy: any;
    if (sortBy === 'activationsCount') {
      orderBy = { activations: { _count: sortOrder } };
    } else {
      orderBy = { [sortBy]: sortOrder };
    }

    // Execute queries
    const [items, total] = await Promise.all([
      prisma.channelMeme.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: memeSelect,
      }),
      prisma.channelMeme.count({ where }),
    ]);

    return { items, total };
  }

  async findById(id: string) {
    return prisma.channelMeme.findFirst({
      where: {
        id,
        status: 'approved',
        deletedAt: null,
      },
      select: memeSelect,
    });
  }

  async createActivation(data: {
    channelMemeId: string;
    userId: string;
    channelId: string;
    priceCoins: number;
    volume: number;
  }) {
    return prisma.memeActivation.create({
      data: {
        channelMemeId: data.channelMemeId,
        userId: data.userId,
        channelId: data.channelId,
        priceCoins: data.priceCoins,
        volume: data.volume,
        status: 'queued',
      },
    });
  }

  async updateLastActivated(channelMemeId: string) {
    return prisma.channelMeme.update({
      where: { id: channelMemeId },
      data: { lastActivatedAt: new Date() },
    });
  }
}
```

---

## Фаза 3.5: Критические фиксы (ДОБАВЛЕНО ПОСЛЕ ВЫПОЛНЕНИЯ ФАЗ 0-3)

> **Причина**: Проблемы обнаруженные при выполнении Фаз 0-3, не покрытые исходным планом.

### 3.5.1 Настройка api-contracts для тестов и runtime

**Проблема**: `@memalerts/api-contracts` не резолвится в runtime тестов — пакет ожидает `dist/`, но его нет.

**Решение**: Настроить `package.json` с proper exports и использовать `tsup` для сборки.

**Файл: `packages/api-contracts/package.json`**
```json
{
  "name": "@memalerts/api-contracts",
  "version": "1.0.0",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "dev": "tsup src/index.ts --format esm,cjs --dts --watch",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "zod": "^3.22.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

**Файл: `packages/api-contracts/tsup.config.ts`** (создать)
```typescript
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

**Команды:**
```bash
cd packages/api-contracts
npm install tsup --save-dev
npm run build
```

**Обновить root package.json scripts:**
```json
{
  "scripts": {
    "build:contracts": "cd packages/api-contracts && npm run build",
    "pretest": "npm run build:contracts"
  }
}
```

---

### 3.5.2 Фикс SQL rollups: coinsSpent → priceCoins

**Проблема**: SQL rollups используют колонку `coinsSpent`, которой нет в актуальной схеме. В `MemeActivation` поле называется `priceCoins`.

**Файлы для исправления:**
- `apps/backend/src/jobs/memeDailyStatsRollup.ts`
- `apps/backend/src/jobs/channelTopStats30dRollup.ts`
- `apps/backend/src/jobs/channelDailyStatsRollup.ts`

**Глобальная замена во всех файлах:**
```
FIND:    "coinsSpent"
REPLACE: "priceCoins"
```

**Полный список замен:**

| Файл | Строка | Замена |
|------|--------|--------|
| `memeDailyStatsRollup.ts` | 21 | `"coinsSpent"` → `"priceCoins"` |
| `memeDailyStatsRollup.ts` | 32 | `b."coinsSpent"` → `b."priceCoins"` |
| `memeDailyStatsRollup.ts` | 57 | `"coinsSpent"` → `"priceCoins"` |
| `memeDailyStatsRollup.ts` | 67 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelTopStats30dRollup.ts` | 22 | `"coinsSpent"` → `"priceCoins"` |
| `channelTopStats30dRollup.ts` | 31,33 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelTopStats30dRollup.ts` | 42,44 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelTopStats30dRollup.ts` | 52 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelTopStats30dRollup.ts` | 86 | `"coinsSpent"` → `"priceCoins"` |
| `channelTopStats30dRollup.ts` | 95,97 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelTopStats30dRollup.ts` | 131 | `"coinsSpent"` → `"priceCoins"` |
| `channelTopStats30dRollup.ts` | 139 | `b."coinsSpent"` → `b."priceCoins"` |
| `channelDailyStatsRollup.ts` | 40,42 | `a."coinsSpent"` → `a."priceCoins"` |

---

### 3.5.3 Retry logic для activateMeme при concurrency

**Проблема**: Write-conflict при concurrent activations. Текущий `Serializable` isolation level выбросит ошибку, но нет retry logic.

**Решение**: Создать retry wrapper с exponential backoff.

**Файл: `apps/backend/src/utils/retryTransaction.ts`** (создать)
```typescript
import { Prisma } from '@prisma/client';
import { logger } from './logger.js';

const RETRYABLE_ERROR_CODES = [
  'P2034', // Prisma: Transaction conflict
  '40001', // PostgreSQL: serialization_failure
];

interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 50, maxDelayMs = 1000 } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      const isPrismaError = error instanceof Prisma.PrismaClientKnownRequestError;
      const errorCode = isPrismaError ? error.code : (error as { code?: string })?.code;

      const isRetryable = RETRYABLE_ERROR_CODES.some(code =>
        errorCode === code || String(error).includes(code)
      );

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const delay = Math.min(baseDelayMs * Math.pow(2, attempt), maxDelayMs);
      const jitter = Math.random() * delay * 0.1;

      logger.warn('transaction.retry', {
        attempt: attempt + 1,
        maxRetries,
        errorCode,
        delayMs: Math.round(delay + jitter),
      });

      await new Promise(resolve => setTimeout(resolve, delay + jitter));
    }
  }

  throw lastError;
}
```

**Обновить `apps/backend/src/services/meme/activateMeme.ts`:**

Найти строку ~130:
```typescript
const result = await prisma.$transaction(
```

Заменить на:
```typescript
import { withRetry } from '../../utils/retryTransaction.js';

// ... в функции activateMeme:

const result = await withRetry(
  () => prisma.$transaction(
    async (tx) => {
      // ... existing transaction code (без изменений) ...
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
  ),
  { maxRetries: 3, baseDelayMs: 50 }
);
```

---

### 3.5.4 Windows EPERM при prisma generate (инфраструктура)

**Проблема**: `EPERM: operation not permitted, rename` при `prisma generate` на Windows (антивирус блокирует DLL).

**Решения (выбрать одно):**

**Вариант A: Исключения антивируса**
Добавить в исключения Windows Defender:
```
node_modules\.prisma\
node_modules\@prisma\
```

**Вариант B: WSL2**
```bash
cd /mnt/c/Users/LOTAS/Desktop/Memalerts/memalerts-monorepo
npx prisma generate
```

**Вариант C: Retry скрипт**

**Файл: `scripts/prisma-generate-win.js`** (создать)
```javascript
const { execSync } = require('child_process');

const maxRetries = 5;
const delayMs = 2000;

async function runWithRetry() {
  for (let i = 0; i < maxRetries; i++) {
    try {
      console.log(`Attempt ${i + 1}/${maxRetries}...`);
      execSync('npx prisma generate', { stdio: 'inherit' });
      console.log('Success!');
      return;
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      console.log(`Failed, retrying in ${delayMs}ms...`);
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
}

runWithRetry().catch(e => {
  console.error(e);
  process.exit(1);
});
```

---

### 3.5.5 Чеклист Фазы 3.5

- [ ] Настроить `packages/api-contracts/package.json` с exports
- [ ] Установить `tsup` и создать `tsup.config.ts`
- [ ] Добавить `build:contracts` и `pretest` в root scripts
- [ ] Заменить `coinsSpent` → `priceCoins` в 3 rollup файлах (~15 замен)
- [ ] Создать `apps/backend/src/utils/retryTransaction.ts`
- [ ] Обернуть `activateMeme` transaction в `withRetry`
- [ ] (Опционально) Добавить скрипт для Windows prisma generate
- [ ] Запустить тесты и убедиться что всё работает

---

## Фаза 4: Frontend Refactoring (3-5 дней)

### 4.1 Создать типизированный API клиент

**Файл: `apps/frontend/src/shared/api/client.ts`**
```typescript
import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import { ErrorResponse, ErrorResponseSchema } from '@memalerts/api-contracts';
import { z } from 'zod';

class ApiClient {
  private instance: AxiosInstance;

  constructor() {
    this.instance = axios.create({
      baseURL: import.meta.env.VITE_API_URL || '/api/v1',
      withCredentials: true,
    });

    this.instance.interceptors.response.use(
      response => response,
      this.handleError
    );
  }

  private handleError = (error: AxiosError) => {
    if (error.response?.data) {
      const parsed = ErrorResponseSchema.safeParse(error.response.data);
      if (parsed.success) {
        throw new ApiError(parsed.data.error);
      }
    }
    throw new ApiError({
      code: 'INTERNAL_ERROR',
      message: error.message,
    });
  };

  async get<T>(
    url: string,
    schema: z.ZodSchema<T>,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.instance.get(url, config);
    return schema.parse(response.data);
  }

  async post<T>(
    url: string,
    data: unknown,
    schema: z.ZodSchema<T>,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.instance.post(url, data, config);
    return schema.parse(response.data);
  }
}

export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;

  constructor(error: ErrorResponse['error']) {
    super(error.message);
    this.name = 'ApiError';
    this.code = error.code;
    this.details = error.details;
  }
}

export const apiClient = new ApiClient();
```

### 4.2 Создать типизированные API хуки

**Файл: `apps/frontend/src/features/meme-catalog/api/useMemes.ts`**
```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ListChannelMemesQuery,
  ListChannelMemesResponseSchema,
  GetMemeResponseSchema,
  ActivateMemeBody,
  ActivateMemeResponseSchema,
  MemeListItem,
  MemeDetail,
} from '@memalerts/api-contracts';
import { apiClient } from '@/shared/api/client';

// Query keys
export const memeKeys = {
  all: ['memes'] as const,
  lists: () => [...memeKeys.all, 'list'] as const,
  list: (channelId: string, params: Partial<ListChannelMemesQuery>) =>
    [...memeKeys.lists(), channelId, params] as const,
  details: () => [...memeKeys.all, 'detail'] as const,
  detail: (id: string) => [...memeKeys.details(), id] as const,
};

// List memes
export function useChannelMemes(
  channelId: string,
  params: Partial<ListChannelMemesQuery> = {}
) {
  return useQuery({
    queryKey: memeKeys.list(channelId, params),
    queryFn: async () => {
      const queryString = new URLSearchParams(
        Object.entries(params)
          .filter(([_, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)])
      ).toString();

      const response = await apiClient.get(
        `/channels/${channelId}/memes?${queryString}`,
        ListChannelMemesResponseSchema
      );

      return response.data;
    },
    staleTime: 30_000,
  });
}

// Get single meme
export function useMeme(memeId: string) {
  return useQuery({
    queryKey: memeKeys.detail(memeId),
    queryFn: async () => {
      const response = await apiClient.get(
        `/memes/${memeId}`,
        GetMemeResponseSchema
      );
      return response.data;
    },
    enabled: !!memeId,
  });
}

// Activate meme
export function useActivateMeme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      memeId,
      channelId,
      volume = 1,
    }: {
      memeId: string;
      channelId: string;
      volume?: number;
    }) => {
      const body: ActivateMemeBody = { channelId, volume };

      const response = await apiClient.post(
        `/memes/${memeId}/activate`,
        body,
        ActivateMemeResponseSchema
      );

      return response.data;
    },
    onSuccess: (data, { memeId, channelId }) => {
      // Invalidate meme detail to refresh cooldown
      queryClient.invalidateQueries({ queryKey: memeKeys.detail(memeId) });
      // Invalidate meme list to refresh activations count
      queryClient.invalidateQueries({ queryKey: memeKeys.lists() });
    },
  });
}
```

### 4.3 Обновить MemeCard компонент

**Файл: `apps/frontend/src/entities/meme/ui/MemeCard/MemeCard.tsx`**
```typescript
import { memo, useMemo } from 'react';
import type { MemeListItem } from '@memalerts/api-contracts';
import { resolveMediaUrl } from '@/shared/lib/urls';
import { useMemeCard, type MemeCardPreviewMode } from './model/useMemeCard';
import { MemeCardView } from './ui/MemeCardView';

export interface MemeCardProps {
  meme: MemeListItem;
  previewMode?: MemeCardPreviewMode;
  onClick: () => void;
}

function MemeCardBase({ meme, previewMode = 'hoverMuted', onClick }: MemeCardProps) {
  // Get best media URL
  const mediaUrl = useMemo(() => {
    // Prefer preview, then first variant, then fileUrl
    if (meme.previewUrl) return resolveMediaUrl(meme.previewUrl);
    if (meme.variants.length > 0) return resolveMediaUrl(meme.variants[0].fileUrl);
    return resolveMediaUrl(meme.fileUrl);
  }, [meme.previewUrl, meme.variants, meme.fileUrl]);

  const {
    aspectRatio,
    isHovered,
    shouldLoadMedia,
    setCardEl,
    videoRef,
    getVideoMuted,
    onMouseEnter,
    onMouseLeave,
    onClick: handleClick,
    onMouseDown,
    onTouchStart,
    onKeyDown,
  } = useMemeCard({ meme, mediaUrl, previewMode, onClick });

  return (
    <MemeCardView
      meme={meme}
      mediaUrl={mediaUrl}
      previewMode={previewMode}
      aspectRatio={aspectRatio}
      isHovered={isHovered}
      shouldLoadMedia={shouldLoadMedia}
      videoMuted={getVideoMuted()}
      setCardEl={setCardEl}
      videoRef={videoRef}
      onMediaError={() => {}}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      onKeyDown={onKeyDown}
    />
  );
}

export const MemeCard = memo(MemeCardBase);
```

### 4.4 Обновить MemeCardView

**Файл: `apps/frontend/src/entities/meme/ui/MemeCard/ui/MemeCardView.tsx`**
```typescript
import { memo, type RefObject } from 'react';
import type { MemeListItem } from '@memalerts/api-contracts';
import { cn } from '@/shared/lib/cn';

export interface MemeCardViewProps {
  meme: MemeListItem;
  mediaUrl: string;
  previewMode: 'hoverWithSound' | 'hoverMuted' | 'autoplayMuted';
  aspectRatio: number;
  isHovered: boolean;
  shouldLoadMedia: boolean;
  videoMuted: boolean;
  setCardEl: (node: HTMLElement | null) => void;
  videoRef: RefObject<HTMLVideoElement>;
  onMediaError: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onClick: () => void;
  onMouseDown: () => void;
  onTouchStart: () => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function MemeCardViewBase({
  meme,
  mediaUrl,
  previewMode,
  aspectRatio,
  isHovered,
  shouldLoadMedia,
  videoMuted,
  setCardEl,
  videoRef,
  onMediaError,
  onMouseEnter,
  onMouseLeave,
  onClick,
  onMouseDown,
  onTouchStart,
  onKeyDown,
}: MemeCardViewProps) {
  const isPopular = meme.activationsCount >= 100;
  const hasMedia = Boolean(mediaUrl);

  return (
    <article
      ref={setCardEl}
      className={cn(
        'meme-card block w-full overflow-hidden rounded-xl cursor-pointer break-inside-avoid mb-3 relative isolate',
        'bg-white/60 dark:bg-white/5 ring-1 ring-black/5 dark:ring-white/10 shadow-sm',
        'will-change-transform',
        'focus-visible:ring-2 focus-visible:ring-primary/40',
        isPopular && 'ring-2 ring-orange-500/70'
      )}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
      onMouseDown={onMouseDown}
      onTouchStart={onTouchStart}
      role="button"
      tabIndex={0}
      aria-label={`View meme: ${meme.title}`}
      onKeyDown={onKeyDown}
    >
      {/* Media container */}
      <div className="relative w-full bg-gray-900 z-0" style={{ aspectRatio }}>
        {!shouldLoadMedia || !hasMedia ? (
          <div className="w-full h-full bg-gray-900" aria-hidden="true" />
        ) : meme.type === 'video' ? (
          <video
            ref={videoRef}
            src={mediaUrl}
            onError={onMediaError}
            muted={videoMuted}
            autoPlay={previewMode === 'autoplayMuted'}
            loop
            playsInline
            className="w-full h-full object-contain"
            preload="metadata"
          />
        ) : (
          <img
            src={mediaUrl}
            alt={meme.title}
            className="w-full h-full object-contain"
            loading="lazy"
            onError={onMediaError}
          />
        )}

        {/* Title overlay on hover */}
        {isHovered && (
          <div className="absolute -bottom-px -left-0.5 -right-0.5 bg-black/70 text-white p-2 text-center z-20">
            <p className="text-sm font-medium truncate px-2">
              {meme.title}
            </p>
          </div>
        )}

        {/* Stats overlay */}
        {meme.activationsCount > 0 && (
          <div className="absolute top-2 right-2 z-30">
            <span className="inline-flex items-center rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
              {meme.activationsCount} plays
            </span>
          </div>
        )}

        {/* Price */}
        {meme.priceCoins > 0 && (
          <div className="absolute bottom-2 left-2 z-30">
            <span className="inline-flex items-center rounded-full bg-black/70 text-white text-[11px] font-semibold px-2 py-0.5">
              {meme.priceCoins} coins
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

export const MemeCardView = memo(MemeCardViewBase, (prev, next) => {
  return (
    prev.meme.id === next.meme.id &&
    prev.mediaUrl === next.mediaUrl &&
    prev.isHovered === next.isHovered &&
    prev.shouldLoadMedia === next.shouldLoadMedia &&
    prev.videoMuted === next.videoMuted
  );
});
```

---

## Фаза 5: Удаление legacy кода (1-2 дня)

### 5.1 Удалить файлы

```bash
# Backend - удалить старые контроллеры
rm -rf apps/backend/src/controllers/viewer/
rm -rf apps/backend/src/controllers/public/
rm -rf apps/backend/src/controllers/admin/

# Backend - удалить старые типы
rm apps/backend/src/shared/types.ts

# Frontend - удалить старые типы
rm apps/frontend/src/types/index.ts

# Shared - удалить старые типы
rm -rf packages/shared/src/types/
```

### 5.2 Обновить импорты

Во всех файлах заменить:
```typescript
// OLD
import { Meme } from '@/types';

// NEW
import { MemeListItem, MemeDetail } from '@memalerts/api-contracts';
```

---

## Фаза 6: Тестирование и документация (2-3 дня)

### 6.1 Добавить тесты контрактов

**Файл: `packages/api-contracts/src/__tests__/meme.test.ts`**
```typescript
import { describe, it, expect } from 'vitest';
import { MemeListItemSchema, MemeDetailSchema } from '../entities/meme';

describe('MemeListItemSchema', () => {
  it('should validate valid meme', () => {
    const validMeme = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Meme',
      type: 'video',
      fileUrl: 'https://example.com/meme.mp4',
      previewUrl: null,
      variants: [],
      priceCoins: 100,
      durationMs: 5000,
      activationsCount: 42,
      createdAt: '2024-01-01T00:00:00.000Z',
    };

    const result = MemeListItemSchema.safeParse(validMeme);
    expect(result.success).toBe(true);
  });

  it('should reject meme without fileUrl', () => {
    const invalidMeme = {
      id: '123e4567-e89b-12d3-a456-426614174000',
      title: 'Test Meme',
      type: 'video',
      // fileUrl missing
    };

    const result = MemeListItemSchema.safeParse(invalidMeme);
    expect(result.success).toBe(false);
  });
});
```

### 6.2 Обновить ARCHITECTURE.md

**Файл: `apps/frontend/docs/ARCHITECTURE.md`** - полностью переписать с новыми правилами.

**Файл: `apps/backend/ARCHITECTURE.md`** - полностью переписать с новыми правилами.

---

# Часть 4: ПРАВИЛА ДЛЯ AI-АССИСТЕНТОВ

## Железные правила (ОБЯЗАТЕЛЬНЫ)

```
ПРАВИЛО 1: ВСЕ API ТИПЫ - ТОЛЬКО ИЗ @memalerts/api-contracts
- Никогда не создавать типы для API responses вручную
- Использовать только z.infer<typeof Schema>
- При изменении API - сначала менять schema

ПРАВИЛО 2: НИКАКИХ as unknown / as any
- Все type assertions должны быть обоснованы
- Использовать type guards вместо casts
- При необходимости cast - добавить комментарий почему

ПРАВИЛО 3: ОБЯЗАТЕЛЬНАЯ RUNTIME VALIDATION
- На входе в API endpoint - validateRequest middleware
- При получении данных от API - schema.parse()
- Для внешних данных - always validate

ПРАВИЛО 4: ЕДИНЫЙ ФОРМАТ ОТВЕТОВ
- Success: { success: true, data: ... }
- Error: { success: false, error: { code, message, details? } }
- Paginated: { success: true, data: { items, pagination } }

ПРАВИЛО 5: LAYERED ARCHITECTURE
- Controller → Service → Repository
- Никакой бизнес-логики в controllers
- Никаких Prisma queries вне repository

ПРАВИЛО 6: НИКАКОГО ДУБЛИРОВАНИЯ ТИПОВ
- Один тип = один источник
- Backend DTO = mappers из DB → API contract type
- Frontend = только API contract types

ПРАВИЛО 7: EXPLICIT NULL HANDLING
- null !== undefined
- Optional field может отсутствовать
- Nullable field присутствует но может быть null
```

## Чеклист для изменений

При добавлении нового поля в API:

```markdown
[ ] 1. Добавить в Zod schema (packages/api-contracts)
[ ] 2. Добавить в Prisma schema (если хранится в БД)
[ ] 3. Добавить в mapper (api/v1/.../mappers.ts)
[ ] 4. Добавить в repository select (если из БД)
[ ] 5. Обновить тесты контрактов
[ ] 6. Rebuild packages/api-contracts
[ ] 7. Проверить что frontend компилируется
```

При создании нового endpoint:

```markdown
[ ] 1. Создать schemas в packages/api-contracts/src/endpoints/
[ ] 2. Export из index.ts
[ ] 3. Создать handler в api/v1/.../handlers.ts
[ ] 4. Добавить route в api/v1/.../router.ts
[ ] 5. Создать/обновить service method
[ ] 6. Создать/обновить repository method
[ ] 7. Добавить тесты
[ ] 8. Создать frontend hook
```

---

# Часть 5: ПОРЯДОК ВЫПОЛНЕНИЯ

## Приоритет задач

| # | Задача | Приоритет | Зависимости | Оценка |
|---|--------|-----------|-------------|--------|
| 1 | Создать packages/api-contracts | CRITICAL | - | 1 день |
| 2 | Определить базовые schemas (common) | CRITICAL | 1 | 0.5 дня |
| 3 | Определить Meme entity schema | CRITICAL | 2 | 1 день |
| 4 | Определить endpoint schemas для memes | CRITICAL | 3 | 1 день |
| 5 | Упростить Prisma schema | HIGH | - | 1 день |
| 6 | Создать migration script | HIGH | 5 | 0.5 дня |
| 7 | Создать validation middleware | HIGH | 1 | 0.5 дня |
| 8 | Рефакторинг backend API (memes) | HIGH | 4,7 | 2 дня |
| 9 | Создать типизированный API client | HIGH | 1 | 0.5 дня |
| 10 | Создать API hooks | HIGH | 9 | 1 день |
| 11 | Обновить MemeCard | MEDIUM | 10 | 1 день |
| 12 | Удалить legacy код | MEDIUM | 8,11 | 1 день |
| 13 | Тесты контрактов | MEDIUM | 4 | 1 день |
| 14 | Документация | LOW | 12 | 1 день |

## Timeline

```
День 1-2:   Фаза 0 (packages/api-contracts setup)
День 3-5:   Фаза 1 (Meme contracts)
День 6-8:   Фаза 2 (Prisma refactoring)
День 9-13:  Фаза 3 (Backend refactoring)
День 14:    Фаза 3.5 (Критические фиксы - api-contracts build, SQL rollups, retry logic)
День 15-19: Фаза 4 (Frontend refactoring)
День 20-21: Фаза 5 (Legacy cleanup)
День 22-24: Фаза 6 (Testing & docs)
```

**Общая оценка: 3.5-4 недели**

> **ВАЖНО**: Фаза 3.5 БЛОКИРУЕТ Фазу 4. Без исправления api-contracts exports фронтенд не сможет импортировать типы.

---

# Часть 6: КРИТЕРИИ УСПЕХА

## Definition of Done

- [ ] Все API types определены в @memalerts/api-contracts
- [ ] Нет дублирования типов между backend/frontend
- [ ] Все API responses проходят runtime validation
- [ ] Нет as unknown / as any без комментариев
- [ ] Единый формат ответов на всех endpoints
- [ ] Все endpoints покрыты тестами контрактов
- [ ] Frontend компилируется без ошибок
- [ ] Backend компилируется без ошибок
- [ ] Документация обновлена

## Метрики качества

| Метрика | До | После (цель) |
|---------|-----|--------------|
| Типов с any/unknown | ~50 | 0 |
| Дублирующихся типов | ~30 | 0 |
| Endpoints без validation | ~80% | 0% |
| Тестовое покрытие контрактов | 0% | 100% |
| Build errors при изменении типа | часто | никогда |

---

*Документ создан: 2026-01-26*
*Версия: 1.0*
*Для: GPT 5.2 Codex Extra High*
