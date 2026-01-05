import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';

function parseNonNegativeInt(n: any): number | null {
  const v = typeof n === 'number' ? n : typeof n === 'string' ? parseInt(n, 10) : NaN;
  if (!Number.isFinite(v) || v < 0) return null;
  return v;
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
      return res
        .status(404)
        .json({ errorCode: 'CHANNEL_MEME_NOT_FOUND', error: 'Meme not found', details: { entity: 'channelMeme', id: channelMemeId } });
    }

    const existingDesc = String(cm.aiAutoDescription ?? '').trim();
    if (existingDesc) {
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
      const lastTryMs = Math.max(new Date(last.createdAt).getTime(), last.aiLastTriedAt ? new Date(last.aiLastTriedAt).getTime() : 0);
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
      } as any,
      select: { id: true, createdAt: true },
    });

    const queuedAt = new Date(submission.createdAt).toISOString();
    const nextAllowedAt = new Date(nowMs + cooldownMs).toISOString();

    return res.status(202).json({
      submissionId: submission.id,
      queuedAt,
      nextAllowedAt,
    });
  },
};



