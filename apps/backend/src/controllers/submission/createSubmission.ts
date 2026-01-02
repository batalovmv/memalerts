import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import { createSubmissionSchema } from '../../shared/index.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { calculateFileHash, decrementFileHashReference, findOrCreateFileHash, getFileStats } from '../../utils/fileHash.js';
import { validateFileContent } from '../../utils/fileTypeValidator.js';
import { logFileUpload, logSecurityEvent } from '../../utils/auditLogger.js';
import path from 'path';
import fs from 'fs';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { debugLog } from '../../utils/debug.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

export const createSubmission = async (req: AuthRequest, res: Response) => {
  debugLog('[DEBUG] createSubmission started', { hasFile: !!req.file, userId: req.userId, channelId: req.channelId });

  if (!req.file) {
    return res.status(400).json({ errorCode: 'BAD_REQUEST', error: 'Bad request', details: { field: 'file' } });
  }

  // Determine channelId: use from body/query if provided, otherwise use from token
  let channelId = (req.body as any).channelId || (req.query as any).channelId;
  if (!channelId) {
    channelId = req.channelId;
  }

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  // Validate that the channel exists
  const channel = await prisma.channel.findUnique({
    where: { id: channelId as string },
    select: {
      id: true,
      slug: true,
      defaultPriceCoins: true,
      submissionsEnabled: true,
      submissionsOnlyWhenLive: true,
    },
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // Block viewer submissions when disabled (global per-channel gate).
  // IMPORTANT: enforce server-side before heavy file processing.
  if (!(channel as any).submissionsEnabled) {
    return res.status(403).json({
      error: 'Submissions are disabled for this channel',
      errorCode: 'SUBMISSIONS_DISABLED',
    });
  }

  // Optional: allow submissions only while stream is online (best-effort).
  if ((channel as any).submissionsOnlyWhenLive) {
    const slug = String((channel as any).slug || '').toLowerCase();
    const snap = await getStreamDurationSnapshot(slug);
    if (snap.status !== 'online') {
      return res.status(403).json({
        error: 'Submissions are allowed only while the stream is live',
        errorCode: 'SUBMISSIONS_OFFLINE',
      });
    }
  }

  // Owner bypass must be based on JWT channelId to avoid mismatches.
  // If the authenticated user is the streamer/admin for this channel (req.channelId === target channelId),
  // then submissions should be auto-approved (no pending request).
  const isOwner =
    !!req.userId && !!req.channelId && (req.userRole === 'streamer' || req.userRole === 'admin') && String(req.channelId) === String(channelId);

  try {
    // Validate file is video
    if (!req.file.mimetype.startsWith('video/')) {
    return res.status(400).json({ errorCode: 'INVALID_MEDIA_TYPE', error: 'Invalid media type' });
    }

    // Validate file content using magic bytes (prevents MIME type spoofing)
    const filePath = path.join(process.cwd(), req.file.path);
    const contentValidation = await validateFileContent(filePath, req.file.mimetype);
    if (!contentValidation.valid) {
      // Delete the uploaded file if validation fails
      await safeUnlink(filePath);

      // Log security event
      await logSecurityEvent(
        'file_validation_failed',
        req.userId!,
        channelId as string,
        {
          fileName: req.file.originalname,
          declaredType: req.file.mimetype,
          detectedType: contentValidation.detectedType,
          error: contentValidation.error,
        },
        req
      );

      return res.status(400).json({
        errorCode: 'INVALID_FILE_CONTENT',
        error: 'Invalid file content',
        message: contentValidation.error || 'File content does not match declared file type',
      });
    }

    // Parse tags from FormData (they come as JSON string)
    const bodyData: any = { ...req.body };
    if (typeof bodyData.tags === 'string') {
      try {
        bodyData.tags = JSON.parse(bodyData.tags);
      } catch (e) {
        bodyData.tags = [];
      }
    }

    const body = createSubmissionSchema.parse(bodyData);

    // Ensure type is video
    if (body.type !== 'video') {
      return res.status(400).json({ error: 'Only video type is allowed' });
    }

    // Enforce limits:
    // - size <= 50MB
    // - duration <= 15s (strict, because memes go to OBS)
    // Note: server-side duration detection relies on ffprobe which might be unavailable on some hosts.
    // We enforce duration using server metadata when available, and fall back to client-provided durationMs (from frontend metadata) when not.
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (req.file.size > MAX_SIZE) {
      await safeUnlink(filePath);
      return res.status(400).json({
        error: `Video file size (${(req.file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`,
      });
    }

    // Duration detection (prefer server-side; fallback to client-provided)
    const metadata = await getVideoMetadata(filePath);
    const clientDurationMsRaw = ((req.body as any)?.durationMs ?? (req.body as any)?.duration_ms) as unknown;
    const clientDurationMs =
      typeof clientDurationMsRaw === 'string' ? parseInt(clientDurationMsRaw, 10) : typeof clientDurationMsRaw === 'number' ? clientDurationMsRaw : null;

    const serverDurationSec = metadata?.duration && metadata.duration > 0 ? metadata.duration : null;
    const serverDurationMs = serverDurationSec !== null ? Math.round(serverDurationSec * 1000) : null;

    const effectiveDurationMs = serverDurationMs ?? (Number.isFinite(clientDurationMs as number) ? (clientDurationMs as number) : null);

    if (effectiveDurationMs === null) {
      console.warn('[createSubmission] Unable to determine duration; allowing upload but approval will enforce max duration', {
        userId: req.userId,
        channelId,
        file: req.file?.originalname,
        mime: req.file?.mimetype,
      });
    } else if (effectiveDurationMs > 15000) {
      await safeUnlink(filePath);
      return res.status(413).json({
        errorCode: 'VIDEO_TOO_LONG',
        error: 'Video is too long',
        details: { maxDurationMs: 15000, durationMs: effectiveDurationMs },
      });
    }

    // Calculate file hash and perform deduplication with timeout
    let finalFilePath: string;
    let fileHash: string | null = null;
    try {
      // Add timeout for hash calculation to prevent hanging
      const hashPromise = calculateFileHash(filePath);
      const hashTimeout = new Promise<string>((_, reject) => {
        // 50MB hashing can exceed 10s on busy/slow disks; too aggressive timeout causes fileHash=null + non-dedup paths.
        setTimeout(() => reject(new Error('Hash calculation timeout')), 30000); // 30 second timeout
      });

      const hash = await Promise.race([hashPromise, hashTimeout]);
      const stats = await getFileStats(filePath);
      const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
      finalFilePath = result.filePath;
      fileHash = hash;
      console.log(`File deduplication: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
    } catch (error: any) {
      console.error('File hash calculation failed, using original path:', error.message);
      // Fallback to original path if hash calculation fails
      finalFilePath = `/uploads/${req.file.filename}`;
    }

    // Invariant: if the target channel already has this asset enabled, return 409 for all submission endpoints.
    // Best-effort: only enforce when we have a stable dedup key (fileHash).
    if (fileHash) {
      const existingAsset = await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: {
          id: true,
          type: true,
          fileUrl: true,
          fileHash: true,
          durationMs: true,
          purgeRequestedAt: true,
          purgedAt: true,
        },
      });

      if (existingAsset) {
        // Safety: if this asset was "deleted" (quarantined) or purged, forbid re-upload by hash.
        // This prevents a moderator-deleted meme from being reintroduced via new uploads.
        if (existingAsset.purgeRequestedAt || existingAsset.purgedAt) {
          try {
            await decrementFileHashReference(fileHash);
          } catch {
            // ignore
          }
          return res.status(410).json({
            errorCode: 'ASSET_PURGED_OR_QUARANTINED',
            error: 'This meme was deleted and cannot be uploaded again',
            requestId: req.requestId,
            details: {
              legacyErrorCode: 'MEME_ASSET_DELETED',
              fileHash,
              memeAssetId: existingAsset.id,
              purgeRequestedAt: existingAsset.purgeRequestedAt,
              purgedAt: existingAsset.purgedAt,
            },
          });
        }

        const existingCm = await prisma.channelMeme.findUnique({
          where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId: existingAsset.id } },
          select: { id: true, deletedAt: true, legacyMemeId: true },
        });

        if (existingCm && !existingCm.deletedAt) {
          // We incremented FileHash.referenceCount in findOrCreateFileHash; undo to avoid leaks.
          try {
            await decrementFileHashReference(fileHash);
          } catch {
            // ignore
          }
          return res.status(409).json({
            errorCode: 'ALREADY_IN_CHANNEL',
            error: 'This meme is already in your channel',
            requestId: req.requestId,
          });
        }

        // Owner-bypass: if meme was previously disabled in this channel, restore it instead of creating a duplicate.
        if (isOwner && existingCm && existingCm.deletedAt) {
          try {
            await decrementFileHashReference(fileHash);
          } catch {
            // ignore
          }

          const defaultPrice = channel.defaultPriceCoins ?? 100;
          const now = new Date();

          const restored = await prisma.channelMeme.update({
            where: { id: existingCm.id },
            data: {
              status: 'approved',
              deletedAt: null,
              title: body.title,
              priceCoins: defaultPrice,
              approvedByUserId: req.userId!,
              approvedAt: now,
            },
            select: { id: true, legacyMemeId: true, memeAssetId: true },
          });

          const legacyData: any = {
            channelId,
            title: body.title,
            type: existingAsset.type,
            fileUrl: existingAsset.fileUrl,
            fileHash: existingAsset.fileHash,
            durationMs: existingAsset.durationMs,
            priceCoins: defaultPrice,
            status: 'approved',
            deletedAt: null,
            createdByUserId: req.userId!,
            approvedByUserId: req.userId!,
          };

          let legacy: any | null = null;
          if (restored.legacyMemeId) {
            try {
              legacy = await prisma.meme.update({
                where: { id: restored.legacyMemeId },
                data: legacyData,
              });
            } catch {
              legacy = await prisma.meme.create({ data: legacyData });
              await prisma.channelMeme.update({
                where: { id: restored.id },
                data: { legacyMemeId: legacy.id },
              });
            }
          } else {
            legacy = await prisma.meme.create({ data: legacyData });
            await prisma.channelMeme.update({
              where: { id: restored.id },
              data: { legacyMemeId: legacy.id },
            });
          }

          return res.status(201).json({
            ...(legacy as any),
            isDirectApproval: true,
            channelMemeId: restored.id,
            memeAssetId: restored.memeAssetId,
            sourceKind: 'upload',
            isRestored: true,
            status: 'approved',
            deletedAt: null,
          });
        }
      }
    }

    // Get or create tags with timeout protection
    let tagIds: string[] = [];
    try {
      const tagsPromise = getOrCreateTags(body.tags || []);
      const tagsTimeout = new Promise<string[]>((resolve) => {
        setTimeout(() => {
          console.warn('Tags creation timeout, proceeding without tags');
          resolve([]); // Proceed without tags if timeout
        }, 5000); // 5 second timeout for tags
      });
      tagIds = await Promise.race([tagsPromise, tagsTimeout]);
    } catch (error: any) {
      console.warn('Error creating tags, proceeding without tags:', error.message);
      tagIds = []; // Proceed without tags on error
    }

    // If owner is submitting, create meme directly (bypass approval)
    if (isOwner) {
      console.log('Owner submitting meme, creating directly as approved');

      // Best-effort duration for storage (server preferred, client fallback)
      const durationMs = Math.max(0, Math.min(effectiveDurationMs ?? 0, 15000));

      // Get default price from channel
      const defaultPrice = channel.defaultPriceCoins ?? 100; // Use channel default or 100 as fallback

      // Create meme directly with approved status
      const memeData: any = {
        channelId,
        title: body.title,
        type: 'video',
        fileUrl: finalFilePath,
        durationMs, // Use real duration or 0
        priceCoins: defaultPrice, // Use channel default price
        status: 'approved',
        createdByUserId: req.userId!,
        approvedByUserId: req.userId!,
        fileHash,
      };

      // Only add tags if we have tagIds (and table exists)
      if (tagIds.length > 0) {
        memeData.tags = {
          create: tagIds.map((tagId) => ({
            tagId,
          })),
        };
      }

      const memePromise = prisma.meme.create({
        data: memeData,
        include:
          tagIds.length > 0
            ? {
                tags: {
                  include: {
                    tag: true,
                  },
                },
              }
            : undefined,
      });

      const memeTimeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Meme creation timeout')), 10000);
      });

      let meme: any;
      try {
        meme = await Promise.race([memePromise, memeTimeout]);
      } catch (dbError: any) {
        // If error is about MemeTag table, retry without tags
        if (dbError?.code === 'P2021' && dbError?.meta?.table === 'public.MemeTag') {
          console.warn('MemeTag table not found, creating meme without tags');
          meme = await prisma.meme.create({
            data: {
              channelId,
              title: body.title,
              type: 'video',
              fileUrl: finalFilePath,
              durationMs, // Use real duration or 0
              priceCoins: defaultPrice, // Use channel default price
              status: 'approved',
              createdByUserId: req.userId!,
              approvedByUserId: req.userId!,
              fileHash,
            },
          });
        } else {
          throw dbError;
        }
      }

      // Dual-write (required for strict client contract): ensure we have MemeAsset + ChannelMeme ids.
      let memeAssetId: string | null = null;
      let channelMemeId: string | null = null;
      try {
        const existingAsset =
          fileHash
            ? await prisma.memeAsset.findFirst({ where: { fileHash }, select: { id: true } })
            : await prisma.memeAsset.findFirst({
                where: { fileHash: null, fileUrl: finalFilePath, type: 'video', durationMs },
                select: { id: true },
              });

        memeAssetId =
          existingAsset?.id ??
          (
            await prisma.memeAsset.create({
              data: {
                type: 'video',
                fileUrl: finalFilePath,
                fileHash,
                durationMs,
                createdByUserId: req.userId!,
              },
              select: { id: true },
            })
          ).id;

        const cm = await prisma.channelMeme.upsert({
          where: { channelId_memeAssetId: { channelId: String(channelId), memeAssetId } },
          create: {
            channelId: String(channelId),
            memeAssetId,
            legacyMemeId: meme?.id || null,
            status: 'approved',
            title: body.title,
            priceCoins: defaultPrice,
            addedByUserId: req.userId!,
            approvedByUserId: req.userId!,
            approvedAt: new Date(),
          },
          update: {
            legacyMemeId: meme?.id || null,
            status: 'approved',
            title: body.title,
            priceCoins: defaultPrice,
            approvedByUserId: req.userId!,
            approvedAt: new Date(),
            deletedAt: null,
          },
          select: { id: true },
        });
        channelMemeId = cm.id;
      } catch (e: any) {
        // Race-condition safety: unique(ChannelMeme.channelId,memeAssetId) -> map to 409 instead of 500.
        if (e?.code === 'P2002') {
          return res.status(409).json({
            errorCode: 'ALREADY_IN_CHANNEL',
            error: 'This meme is already in your channel',
            requestId: req.requestId,
          });
        }
        throw e;
      }

      // Log file upload
      await logFileUpload(req.userId!, channelId as string, finalFilePath, req.file.size, true, req);

      // Send response with meme data
      return res.status(201).json({
        ...meme,
        isDirectApproval: true,
        isRestored: false,
        channelMemeId,
        memeAssetId,
        status: 'approved',
        deletedAt: null,
      });
    }

    // Otherwise, create submission for approval
    // Create submission with timeout protection
    // If tagIds is empty or tags table doesn't exist, create without tags
    const submissionData: any = {
      channelId,
      submitterUserId: req.userId!,
      title: body.title,
      type: 'video', // Force video type
      fileUrlTemp: finalFilePath, // Use deduplicated file path
      notes: body.notes || null,
      status: 'pending',
      sourceKind: 'upload',
      // Best-effort metadata for moderation/AI (no extra heavy work here).
      fileHash,
      durationMs: effectiveDurationMs !== null ? Math.max(0, Math.min(effectiveDurationMs, 15000)) : null,
      mimeType: req.file.mimetype || null,
      fileSizeBytes: Number.isFinite(req.file.size) ? req.file.size : null,
    };

    // Only add tags if we have tagIds (and table exists)
    if (tagIds.length > 0) {
      submissionData.tags = {
        create: tagIds.map((tagId) => ({
          tagId,
        })),
      };
    }

    const submissionPromise = prisma.memeSubmission.create({
      data: submissionData,
      include:
        tagIds.length > 0
          ? {
              tags: {
                include: {
                  tag: true,
                },
              },
            }
          : undefined,
    });

    const submissionTimeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Submission creation timeout')), 10000); // 10 second timeout
    });

    let submission: any;
    try {
      submission = await Promise.race([submissionPromise, submissionTimeout]);
    } catch (dbError: any) {
      // If error is about MemeSubmissionTag table, retry without tags
      if (dbError?.code === 'P2021' && dbError?.meta?.table === 'public.MemeSubmissionTag') {
        console.warn('MemeSubmissionTag table not found, creating submission without tags');
        submission = await prisma.memeSubmission.create({
          data: {
            channelId,
            submitterUserId: req.userId!,
            title: body.title,
            type: 'video',
            fileUrlTemp: `/uploads/${req.file.filename}`,
            notes: body.notes || null,
            status: 'pending',
            sourceKind: 'upload',
            fileHash,
            durationMs: effectiveDurationMs ?? null,
            mimeType: req.file.mimetype || null,
            fileSizeBytes: Number.isFinite(req.file.size) ? req.file.size : null,
          },
        });
      } else {
        throw dbError;
      }
    }

    // Log file upload
    await logFileUpload(req.userId!, channelId as string, finalFilePath, req.file.size, true, req);

    debugLog('[DEBUG] Submission created successfully, sending response', { submissionId: submission.id, channelId });

    // Emit Socket.IO event for new submission
    try {
      const io: Server = req.app.get('io');
      const channel = await prisma.channel.findUnique({
        where: { id: channelId as string },
        select: { slug: true, users: { where: { role: 'streamer' }, take: 1, select: { id: true } } },
      });
      if (channel) {
        const channelSlug = String(channel.slug).toLowerCase();
        const streamerUserId = (channel as any).users?.[0]?.id;
        const evt = {
          event: 'submission:created' as const,
          submissionId: submission.id,
          channelId: channelId as string,
          channelSlug,
          submitterId: req.userId || undefined,
          userIds: streamerUserId ? [streamerUserId] : undefined,
          source: 'local' as const,
        };
        emitSubmissionEvent(io, evt);
        void relaySubmissionEventToPeer(evt);
      }
    } catch (error) {
      console.error('Error emitting submission:created event:', error);
      // Don't fail the request if Socket.IO emit fails
    }

    // Send response immediately after creating submission
    res.status(201).json(submission);
  } catch (error: any) {
    console.error('Error in createSubmission:', {
      message: error?.message,
      name: error?.name,
      code: error?.code,
      stack: error?.stack,
      hasFile: !!req.file,
      fileSize: req.file?.size,
      channelId: req.channelId,
      userId: req.userId,
    });

    // Clean up uploaded file if it exists and error occurred
    if (req.file) {
      try {
        const filePath = path.join(process.cwd(), req.file.path);
        await safeUnlink(filePath);
        console.log('Cleaned up uploaded file after error:', req.file.filename);
      } catch (cleanupError) {
        console.error('Failed to clean up file after error:', cleanupError);
      }
    }

    // Handle specific error types
    if (error?.message === 'Submission creation timeout') {
      return res.status(408).json({
        error: 'Request timeout',
        message: 'Submission creation timed out. Please try again.',
      });
    }

    // Handle Prisma errors specifically
    if (error?.code === 'P2021' || error?.name === 'PrismaClientKnownRequestError') {
      console.error('Prisma database error - table may not exist:', error?.meta);
      if (!res.headersSent) {
        return res.status(500).json({
          error: 'Database error',
          message: 'A database error occurred. Please contact support if this persists.',
          details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
        });
      }
      return;
    }

    // If response hasn't been sent, send error response
    if (!res.headersSent) {
      // Return error response instead of throwing to prevent hanging
      return res.status(500).json({
        error: 'Internal server error',
        message: error?.message || 'An unexpected error occurred',
        details: process.env.NODE_ENV === 'development' ? error?.stack : undefined,
      });
    } else {
      // Response already sent, just log the error
      console.error('Error occurred after response was sent');
    }
  }
};


