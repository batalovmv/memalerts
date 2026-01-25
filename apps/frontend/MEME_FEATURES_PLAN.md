# 🎬 Meme Features Development Plan for GPT 5.2 Codex

> **Цель**: Развить функционал мемов для улучшения UX зрителей и стримеров.
> **Контекст**: Зритель приходит на сайт чтобы **отправить мем на стрим**, а не просто смотреть. Все фичи должны ускорять поиск и выбор нужного мема.

---

## 📊 Контекст проекта

### Архитектура

```
apps/
├── backend/           # Express + TypeScript + Prisma
│   ├── src/
│   │   ├── services/meme/        # Логика мемов
│   │   ├── services/submission/  # Логика сабмитов
│   │   ├── utils/ai/             # AI анализ (ASR, теги, описание)
│   │   └── controllers/          # API endpoints
│   └── prisma/schema.prisma      # Схема БД
│
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── features/streamer-profile/  # Страница стримера (каталог мемов)
│   │   ├── features/dashboard/         # Дашборд стримера
│   │   ├── entities/meme/              # Компоненты мемов
│   │   └── shared/api/                 # API клиент
│   └── overlay/       # OBS overlay (отдельное приложение)
│
└── packages/shared/   # Общие типы
```

### Ключевые сущности БД

```prisma
MemeAsset        # Глобальный мем (пул)
ChannelMeme      # Мем в каталоге стримера
MemeSubmission   # Заявка на добавление мема
MemeActivation   # Активация мема зрителем
Tag              # Тег мема
```

### Текущее состояние AI

- `aiTranscript` — распознанная речь (ASR)
- `aiAutoTitle` — AI-сгенерированное название
- `aiAutoTagNamesJson` — AI-сгенерированные теги
- `aiAutoDescription` — AI-сгенерированное описание
- `aiSearchText` — текст для поиска

---

## 📋 Приоритеты

| Приоритет | Описание |
|-----------|----------|
| 🔴 P0 | Критично, делаем первым |
| 🟠 P1 | Высокий приоритет |
| 🟡 P2 | Средний приоритет |
| 🟢 P3 | Низкий приоритет |

---

# 🔴 P0-1: Таксономия тегов

## Проблема

AI генерирует теги свободно: "funny" ≠ "смешной" ≠ "humor". Нет стандартизации, что ломает поиск и рекомендации.

## Решение

Создать каталог canonical тегов с категориями и aliases.

## Схема БД (миграция)

**Файл:** `apps/backend/prisma/schema.prisma`

```prisma
model TagCategory {
  id          String @id @default(uuid())
  slug        String @unique  // "mood", "genre", "intent"
  displayName String          // "Настроение", "Жанр", "Цель"
  sortOrder   Int    @default(0)
  createdAt   DateTime @default(now())
  
  tags Tag[]
  
  @@index([sortOrder])
}

model Tag {
  // Обновить существующую модель:
  id          String  @id @default(uuid())
  name        String  @unique  // canonical: "funny"
  displayName String?          // "Смешное" (NEW)
  categoryId  String?          // (NEW)
  status      String  @default("active") // active | pending | deprecated (NEW)
  usageCount  Int     @default(0) // (NEW)
  createdAt   DateTime @default(now())
  
  category TagCategory? @relation(fields: [categoryId], references: [id])
  aliases  TagAlias[]
  // ... existing relations
  
  @@index([categoryId])
  @@index([status])
  @@index([usageCount])
}

model TagAlias {
  id    String @id @default(uuid())
  alias String @unique  // "смешной", "humor", "lol"
  tagId String
  createdAt DateTime @default(now())
  
  tag Tag @relation(fields: [tagId], references: [id], onDelete: Cascade)
  
  @@index([tagId])
}

model TagSuggestion {
  id            String   @id @default(uuid())
  rawTag        String
  normalizedTag String   @unique
  memeAssetId   String?
  count         Int      @default(1)
  status        String   @default("pending") // pending | approved | rejected | mapped
  mappedToTagId String?
  createdAt     DateTime @default(now())
  reviewedAt    DateTime?
  reviewedById  String?
  
  memeAsset MemeAsset? @relation(fields: [memeAssetId], references: [id], onDelete: SetNull)
  mappedTo  Tag?       @relation(fields: [mappedToTagId], references: [id], onDelete: SetNull)
  
  @@index([status, count])
}
```

## Seed: Стартовый каталог

**Файл:** `apps/backend/prisma/seed-tags.ts` (создать)

```typescript
const INITIAL_CATALOG = {
  mood: {
    displayName: "Настроение",
    tags: [
      { name: "funny", display: "Смешное", aliases: ["смешной", "humor", "lol", "угар", "ржака"] },
      { name: "sad", display: "Грустное", aliases: ["грустный", "печаль", "депрессия"] },
      { name: "epic", display: "Эпичное", aliases: ["эпик", "legendary", "крутой"] },
      { name: "cringe", display: "Кринж", aliases: ["кринжовый", "awkward"] },
      { name: "wholesome", display: "Душевное", aliases: ["милый", "cute", "добрый"] },
      { name: "scary", display: "Страшное", aliases: ["horror", "хоррор", "жуткий"] },
      { name: "hype", display: "Хайп", aliases: ["viral", "хайповый"] },
      { name: "cursed", display: "Проклятое", aliases: ["cursed_image", "проклятый"] },
      { name: "nostalgic", display: "Ностальгия", aliases: ["олдскул", "oldschool"] },
    ]
  },
  
  intent: {
    displayName: "Цель",
    tags: [
      { name: "troll", display: "Потроллить", aliases: ["троллинг", "стеб", "троль"] },
      { name: "support", display: "Поддержать", aliases: ["поддержка", "wholesome"] },
      { name: "hurry", display: "Поторопить", aliases: ["давай", "быстрее", "го"] },
      { name: "celebrate", display: "Победа", aliases: ["victory", "win", "pog", "погчамп"] },
      { name: "fail", display: "Фейл", aliases: ["oof", "rip", "F", "провал"] },
      { name: "vibe", display: "Вайб", aliases: ["chill", "расслабон"] },
      { name: "react", display: "Реакция", aliases: ["reaction", "bruh"] },
    ]
  },
  
  content_type: {
    displayName: "Тип контента",
    tags: [
      { name: "music", display: "Музыка", aliases: ["музыкальный", "song", "песня"] },
      { name: "sound_effect", display: "Звуковой эффект", aliases: ["звук", "sfx", "эффект"] },
      { name: "dialogue", display: "Диалог", aliases: ["речь", "цитата", "разговор"] },
      { name: "earrape", display: "Earrape", aliases: ["громкий", "loud"] },
      { name: "remix", display: "Ремикс", aliases: ["mashup", "микс"] },
      { name: "vine", display: "Вайн", aliases: ["вайн"] },
    ]
  },
  
  source: {
    displayName: "Источник",
    tags: [
      { name: "tiktok", display: "TikTok", aliases: ["тикток"] },
      { name: "youtube", display: "YouTube", aliases: ["ютуб", "yt"] },
      { name: "movie", display: "Фильм", aliases: ["кино", "cinema", "фильм"] },
      { name: "tv_show", display: "Сериал", aliases: ["сериал", "show"] },
      { name: "anime", display: "Аниме", aliases: ["аниме"] },
      { name: "game", display: "Игра", aliases: ["gaming", "геймплей", "игра"] },
      { name: "cartoon", display: "Мультфильм", aliases: ["мультик", "animation"] },
      { name: "stream", display: "Стрим", aliases: ["twitch", "clip", "клип"] },
    ]
  },
  
  theme: {
    displayName: "Тема",
    tags: [
      { name: "animals", display: "Животные", aliases: ["pets", "животные"] },
      { name: "cat", display: "Кот", aliases: ["котик", "кошка"] },
      { name: "dog", display: "Собака", aliases: ["пёс", "собачка"] },
      { name: "food", display: "Еда", aliases: ["еда", "food"] },
      { name: "sports", display: "Спорт", aliases: ["футбол", "sport"] },
      { name: "cars", display: "Машины", aliases: ["авто", "cars"] },
    ]
  },
  
  meme_format: {
    displayName: "Мем-формат",
    tags: [
      { name: "bruh", display: "Bruh", aliases: ["бра", "bruh_moment"] },
      { name: "sigma", display: "Sigma", aliases: ["сигма", "gigachad", "гигачад"] },
      { name: "skibidi", display: "Skibidi", aliases: ["скибиди"] },
      { name: "ohio", display: "Ohio", aliases: ["огайо", "only_in_ohio"] },
      { name: "bonk", display: "Bonk", aliases: ["бонк"] },
      { name: "oof", display: "Oof", aliases: ["уф"] },
      { name: "rickroll", display: "Рикролл", aliases: ["rick_roll", "rick_astley"] },
    ]
  },
};
```

## Backend: Маппинг AI-тегов на canonical

**Файл:** `apps/backend/src/utils/ai/tagMapping.ts` (создать)

```typescript
import { prisma } from '../../lib/prisma.js';

interface TagMappingResult {
  canonicalTagId: string;
  canonicalName: string;
}

// Кэш aliases для быстрого маппинга
let aliasCache: Map<string, TagMappingResult> | null = null;
let cacheUpdatedAt = 0;
const CACHE_TTL_MS = 60_000;

async function loadAliasCache(): Promise<Map<string, TagMappingResult>> {
  const now = Date.now();
  if (aliasCache && now - cacheUpdatedAt < CACHE_TTL_MS) {
    return aliasCache;
  }
  
  const aliases = await prisma.tagAlias.findMany({
    include: { tag: { select: { id: true, name: true } } },
  });
  
  const cache = new Map<string, TagMappingResult>();
  
  // Добавляем canonical names
  const tags = await prisma.tag.findMany({
    where: { status: 'active' },
    select: { id: true, name: true },
  });
  for (const tag of tags) {
    cache.set(tag.name.toLowerCase(), { canonicalTagId: tag.id, canonicalName: tag.name });
  }
  
  // Добавляем aliases
  for (const alias of aliases) {
    cache.set(alias.alias.toLowerCase(), { 
      canonicalTagId: alias.tag.id, 
      canonicalName: alias.tag.name 
    });
  }
  
  aliasCache = cache;
  cacheUpdatedAt = now;
  return cache;
}

export async function mapTagToCanonical(rawTag: string): Promise<TagMappingResult | null> {
  const normalized = rawTag.toLowerCase().trim().replace(/\s+/g, '_');
  const cache = await loadAliasCache();
  return cache.get(normalized) || null;
}

export async function mapTagsToCanonical(rawTags: string[]): Promise<{
  mapped: TagMappingResult[];
  unmapped: string[];
}> {
  const mapped: TagMappingResult[] = [];
  const unmapped: string[] = [];
  
  for (const raw of rawTags) {
    const result = await mapTagToCanonical(raw);
    if (result) {
      // Avoid duplicates
      if (!mapped.some(m => m.canonicalTagId === result.canonicalTagId)) {
        mapped.push(result);
      }
    } else {
      unmapped.push(raw);
    }
  }
  
  return { mapped, unmapped };
}

export async function recordUnmappedTag(rawTag: string, memeAssetId?: string): Promise<void> {
  const normalized = rawTag.toLowerCase().trim().replace(/\s+/g, '_');
  if (normalized.length < 2 || normalized.length > 50) return;
  
  await prisma.tagSuggestion.upsert({
    where: { normalizedTag: normalized },
    create: {
      rawTag,
      normalizedTag: normalized,
      memeAssetId,
      count: 1,
    },
    update: {
      count: { increment: 1 },
    },
  });
}

export function invalidateTagCache(): void {
  aliasCache = null;
  cacheUpdatedAt = 0;
}
```

## Backend: Обновить AI pipeline

**Файл:** `apps/backend/src/services/aiModeration/aiModerationPersistence.ts`

Найти место где сохраняются теги и добавить маппинг:

```typescript
import { mapTagsToCanonical, recordUnmappedTag } from '../../utils/ai/tagMapping.js';

// После генерации тегов AI:
const { mapped, unmapped } = await mapTagsToCanonical(aiGeneratedTags);

// Сохраняем только canonical теги
const canonicalTagNames = mapped.map(m => m.canonicalName);

// Записываем unmapped для модерации
for (const tag of unmapped) {
  await recordUnmappedTag(tag, memeAssetId);
}
```

## 🤖 AI-Gatekeeper: Автоматическое расширение каталога

Система полностью автономна — AI валидирует и категоризирует новые теги.

### Принцип работы

```
AI генерирует тег "скибиди"
         ↓
Не найден в каталоге → TagSuggestion.count++
         ↓
count >= 30 + uniqueUsers >= 5
         ↓
    AI-валидация:
    ├── "Это мусор?" → да → отклоняем автоматически
    ├── "Это alias?" → да, "skibidi" → создаём alias автоматически
    └── "Какая категория?" → "meme_format" → создаём canonical автоматически
         ↓
    Тег добавлен без ручной работы ✅
```

### Конфигурация

```typescript
// apps/backend/src/config/tagValidation.ts
export const TAG_VALIDATION_CONFIG = {
  // Минимум упоминаний для AI-валидации
  AI_VALIDATION_THRESHOLD: 30,
  
  // Минимум уникальных пользователей (защита от спама)
  MIN_UNIQUE_USERS: 5,
  
  // Минимальная уверенность AI для авто-одобрения
  MIN_CONFIDENCE: 0.8,
  
  // Rate limit на AI-валидацию (в час)
  AI_VALIDATION_RATE_LIMIT: 100,
  
  // Авто-deprecate если мало использований за N дней
  DEPRECATE_AFTER_DAYS: 30,
  DEPRECATE_MIN_USAGE: 10,
};
```

### Фильтры до AI (дешёвые проверки)

**Файл:** `apps/backend/src/utils/ai/tagValidation.ts`

```typescript
export function isLikelyGarbage(tag: string): boolean {
  // Слишком короткий/длинный
  if (tag.length < 2 || tag.length > 30) return true;
  
  // Много цифр (скорее всего ID или дата)
  if (/\d{4,}/.test(tag)) return true;
  
  // Только цифры
  if (/^\d+$/.test(tag)) return true;
  
  // Похоже на URL/путь
  if (tag.includes('/') || tag.includes('http')) return true;
  
  // Слишком много подчёркиваний (скорее всего техническое)
  if ((tag.match(/_/g) || []).length > 3) return true;
  
  return false;
}

export async function shouldValidateTag(suggestion: TagSuggestion): Promise<boolean> {
  if (suggestion.count < TAG_VALIDATION_CONFIG.AI_VALIDATION_THRESHOLD) {
    return false;
  }
  
  // Проверяем что не один человек спамит
  const uniqueUsers = await countUniqueUsersForTag(suggestion.normalizedTag);
  if (uniqueUsers < TAG_VALIDATION_CONFIG.MIN_UNIQUE_USERS) {
    return false;
  }
  
  return true;
}
```

### AI-валидация

**Файл:** `apps/backend/src/utils/ai/tagAiValidator.ts`

```typescript
interface TagValidationResult {
  isValid: boolean;           // осмысленный тег?
  isAlias: boolean;           // это alias существующего?
  aliasOf?: string;           // если alias — какого тега
  category?: string;          // mood | intent | content_type | source | theme | meme_format
  displayName?: string;       // красивое название
  confidence: number;         // 0-1
  reason?: string;            // объяснение решения
}

export async function validateTagWithAI(
  rawTag: string,
  existingTags: string[]
): Promise<TagValidationResult> {
  const prompt = `
Ты эксперт по мем-культуре и интернет-трендам. Проанализируй тег для системы мемов.

Тег для анализа: "${rawTag}"

Существующие canonical теги в системе:
${existingTags.slice(0, 100).join(', ')}

Категории тегов:
- mood: настроение (funny, sad, epic, cringe, wholesome, scary, hype)
- intent: цель отправки (troll, support, hurry, celebrate, fail, vibe, react)
- content_type: тип контента (music, sound_effect, dialogue, earrape, remix)
- source: источник (tiktok, youtube, movie, anime, game, stream)
- theme: тема (animals, cat, dog, food, sports, cars)
- meme_format: мем-формат (bruh, sigma, skibidi, ohio, bonk, rickroll)

Ответь строго в JSON формате:
{
  "isValid": true/false,
  "isAlias": true/false,
  "aliasOf": "existing_tag_name или null",
  "category": "mood|intent|content_type|source|theme|meme_format или null",
  "displayName": "Красивое название для UI",
  "confidence": 0.0-1.0,
  "reason": "краткое объяснение решения"
}

Правила:
- isValid=false если: мусор, опечатка, слишком специфично (имя пользователя, дата), бессмысленно
- isAlias=true если: это синоним/вариант/перевод существующего тега
- Для новых трендов (skibidi, ohio и т.д.) — isValid=true, category="meme_format"
- confidence < 0.8 если не уверен — тег пойдёт на ручную модерацию
`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3, // более детерминированные ответы
  });

  return JSON.parse(response.choices[0].message.content);
}
```

### Автоматическая обработка

**Файл:** `apps/backend/src/jobs/tagAutoApproval.ts`

```typescript
export async function processTagSuggestion(suggestion: TagSuggestion): Promise<{
  action: 'approved' | 'rejected' | 'alias_created' | 'manual_review';
  details: string;
}> {
  // 1. Базовые проверки (без AI)
  if (isLikelyGarbage(suggestion.normalizedTag)) {
    await rejectSuggestion(suggestion.id, 'garbage_filter');
    return { action: 'rejected', details: 'Failed garbage filter' };
  }

  // 2. Проверяем порог
  if (!await shouldValidateTag(suggestion)) {
    return { action: 'manual_review', details: 'Below threshold' };
  }

  // 3. AI-валидация
  const existingTags = await getAllCanonicalTagNames();
  const result = await validateTagWithAI(suggestion.rawTag, existingTags);

  // 4. Обработка результата
  if (!result.isValid) {
    await rejectSuggestion(suggestion.id, `AI rejected: ${result.reason}`);
    return { action: 'rejected', details: result.reason || 'AI marked as invalid' };
  }

  if (result.confidence < TAG_VALIDATION_CONFIG.MIN_CONFIDENCE) {
    await markForManualReview(suggestion.id, result);
    return { action: 'manual_review', details: `Low confidence: ${result.confidence}` };
  }

  if (result.isAlias && result.aliasOf) {
    const existingTag = await findTagByName(result.aliasOf);
    if (existingTag) {
      await prisma.tagAlias.create({
        data: {
          alias: suggestion.normalizedTag,
          tagId: existingTag.id,
        },
      });
      await approveSuggestion(suggestion.id, 'auto_alias');
      invalidateTagCache();
      return { action: 'alias_created', details: `Alias of ${result.aliasOf}` };
    }
  }

  // 5. Создаём новый canonical тег
  const categoryId = result.category ? await getCategoryIdBySlug(result.category) : null;
  
  await prisma.tag.create({
    data: {
      name: suggestion.normalizedTag,
      displayName: result.displayName || suggestion.rawTag,
      categoryId,
      status: 'active',
      usageCount: suggestion.count,
    },
  });
  
  await approveSuggestion(suggestion.id, 'auto_approved');
  invalidateTagCache();
  
  logger.info('tag.auto_approved', {
    tag: suggestion.normalizedTag,
    category: result.category,
    confidence: result.confidence,
  });
  
  return { action: 'approved', details: `Category: ${result.category}` };
}
```

### Background Job (Scheduler)

**Файл:** `apps/backend/src/jobs/tagAutoApprovalScheduler.ts`

```typescript
import { CronJob } from 'cron';

let processedThisHour = 0;

export function startTagAutoApprovalScheduler(): void {
  // Запускать каждые 10 минут
  const job = new CronJob('*/10 * * * *', async () => {
    // Rate limit
    if (processedThisHour >= TAG_VALIDATION_CONFIG.AI_VALIDATION_RATE_LIMIT) {
      logger.debug('tag.auto_approval.rate_limited');
      return;
    }

    const suggestions = await prisma.tagSuggestion.findMany({
      where: {
        status: 'pending',
        count: { gte: TAG_VALIDATION_CONFIG.AI_VALIDATION_THRESHOLD },
      },
      orderBy: { count: 'desc' },
      take: 10, // батчами по 10
    });

    for (const suggestion of suggestions) {
      if (processedThisHour >= TAG_VALIDATION_CONFIG.AI_VALIDATION_RATE_LIMIT) break;
      
      try {
        const result = await processTagSuggestion(suggestion);
        processedThisHour++;
        
        logger.info('tag.auto_approval.processed', {
          tag: suggestion.normalizedTag,
          action: result.action,
        });
      } catch (error) {
        logger.error('tag.auto_approval.failed', {
          suggestionId: suggestion.id,
          error: getErrorMessage(error),
        });
      }
    }
  });

  // Сбрасывать счётчик каждый час
  const resetJob = new CronJob('0 * * * *', () => {
    processedThisHour = 0;
  });

  job.start();
  resetJob.start();
  
  logger.info('tag.auto_approval.scheduler_started');
}
```

### Авто-deprecation неиспользуемых тегов

```typescript
// Запускать раз в день
export async function deprecateUnusedTags(): Promise<void> {
  const threshold = new Date();
  threshold.setDate(threshold.getDate() - TAG_VALIDATION_CONFIG.DEPRECATE_AFTER_DAYS);

  const unusedTags = await prisma.tag.findMany({
    where: {
      status: 'active',
      usageCount: { lt: TAG_VALIDATION_CONFIG.DEPRECATE_MIN_USAGE },
      createdAt: { lt: threshold },
    },
  });

  for (const tag of unusedTags) {
    await prisma.tag.update({
      where: { id: tag.id },
      data: { status: 'deprecated' },
    });
    
    logger.info('tag.auto_deprecated', { tagId: tag.id, tagName: tag.name });
  }
}
```

### Мониторинг и метрики

```typescript
// Prometheus метрики
const tagAutoApprovalTotal = counter({
  name: 'memalerts_tag_auto_approval_total',
  help: 'Total tags processed by auto-approval',
  labelNames: ['action'], // approved | rejected | alias_created | manual_review
});

const tagAiValidationDuration = histogram({
  name: 'memalerts_tag_ai_validation_duration_seconds',
  help: 'Duration of AI tag validation',
});
```

### Ожидаемый результат

| Метрика | Значение |
|---------|----------|
| Авто-одобрено | ~80% |
| Авто-отклонено (мусор) | ~15% |
| Ручная модерация | ~5% (edge cases) |
| Мусор в каталоге | ~0% |

## API: Модерация тегов (Owner) — только для edge cases

**Файл:** `apps/backend/src/controllers/owner/tagModeration.ts`

```typescript
// GET /owner/tags/suggestions — список pending тегов (только те что требуют ручной модерации)
// POST /owner/tags/suggestions/:id/approve — одобрить вручную
// POST /owner/tags/suggestions/:id/map — маппить на существующий
// POST /owner/tags/suggestions/:id/reject — отклонить

// GET /owner/tags — список всех тегов с категориями
// POST /owner/tags — создать тег вручную
// PATCH /owner/tags/:id — обновить тег
// POST /owner/tags/:id/merge — объединить теги

// GET /owner/tags/stats — статистика авто-модерации
```

## Frontend: Панель модерации (минимальная)

**Файл:** `apps/frontend/src/features/settings/tabs/OwnerTagModeration.tsx`

UI только для:
- Просмотра статистики авто-модерации
- Ручной модерации ~5% edge cases
- Управления категориями

## Чеклист P0-1

- [ ] Миграция: `TagCategory`, обновить `Tag`, добавить `TagAlias`, `TagSuggestion`
- [ ] Seed: `prisma/seed-tags.ts` с ~80 canonical тегами
- [ ] Backend: `utils/ai/tagMapping.ts` — маппинг с кэшем
- [ ] Backend: Интеграция в AI pipeline
- [ ] Backend: `utils/ai/tagValidation.ts` — фильтры до AI
- [ ] Backend: `utils/ai/tagAiValidator.ts` — AI-валидация
- [ ] Backend: `jobs/tagAutoApproval.ts` — автоматическая обработка
- [ ] Backend: `jobs/tagAutoApprovalScheduler.ts` — scheduler (каждые 10 мин)
- [ ] Backend: авто-deprecation неиспользуемых тегов
- [ ] Backend: метрики авто-модерации
- [ ] Backend: API для ручной модерации edge cases
- [ ] Frontend: минимальная панель модерации
- [ ] Backfill: скрипт для маппинга существующих тегов

---

# 🔴 P0-2: Поиск по транскрипту + Улучшение названий

## Проблема

1. Поиск не ищет по речи в мемах
2. AI генерирует названия из контекста, а не из ключевых фраз

## Инсайт

Мемы запоминают по ключевой фразе:
- "Позвоните адвокату!" → "Адвокат"
- "Bruh..." → "Bruh"

## Backend: Добавить транскрипт в MemeAsset

**Файл:** `apps/backend/prisma/schema.prisma`

```prisma
model MemeAsset {
  // ... existing fields
  
  // Добавить:
  aiTranscript String? @db.VarChar(50000)
}
```

## Backend: Включить транскрипт в searchText

**Файл:** `apps/backend/src/services/aiModeration/aiModerationPersistence.ts`

```typescript
function buildSearchText(params: {
  title: string;
  description?: string;
  transcript?: string;
  tags: string[];
}): string {
  const parts = [
    params.title,
    params.description,
    // Ключевые фразы из транскрипта (первые 1000 символов)
    params.transcript?.slice(0, 1000),
    params.tags.join(' '),
  ].filter(Boolean);
  
  return parts.join('\n').slice(0, 4000);
}
```

## Backend: Улучшить генерацию названий

**Файл:** `apps/backend/src/utils/ai/openaiMemeMetadata.ts`

Обновить prompt:

```typescript
const systemPrompt = `Ты генерируешь короткие названия для мемов (2-4 слова).

ВАЖНО: Если в транскрипте есть яркая/запоминающаяся фраза — используй её как название.
Мемы называют по тому что в них говорят.

Примеры правильных названий:
- Транскрипт: "Позвоните адвокату, позвоните адвокату!" → "Адвокат"
- Транскрипт: "Bruh... what is this?" → "Bruh"
- Транскрипт: "Oh no, our table, it's broken!" → "Our Table"
- Транскрипт: "I am the one who knocks" → "I Am The One Who Knocks"

Если яркой фразы нет — придумай короткое описательное название.
Ответ в формате JSON: { "title": "...", "tags": [...], "description": "..." }`;
```

## Чеклист P0-2

- [ ] Миграция: добавить `aiTranscript` в `MemeAsset`
- [ ] Backend: копировать транскрипт из `MemeSubmission` в `MemeAsset`
- [ ] Backend: включить транскрипт в `aiSearchText`
- [ ] Backend: обновить prompt для генерации названий
- [ ] Backfill: скрипт для обновления searchText существующих мемов

---

# 🔴 P0-3: Taste Profile (Профиль вкуса)

## Концепция

Система изучает вкус зрителя на основе отправленных мемов. На любом канале показываем "его" мемы первыми.

## Схема БД

**Файл:** `apps/backend/prisma/schema.prisma`

```prisma
model UserTasteProfile {
  id       String @id @default(uuid())
  userId   String @unique
  
  // { "funny": 47.5, "cat": 23.2, "troll": 15.0 }
  tagWeightsJson Json @default("{}")
  
  // { "mood": {"funny": 47.5}, "intent": {"troll": 15.0} }
  categoryWeightsJson Json @default("{}")
  
  // ["funny", "cat", "troll", "music", "gaming"]
  topTagsJson Json @default("[]")
  
  totalActivations  Int @default(0)
  profileVersion    Int @default(1)
  lastActivationAt  DateTime?
  updatedAt         DateTime @updatedAt
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model UserTagActivity {
  id        String   @id @default(uuid())
  userId    String
  tagId     String
  weight    Float    @default(1.0)
  source    String   // activation | favorite | blacklist
  createdAt DateTime @default(now())
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  tag  Tag  @relation(fields: [tagId], references: [id], onDelete: Cascade)
  
  @@index([userId, tagId])
  @@index([userId, createdAt])
}
```

## Backend: Сервис Taste Profile

**Файл:** `apps/backend/src/services/taste/TasteProfileService.ts` (создать)

```typescript
export class TasteProfileService {
  // Обновить профиль после активации
  async recordActivation(userId: string, memeAssetId: string): Promise<void>;
  
  // Обновить профиль после добавления в избранное
  async recordFavorite(userId: string, memeAssetId: string): Promise<void>;
  
  // Обновить профиль после blacklist
  async recordBlacklist(userId: string, memeAssetId: string): Promise<void>;
  
  // Получить профиль пользователя
  async getProfile(userId: string): Promise<UserTasteProfile | null>;
  
  // Scoring мема для пользователя
  async scoreMemeForUser(meme: MemeWithTags, profile: UserTasteProfile): number;
  
  // Получить персонализированные мемы
  async getPersonalizedMemes(
    userId: string, 
    channelId: string, 
    limit: number
  ): Promise<ScoredMeme[]>;
}
```

## Backend: API endpoints

```typescript
// GET /me/taste-profile — получить свой профиль
// GET /channels/:slug/memes/personalized — персонализированный список мемов
```

## Frontend: Секция "Для тебя"

**Файл:** `apps/frontend/src/features/streamer-profile/ui/PersonalizedMemesSection.tsx`

```tsx
// Показывать если у пользователя есть профиль (>= 5 активаций)
// Иначе показывать Trending
```

## Чеклист P0-3

- [ ] Миграция: `UserTasteProfile`, `UserTagActivity`
- [ ] Backend: `TasteProfileService`
- [ ] Backend: интеграция в `activateMeme` — обновлять профиль
- [ ] Backend: endpoint `/me/taste-profile`
- [ ] Backend: endpoint `/channels/:slug/memes/personalized`
- [ ] Frontend: секция "Для тебя" на странице стримера
- [ ] Frontend: fallback на Trending для новых пользователей

---

# 🟠 P1-1: Быстрый доступ

## "Мои частые" + "Недавние"

**Backend:**
```typescript
// GET /channels/:slug/memes/my-frequent — топ мемов которые юзер активировал
// GET /channels/:slug/memes/my-recent — последние N активаций юзера
```

**Frontend:** Секции на странице стримера.

## Избранное

**Миграция:**
```prisma
model UserMemeFavorite {
  id           String   @id @default(uuid())
  userId       String
  memeAssetId  String
  createdAt    DateTime @default(now())
  
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  memeAsset MemeAsset @relation(fields: [memeAssetId], references: [id], onDelete: Cascade)
  
  @@unique([userId, memeAssetId])
  @@index([userId])
}
```

**API:**
```typescript
// POST /memes/:id/favorite — добавить в избранное
// DELETE /memes/:id/favorite — убрать из избранного
// GET /me/favorites — список избранных
```

## Blacklist

**Миграция:**
```prisma
model UserMemeBlacklist {
  id           String   @id @default(uuid())
  userId       String
  memeAssetId  String
  createdAt    DateTime @default(now())
  
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  memeAsset MemeAsset @relation(fields: [memeAssetId], references: [id], onDelete: Cascade)
  
  @@unique([userId, memeAssetId])
  @@index([userId])
}
```

**API:**
```typescript
// POST /memes/:id/blacklist — скрыть мем
// DELETE /memes/:id/blacklist — убрать из blacklist
// GET /me/blacklist — список скрытых
```

**Важно:** Blacklist влияет на Taste Profile (негативный сигнал).

## Чеклист P1-1

- [ ] Миграция: `UserMemeFavorite`, `UserMemeBlacklist`
- [ ] Backend: endpoints для favorites
- [ ] Backend: endpoints для blacklist
- [ ] Backend: endpoints "мои частые" и "недавние"
- [ ] Backend: интеграция blacklist с Taste Profile
- [ ] Frontend: UI кнопки ⭐ и 🚫 на карточке мема
- [ ] Frontend: секции "Мои частые" и "Недавние"

---

# 🟠 P1-2: Trending & Discovery

## Trending с фильтром периода

**API:**
```typescript
// GET /channels/:slug/memes/trending?period=24h|7d|30d
```

**Данные:** Агрегация `ChannelMemeDailyStats`.

## Быстрые фильтры по тегам

**API:**
```typescript
// GET /channels/:slug/memes?tags=funny,music&category=mood
// GET /tags/categories — список категорий с тегами
```

**Frontend:** Кнопки фильтров под поиском.

## Умный поиск

**API:**
```typescript
// GET /channels/:slug/memes/search?q=bruh&autocomplete=true
// Возвращает подсказки с количеством активаций
```

## "Похожие" в модалке

**API:**
```typescript
// GET /memes/:id/similar?limit=5
// Возвращает мемы с похожими тегами
```

## Чеклист P1-2

- [ ] Backend: endpoint trending с фильтром периода
- [ ] Backend: endpoint категорий тегов
- [ ] Backend: endpoint поиска с autocomplete
- [ ] Backend: endpoint "похожие мемы"
- [ ] Frontend: UI фильтров периода
- [ ] Frontend: UI быстрых фильтров по тегам
- [ ] Frontend: autocomplete в поиске
- [ ] Frontend: секция "Похожие" в MemeModal

---

# 🟠 P1-3: Детекция дубликатов

## При загрузке

**Файл:** `apps/backend/src/services/submission/submissionCreate.ts`

```typescript
async function checkDuplicate(channelId: string, fileHash: string) {
  const existing = await prisma.channelMeme.findFirst({
    where: {
      channelId,
      memeAsset: { fileHash },
      deletedAt: null,
    },
    select: { id: true, title: true },
  });
  
  if (existing) {
    return { isDuplicate: true, existingMeme: existing };
  }
  return { isDuplicate: false };
}
```

**API response:**
```json
{
  "isDuplicate": true,
  "existingMeme": { "id": "...", "title": "Bruh Sound Effect" }
}
```

**Frontend:** Показать warning с опцией "Загрузить всё равно".

## Чеклист P1-3

- [ ] Backend: проверка дубликата в upload flow
- [ ] Backend: включить в response upload API
- [ ] Frontend: UI предупреждения
- [ ] Frontend: опция продолжить загрузку

---

# 🟡 P2: Функции среднего приоритета

## Smart Cooldown

**Миграция:**
```prisma
model ChannelMeme {
  // ... existing
  cooldownMinutes Int?      @default(0)
  lastActivatedAt DateTime?
}
```

**Логика:** Проверять при активации, показывать таймер в UI.

## Коллекции мемов

**Миграция:**
```prisma
model MemeCollection {
  id        String @id @default(uuid())
  channelId String
  name      String
  emoji     String?
  sortOrder Int    @default(0)
  isPublic  Boolean @default(true)
  createdAt DateTime @default(now())
  
  channel Channel @relation(...)
  items   MemeCollectionItem[]
}

model MemeCollectionItem {
  id            String @id @default(uuid())
  collectionId  String
  channelMemeId String
  sortOrder     Int    @default(0)
  
  collection  MemeCollection @relation(...)
  channelMeme ChannelMeme    @relation(...)
  
  @@unique([collectionId, channelMemeId])
}
```

## Закреплённые мемы

**Миграция:**
```prisma
model ChannelMeme {
  // ... existing
  isPinned    Boolean  @default(false)
  pinnedAt    DateTime?
  pinnedOrder Int?
}
```

## Временное отключение

**Миграция:**
```prisma
model ChannelMeme {
  // ... existing
  isDisabled   Boolean  @default(false)
  disabledAt   DateTime?
  disableUntil DateTime?
}
```

## Leaderboards за период

**API:**
```typescript
// GET /channels/:slug/leaderboard?period=today|week|month
```

## Meme Analytics

**API:**
```typescript
// GET /streamer/analytics/memes — статистика мемов
```

## Stream Summary

Итоги стрима в Credits Overlay и статистике.

## Чеклист P2

- [ ] Smart Cooldown: миграция + логика + UI
- [ ] Коллекции: миграция + CRUD API + UI
- [ ] Закреплённые: миграция + API + UI
- [ ] Отключение: миграция + API + UI
- [ ] Leaderboards: API + UI
- [ ] Analytics: API + UI в дашборде
- [ ] Stream Summary: интеграция в Credits + статистику

---

# 🟢 P3: Функции низкого приоритета

## Уведомления о статусе сабмита

**Миграция:**
```prisma
model UserNotification {
  id        String   @id @default(uuid())
  userId    String
  type      String   // submission_approved | submission_rejected | etc
  title     String
  body      String?
  data      Json?
  isRead    Boolean  @default(false)
  createdAt DateTime @default(now())
  
  user User @relation(...)
  
  @@index([userId, isRead])
}
```

## QR-код

Frontend: генерация QR для страницы стримера.

## Soundboard Mode

Отдельный overlay для быстрых звуков.

## Meme Queue Widget

OBS виджет с очередью мемов.

---

# 🤖 Автономность: Системы самоуправления

## A1: Strict Auto-Approve для стримеров

### Проблема
Стример вручную одобряет каждый мем → много работы.

### Решение
Опциональный режим auto-approve с **жёсткими правилами** (Twitch/YouTube ToS).

### Правила безопасности (Content Policy)

```typescript
// apps/backend/src/config/contentPolicy.ts
export const CONTENT_POLICY = {
  // Категории которые ВСЕГДА требуют ручной модерации
  ALWAYS_MANUAL_LABELS: [
    'sexual',
    'sexual/minors',
    'hate',
    'hate/threatening',
    'violence',
    'violence/graphic',
    'self-harm',
    'harassment',
    'harassment/threatening',
  ],
  
  // Ключевые слова для блокировки (расширяемый список)
  BLOCKED_KEYWORDS: [
    // Политика, экстремизм
    // Насилие
    // NSFW
    // ... (список хранится в БД для обновления без деплоя)
  ],
  
  // Максимальный aiRiskScore для auto-approve
  MAX_RISK_SCORE: 0.3,
  
  // Минимальная уверенность AI
  MIN_AI_CONFIDENCE: 0.85,
  
  // Проверенные загрузчики (whitelist)
  TRUSTED_UPLOADER_MIN_APPROVED: 10, // минимум 10 одобренных мемов
};
```

### Логика Auto-Approve

```typescript
interface AutoApproveResult {
  approved: boolean;
  reason: string;
  requiresManualReview: boolean;
}

async function checkAutoApprove(
  submission: MemeSubmission,
  channelSettings: ChannelAutoApproveSettings
): Promise<AutoApproveResult> {
  // 0. Проверяем что стример включил auto-approve
  if (!channelSettings.autoApproveEnabled) {
    return { approved: false, reason: 'disabled', requiresManualReview: true };
  }

  // 1. AI moderation результат
  if (submission.aiStatus !== 'done') {
    return { approved: false, reason: 'ai_pending', requiresManualReview: true };
  }

  // 2. Risk score
  if ((submission.aiRiskScore || 1) > CONTENT_POLICY.MAX_RISK_SCORE) {
    return { approved: false, reason: 'high_risk', requiresManualReview: true };
  }

  // 3. Запрещённые категории
  const labels = submission.aiLabelsJson as string[] || [];
  const hasBlockedLabel = labels.some(l => 
    CONTENT_POLICY.ALWAYS_MANUAL_LABELS.some(blocked => l.includes(blocked))
  );
  if (hasBlockedLabel) {
    return { approved: false, reason: 'blocked_category', requiresManualReview: true };
  }

  // 4. Проверка ключевых слов в транскрипте и названии
  const textToCheck = [
    submission.title,
    submission.aiTranscript,
    submission.aiAutoDescription,
  ].filter(Boolean).join(' ').toLowerCase();
  
  const blockedKeywords = await getBlockedKeywords();
  const hasBlockedKeyword = blockedKeywords.some(kw => textToCheck.includes(kw));
  if (hasBlockedKeyword) {
    return { approved: false, reason: 'blocked_keyword', requiresManualReview: true };
  }

  // 5. Quality check
  if (!submission.aiAutoTagNamesJson || (submission.aiAutoTagNamesJson as string[]).length === 0) {
    return { approved: false, reason: 'no_tags', requiresManualReview: true };
  }

  // 6. Проверенный загрузчик (опционально)
  if (channelSettings.autoApproveOnlyTrusted) {
    const approvedCount = await countApprovedSubmissions(submission.submitterUserId);
    if (approvedCount < CONTENT_POLICY.TRUSTED_UPLOADER_MIN_APPROVED) {
      return { approved: false, reason: 'not_trusted', requiresManualReview: true };
    }
  }

  // ✅ Всё ок — auto-approve
  return { approved: true, reason: 'passed_all_checks', requiresManualReview: false };
}
```

### Настройки для стримера

```prisma
model Channel {
  // ... existing
  
  // Auto-approve settings
  autoApproveEnabled        Boolean @default(false)
  autoApproveOnlyTrusted    Boolean @default(true)  // только проверенные загрузчики
  autoApproveNotify         Boolean @default(true)  // уведомлять о каждом auto-approve
  autoApproveMaxPerDay      Int?    // лимит в день (null = без лимита)
}
```

### UI для стримера

```
┌─────────────────────────────────────────────────────────┐
│  🤖 Автоматическое одобрение                           │
├─────────────────────────────────────────────────────────┤
│  [✓] Включить auto-approve                             │
│                                                         │
│  Безопасность:                                         │
│  [✓] Только от проверенных загрузчиков (10+ мемов)    │
│  [✓] Уведомлять меня о каждом auto-approve            │
│                                                         │
│  ⚠️ Мемы с подозрительным контентом всегда требуют    │
│     ручного одобрения (политика Twitch/YouTube)        │
└─────────────────────────────────────────────────────────┘
```

---

## A2: Quality Score для мемов

### Автоматическая оценка качества

```typescript
interface MemeQualityScore {
  overall: number;        // 0-100
  
  // Компоненты
  audioClarity: number;   // чёткость звука (из AI ASR confidence)
  transcriptQuality: number; // качество распознавания
  tagRelevance: number;   // теги соответствуют контенту
  titleQuality: number;   // название информативное
  engagement: number;     // активации / время в каталоге
  
  tier: 'S' | 'A' | 'B' | 'C' | 'D'; // для UI
}

async function calculateQualityScore(memeAsset: MemeAsset): Promise<MemeQualityScore> {
  const scores = {
    audioClarity: memeAsset.aiTranscript ? 0.8 : 0.3,
    transcriptQuality: memeAsset.aiTranscript?.length > 10 ? 0.9 : 0.5,
    tagRelevance: (memeAsset.aiAutoTagNamesJson as string[] || []).length >= 3 ? 0.9 : 0.5,
    titleQuality: memeAsset.aiAutoTitle && memeAsset.aiAutoTitle.length > 3 ? 0.85 : 0.4,
    engagement: await calculateEngagementScore(memeAsset.id),
  };
  
  const overall = (
    scores.audioClarity * 0.2 +
    scores.transcriptQuality * 0.2 +
    scores.tagRelevance * 0.25 +
    scores.titleQuality * 0.15 +
    scores.engagement * 0.2
  ) * 100;
  
  const tier = overall >= 90 ? 'S' : overall >= 75 ? 'A' : overall >= 60 ? 'B' : overall >= 40 ? 'C' : 'D';
  
  return { overall, ...scores, tier };
}
```

### Использование

- Сортировка в пуле (высокий quality выше)
- Badge на карточке мема (S/A/B/C)
- Приоритет в рекомендациях

---

## A3: Smart Pricing (динамические цены)

### Концепция

Цена мема автоматически корректируется на основе популярности.

```typescript
interface DynamicPricing {
  basePrice: number;           // базовая цена от стримера
  currentPrice: number;        // текущая цена
  multiplier: number;          // 0.5 - 2.0
  trend: 'rising' | 'falling' | 'stable';
}

async function calculateDynamicPrice(
  channelMeme: ChannelMeme,
  settings: ChannelDynamicPricingSettings
): Promise<DynamicPricing> {
  if (!settings.enabled) {
    return { 
      basePrice: channelMeme.priceCoins, 
      currentPrice: channelMeme.priceCoins,
      multiplier: 1.0,
      trend: 'stable'
    };
  }

  // Активации за последние 24 часа
  const recent = await countRecentActivations(channelMeme.id, 24);
  // Среднее по каналу
  const avgRecent = await getAverageRecentActivations(channelMeme.channelId, 24);
  
  let multiplier = 1.0;
  
  if (avgRecent > 0) {
    const ratio = recent / avgRecent;
    
    if (ratio > 2) {
      // Очень популярен → дороже (макс x2)
      multiplier = Math.min(2.0, 1.0 + (ratio - 1) * 0.2);
    } else if (ratio < 0.3) {
      // Мало активаций → дешевле (мин x0.5)
      multiplier = Math.max(0.5, 0.5 + ratio);
    }
  }
  
  // Ограничиваем диапазоном стримера
  multiplier = Math.max(settings.minMultiplier, Math.min(settings.maxMultiplier, multiplier));
  
  const currentPrice = Math.round(channelMeme.priceCoins * multiplier);
  const trend = multiplier > 1.1 ? 'rising' : multiplier < 0.9 ? 'falling' : 'stable';
  
  return { basePrice: channelMeme.priceCoins, currentPrice, multiplier, trend };
}
```

### Настройки для стримера

```prisma
model Channel {
  // ... existing
  
  dynamicPricingEnabled   Boolean @default(false)
  dynamicPricingMinMult   Float   @default(0.5)   // минимум x0.5
  dynamicPricingMaxMult   Float   @default(2.0)   // максимум x2
}
```

### UI на карточке мема

```
┌─────────────────┐
│      🎬        │
│  Bruh Sound    │
│                │
│  💰 150 (+50%) │  ← красным если дороже
│     или        │
│  💰 75 (-25%)  │  ← зелёным если дешевле
│  📈 trending   │  ← индикатор тренда
└─────────────────┘
```

---

## A4: Auto-Import Trending для новых стримеров

### Концепция

Новый стример подключился → предлагаем топ мемов из пула.

```typescript
async function suggestStarterMemes(channelId: string): Promise<MemeAsset[]> {
  // Топ-20 мемов пула по качеству + engagement
  const trending = await prisma.memeAsset.findMany({
    where: {
      poolVisibility: 'visible',
      aiStatus: 'done',
      purgedAt: null,
    },
    orderBy: [
      { qualityScore: 'desc' },
    ],
    take: 20,
  });
  
  return trending;
}
```

### UI для стримера (onboarding)

```
┌─────────────────────────────────────────────────────────┐
│  🚀 Быстрый старт                                      │
├─────────────────────────────────────────────────────────┤
│  Добавьте популярные мемы в свой каталог:              │
│                                                         │
│  [✓] Bruh Sound Effect     [✓] Oof                     │
│  [✓] Vine Boom             [✓] Sad Violin              │
│  [✓] Windows XP            [ ] Rickroll                │
│                                                         │
│  [Добавить выбранные (5)]  [Пропустить]                │
└─────────────────────────────────────────────────────────┘
```

---

## A5: Progressive Spam Ban

### Прогрессивная система банов

```typescript
interface UserBanState {
  banCount: number;        // количество банов
  currentBanUntil: Date | null;
  lastBanAt: Date | null;
  banDecayAt: Date | null; // когда начнёт спадать
}

const BAN_PROGRESSION = [
  30 * 60 * 1000,      // 1-й бан: 30 минут
  60 * 60 * 1000,      // 2-й: 1 час
  2 * 60 * 60 * 1000,  // 3-й: 2 часа
  6 * 60 * 60 * 1000,  // 4-й: 6 часов
  24 * 60 * 60 * 1000, // 5-й: 24 часа
  7 * 24 * 60 * 60 * 1000, // 6+: 7 дней
];

const BAN_DECAY_DAYS = 30; // бан-счётчик спадает через 30 дней без нарушений

async function applySpamBan(userId: string, reason: string): Promise<void> {
  const state = await getUserBanState(userId);
  
  // Decay: если прошло 30 дней без нарушений, сбрасываем счётчик
  if (state.lastBanAt && state.banDecayAt && new Date() > state.banDecayAt) {
    state.banCount = 0;
  }
  
  const banDuration = BAN_PROGRESSION[Math.min(state.banCount, BAN_PROGRESSION.length - 1)];
  const banUntil = new Date(Date.now() + banDuration);
  
  await prisma.userBanState.upsert({
    where: { userId },
    create: {
      userId,
      banCount: 1,
      currentBanUntil: banUntil,
      lastBanAt: new Date(),
      banDecayAt: new Date(Date.now() + BAN_DECAY_DAYS * 24 * 60 * 60 * 1000),
      reason,
    },
    update: {
      banCount: { increment: 1 },
      currentBanUntil: banUntil,
      lastBanAt: new Date(),
      banDecayAt: new Date(Date.now() + BAN_DECAY_DAYS * 24 * 60 * 60 * 1000),
      reason,
    },
  });
  
  logger.warn('user.spam_banned', { userId, banUntil, banCount: state.banCount + 1, reason });
}
```

### Триггеры бана

```typescript
async function checkSpamPatterns(userId: string): Promise<{ shouldBan: boolean; reason: string }> {
  const last24h = await getSubmissionsLast24h(userId);
  
  // 1. Много отклонённых подряд
  const recentRejected = last24h.filter(s => s.status === 'rejected');
  if (recentRejected.length >= 5) {
    return { shouldBan: true, reason: '5+ rejected submissions in 24h' };
  }
  
  // 2. Много high-risk
  const highRisk = last24h.filter(s => (s.aiRiskScore || 0) > 0.7);
  if (highRisk.length >= 3) {
    return { shouldBan: true, reason: '3+ high-risk submissions in 24h' };
  }
  
  // 3. Дубликаты спамом
  const duplicates = last24h.filter(s => s.isDuplicate);
  if (duplicates.length >= 10) {
    return { shouldBan: true, reason: '10+ duplicate submissions in 24h' };
  }
  
  return { shouldBan: false, reason: '' };
}
```

### Схема

```prisma
model UserBanState {
  id              String    @id @default(uuid())
  userId          String    @unique
  banCount        Int       @default(0)
  currentBanUntil DateTime?
  lastBanAt       DateTime?
  banDecayAt      DateTime?
  reason          String?
  
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

---

## A6: Health Monitoring & Alerting

### Автоматические проверки

```typescript
// apps/backend/src/jobs/healthMonitor.ts

interface HealthCheck {
  name: string;
  check: () => Promise<boolean>;
  alert: (message: string) => Promise<void>;
  autoFix?: () => Promise<void>;
}

const healthChecks: HealthCheck[] = [
  {
    name: 'ai_queue_stuck',
    check: async () => {
      const stuck = await prisma.memeSubmission.count({
        where: {
          aiStatus: 'processing',
          aiProcessingStartedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        },
      });
      return stuck === 0;
    },
    alert: (msg) => sendTelegramAlert(msg),
    autoFix: async () => {
      // Reset stuck jobs
      await prisma.memeSubmission.updateMany({
        where: {
          aiStatus: 'processing',
          aiProcessingStartedAt: { lt: new Date(Date.now() - 30 * 60 * 1000) },
        },
        data: { aiStatus: 'pending', aiProcessingStartedAt: null },
      });
    },
  },
  
  {
    name: 'disk_space',
    check: async () => {
      const { available } = await checkDiskSpace('/');
      return available > 5 * 1024 * 1024 * 1024; // > 5GB
    },
    alert: (msg) => sendTelegramAlert(msg),
  },
  
  {
    name: 'error_rate',
    check: async () => {
      const errors = await getErrorCountLast5Min();
      return errors < 100; // < 100 ошибок за 5 мин
    },
    alert: (msg) => sendTelegramAlert(msg),
  },
];

// Запускать каждые 5 минут
async function runHealthChecks(): Promise<void> {
  for (const check of healthChecks) {
    try {
      const healthy = await check.check();
      if (!healthy) {
        await check.alert(`⚠️ Health check failed: ${check.name}`);
        if (check.autoFix) {
          await check.autoFix();
          logger.info('health.auto_fixed', { check: check.name });
        }
      }
    } catch (error) {
      logger.error('health.check_error', { check: check.name, error });
    }
  }
}
```

---

## A7: Engagement-based Visibility

### Концепция

Мемы с низким engagement постепенно уходят вниз.

```typescript
// Visibility score = quality + recency + engagement
async function calculateVisibilityScore(memeAsset: MemeAsset): Promise<number> {
  const quality = memeAsset.qualityScore || 50;
  
  // Recency: новые мемы получают бонус
  const ageHours = (Date.now() - memeAsset.createdAt.getTime()) / (1000 * 60 * 60);
  const recencyBonus = Math.max(0, 20 - ageHours / 24); // +20 для новых, спадает за 20 дней
  
  // Engagement: активации за 30 дней
  const activations = await countActivationsLast30d(memeAsset.id);
  const engagementScore = Math.min(30, activations * 2); // макс +30
  
  return quality + recencyBonus + engagementScore;
}
```

**Примечание:** Эта фича будет полезнее когда накопится больше данных.

---

## A8: Auto-Merge дубликатов (защитная функция)

```typescript
// Периодически проверять на дубликаты по contentHash
async function findAndMergeDuplicates(): Promise<void> {
  const duplicates = await prisma.$queryRaw`
    SELECT "contentHash", array_agg(id) as ids, COUNT(*) as cnt
    FROM "MemeAsset"
    WHERE "contentHash" IS NOT NULL AND "purgedAt" IS NULL
    GROUP BY "contentHash"
    HAVING COUNT(*) > 1
  `;
  
  for (const dup of duplicates) {
    const assets = await prisma.memeAsset.findMany({
      where: { id: { in: dup.ids } },
      orderBy: { qualityScore: 'desc' },
    });
    
    const primary = assets[0]; // лучшее качество
    const others = assets.slice(1);
    
    // Перенести связи на primary
    for (const other of others) {
      await prisma.channelMeme.updateMany({
        where: { memeAssetId: other.id },
        data: { memeAssetId: primary.id },
      });
      
      // Мягкое удаление дубликата
      await prisma.memeAsset.update({
        where: { id: other.id },
        data: { purgedAt: new Date(), purgeReason: 'duplicate_merged' },
      });
    }
    
    logger.info('meme.duplicates_merged', { primaryId: primary.id, mergedCount: others.length });
  }
}
```

---

## A9: Auto-Cleanup (перспектива)

Когда понадобится — автоматическое архивирование неиспользуемых мемов.

```typescript
// Пока отключено, но готово к использованию
const AUTO_CLEANUP_CONFIG = {
  enabled: false,
  archiveAfterDays: 90,      // архивировать после 90 дней без активаций
  deleteAfterDays: 180,      // удалять файлы после 180 дней в архиве
  minAgeForCleanup: 180,     // только мемы старше 6 месяцев
};
```

---

# 📋 Итоговый чеклист

## P0 (Критично)

### Таксономия тегов + AI-Gatekeeper
- [ ] Миграция: `TagCategory`, `Tag` (обновить), `TagAlias`, `TagSuggestion`
- [ ] Seed: стартовый каталог ~80 тегов
- [ ] Backend: `tagMapping.ts` — маппинг AI-тегов на canonical
- [ ] Backend: `tagValidation.ts` — фильтры до AI (garbage detection)
- [ ] Backend: `tagAiValidator.ts` — AI-валидация и категоризация
- [ ] Backend: `tagAutoApproval.ts` — автоматическая обработка
- [ ] Backend: scheduler авто-модерации (каждые 10 мин)
- [ ] Backend: авто-deprecation неиспользуемых тегов
- [ ] Backend: интеграция в AI pipeline
- [ ] Backend: метрики авто-модерации
- [ ] Frontend: минимальная панель для edge cases

### Поиск по транскрипту + названия
- [ ] Миграция: добавить `aiTranscript` в `MemeAsset`
- [ ] Backend: копировать транскрипт в MemeAsset
- [ ] Backend: включить транскрипт в `aiSearchText`
- [ ] Backend: обновить prompt для генерации названий из речи

### Taste Profile
- [ ] Миграция: `UserTasteProfile`, `UserTagActivity`
- [ ] Backend: `TasteProfileService`
- [ ] Backend: интеграция с активациями
- [ ] Backend: endpoint `/me/taste-profile`
- [ ] Backend: endpoint `/channels/:slug/memes/personalized`
- [ ] Frontend: секция "Для тебя"

## P1 (Высокий)
- [ ] "Мои частые" + "Недавние"
- [ ] Избранное (⭐)
- [ ] Blacklist (🚫)
- [ ] Trending с фильтром периода
- [ ] Быстрые фильтры по тегам
- [ ] Умный поиск с автодополнением
- [ ] "Похожие" в модалке
- [ ] Детекция дубликатов при загрузке

## P2 (Средний)
- [ ] Smart Cooldown
- [ ] Коллекции мемов
- [ ] Leaderboards за период
- [ ] Meme Analytics
- [ ] Stream Summary
- [ ] Закреплённые мемы (Pinned)
- [ ] Временное отключение мема

## P3 (Низкий)
- [ ] Уведомления о статусе сабмита
- [ ] QR-код для зрителей
- [ ] Soundboard Mode
- [ ] Meme Queue Widget

## Автономность (A)

### A1: Strict Auto-Approve
- [x] Миграция: поля autoApprove в Channel
- [x] Backend: `contentPolicy.ts` — правила Twitch/YouTube
- [x] Backend: `autoApprove.ts` — проверка всех условий
- [x] Backend: интеграция после AI moderation
- [x] Frontend: настройки для стримера

### A2: Quality Score
- [x] Backend: `qualityScore.ts` — расчёт метрики
- [x] Backend: фоновый пересчёт для всех мемов
- [x] Backend: добавить `qualityScore` в MemeAsset
- [x] Frontend: badge S/A/B/C на карточке

### A3: Smart Pricing
- [ ] Миграция: поля dynamicPricing в Channel
- [ ] Backend: `dynamicPricing.ts` — расчёт цен
- [ ] Backend: endpoint с текущими ценами
- [ ] Frontend: отображение цены на карточке (↑/↓)
- [ ] Frontend: toggle для стримера

### A4: Auto-Import Trending (onboarding)
- [ ] Backend: endpoint `/starter-memes`
- [ ] Frontend: onboarding flow для новых стримеров

### A5: Progressive Spam Ban
- [x] Миграция: `UserBanState`
- [x] Backend: `spamBan.ts` — логика прогрессии и decay
- [x] Backend: триггеры проверки
- [x] Frontend: уведомление о бане

### A6: Health Monitoring
- [x] Backend: `healthMonitor.ts` — проверки
- [x] Backend: scheduler каждые 5 минут
- [x] Backend: Telegram alerting

### A7: Engagement Visibility
- [ ] Backend: `visibilityScore.ts`
- [ ] Backend: индекс для сортировки

### A8: Auto-Merge дубликатов
- [x] Backend: `duplicateMerge.ts`
- [x] Backend: scheduler раз в день

### A9: Auto-Cleanup (отложено)
- [ ] Подготовлено, включить при необходимости

---

# 🎯 Рекомендуемый порядок реализации

## Фаза 1: Основа
1. **Таксономия тегов + AI-Gatekeeper** — база для Taste Profile и поиска
2. **Поиск по транскрипту + улучшение названий** — ключевое улучшение UX
3. **Taste Profile** — персонализация "Для тебя"

**Дополнительно (сделано в рамках Фазы 1, но вне исходного плана):**
- Tag-only поиск по клику на тег (без смешения с текстовым поиском)
- Ранжирование результатов поиска: точные совпадения раньше, похожие ниже
- Публичные выдачи мемов отдают `aiAutoTagNames`/`tags` для карточек
- `memes/pool` и public search поддерживают фильтр `?tags=`

## Фаза 2: Быстрый доступ
4. **"Мои частые" + избранное + blacklist** — персональные списки
5. **Trending + фильтры** — discovery

## Фаза 3: Автономность
6. **Strict Auto-Approve** (A1) — снижение нагрузки на стримеров
7. **Quality Score** (A2) — автоматическая сортировка
8. **Progressive Spam Ban** (A5) — защита от абьюза
9. **Auto-Merge дубликатов** (A8) — чистота данных
10. **Health Monitoring** (A6) — стабильность системы

## Фаза 4: Продвинутые фичи
11. **Smart Pricing** (A3) — динамические цены
12. **Auto-Import Trending** (A4) — onboarding
13. **Smart Cooldown** — защита от спама одним мемом
14. **Leaderboards за период** — геймификация

## Фаза 5: Шлифовка
15. **Stream Summary** — аналитика
16. **Коллекции мемов** — организация
17. **Уведомления** — статус сабмита
18. **QR-код** — маркетинг

---

# ⚠️ Важные ограничения

1. **НЕ ЛОМАТЬ существующий поиск** — транскрипт добавляется к searchText, не заменяет
2. **НЕ ЛОМАТЬ AI pipeline** — маппинг тегов добавляется после генерации
3. **Миграции должны быть backward-compatible** — expand/contract pattern
4. **Кэшировать тяжёлые операции** — alias lookup, profile scoring
5. **Cold start для Taste Profile** — fallback на Trending если < 5 активаций
6. **Auto-Approve ТОЛЬКО с жёсткими правилами** — соответствие Twitch/YouTube ToS
7. **Баны прогрессивные + decay** — 30мин → 1ч → 2ч → 6ч → 24ч → 7д, спадает за 30 дней
8. **Smart Pricing opt-in** — стример сам включает динамические цены
9. **Quality Score не влияет на видимость сразу** — сначала накопить данные

---

# 📁 Ключевые файлы для изучения

## Backend
- `src/utils/ai/openaiMemeMetadata.ts` — генерация названий/тегов
- `src/services/aiModeration/` — AI pipeline
- `src/services/meme/` — логика мемов
- `src/controllers/viewer/` — API для зрителей
- `prisma/schema.prisma` — схема БД

## Frontend
- `src/features/streamer-profile/` — страница стримера
- `src/entities/meme/` — компоненты мемов
- `src/shared/api/` — API клиент

---

# 📝 Заметки

## Про генерацию названий

Мемы запоминают по ключевой фразе из речи:
- "Позвоните адвокату!" → "Адвокат"
- "Bruh..." → "Bruh"
- "Oh no, our table" → "Our Table"

AI должен приоритизировать яркие фразы из транскрипта.

## Не добавляем

- ❌ Голосование за мемы — спорный момент
- ❌ Meme Requests — зритель сам добавляет мемы
- ❌ Подарок мемов — не имеет смысла
- ❌ Рандомный мем — зрители хотят конкретные
- ❌ Писать в чат — лишнее
- ❌ Перевод мемов — не нужно

---

*Документ создан: 2026-01-24*
*Последнее обновление: 2026-01-24*
*Формат: для GPT 5.2 Codex*
*Версия: 2.0 (добавлена секция Автономность)*
