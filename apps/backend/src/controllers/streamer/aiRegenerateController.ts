import type { Response } from 'express';
import type { Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { enqueueAiModerationJob } from '../../queues/aiModerationQueue.js';

function parseNonNegativeInt(n: unknown): number | null {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
}

function normalizeAiText(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”«»"]/g, '')
    .trim();
}

/**
 * Frontend sometimes auto-fills placeholder values (e.g. "Мем") which should not block AI re-run.
 * We treat those placeholders as "effectively empty" here for backward-compatible UX.
 */
function isEffectivelyEmptyAiDescription(descRaw: unknown, titleRaw: unknown): boolean {
  const desc = normalizeAiText(String(descRaw ?? ''));
  if (!desc) return true;

  // Common case: UI auto-fills description with the same text as title (including when title defaults to "Мем").
  const title = normalizeAiText(String(titleRaw ?? ''));
  if (title && desc === title) return true;

  // Known placeholders from UI / legacy.
  const placeholders = new Set([
    'мем',
    'meme',
    'ai tags',
    'ai tag',
    'tags',
    'теги',
    'описание',
    'description',
    'ai description',
  ]);
  if (placeholders.has(desc)) return true;

  // Some UIs render multi-line templates; after whitespace normalization it becomes a single line.
  if (desc === 'мем ai tags мем' || desc === 'meme ai tags meme') return true;

  return false;
}

export const aiRegenerateController = {
  regenerate: async (req: AuthRequest, res: Response) => {
    const channelId = req.channelId;
    const userId = req.userId;
    const channelMemeId = String(req.params.id || '').trim();

    if (!channelId || !userId) {
      return res.status(401).json({ errorCode: 'UNAUTHORIZED', error: 'Unauthorized' });
    }
    if (!channelMemeId) {
      return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'id' } });
    }

    const cm = await prisma.channelMeme.findFirst({
      where: { id: channelMemeId, channelId },
      select: {
        id: true,
        channelId: true,
        memeAssetId: true,
        title: true,
        createdAt: true,
        aiAutoDescription: true,
        memeAsset: {
          select: {
            id: true,
            type: true,
            fileUrl: true,
            fileHash: true,
            durationMs: true,
          },
        },
      },
    });

    if (!cm) {
      return res.status(404).json({
        errorCode: 'CHANNEL_MEME_NOT_FOUND',
        error: 'Meme not found',
        details: { entity: 'channelMeme', id: channelMemeId },
      });
    }

    if (!isEffectivelyEmptyAiDescription(cm.aiAutoDescription, cm.title)) {
      return res.status(400).json({
        errorCode: 'AI_REGENERATE_NOT_ALLOWED',
        error: 'AI regenerate is allowed only when aiAutoDescription is empty',
        details: { reason: 'description_already_present' },
      });
    }

    const nowMs = Date.now();
    const minAgeMs = 5 * 60_000;
    const ageMs = nowMs - new Date(cm.createdAt).getTime();
    if (!Number.isFinite(ageMs) || ageMs < minAgeMs) {
      const retryAfterSeconds = Math.max(1, Math.ceil((minAgeMs - Math.max(0, ageMs)) / 1000));
      return res.status(400).json({
        errorCode: 'AI_REGENERATE_TOO_SOON',
        error: 'Too soon to regenerate AI',
        retryAfterSeconds,
        details: { minAgeSeconds: Math.floor(minAgeMs / 1000) },
      });
    }

    const cooldownMs = 10 * 60_000;
    const last = await prisma.memeSubmission.findFirst({
      where: {
        channelId,
        memeAssetId: cm.memeAssetId,
        sourceKind: { in: ['upload', 'url'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, createdAt: true, aiLastTriedAt: true },
    });

    if (last) {
      const lastTryMs = Math.max(
        new Date(last.createdAt).getTime(),
        last.aiLastTriedAt ? new Date(last.aiLastTriedAt).getTime() : 0
      );
      if (nowMs - lastTryMs < cooldownMs) {
        const retryAfterSeconds = Math.max(1, Math.ceil((cooldownMs - (nowMs - lastTryMs)) / 1000));
        return res.status(429).json({
          errorCode: 'AI_REGENERATE_COOLDOWN',
          error: 'Cooldown not elapsed',
          retryAfterSeconds,
          details: { cooldownSeconds: Math.floor(cooldownMs / 1000) },
        });
      }
    }

    const fileUrl = String(cm.memeAsset?.fileUrl ?? '').trim();
    if (!fileUrl) {
      return res.status(400).json({
        errorCode: 'AI_REGENERATE_NOT_ALLOWED',
        error: 'Cannot regenerate AI for meme without fileUrl',
        details: { reason: 'missing_file_url', memeAssetId: cm.memeAssetId },
      });
    }

    const sourceKind = fileUrl.startsWith('/uploads/') ? 'upload' : 'url';
    const durationMs = parseNonNegativeInt(cm.memeAsset?.durationMs);

    const submission = await prisma.memeSubmission.create({
      data: {
        channelId: String(channelId),
        submitterUserId: String(userId),
        title: String(cm.title || 'Meme').slice(0, 200),
        type: String(cm.memeAsset?.type || 'video'),
        fileUrlTemp: fileUrl,
        sourceKind,
        status: 'approved',
        memeAssetId: cm.memeAssetId,
        fileHash: cm.memeAsset?.fileHash ?? null,
        durationMs: durationMs && durationMs > 0 ? durationMs : null,
        aiStatus: 'pending',
      } satisfies Prisma.MemeSubmissionUncheckedCreateInput,
      select: { id: true, createdAt: true },
    });
    logger.info('ai.enqueue', { submissionId: submission.id, reason: 'ai_regenerate' });
    void enqueueAiModerationJob(submission.id, { reason: 'ai_regenerate' });

    const queuedAt = new Date(submission.createdAt).toISOString();
    const nextAllowedAt = new Date(nowMs + cooldownMs).toISOString();

    return res.status(202).json({
      submissionId: submission.id,
      queuedAt,
      nextAllowedAt,
    });
  },
};
