import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';

const COMPLETED_STATUSES = ['done', 'completed'] as const;

export class CooccurrenceService {
  /**
   * Полный пересчёт co-occurrence матрицы
   * Запускать периодически (например, раз в час через cron)
   */
  static async recalculateAll(): Promise<void> {
    logger.info('cooccurrence.recalculate_start');
    const startTime = Date.now();

    // 1. Получить все активации сгруппированные по пользователям
    // Prisma 5 requires specific field for _count in having, using id to count rows
    const userActivations = await prisma.memeActivation.groupBy({
      by: ['userId'],
      where: {
        status: { in: [...COMPLETED_STATUSES] },
      },
      _count: { id: true },
      having: {
        id: {
          _count: {
            gte: 2, // Минимум 2 активации для co-occurrence
          },
        },
      },
    });

    const cooccurrenceMap = new Map<string, number>();

    // 2. Для каждого пользователя найти пары активированных мемов
    for (const { userId } of userActivations) {
      const activations = await prisma.memeActivation.findMany({
        where: {
          userId,
          status: { in: [...COMPLETED_STATUSES] },
        },
        select: {
          channelMeme: {
            select: { memeAssetId: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 100, // Ограничиваем для производительности
      });

      const memeIds = Array.from(
        new Set(activations.map((activation) => activation.channelMeme.memeAssetId).filter(Boolean))
      );

      if (memeIds.length < 2) continue;

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

      await Promise.all(
        batch.map(([key, count]) => {
          const [memeAssetId1, memeAssetId2] = key.split(':');
          return prisma.memeCooccurrence.upsert({
            where: {
              memeAssetId1_memeAssetId2: { memeAssetId1, memeAssetId2 },
            },
            create: { memeAssetId1, memeAssetId2, cooccurrences: count },
            update: { cooccurrences: count },
          });
        })
      );
    }

    const duration = Date.now() - startTime;
    logger.info('cooccurrence.recalculate_done', {
      pairs: entries.length,
      users: userActivations.length,
      durationMs: duration,
    });
  }

  /**
   * Инкрементальное обновление при новой активации
   */
  static async recordActivation(userId: string, memeAssetId: string): Promise<void> {
    if (!userId || !memeAssetId) return;

    // Получить другие мемы, активированные этим пользователем
    const otherActivations = await prisma.memeActivation.findMany({
      where: {
        userId,
        status: { in: [...COMPLETED_STATUSES] },
        channelMeme: {
          memeAssetId: { not: memeAssetId },
        },
      },
      select: {
        channelMeme: { select: { memeAssetId: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 50, // Последние 50
    });

    const otherMemeIds = Array.from(
      new Set(otherActivations.map((activation) => activation.channelMeme.memeAssetId).filter(Boolean))
    );

    // Обновить co-occurrence для каждой пары
    await Promise.all(
      otherMemeIds.map((otherId) => {
        const [id1, id2] = [memeAssetId, otherId].sort();
        return prisma.memeCooccurrence.upsert({
          where: {
            memeAssetId1_memeAssetId2: { memeAssetId1: id1, memeAssetId2: id2 },
          },
          create: { memeAssetId1: id1, memeAssetId2: id2, cooccurrences: 1 },
          update: { cooccurrences: { increment: 1 } },
        });
      })
    );
  }

  /**
   * Получить рекомендации на основе co-occurrence
   */
  static async getRecommendations(
    activatedMemeIds: string[],
    excludeIds: string[],
    limit: number
  ): Promise<Array<{ memeAssetId: string; score: number }>> {
    if (!Array.isArray(activatedMemeIds) || activatedMemeIds.length === 0 || limit <= 0) return [];

    const activatedSet = new Set(activatedMemeIds);
    const excludeSet = new Set(excludeIds || []);

    // Найти co-occurring мемы
    const cooccurrences = await prisma.memeCooccurrence.findMany({
      where: {
        OR: [
          { memeAssetId1: { in: activatedMemeIds }, memeAssetId2: { notIn: excludeIds } },
          { memeAssetId2: { in: activatedMemeIds }, memeAssetId1: { notIn: excludeIds } },
        ],
      },
      orderBy: { cooccurrences: 'desc' },
      take: limit * 3,
    });

    // Агрегировать scores
    const scores = new Map<string, number>();

    for (const co of cooccurrences) {
      const targetId = activatedSet.has(co.memeAssetId1) ? co.memeAssetId2 : co.memeAssetId1;

      if (!excludeSet.has(targetId) && !activatedSet.has(targetId)) {
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
