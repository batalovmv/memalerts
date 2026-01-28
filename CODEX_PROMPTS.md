# Промпты для Codex — Улучшение системы рекомендаций

> Выполняй задачи последовательно. Каждая задача — отдельный запуск Codex.

---

## Задача 1.1: Учитывать лайки в профиле вкусов

**Уровень:** High

```
Контекст: В проекте memalerts есть система рекомендаций мемов на основе профиля вкусов пользователя. Сейчас профиль обновляется только при активации мемов (TasteProfileService.recordActivation). Но когда пользователь добавляет мем в избранное — это никак не влияет на рекомендации. Нужно это исправить.

Задача: Добавить учёт лайков (избранного) в профиле вкусов.

Что сделать:

1. В файле apps/backend/src/services/taste/TasteProfileService.ts добавить новый метод recordFavorite():

```typescript
static async recordFavorite(args: { userId: string; memeAssetId: string }): Promise<void> {
  // 1. Получить MemeAsset по memeAssetId
  // 2. Извлечь aiAutoTagNames из MemeAsset
  // 3. Использовать mapTagsToCanonical() для получения канонических тегов (как в recordActivation)
  // 4. Обновить профиль вкусов с весом 0.5 (половина от активации которая даёт 1.0)
  // 5. Залогировать в UserTagActivity с source='favorite' и weight=0.5
}
```

Используй существующий метод recordActivation() как образец. Основное отличие — вес 0.5 вместо 1.0.

2. В файле apps/backend/src/controllers/viewer/memeLists.ts найти функцию addFavorite() и добавить вызов:

```typescript
void TasteProfileService.recordFavorite({
  userId: req.userId!,
  memeAssetId,
}).catch((error) => {
  logger.warn('taste_profile.favorite_failed', { userId: req.userId, memeAssetId, error });
});
```

Вызов должен быть асинхронным (void) чтобы не блокировать ответ.

Не забудь добавить импорт TasteProfileService в memeLists.ts если его там нет.

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 1.2: Time Decay для весов тегов

**Уровень:** High

```
Контекст: В системе рекомендаций memalerts веса тегов только накапливаются и никогда не уменьшаются. Активация мема год назад весит столько же, сколько вчерашняя. Нужно добавить time decay — чтобы старые предпочтения постепенно теряли вес.

Задача: Реализовать time decay в scoring функции.

Что сделать:

1. В файле apps/backend/src/services/taste/TasteProfileService.ts модифицировать метод scoreMemeForUser():

Текущая логика:
```typescript
score += profile.tagWeights[tagName] ?? 0
score += (profile.categoryWeights[categorySlug] ?? 0) * 0.5
```

Новая логика — применять decay на основе lastActivationAt профиля:

```typescript
const DECAY_HALF_LIFE_DAYS = 30; // Вес уменьшается вдвое за 30 дней

function calculateDecayFactor(lastActivationAt: Date | null): number {
  if (!lastActivationAt) return 1.0;
  const daysSince = (Date.now() - lastActivationAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
}

// В scoreMemeForUser:
const decayFactor = calculateDecayFactor(profile.lastActivationAt);

for (const tagName of tagNames) {
  const rawWeight = profile.tagWeights[tagName] ?? 0;
  score += rawWeight * decayFactor;
}

for (const categorySlug of categorySlugs) {
  const rawWeight = profile.categoryWeights[categorySlug] ?? 0;
  score += rawWeight * 0.5 * decayFactor;
}
```

2. Убедись что profile.lastActivationAt доступен в TasteProfileSnapshot и передаётся в scoreMemeForUser.

Примечание: Это простая реализация — decay применяется ко всему профилю на основе последней активности. Более сложный вариант (decay для каждого тега отдельно) можно сделать позже.

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 1.3: Negative Signals (скрытые мемы)

**Уровень:** High

```
Контекст: Когда пользователь скрывает мем в memalerts, он просто перестаёт показываться. Но система не учится на этом негативном сигнале — теги скрытого мема не теряют вес. Нужно это исправить.

Задача: Уменьшать веса тегов при скрытии мема.

Что сделать:

1. В файле apps/backend/src/services/taste/TasteProfileService.ts добавить метод recordHidden():

```typescript
static async recordHidden(args: { userId: string; memeAssetId: string }): Promise<void> {
  const { userId, memeAssetId } = args;

  // 1. Получить MemeAsset с тегами
  const memeAsset = await prisma.memeAsset.findUnique({
    where: { id: memeAssetId },
    select: { aiAutoTagNames: true }
  });

  if (!memeAsset?.aiAutoTagNames?.length) return;

  // 2. Получить канонические теги
  const { mapped } = await mapTagsToCanonical(memeAsset.aiAutoTagNames);
  if (mapped.length === 0) return;

  // 3. Загрузить текущий профиль
  const existing = await prisma.userTasteProfile.findUnique({
    where: { userId }
  });

  if (!existing) return; // Нет профиля — нечего уменьшать

  // 4. Уменьшить веса тегов
  const tagWeights = existing.tagWeightsJson as Record<string, number>;
  const HIDDEN_PENALTY = 0.3;

  for (const { canonicalName } of mapped) {
    if (tagWeights[canonicalName]) {
      tagWeights[canonicalName] = Math.max(0, tagWeights[canonicalName] - HIDDEN_PENALTY);
    }
  }

  // 5. Пересчитать topTags
  const topTags = Object.entries(tagWeights)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([name, weight]) => ({ name, weight }));

  // 6. Обновить профиль
  await prisma.userTasteProfile.update({
    where: { userId },
    data: {
      tagWeightsJson: tagWeights,
      topTagsJson: topTags
    }
  });

  logger.info('taste_profile.hidden_recorded', { userId, memeAssetId, tagsAffected: mapped.length });
}
```

2. В файле apps/backend/src/controllers/viewer/memeLists.ts найти функцию addHidden() и добавить вызов:

```typescript
void TasteProfileService.recordHidden({
  userId: req.userId!,
  memeAssetId,
}).catch((error) => {
  logger.warn('taste_profile.hidden_failed', { userId: req.userId, memeAssetId, error });
});
```

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 1.4: Freshness Boost для новых мемов

**Уровень:** High

```
Контекст: В системе рекомендаций memalerts новые мемы не имеют преимущества перед старыми. Нужно добавить буст свежести, чтобы новый контент имел шанс попасть в рекомендации.

Задача: Добавить freshness boost в scoring.

Что сделать:

1. В файле apps/backend/src/controllers/viewer/personalizedMemes.ts добавить функцию расчёта буста свежести:

```typescript
function calculateFreshnessBoost(createdAt: Date): number {
  const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 1) return 2.0;    // Сегодня — двойной буст
  if (daysSinceCreation < 3) return 1.7;    // 1-3 дня — 1.7x
  if (daysSinceCreation < 7) return 1.4;    // Неделя — 1.4x
  if (daysSinceCreation < 14) return 1.2;   // 2 недели — 1.2x
  if (daysSinceCreation < 30) return 1.1;   // Месяц — 1.1x
  return 1.0;                                // Старше — без буста
}
```

2. В том же файле найти место где вычисляется score для каждого мема (внутри цикла по кандидатам) и применить буст:

```typescript
// Найди строку типа:
const score = TasteProfileService.scoreMemeForUser(profile, { tagNames, categorySlugs });

// Замени на:
const baseScore = TasteProfileService.scoreMemeForUser(profile, { tagNames, categorySlugs });
const freshnessBoost = calculateFreshnessBoost(meme.createdAt); // или channelMeme.createdAt
const score = baseScore * freshnessBoost;
```

3. Убедись что createdAt доступен в объекте мема. Если нет — добавь его в select запроса.

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 2.1: Diversity — разнообразие рекомендаций

**Уровень:** High

```
Контекст: В рекомендациях memalerts может быть много мемов с одинаковым топ-тегом подряд. Например, 5 мемов с тегом "gaming" в топ-10. Нужно добавить diversification.

Задача: Ограничить количество мемов с одинаковым топ-тегом в результатах.

Что сделать:

1. В файле apps/backend/src/controllers/viewer/personalizedMemes.ts добавить функцию diversifyResults():

```typescript
interface ScoredMeme {
  meme: any; // тип мема из твоего кода
  score: number;
  tagNames: string[];
}

function diversifyResults(scoredMemes: ScoredMeme[], limit: number): ScoredMeme[] {
  const MAX_SAME_TOP_TAG = 2; // Максимум 2 мема с одинаковым топ-тегом
  const result: ScoredMeme[] = [];
  const topTagCounts: Record<string, number> = {};

  // Мемы уже отсортированы по score (убывание)
  for (const item of scoredMemes) {
    if (result.length >= limit) break;

    const topTag = item.tagNames[0]; // Первый тег — самый релевантный

    if (topTag) {
      const currentCount = topTagCounts[topTag] || 0;
      if (currentCount >= MAX_SAME_TOP_TAG) {
        continue; // Пропускаем — слишком много мемов с этим тегом
      }
      topTagCounts[topTag] = currentCount + 1;
    }

    result.push(item);
  }

  // Если не набрали limit — добавляем пропущенные мемы
  if (result.length < limit) {
    for (const item of scoredMemes) {
      if (result.length >= limit) break;
      if (!result.includes(item)) {
        result.push(item);
      }
    }
  }

  return result;
}
```

2. Найди место где выбираются топ мемы после scoring (обычно .sort().slice(0, limit)) и замени на:

```typescript
// Было:
const topMemes = scoredMemes.sort((a, b) => b.score - a.score).slice(0, limit);

// Стало:
const sortedMemes = scoredMemes.sort((a, b) => b.score - a.score);
const topMemes = diversifyResults(sortedMemes, limit);
```

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 2.2: Popularity Normalization

**Уровень:** High

```
Контекст: Популярные мемы в memalerts имеют больше шансов попасть в рекомендации просто потому что их больше активировали. Нужно нормализовать score чтобы менее популярные мемы тоже имели шанс.

Задача: Добавить нормализацию по популярности.

Что сделать:

1. Сначала нужно получить количество активаций для каждого мема. В файле apps/backend/src/controllers/viewer/personalizedMemes.ts модифицируй запрос загрузки кандидатов, добавив _count:

```typescript
// В запросе к ChannelMeme или MemeAsset добавь:
include: {
  _count: {
    select: { activations: true }
  }
}
// или если activations на MemeAsset:
include: {
  memeAsset: {
    include: {
      _count: {
        select: { activations: true }
      }
    }
  }
}
```

2. Добавь функцию нормализации:

```typescript
function normalizeByPopularity(score: number, activationCount: number): number {
  // Логарифмическая нормализация
  // +10 чтобы избежать деления на log(1)=0 для новых мемов
  const popularityFactor = Math.log10(activationCount + 10);
  const baseFactor = Math.log10(10); // = 1

  // Популярные мемы получают пенальти, непопулярные — буст
  return score / (popularityFactor / baseFactor);
}
```

3. Примени нормализацию при расчёте финального score:

```typescript
const baseScore = TasteProfileService.scoreMemeForUser(profile, { tagNames, categorySlugs });
const freshnessBoost = calculateFreshnessBoost(meme.createdAt);
const activationCount = meme._count?.activations || meme.memeAsset?._count?.activations || 0;

const score = normalizeByPopularity(baseScore * freshnessBoost, activationCount);
```

Примечание: Если в схеме нет прямой связи activations, возможно нужно считать через отдельный запрос или добавить поле activationCount в ChannelMeme/MemeAsset.

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 2.3: Exploration — случайные мемы для discovery

**Уровень:** High

```
Контекст: Система рекомендаций memalerts показывает только мемы которые соответствуют профилю пользователя. Но пользователь может открыть для себя новые интересы если показать ему случайные мемы. Нужно добавить exploration.

Задача: Добавить 10% случайных мемов в рекомендации.

Что сделать:

1. В файле apps/backend/src/controllers/viewer/personalizedMemes.ts добавь функцию перемешивания:

```typescript
function shuffleArray<T>(array: T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

2. Добавь функцию смешивания exploitation и exploration:

```typescript
function mixExploration<T extends { id: string }>(
  personalizedMemes: T[],
  allCandidates: T[],
  limit: number,
  explorationRatio: number = 0.1
): T[] {
  const explorationCount = Math.max(1, Math.floor(limit * explorationRatio));
  const exploitationCount = limit - explorationCount;

  // Берём топ персонализированных (exploitation)
  const exploitation = personalizedMemes.slice(0, exploitationCount);
  const exploitationIds = new Set(exploitation.map(m => m.id));

  // Выбираем случайные из тех, что не попали в exploitation (exploration)
  const unseenCandidates = allCandidates.filter(m => !exploitationIds.has(m.id));
  const exploration = shuffleArray(unseenCandidates).slice(0, explorationCount);

  // Перемешиваем exploration в конец результата (или можно распределить равномерно)
  return [...exploitation, ...exploration];
}
```

3. Примени после diversifyResults:

```typescript
// После diversification:
const diversifiedMemes = diversifyResults(sortedMemes, limit);

// Добавляем exploration:
const finalMemes = mixExploration(
  diversifiedMemes.map(s => s.meme),
  allCandidates, // все кандидаты до scoring
  limit,
  0.1 // 10% exploration
);
```

4. Опционально: сделай explorationRatio настраиваемым через query параметр:
```typescript
const explorationRatio = Math.min(0.3, Math.max(0, parseFloat(req.query.exploration) || 0.1));
```

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 3.1: Item-Item Collaborative Filtering — Схема БД

**Уровень:** Extra High

```
Контекст: Сейчас рекомендации memalerts основаны только на тегах (content-based). Нужно добавить collaborative filtering — рекомендовать мемы на основе того, что активировали другие пользователи с похожими вкусами.

Задача: Создать таблицу для хранения co-occurrence (совместных активаций) мемов.

Что сделать:

1. В файле apps/backend/prisma/schema.prisma добавь новую модель:

```prisma
/// Хранит количество совместных активаций пар мемов
/// Если пользователь активировал мем A и мем B — это co-occurrence
model MemeCooccurrence {
  id            String   @id @default(cuid())

  /// ID первого мема (всегда меньший по алфавиту для уникальности)
  memeAssetId1  String
  memeAsset1    MemeAsset @relation("CooccurrenceMeme1", fields: [memeAssetId1], references: [id], onDelete: Cascade)

  /// ID второго мема
  memeAssetId2  String
  memeAsset2    MemeAsset @relation("CooccurrenceMeme2", fields: [memeAssetId2], references: [id], onDelete: Cascade)

  /// Количество пользователей, активировавших оба мема
  cooccurrences Int      @default(0)

  /// Последнее обновление
  updatedAt     DateTime @updatedAt

  @@unique([memeAssetId1, memeAssetId2])
  @@index([memeAssetId1])
  @@index([memeAssetId2])
  @@index([cooccurrences])
}
```

2. Добавь связи в модель MemeAsset:

```prisma
model MemeAsset {
  // ... существующие поля ...

  /// Co-occurrence связи (этот мем как первый в паре)
  cooccurrencesAs1 MemeCooccurrence[] @relation("CooccurrenceMeme1")
  /// Co-occurrence связи (этот мем как второй в паре)
  cooccurrencesAs2 MemeCooccurrence[] @relation("CooccurrenceMeme2")
}
```

3. Создай миграцию:
```bash
cd apps/backend
npx prisma migrate dev --name add_meme_cooccurrence
```

4. Сгенерируй клиент:
```bash
npx prisma generate
```

После этого можно переходить к задаче 3.2 — расчёту co-occurrence.
```

---

## Задача 3.2: Item-Item Collaborative Filtering — Расчёт co-occurrence

**Уровень:** Extra High

```
Контекст: В предыдущей задаче создана таблица MemeCooccurrence. Теперь нужно написать логику расчёта co-occurrence на основе истории активаций.

Задача: Создать сервис для расчёта и обновления co-occurrence матрицы.

Что сделать:

1. Создай файл apps/backend/src/services/recommendations/CooccurrenceService.ts:

```typescript
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';

export class CooccurrenceService {
  /**
   * Полный пересчёт co-occurrence матрицы
   * Запускать периодически (например, раз в час через cron)
   */
  static async recalculateAll(): Promise<void> {
    logger.info('cooccurrence.recalculate_start');
    const startTime = Date.now();

    // 1. Получить все активации сгруппированные по пользователям
    const userActivations = await prisma.memeActivation.groupBy({
      by: ['userId'],
      _count: true,
      having: {
        userId: {
          _count: {
            gte: 2 // Минимум 2 активации для co-occurrence
          }
        }
      }
    });

    const cooccurrenceMap = new Map<string, number>();

    // 2. Для каждого пользователя найти пары активированных мемов
    for (const { userId } of userActivations) {
      const activations = await prisma.memeActivation.findMany({
        where: { userId, status: 'completed' },
        select: {
          channelMeme: {
            select: { memeAssetId: true }
          }
        },
        orderBy: { createdAt: 'desc' },
        take: 100 // Ограничиваем для производительности
      });

      const memeIds = [...new Set(activations.map(a => a.channelMeme.memeAssetId))];

      // Создаём все пары
      for (let i = 0; i < memeIds.length; i++) {
        for (let j = i + 1; j < memeIds.length; j++) {
          // Сортируем ID для консистентности ключа
          const [id1, id2] = [memeIds[i], memeIds[j]].sort();
          const key = `${id1}:${id2}`;
          cooccurrenceMap.set(key, (cooccurrenceMap.get(key) || 0) + 1);
        }
      }
    }

    // 3. Batch upsert в БД
    const entries = Array.from(cooccurrenceMap.entries());
    const BATCH_SIZE = 500;

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
      const batch = entries.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(([key, count]) => {
        const [memeAssetId1, memeAssetId2] = key.split(':');
        return prisma.memeCooccurrence.upsert({
          where: {
            memeAssetId1_memeAssetId2: { memeAssetId1, memeAssetId2 }
          },
          create: { memeAssetId1, memeAssetId2, cooccurrences: count },
          update: { cooccurrences: count }
        });
      }));
    }

    const duration = Date.now() - startTime;
    logger.info('cooccurrence.recalculate_done', {
      pairs: entries.length,
      users: userActivations.length,
      durationMs: duration
    });
  }

  /**
   * Инкрементальное обновление при новой активации
   */
  static async recordActivation(userId: string, memeAssetId: string): Promise<void> {
    // Получить другие мемы, активированные этим пользователем
    const otherActivations = await prisma.memeActivation.findMany({
      where: {
        userId,
        status: 'completed',
        channelMeme: {
          memeAssetId: { not: memeAssetId }
        }
      },
      select: {
        channelMeme: { select: { memeAssetId: true } }
      },
      take: 50 // Последние 50
    });

    const otherMemeIds = [...new Set(otherActivations.map(a => a.channelMeme.memeAssetId))];

    // Обновить co-occurrence для каждой пары
    await Promise.all(otherMemeIds.map(otherId => {
      const [id1, id2] = [memeAssetId, otherId].sort();
      return prisma.memeCooccurrence.upsert({
        where: {
          memeAssetId1_memeAssetId2: { memeAssetId1: id1, memeAssetId2: id2 }
        },
        create: { memeAssetId1: id1, memeAssetId2: id2, cooccurrences: 1 },
        update: { cooccurrences: { increment: 1 } }
      });
    }));
  }

  /**
   * Получить рекомендации на основе co-occurrence
   */
  static async getRecommendations(
    activatedMemeIds: string[],
    excludeIds: string[],
    limit: number
  ): Promise<Array<{ memeAssetId: string; score: number }>> {
    if (activatedMemeIds.length === 0) return [];

    // Найти co-occurring мемы
    const cooccurrences = await prisma.memeCooccurrence.findMany({
      where: {
        OR: [
          { memeAssetId1: { in: activatedMemeIds }, memeAssetId2: { notIn: excludeIds } },
          { memeAssetId2: { in: activatedMemeIds }, memeAssetId1: { notIn: excludeIds } }
        ]
      },
      orderBy: { cooccurrences: 'desc' },
      take: limit * 3
    });

    // Агрегировать scores
    const scores = new Map<string, number>();

    for (const co of cooccurrences) {
      const targetId = activatedMemeIds.includes(co.memeAssetId1)
        ? co.memeAssetId2
        : co.memeAssetId1;

      if (!excludeIds.includes(targetId)) {
        scores.set(targetId, (scores.get(targetId) || 0) + co.cooccurrences);
      }
    }

    // Топ по score
    return Array.from(scores.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([memeAssetId, score]) => ({ memeAssetId, score }));
  }
}
```

2. Добавь вызов recordActivation в apps/backend/src/services/meme/activateMeme.ts после успешной активации:

```typescript
// После TasteProfileService.recordActivation добавь:
void CooccurrenceService.recordActivation(
  req.userId!,
  result.activation.channelMeme.memeAssetId
).catch(err => logger.warn('cooccurrence.record_failed', { error: err }));
```

3. Создай cron job для периодического пересчёта (или добавь в существующий scheduler):

```typescript
// В файле с cron jobs:
import { CooccurrenceService } from '../services/recommendations/CooccurrenceService';

// Каждый час
cron.schedule('0 * * * *', async () => {
  try {
    await CooccurrenceService.recalculateAll();
  } catch (error) {
    logger.error('cron.cooccurrence_failed', { error });
  }
});
```

После изменений запусти: pnpm --filter @memalerts/backend test
```

---

## Задача 3.3: Hybrid Recommender — объединение подходов

**Уровень:** Extra High

```
Контекст: Теперь есть два источника рекомендаций:
1. Content-based (теги) — TasteProfileService.scoreMemeForUser()
2. Collaborative (co-occurrence) — CooccurrenceService.getRecommendations()

Нужно объединить их в hybrid recommender.

Задача: Создать гибридный алгоритм рекомендаций.

Что сделать:

1. Создай файл apps/backend/src/services/recommendations/HybridRecommender.ts:

```typescript
import { TasteProfileService } from '../taste/TasteProfileService';
import { CooccurrenceService } from './CooccurrenceService';
import { prisma } from '../../prisma';
import { logger } from '../../utils/logger';

interface HybridConfig {
  contentWeight: number;      // Вес content-based (теги)
  collaborativeWeight: number; // Вес collaborative (co-occurrence)
  freshnessWeight: number;    // Вес свежести
  diversityEnabled: boolean;
  explorationRatio: number;
}

const DEFAULT_CONFIG: HybridConfig = {
  contentWeight: 0.5,
  collaborativeWeight: 0.3,
  freshnessWeight: 0.2,
  diversityEnabled: true,
  explorationRatio: 0.1
};

export class HybridRecommender {
  static async getRecommendations(args: {
    userId: string;
    channelId: string;
    limit: number;
    config?: Partial<HybridConfig>;
  }): Promise<string[]> {
    const { userId, channelId, limit } = args;
    const config = { ...DEFAULT_CONFIG, ...args.config };

    logger.info('hybrid_recommender.start', { userId, channelId, limit, config });

    // 1. Загрузить профиль вкусов и историю активаций
    const [tasteProfile, recentActivations] = await Promise.all([
      TasteProfileService.getProfile(userId),
      prisma.memeActivation.findMany({
        where: { userId, status: 'completed' },
        select: { channelMeme: { select: { memeAssetId: true } } },
        orderBy: { createdAt: 'desc' },
        take: 50
      })
    ]);

    const activatedMemeIds = recentActivations.map(a => a.channelMeme.memeAssetId);

    // 2. Загрузить кандидатов (мемы канала)
    const candidates = await prisma.channelMeme.findMany({
      where: {
        channelId,
        status: 'approved',
        deletedAt: null,
        memeAssetId: { notIn: activatedMemeIds } // Исключить уже активированные
      },
      include: {
        memeAsset: {
          select: {
            id: true,
            aiAutoTagNames: true,
            createdAt: true
          }
        },
        tags: {
          include: { tag: { include: { category: true } } }
        }
      },
      take: 200
    });

    // 3. Получить collaborative scores
    const collaborativeScores = await CooccurrenceService.getRecommendations(
      activatedMemeIds,
      [], // не исключаем, просто не учитываем уже активированные
      limit * 2
    );
    const collabMap = new Map(collaborativeScores.map(c => [c.memeAssetId, c.score]));

    // 4. Вычислить hybrid score для каждого кандидата
    const scored = candidates.map(candidate => {
      const memeAssetId = candidate.memeAsset.id;

      // Content-based score
      const tagNames = candidate.memeAsset.aiAutoTagNames || [];
      const categorySlugs = candidate.tags
        .map(t => t.tag.category?.slug)
        .filter(Boolean) as string[];

      const contentScore = tasteProfile
        ? TasteProfileService.scoreMemeForUser(tasteProfile, { tagNames, categorySlugs })
        : 0;

      // Collaborative score (нормализуем)
      const maxCollabScore = Math.max(...collaborativeScores.map(c => c.score), 1);
      const collabScore = (collabMap.get(memeAssetId) || 0) / maxCollabScore;

      // Freshness score
      const daysSinceCreation = (Date.now() - candidate.memeAsset.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      const freshnessScore = Math.max(0, 1 - daysSinceCreation / 30); // 0-1, убывает за 30 дней

      // Hybrid score
      const hybridScore =
        contentScore * config.contentWeight +
        collabScore * config.collaborativeWeight +
        freshnessScore * config.freshnessWeight;

      return {
        memeAssetId,
        channelMemeId: candidate.id,
        score: hybridScore,
        tagNames
      };
    });

    // 5. Сортировка
    scored.sort((a, b) => b.score - a.score);

    // 6. Diversity (если включено)
    let result = scored;
    if (config.diversityEnabled) {
      result = this.diversify(scored, limit);
    }

    // 7. Exploration
    if (config.explorationRatio > 0) {
      result = this.addExploration(result, scored, limit, config.explorationRatio);
    }

    logger.info('hybrid_recommender.done', {
      userId,
      candidates: candidates.length,
      results: result.length
    });

    return result.slice(0, limit).map(r => r.channelMemeId);
  }

  private static diversify<T extends { tagNames: string[] }>(items: T[], limit: number): T[] {
    const MAX_SAME_TAG = 2;
    const result: T[] = [];
    const tagCounts: Record<string, number> = {};

    for (const item of items) {
      if (result.length >= limit * 1.5) break; // Берём с запасом

      const topTag = item.tagNames[0];
      if (topTag && (tagCounts[topTag] || 0) >= MAX_SAME_TAG) continue;

      result.push(item);
      if (topTag) tagCounts[topTag] = (tagCounts[topTag] || 0) + 1;
    }

    return result;
  }

  private static addExploration<T extends { memeAssetId: string }>(
    selected: T[],
    all: T[],
    limit: number,
    ratio: number
  ): T[] {
    const explorationCount = Math.max(1, Math.floor(limit * ratio));
    const exploitationCount = limit - explorationCount;

    const exploitation = selected.slice(0, exploitationCount);
    const selectedIds = new Set(exploitation.map(s => s.memeAssetId));

    const unseen = all.filter(item => !selectedIds.has(item.memeAssetId));
    const shuffled = unseen.sort(() => Math.random() - 0.5);
    const exploration = shuffled.slice(0, explorationCount);

    return [...exploitation, ...exploration];
  }
}
```

2. Обнови контроллер apps/backend/src/controllers/viewer/personalizedMemes.ts чтобы использовать HybridRecommender:

```typescript
import { HybridRecommender } from '../../services/recommendations/HybridRecommender';

// В функции getPersonalizedMemes замени логику scoring на:
const recommendedIds = await HybridRecommender.getRecommendations({
  userId: req.userId!,
  channelId: channel.id,
  limit: query.limit || 20,
  config: {
    // Можно сделать настраиваемым через query params
    contentWeight: 0.5,
    collaborativeWeight: 0.3,
    freshnessWeight: 0.2
  }
});

// Затем загрузи полные данные мемов по IDs
const memes = await prisma.channelMeme.findMany({
  where: { id: { in: recommendedIds } },
  // ... include и select как раньше
});

// Сохрани порядок
const memeMap = new Map(memes.map(m => [m.id, m]));
const orderedMemes = recommendedIds
  .map(id => memeMap.get(id))
  .filter(Boolean);
```

После изменений:
1. pnpm build:contracts (если менялись типы)
2. pnpm --filter @memalerts/backend test
```

---

## Чеклист выполнения

- [ ] 1.1 recordFavorite — лайки влияют на профиль
- [ ] 1.2 Time Decay — старые активации весят меньше
- [ ] 1.3 recordHidden — скрытые мемы понижают веса
- [ ] 1.4 Freshness Boost — новые мемы получают буст
- [ ] 2.1 Diversity — не более 2 мемов с одним тегом
- [ ] 2.2 Popularity Normalization — нормализация популярности
- [ ] 2.3 Exploration — 10% случайных мемов
- [ ] 3.1 MemeCooccurrence schema — таблица co-occurrence
- [ ] 3.2 CooccurrenceService — расчёт co-occurrence
- [ ] 3.3 HybridRecommender — гибридный алгоритм

---

*Создано: 2026-01-28*
