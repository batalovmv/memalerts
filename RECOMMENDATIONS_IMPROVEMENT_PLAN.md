# План улучшения системы рекомендаций MemAlerts

> **Для:** AI-ассистента (Codex/Claude)
> **Проект:** memalerts-monorepo
> **Цель:** Улучшить качество персонализированных рекомендаций мемов

---

## Контекст проекта

**MemAlerts** — платформа для активации мемов на стримах. Пользователи тратят channel points/монеты чтобы показать мем на стриме.

### Ключевые сущности:
- **MemeAsset** — глобальный медиафайл мема с AI-тегами
- **ChannelMeme** — мем, добавленный на конкретный канал стримера
- **MemeActivation** — запись об активации мема пользователем
- **UserTasteProfile** — профиль вкусов пользователя (веса тегов)
- **UserMemeFavorite** — избранные мемы пользователя
- **UserMemeBlocklist** — скрытые мемы пользователя

### Текущий алгоритм рекомендаций:
```
score = Σ(tagWeights[tag]) + 0.5 * Σ(categoryWeights[category])
```
Веса увеличиваются на +1 при каждой активации мема с этим тегом.

---

## Проблемы текущей системы

| # | Проблема | Влияние |
|---|----------|---------|
| 1 | Лайки/избранное НЕ влияют на рекомендации | Теряем явный сигнал интереса |
| 2 | Нет time decay — старые активации весят как новые | Устаревшие предпочтения |
| 3 | Скрытые мемы не влияют на профиль (negative signal) | Не учимся на негативе |
| 4 | Нет diversity — много похожих мемов подряд | Плохой UX |
| 5 | Popularity bias — популярные мемы доминируют | Filter bubble |
| 6 | Cold start — новые мемы не попадают в рекомендации | Нет exploration |

---

## Фаза 1: Quick Wins

### Задача 1.1: Учитывать лайки (избранное) в профиле вкусов

**Файлы для изменения:**
- `apps/backend/src/services/taste/TasteProfileService.ts`
- `apps/backend/src/controllers/viewer/memeLists.ts`

**Что сделать:**

1. В `TasteProfileService.ts` добавить метод `recordFavorite()`:
```typescript
async recordFavorite(args: { userId: string; memeAssetId: string }): Promise<void> {
  // 1. Получить теги мема (aiAutoTagNames из MemeAsset)
  // 2. Вызвать updateProfileWeights с weight = 0.5 (половина от активации)
}
```

2. В `memeLists.ts` в функции `addFavorite()` вызывать:
```typescript
void TasteProfileService.recordFavorite({
  userId: req.userId!,
  memeAssetId,
}).catch(err => logger.warn('taste_profile.favorite_failed', { error: err }));
```

**Критерий успеха:** После добавления мема в избранное, его теги влияют на профиль вкусов.

---

### Задача 1.2: Реализовать Time Decay

**Файлы для изменения:**
- `apps/backend/src/services/taste/TasteProfileService.ts`
- `apps/backend/prisma/schema.prisma` (возможно)

**Что сделать:**

1. Изменить структуру хранения весов — вместо простого числа хранить с timestamp:
```typescript
// Вариант A: Хранить lastUpdatedAt для каждого тега
tagWeightsJson: {
  "gaming": { weight: 5, lastUpdatedAt: "2024-01-15T..." },
  "anime": { weight: 3, lastUpdatedAt: "2024-01-10T..." }
}

// Вариант B (проще): Применять decay при расчёте score
```

2. В методе `scoreMemeForUser()` применять decay:
```typescript
const DECAY_HALF_LIFE_DAYS = 30; // Вес уменьшается вдвое за 30 дней

function applyTimeDecay(weight: number, lastActivityAt: Date): number {
  const daysSince = (Date.now() - lastActivityAt.getTime()) / (1000 * 60 * 60 * 24);
  const decayFactor = Math.pow(0.5, daysSince / DECAY_HALF_LIFE_DAYS);
  return weight * decayFactor;
}
```

**Рекомендация:** Начать с Варианта B (decay при scoring) — проще реализовать и не требует миграции данных.

**Критерий успеха:** Недавние активации влияют на рекомендации сильнее, чем старые.

---

### Задача 1.3: Negative Signals (скрытые мемы)

**Файлы для изменения:**
- `apps/backend/src/services/taste/TasteProfileService.ts`
- `apps/backend/src/controllers/viewer/memeLists.ts`

**Что сделать:**

1. Добавить метод `recordHidden()` в TasteProfileService:
```typescript
async recordHidden(args: { userId: string; memeAssetId: string }): Promise<void> {
  // 1. Получить теги мема
  // 2. Уменьшить веса тегов на -0.3 (или другой коэффициент)
  // 3. Не допускать отрицательных весов (Math.max(0, newWeight))
}
```

2. В `addHidden()` контроллера вызывать recordHidden.

**Критерий успеха:** После скрытия мема, мемы с похожими тегами понижаются в рекомендациях.

---

### Задача 1.4: Boost свежести (Freshness)

**Файлы для изменения:**
- `apps/backend/src/controllers/viewer/personalizedMemes.ts`

**Что сделать:**

В scoring добавить бонус за свежесть:
```typescript
function calculateFreshnessBoost(createdAt: Date): number {
  const daysSinceCreation = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);

  if (daysSinceCreation < 1) return 2.0;   // Новый мем — двойной буст
  if (daysSinceCreation < 7) return 1.5;   // Неделя — 1.5x
  if (daysSinceCreation < 30) return 1.2;  // Месяц — 1.2x
  return 1.0;                               // Старше — без буста
}

// В scoring:
const baseScore = TasteProfileService.scoreMemeForUser(profile, { tagNames, categorySlugs });
const freshnessBoost = calculateFreshnessBoost(meme.createdAt);
const finalScore = baseScore * freshnessBoost;
```

**Критерий успеха:** Новые мемы чаще появляются в рекомендациях.

---

## Фаза 2: Улучшенный Scoring

### Задача 2.1: Diversity (разнообразие)

**Файлы для изменения:**
- `apps/backend/src/controllers/viewer/personalizedMemes.ts`

**Что сделать:**

После сортировки по score применить diversification:
```typescript
function diversifyResults(memes: ScoredMeme[], limit: number): ScoredMeme[] {
  const result: ScoredMeme[] = [];
  const tagCounts: Record<string, number> = {};
  const MAX_SAME_TAG = 2; // Максимум 2 мема с одинаковым топ-тегом подряд

  for (const meme of memes) {
    if (result.length >= limit) break;

    const topTag = meme.tagNames[0];
    if (topTag && (tagCounts[topTag] || 0) >= MAX_SAME_TAG) {
      continue; // Пропускаем, слишком много с этим тегом
    }

    result.push(meme);
    if (topTag) tagCounts[topTag] = (tagCounts[topTag] || 0) + 1;
  }

  // Если не набрали limit — добавляем оставшиеся
  if (result.length < limit) {
    for (const meme of memes) {
      if (result.length >= limit) break;
      if (!result.includes(meme)) result.push(meme);
    }
  }

  return result;
}
```

**Критерий успеха:** В топ-10 рекомендаций нет более 2-3 мемов с одинаковым тегом.

---

### Задача 2.2: Popularity Normalization

**Файлы для изменения:**
- `apps/backend/src/controllers/viewer/personalizedMemes.ts`

**Что сделать:**

Нормализовать score на популярность мема:
```typescript
function normalizeByPopularity(score: number, totalActivations: number): number {
  // Логарифмическая нормализация чтобы популярные мемы не доминировали
  const popularityPenalty = Math.log10(totalActivations + 10) / Math.log10(10);
  return score / popularityPenalty;
}
```

**Примечание:** Требуется добавить поле `activationCount` к ChannelMeme или считать через агрегацию.

---

### Задача 2.3: Exploration vs Exploitation

**Что сделать:**

Добавить случайный элемент для discovery новых мемов:
```typescript
const EXPLORATION_RATIO = 0.1; // 10% случайных мемов

function mixExploration(personalizedMemes: Meme[], allMemes: Meme[], limit: number): Meme[] {
  const explorationCount = Math.floor(limit * EXPLORATION_RATIO);
  const exploitationCount = limit - explorationCount;

  // Берём топ персонализированных
  const exploitation = personalizedMemes.slice(0, exploitationCount);

  // Добавляем случайные мемы которых нет в персонализированных
  const unseenMemes = allMemes.filter(m => !personalizedMemes.includes(m));
  const exploration = shuffleArray(unseenMemes).slice(0, explorationCount);

  return shuffleArray([...exploitation, ...exploration]);
}
```

---

## Фаза 3: Collaborative Filtering (Advanced)

### Задача 3.1: Item-Item Collaborative Filtering

**Концепция:** "Пользователи, которые активировали мем A, также активировали мем B"

**Новые таблицы в Prisma:**
```prisma
model MemeCooccurrence {
  id            String   @id @default(cuid())
  memeAssetId1  String
  memeAssetId2  String
  cooccurrences Int      @default(0)
  updatedAt     DateTime @updatedAt

  @@unique([memeAssetId1, memeAssetId2])
  @@index([memeAssetId1])
}
```

**Алгоритм:**
1. Периодически (cron job) пересчитывать co-occurrence матрицу
2. При рекомендациях: для каждого активированного мема найти топ co-occurring мемы
3. Комбинировать с content-based scoring

**Реализация:**
```typescript
async function getCollaborativeRecommendations(
  userId: string,
  limit: number
): Promise<string[]> {
  // 1. Получить последние N активаций пользователя
  const recentActivations = await prisma.memeActivation.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { channelMeme: { select: { memeAssetId: true } } }
  });

  const activatedMemeIds = recentActivations.map(a => a.channelMeme.memeAssetId);

  // 2. Найти co-occurring мемы
  const cooccurrences = await prisma.memeCooccurrence.findMany({
    where: {
      memeAssetId1: { in: activatedMemeIds },
      memeAssetId2: { notIn: activatedMemeIds } // Исключить уже активированные
    },
    orderBy: { cooccurrences: 'desc' },
    take: limit * 2
  });

  // 3. Агрегировать scores
  const scores: Record<string, number> = {};
  for (const co of cooccurrences) {
    scores[co.memeAssetId2] = (scores[co.memeAssetId2] || 0) + co.cooccurrences;
  }

  // 4. Вернуть топ
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([memeId]) => memeId);
}
```

---

### Задача 3.2: Hybrid Recommender

Комбинировать content-based и collaborative:
```typescript
async function getHybridRecommendations(
  userId: string,
  channelId: string,
  limit: number
): Promise<Meme[]> {
  const CONTENT_WEIGHT = 0.6;
  const COLLAB_WEIGHT = 0.4;

  // Параллельно получаем оба типа рекомендаций
  const [contentBased, collaborative] = await Promise.all([
    getContentBasedRecommendations(userId, channelId, limit * 2),
    getCollaborativeRecommendations(userId, limit * 2)
  ]);

  // Нормализуем scores к 0-1
  const normalizedContent = normalizeScores(contentBased);
  const normalizedCollab = normalizeScores(collaborative);

  // Комбинируем
  const combined: Record<string, number> = {};
  for (const [memeId, score] of Object.entries(normalizedContent)) {
    combined[memeId] = (combined[memeId] || 0) + score * CONTENT_WEIGHT;
  }
  for (const [memeId, score] of Object.entries(normalizedCollab)) {
    combined[memeId] = (combined[memeId] || 0) + score * COLLAB_WEIGHT;
  }

  // Топ результаты
  const topMemeIds = Object.entries(combined)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([memeId]) => memeId);

  return fetchMemesByIds(topMemeIds);
}
```

---

## Порядок выполнения

```
Фаза 1 (Quick Wins) — 1-2 дня
├── 1.1 Учитывать лайки ✓
├── 1.2 Time Decay ✓
├── 1.3 Negative Signals ✓
└── 1.4 Freshness Boost ✓

Фаза 2 (Улучшенный Scoring) — 2-3 дня
├── 2.1 Diversity ✓
├── 2.2 Popularity Normalization ✓
└── 2.3 Exploration/Exploitation ✓

Фаза 3 (Collaborative Filtering) — 3-5 дней
├── 3.1 Item-Item CF ✓
└── 3.2 Hybrid Recommender ✓
```

---

## Ключевые файлы проекта

| Файл | Назначение |
|------|------------|
| `apps/backend/src/services/taste/TasteProfileService.ts` | Сервис профиля вкусов — ОСНОВНОЙ файл для изменений |
| `apps/backend/src/controllers/viewer/personalizedMemes.ts` | Контроллер рекомендаций — scoring и выбор мемов |
| `apps/backend/src/controllers/viewer/memeLists.ts` | Контроллеры избранного/скрытого |
| `apps/backend/src/controllers/viewer/memeViewerState.ts` | Состояние видимости мемов |
| `apps/backend/src/services/meme/activateMeme.ts` | Активация мема — вызывает recordActivation |
| `apps/backend/prisma/schema.prisma` | Схема БД |
| `packages/api-contracts/src/` | Типы API (если нужно менять ответы) |

---

## Важные правила проекта

1. **Типы только из `@memalerts/api-contracts`** — не создавать локальные DTO
2. **После изменения типов:** `pnpm build:contracts`
3. **После изменения Prisma schema:** `npx prisma migrate dev --name описание`
4. **Тесты:** `pnpm --filter @memalerts/backend test`
5. **Не удалять legacy код** в `controllers/`, `routes/`, `services/`

---

## Метрики успеха

Как измерить что рекомендации стали лучше:

1. **CTR (Click-Through Rate)** — % мемов из "для тебя" которые активируют
2. **Diversity Score** — среднее количество уникальных тегов в топ-10
3. **Coverage** — % всех мемов которые хоть раз попали в рекомендации
4. **User Satisfaction** — опрос/рейтинг от пользователей

---

*Создано: 2026-01-28*
