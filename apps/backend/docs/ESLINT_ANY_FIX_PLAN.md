# ✅ ESLint `no-explicit-any` — ИСПРАВЛЕНО

**Статус:** ✅ Выполнено (2026-01-18)  
**Было:** 960 warnings в 127 файлах  
**Сейчас:** 0 warnings

---

## 🎉 Проверка

```bash
pnpm lint -- --max-warnings 0
# ✅ ESLint завершился без warnings

# Дополнительная проверка на остатки any:
grep -rE ': any|as any|<any>' src/ tests/ scripts/
# Совпадений нет
```

---

## 📊 Распределение по категориям

| Категория | Файлов | ~Warnings | Приоритет |
|-----------|--------|-----------|-----------|
| `src/controllers/viewer/` | 12 | ~120 | 🔴 P0 |
| `src/controllers/owner/` | 11 | ~100 | 🟠 P1 |
| `src/utils/` | 25 | ~150 | 🟠 P1 |
| `src/controllers/` (остальные) | 10 | ~80 | 🟠 P1 |
| `src/middleware/` | 8 | ~50 | 🟡 P2 |
| `src/jobs/` | 9 | ~40 | 🟡 P2 |
| `src/socket/`, `src/realtime/` | 6 | ~30 | 🟡 P2 |
| `tests/` | 40+ | ~350 | 🟢 P3 |
| `src/` (остальные) | 6 | ~40 | 🟡 P2 |

---

## 🎯 Типичные паттерны `any` и их исправления

### 1. Error handling: `catch (error: any)` → `catch (error: unknown)`

**Было:**
```typescript
try {
  // ...
} catch (error: any) {
  logger.error('failed', { message: error.message });
}
```

**Стало:**
```typescript
try {
  // ...
} catch (error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('failed', { message });
}
```

**Хелпер (уже есть в проекте):**
```typescript
// src/utils/errors.ts
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
```

---

### 2. Request body: `req.body as any` → Zod schema

**Было:**
```typescript
const { title, description } = req.body as any;
```

**Стало:**
```typescript
import { z } from 'zod';

const schema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

const parsed = schema.safeParse(req.body);
if (!parsed.success) {
  return res.status(400).json({ error: 'Validation failed', details: parsed.error.issues });
}
const { title, description } = parsed.data;
```

---

### 3. JSON.parse: `JSON.parse(...) as any` → typed

**Было:**
```typescript
const data = JSON.parse(rawBody) as any;
```

**Стало:**
```typescript
const data: unknown = JSON.parse(rawBody);
// затем валидация через zod или type guard
```

---

### 4. Record types: `Record<string, any>` → конкретный тип

**Было:**
```typescript
function log(meta: Record<string, any>): void { ... }
```

**Стало:**
```typescript
type LogMeta = Record<string, unknown>;
function log(meta: LogMeta): void { ... }
```

---

### 5. Prisma results: `as any` для доступа к полям

**Было:**
```typescript
const user = await prisma.user.findUnique({ ... }) as any;
const name = user.name;
```

**Стало:**
```typescript
const user = await prisma.user.findUnique({
  where: { id },
  select: { name: true },
});
if (!user) throw new Error('User not found');
const name = user.name; // TypeScript знает тип
```

---

### 6. Тесты: mock objects

**Было:**
```typescript
const mockReq = { body: { ... } } as any;
```

**Стало:**
```typescript
import type { Request } from 'express';

const mockReq = {
  body: { ... },
  headers: {},
  query: {},
} as Partial<Request>;
```

Или использовать test utilities:
```typescript
// tests/helpers/mockRequest.ts
export function createMockRequest(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    headers: {},
    query: {},
    params: {},
    ...overrides,
  } as Request;
}
```

---

## 📋 План исправления по фазам

### Фаза 1: Критичные контроллеры (P0) — ~2 часа

| Файл | Warnings | Действие |
|------|----------|----------|
| `src/controllers/viewer/channel.ts` | ~60 | Zod schemas + unknown |
| `src/controllers/viewer/search.ts` | ~35 | Zod schemas |
| `src/controllers/viewer/activation.ts` | ~15 | Error handling |
| `src/controllers/viewer/stats.ts` | ~14 | Prisma types |
| `src/controllers/viewer/boostyAccess.ts` | ~10 | API types |

**Команда для проверки:**
```bash
pnpm lint 2>&1 | grep "src/controllers/viewer" | wc -l
```

---

### Фаза 2: Owner контроллеры (P1) — ~2 часа

| Файл | Warnings | Действие |
|------|----------|----------|
| `src/controllers/owner/memeAssetModerationController.ts` | ~15 | |
| `src/controllers/owner/entitlementsController.ts` | ~14 | |
| `src/controllers/owner/*DefaultBotController.ts` | ~40 (5 файлов) | Общий тип |

---

### Фаза 3: Utils (P1) — ~3 часа

| Файл | Warnings | Действие |
|------|----------|----------|
| `src/utils/vkvideoApi.ts` | ~30 | API response types |
| `src/utils/webhookController.ts` | ~70 | Event types |
| `src/utils/twitchApi.ts` | ~24 | API types |
| `src/utils/kickApi.ts` | ~17 | |
| `src/utils/boostyApi.ts` | ~12 | |

---

### Фаза 4: Middleware + Jobs (P2) — ~1.5 часа

| Файл | Warnings | Действие |
|------|----------|----------|
| `src/middleware/rateLimit.ts` | ~26 | |
| `src/middleware/errorHandler.ts` | ~9 | |
| `src/jobs/*.ts` | ~40 | |

---

### Фаза 5: Тесты (P3) — ~4 часа

| Категория | Warnings | Действие |
|-----------|----------|----------|
| Mock requests | ~100 | createMockRequest helper |
| Mock responses | ~100 | createMockResponse helper |
| Type assertions | ~150 | Proper types |

**Можно отложить:** Тесты не влияют на production код.

---

## 🛠️ Вспомогательные типы для создания

### 1. `src/types/api.ts` — общие API типы
```typescript
export type ApiHandler = (req: AuthRequest, res: Response) => Promise<void> | void;

export type PaginationQuery = {
  limit?: string;
  offset?: string;
};

export type ApiSuccessResponse<T> = {
  data: T;
  meta?: {
    total?: number;
    limit?: number;
    offset?: number;
  };
};
```

### 2. `src/types/external.ts` — типы внешних API
```typescript
export type TwitchApiResponse<T> = {
  data: T[];
};

export type VkVideoApiResponse<T> = {
  data: T;
  error?: { code: number; message: string };
};
```

### 3. `tests/helpers/mocks.ts` — тестовые хелперы
```typescript
import type { Request, Response } from 'express';

export function mockRequest(overrides?: Partial<Request>): Request {
  return { body: {}, headers: {}, query: {}, params: {}, ...overrides } as Request;
}

export function mockResponse(): Response {
  const res = {} as Response;
  res.status = vi.fn().mockReturnThis();
  res.json = vi.fn().mockReturnThis();
  return res;
}
```

---

## ⚡ Quick Wins (можно сделать за 30 мин)

### 1. Глобальная замена `catch (error: any)` → `catch (error: unknown)`
```bash
# Найти все места
grep -rn "catch (error: any)" src/

# Автозамена (осторожно!)
sed -i 's/catch (error: any)/catch (error: unknown)/g' src/**/*.ts
```

### 2. Глобальная замена `Record<string, any>` → `Record<string, unknown>`
```bash
grep -rn "Record<string, any>" src/
sed -i 's/Record<string, any>/Record<string, unknown>/g' src/**/*.ts
```

### 3. Добавить `// eslint-disable-next-line` для сложных случаев
```typescript
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const legacyData = externalLib.getData() as any;
```

---

## 📈 Метрики прогресса

| Метрика | Было | Стало |
|---------|------|-------|
| Всего warnings | 960 | ✅ 0 |
| src/ warnings | ~610 | ✅ 0 |
| tests/ warnings | ~350 | ✅ 0 |

**Проверка:**
```bash
pnpm lint -- --max-warnings 0
# ✅ Без ошибок и warnings
```

---

## 📋 Чеклист

| # | Фаза | Время | Статус |
|---|------|-------|--------|
| 1 | Quick wins (sed замены) | 30 мин | ✅ |
| 2 | Viewer controllers | 2 часа | ✅ |
| 3 | Owner controllers | 2 часа | ✅ |
| 4 | Utils | 3 часа | ✅ |
| 5 | Middleware + Jobs | 1.5 часа | ✅ |
| 6 | Тесты | 4 часа | ✅ |

**Результат:** 0 warnings

---

## 🎯 Альтернатива: поднять лимит warnings

Если полное исправление не приоритет:

```json
// package.json
"lint": "eslint src/ tests/ scripts/ --max-warnings 1000"
```

Или исключить тесты из strict проверки:

```javascript
// eslint.config.mjs
{
  files: ['tests/**/*.ts'],
  rules: {
    '@typescript-eslint/no-explicit-any': 'off',
  },
}
```

Это уменьшит warnings с 960 до ~610 (только src/).

---

*Создано: 2026-01-18*  
*Статус: ✅ Выполнено 2026-01-18*

