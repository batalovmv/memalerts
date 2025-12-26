import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { createPoolSubmissionSchema } from '../../shared/index.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';

export const createPoolSubmission = async (req: AuthRequest, res: Response) => {
  if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });

  const body = createPoolSubmissionSchema.parse(req.body);

  // NOTE: For pool-import we intentionally do NOT enforce:
  // - channel.submissionsEnabled
  // - channel.submissionsOnlyWhenLive
  // User can submit anytime; streamer approves later.

  const channel = await prisma.channel.findUnique({
    where: { id: body.channelId },
    select: {
      id: true,
      slug: true,
      users: { where: { role: 'streamer' }, take: 1, select: { id: true } },
    },
  });
  if (!channel) return res.status(404).json({ error: 'Channel not found' });

  const asset = await prisma.memeAsset.findUnique({
    where: { id: body.memeAssetId },
    select: { id: true, purgedAt: true },
  });
  if (!asset || asset.purgedAt) return res.status(404).json({ error: 'Meme asset not found' });

  // If already adopted in this channel -> error for frontend handling.
  const existing = await prisma.channelMeme.findUnique({
    where: { channelId_memeAssetId: { channelId: body.channelId, memeAssetId: body.memeAssetId } },
    select: { id: true, deletedAt: true, status: true },
  });
  if (existing && !existing.deletedAt) {
    return res.status(409).json({ error: 'ALREADY_IN_CHANNEL' });
  }

  // Create submission request referencing the asset.
  const created = await prisma.memeSubmission.create({
    data: {
      channelId: body.channelId,
      submitterUserId: req.userId,
      title: body.title,
      type: 'video',
      // Not used for pool submissions, but keep non-null for legacy back-compat.
      fileUrlTemp: '',
      notes: body.notes || null,
      status: 'pending',
      sourceKind: 'pool',
      memeAssetId: body.memeAssetId,
    } as any,
  });

  // Tags: use existing helper semantics (createSubmission/importMeme) by resolving tag ids.
  // We keep this separate to stay compatible with deployments that might miss MemeSubmissionTag table.
  if (Array.isArray(body.tags) && body.tags.length > 0) {
    try {
      const { getOrCreateTags } = await import('../../utils/tags.js');
      const tagIds = await getOrCreateTags(body.tags);
      if (tagIds.length > 0) {
        await prisma.memeSubmissionTag.createMany({
          data: tagIds.map((tagId) => ({ submissionId: created.id, tagId })),
          skipDuplicates: true,
        });
      }
    } catch (e: any) {
      // Back-compat: MemeSubmissionTag might not exist.
      if (!(e?.code === 'P2021' && e?.meta?.table === 'public.MemeSubmissionTag')) {
        console.warn('[createPoolSubmission] tags attach failed (ignored):', e?.message);
      }
    }
  }

  // Emit Socket.IO event for new submission (same as createSubmission)
  try {
    const io: Server = req.app.get('io');
    const channelSlug = String(channel.slug || '').toLowerCase();
    const streamerUserId = (channel as any).users?.[0]?.id;
    const evt = {
      event: 'submission:created' as const,
      submissionId: created.id,
      channelId: body.channelId,
      channelSlug,
      submitterId: req.userId,
      userIds: streamerUserId ? [streamerUserId] : undefined,
      source: 'local' as const,
    };
    emitSubmissionEvent(io, evt);
    void relaySubmissionEventToPeer(evt);
  } catch {
    // ignore
  }

  return res.status(201).json(created);
};


