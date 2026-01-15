import type { Response } from 'express';
import type { Meme, Prisma } from '@prisma/client';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { createPoolSubmissionSchema } from '../../shared/schemas.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { logger } from '../../utils/logger.js';
import { maybeFailDualWrite } from '../../utils/dualWriteTestHooks.js';
import { ZodError } from 'zod';

export const createPoolSubmission = async (req: AuthRequest, res: Response) => {
  const startedAt = Date.now();
  const requestId = req.requestId;
  const userId = req.userId;
  const verboseStages = (() => {
    const raw = String(process.env.DEBUG_LOGS || '').toLowerCase();
    const debugFlag = raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
    // Default to verbose on beta to speed up incident debugging without touching envs.
    const isBetaInstance =
      String(process.env.PORT || '') === '3002' ||
      String(process.env.INSTANCE || '').toLowerCase() === 'beta' ||
      String(process.env.DOMAIN || '').includes('beta.');
    return debugFlag || isBetaInstance;
  })();
  const stageLog = (event: string, meta: Record<string, unknown>) => {
    // Keep detailed stage logs opt-in to avoid spamming production logs.
    (verboseStages ? logger.info : logger.debug)(event, meta);
  };

  stageLog('submission.pool.start', {
    requestId,
    userId: userId || null,
    bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body as Record<string, unknown>) : null,
  });

  if (!userId) {
    stageLog('submission.pool.after_auth', { requestId, ok: false });
    return res.status(401).json({ error: 'Unauthorized', requestId });
  }
  stageLog('submission.pool.after_auth', { requestId, ok: true, userId });

  try {
    const parsed = createPoolSubmissionSchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('submission.pool.validation_failed', {
        requestId,
        userId,
        issues: parsed.error.issues,
      });
      return res.status(400).json({
        error: 'Validation error',
        message: 'Validation failed',
        details: parsed.error.issues,
        requestId,
      });
    }
    const body = parsed.data;
    stageLog('submission.pool.after_parse', {
      requestId,
      userId,
      channelId: body.channelId,
      memeAssetId: body.memeAssetId,
      hasTitle: typeof (body as Record<string, unknown>).title === 'string'
        ? String((body as Record<string, unknown>).title).trim().length > 0
        : false,
      hasNotes: !!body.notes,
      tagsCount: Array.isArray(body.tags) ? body.tags.length : null,
    });

    // NOTE: For pool-import we intentionally do NOT enforce:
    // - channel.submissionsEnabled
    // - channel.submissionsOnlyWhenLive
    // User can submit anytime; streamer approves later.

    const channel = await prisma.channel.findUnique({
      where: { id: body.channelId },
      select: {
        id: true,
        slug: true,
        defaultPriceCoins: true,
        users: { where: { role: 'streamer' }, take: 1, select: { id: true } },
      },
    });
    stageLog('submission.pool.after_channel_lookup', {
      requestId,
      userId,
      found: !!channel,
      durationMs: Date.now() - startedAt,
    });
    if (!channel) return res.status(404).json({ errorCode: 'NOT_FOUND', error: 'Not found', requestId });

    const asset = await prisma.memeAsset.findUnique({
      where: { id: body.memeAssetId },
      select: {
        id: true,
        type: true,
        fileUrl: true,
        fileHash: true,
        durationMs: true,
        aiStatus: true,
        aiAutoTitle: true,
        aiAutoDescription: true,
        aiAutoTagNamesJson: true,
        aiSearchText: true,
        poolVisibility: true,
        purgeRequestedAt: true,
        purgedAt: true,
      },
    });
    stageLog('submission.pool.after_asset_lookup', {
      requestId,
      userId,
      found: !!asset,
      purged: !!asset?.purgedAt,
      durationMs: Date.now() - startedAt,
    });
    // Safety: prevent adopting hidden/quarantined/purged assets even if caller knows the id.
    if (!asset || asset.purgedAt || asset.purgeRequestedAt || asset.poolVisibility !== 'visible') {
      return res.status(404).json({ errorCode: 'MEME_ASSET_NOT_FOUND', error: 'Meme asset not found', requestId });
    }
    const assetFileUrl = asset.fileUrl;
    if (!assetFileUrl)
      return res.status(404).json({ errorCode: 'MEME_ASSET_NOT_FOUND', error: 'Meme asset not found', requestId });

    const titleInput =
      typeof (body as Record<string, unknown>).title === 'string'
        ? String((body as Record<string, unknown>).title).trim()
        : '';
    // If user omitted title, use asset AI title if available; otherwise fallback placeholder.
    const finalTitle = titleInput || (asset.aiAutoTitle ? String(asset.aiAutoTitle).slice(0, 80) : 'Мем');

    // If already adopted in this channel -> error for frontend handling.
    const existing = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: body.channelId, memeAssetId: body.memeAssetId } },
      select: { id: true, deletedAt: true, status: true },
    });
    stageLog('submission.pool.after_already_in_channel_check', {
      requestId,
      userId,
      exists: !!existing,
      deletedAt: existing?.deletedAt ? true : false,
      status: existing?.status || null,
      durationMs: Date.now() - startedAt,
    });
    if (existing && !existing.deletedAt) {
      return res.status(409).json({
        errorCode: 'ALREADY_IN_CHANNEL',
        error: 'This meme is already in your channel',
        requestId,
      });
    }

    // Owner bypass: if the authenticated user is the streamer/admin for this channel, adopt immediately (no submission).
    // IMPORTANT: based on JWT channelId to prevent cross-channel bypass.
    const isOwner =
      !!req.userId &&
      !!req.channelId &&
      (req.userRole === 'streamer' || req.userRole === 'admin') &&
      String(req.channelId) === String(body.channelId);
    if (isOwner) {
      const defaultPrice = channel.defaultPriceCoins ?? 100;
      const now = new Date();

      const aiDescription = asset.aiStatus === 'done' ? (asset.aiAutoDescription ?? null) : null;
      const aiTagsJson =
        asset.aiStatus === 'done' && Array.isArray(asset.aiAutoTagNamesJson) ? asset.aiAutoTagNamesJson : null;
      const aiSearchText =
        asset.aiStatus === 'done'
          ? (asset.aiSearchText ?? (aiDescription ? String(aiDescription).slice(0, 4000) : null))
          : null;
      // ChannelMeme.title is channel-scoped and editable. Use user title when provided; otherwise prefer AI title for convenience.

      const { cm, legacy } = await prisma.$transaction(async (tx) => {
        const cm = await tx.channelMeme.upsert({
          where: { channelId_memeAssetId: { channelId: body.channelId, memeAssetId: asset.id } },
          create: {
            channelId: body.channelId,
            memeAssetId: asset.id,
            status: 'approved',
            title: finalTitle,
            searchText: aiSearchText,
            aiAutoDescription: aiDescription,
          aiAutoTagNamesJson: aiTagsJson ?? undefined,
            priceCoins: defaultPrice,
            addedByUserId: userId,
            approvedByUserId: userId,
            approvedAt: now,
          },
          update: {
            status: 'approved',
            deletedAt: null,
            title: finalTitle,
            searchText: aiSearchText,
            aiAutoDescription: aiDescription,
            aiAutoTagNamesJson: aiTagsJson ?? undefined,
            priceCoins: defaultPrice,
            approvedByUserId: userId,
            approvedAt: now,
          },
        });

        // Back-compat: keep legacy Meme row in sync.
        // Bugfix: if we restored ChannelMeme but legacy Meme was previously soft-deleted, the response must NOT return deletedAt/status=deleted.
        const legacyData: Prisma.MemeUncheckedCreateInput = {
          channelId: body.channelId,
          title: finalTitle,
          type: asset.type,
          fileUrl: assetFileUrl,
          fileHash: asset.fileHash,
          durationMs: asset.durationMs,
          priceCoins: defaultPrice,
          status: 'approved',
          deletedAt: null,
          createdByUserId: userId,
          approvedByUserId: userId,
        };

        let legacy: Meme | null = null;
        if (cm.legacyMemeId) {
          try {
            legacy = await tx.meme.update({
              where: { id: cm.legacyMemeId },
              data: legacyData,
            });
          } catch (error: unknown) {
            const errorCode =
              typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
            if (errorCode === 'P2025') {
              legacy = await tx.meme.create({ data: legacyData });
              await tx.channelMeme.update({
                where: { id: cm.id },
                data: { legacyMemeId: legacy.id },
              });
            } else {
              throw error;
            }
          }
        } else {
          legacy = await tx.meme.create({ data: legacyData });
          await tx.channelMeme.update({
            where: { id: cm.id },
            data: { legacyMemeId: legacy.id },
          });
        }

        maybeFailDualWrite('createPoolSubmission:afterLegacy');

        return { cm, legacy };
      });

      return res.status(201).json({
        ...(legacy ? legacy : {}),
        isDirectApproval: true,
        channelMemeId: cm.id,
        memeAssetId: asset.id,
        sourceKind: 'pool',
        status: 'approved',
        deletedAt: null,
      });
    }

    stageLog('submission.pool.before_db_write', { requestId, userId, durationMs: Date.now() - startedAt });

    // Create submission request referencing the asset.
    const created = await prisma.memeSubmission.create({
      data: {
        channelId: body.channelId,
        submitterUserId: userId,
        title: finalTitle,
        type: asset.type,
        // fileUrlTemp is only for local uploads; keep non-null for legacy back-compat.
        fileUrlTemp: '',
        // For pool submissions, preview should come from the asset itself.
        // Keep it in sourceUrl so pending UI has a stable URL without extra joins/endpoints.
        sourceUrl: assetFileUrl,
        notes: body.notes || null,
        status: 'pending',
        sourceKind: 'pool',
        memeAssetId: body.memeAssetId,
      },
    });

    stageLog('submission.pool.after_db_write', {
      requestId,
      userId,
      submissionId: created.id,
      durationMs: Date.now() - startedAt,
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
      } catch (e: unknown) {
        // Back-compat: MemeSubmissionTag might not exist.
        const errorCode = typeof e === 'object' && e !== null ? (e as { code?: string }).code : null;
        const errorMeta = typeof e === 'object' && e !== null ? (e as { meta?: { table?: string } }).meta : null;
        if (!(errorCode === 'P2021' && errorMeta?.table === 'public.MemeSubmissionTag')) {
          logger.warn('submission.pool.tags_attach_failed_ignored', {
            requestId,
            userId,
            message: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // Emit Socket.IO event for new submission (same as createSubmission)
    try {
      const io: Server = req.app.get('io');
      const channelSlug = String(channel.slug || '').toLowerCase();
      const streamerUserId = channel.users?.[0]?.id;
      const evt = {
        event: 'submission:created' as const,
        submissionId: created.id,
        channelId: body.channelId,
        channelSlug,
        submitterId: userId,
        userIds: streamerUserId ? [streamerUserId] : undefined,
        source: 'local' as const,
      };
      emitSubmissionEvent(io, evt);
      void relaySubmissionEventToPeer(evt);
    } catch (e: unknown) {
      logger.warn('submission.pool.realtime_emit_failed_ignored', {
        requestId,
        userId,
        message: e instanceof Error ? e.message : String(e),
      });
    }

    stageLog('submission.pool.before_response', {
      requestId,
      userId,
      status: 201,
      durationMs: Date.now() - startedAt,
    });
    return res.status(201).json(created);
  } catch (error: unknown) {
    // Critical: without this, async errors can leave the HTTP request hanging (no status/headers).
    if (error instanceof ZodError) {
      logger.warn('submission.pool.validation_failed_throw', {
        requestId,
        userId,
        issues: error.issues,
      });
      return res.status(400).json({
        error: 'Validation error',
        message: 'Validation failed',
        details: error.issues,
        requestId,
      });
    }

    const errorRec =
      error && typeof error === 'object'
        ? (error as { name?: unknown; message?: unknown })
        : ({} as { name?: unknown; message?: unknown });
    const errorName = typeof errorRec.name === 'string' ? errorRec.name : null;
    const errorMessage = typeof errorRec.message === 'string' ? errorRec.message : String(error);
    logger.error('submission.pool.unhandled_error', {
      requestId,
      userId,
      errorName,
      errorMessage,
      durationMs: Date.now() - startedAt,
    });

    const errorCode = typeof error === 'object' && error !== null ? (error as { code?: string }).code : null;
    if (errorCode === 'P2002') {
      return res.status(409).json({
        errorCode: 'SUBMISSION_ALREADY_EXISTS',
        error: 'Submission already exists for this asset',
        requestId,
      });
    }

    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to create pool submission',
        requestId,
      });
    }
  }
};
