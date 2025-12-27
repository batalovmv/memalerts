import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { prisma } from '../../lib/prisma.js';
import { approveSubmissionSchema, needsChangesSubmissionSchema, rejectSubmissionSchema } from '../../shared/index.js';
import { getOrCreateTags } from '../../utils/tags.js';
import {
  calculateFileHash,
  findOrCreateFileHash,
  getFileStats,
  getFileHashByPath,
  incrementFileHashReference,
} from '../../utils/fileHash.js';
import { validatePathWithinDirectory } from '../../utils/pathSecurity.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { ZodError } from 'zod';
import { PrismaClientKnownRequestError, PrismaClientUnknownRequestError } from '@prisma/client/runtime/library';
import fs from 'fs';
import path from 'path';
import { debugLog, debugError } from '../../utils/debug.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../../realtime/walletBridge.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';

export const getSubmissions = async (req: AuthRequest, res: Response) => {
  const status = req.query.status as string | undefined;
  const channelId = req.channelId;
  const limitRaw = req.query.limit as string | undefined;
  const offsetRaw = req.query.offset as string | undefined;
  const includeTotalRaw = req.query.includeTotal as string | undefined;
  const includeTagsRaw = req.query.includeTags as string | undefined;
  const includeTotal =
    includeTotalRaw !== undefined &&
    (includeTotalRaw === '1' || includeTotalRaw.toLowerCase() === 'true' || includeTotalRaw.toLowerCase() === 'yes');
  const includeTags =
    includeTagsRaw === undefined ||
    includeTagsRaw === '1' ||
    includeTagsRaw.toLowerCase() === 'true' ||
    includeTagsRaw.toLowerCase() === 'yes';

  // Defensive paging (admin endpoints can still be abused).
  const maxFromEnv = parseInt(String(process.env.ADMIN_SUBMISSIONS_PAGE_MAX || ''), 10);
  const MAX_PAGE = Number.isFinite(maxFromEnv) && maxFromEnv > 0 ? maxFromEnv : 100;
  const limitParsed = limitRaw !== undefined ? parseInt(limitRaw, 10) : undefined;
  const offsetParsed = offsetRaw !== undefined ? parseInt(offsetRaw, 10) : undefined;
  const limit = limitParsed !== undefined && Number.isFinite(limitParsed) && limitParsed > 0 ? Math.min(limitParsed, MAX_PAGE) : undefined;
  const offset = offsetParsed !== undefined && Number.isFinite(offsetParsed) && offsetParsed >= 0 ? offsetParsed : undefined;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const where = {
      channelId,
      ...(status ? { status } : {}),
    };

    // Perf: tags are not needed for the pending list UI; allow skipping JOINs.
    // Back-compat: default includeTags=true.
    const baseQuery: any = {
      where,
      orderBy: { createdAt: 'desc' },
      ...(limit !== undefined && Number.isFinite(limit) ? { take: limit } : {}),
      ...(offset !== undefined && Number.isFinite(offset) ? { skip: offset } : {}),
    };

    const selectWithTags = {
      id: true,
      channelId: true,
      submitterUserId: true,
      title: true,
      type: true,
      fileUrlTemp: true,
      sourceUrl: true,
      sourceKind: true,
      memeAssetId: true,
      notes: true,
      status: true,
      moderatorNotes: true,
      revision: true,
      createdAt: true,
      submitter: {
        select: { id: true, displayName: true },
      },
      memeAsset: {
        select: { fileUrl: true },
      },
      tags: {
        select: {
          tag: { select: { id: true, name: true } },
        },
      },
    } as const;

    const selectWithoutTags = {
      id: true,
      channelId: true,
      submitterUserId: true,
      title: true,
      type: true,
      fileUrlTemp: true,
      sourceUrl: true,
      sourceKind: true,
      memeAssetId: true,
      notes: true,
      status: true,
      moderatorNotes: true,
      revision: true,
      createdAt: true,
      submitter: {
        select: { id: true, displayName: true },
      },
      memeAsset: {
        select: { fileUrl: true },
      },
    } as const;

    // Add timeout protection (keep conservative: DB can hang under load)
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database query timeout')), 10000); // 10 seconds
    });

    let submissions: any;
    if (!includeTags) {
      submissions = await Promise.race([prisma.memeSubmission.findMany({ ...baseQuery, select: selectWithoutTags }), timeoutPromise]);
    } else {
      const submissionsPromise = prisma.memeSubmission.findMany({ ...baseQuery, select: selectWithTags });
      try {
        submissions = await Promise.race([submissionsPromise, timeoutPromise]);
      } catch (error: any) {
        // If error is about MemeSubmissionTag table, retry without tags
        if (error?.code === 'P2021' && error?.meta?.table === 'public.MemeSubmissionTag') {
          console.warn('MemeSubmissionTag table not found, fetching submissions without tags');
          submissions = await prisma.memeSubmission.findMany({ ...baseQuery, select: selectWithoutTags });
          // Add empty tags array to match expected structure
          submissions = submissions.map((s: any) => ({ ...s, tags: [] }));
        } else if (error?.message === 'Database query timeout') {
          return res.status(408).json({
            error: 'Request timeout',
            message: 'Database query timed out. Please try again.',
          });
        } else {
          throw error;
        }
      }
    }

    // Back-compat: if client didn't request pagination, keep legacy array response.
    if (limit === undefined && offset === undefined) {
      const normalized = Array.isArray(submissions)
        ? submissions.map((s: any) => {
            const { memeAsset, ...rest } = s || {};
            return {
              ...rest,
              // Ensure pending pool submissions always have a usable preview URL.
              // NOTE: sourceUrl is also used for imported memes; pool uses it strictly for preview.
              sourceUrl:
                String((s?.sourceKind || '')).toLowerCase() === 'pool' && !s?.sourceUrl ? s?.memeAsset?.fileUrl ?? null : s?.sourceUrl ?? null,
            };
          })
        : submissions;
      return res.json(normalized);
    }

    // Perf: counting can be expensive on large datasets; only compute if requested.
    const total = includeTotal ? await prisma.memeSubmission.count({ where }) : null;
    const items = Array.isArray(submissions)
      ? submissions.map((s: any) => {
          const { memeAsset, ...rest } = s || {};
          return {
            ...rest,
            sourceUrl:
              String((s?.sourceKind || '')).toLowerCase() === 'pool' && !s?.sourceUrl ? s?.memeAsset?.fileUrl ?? null : s?.sourceUrl ?? null,
          };
        })
      : [];
    return res.json({ items, total });
  } catch (error: any) {
    console.error('Error in getSubmissions:', error);
    if (!res.headersSent) {
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to fetch submissions',
        details: process.env.NODE_ENV === 'development' ? error?.message : undefined,
      });
    }
  }
};

export const approveSubmission = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  debugLog('[DEBUG] approveSubmission started', { submissionId: id, channelId });

  let submission: any; // Declare submission in outer scope for error handling
  let submissionRewardEvent: any = null;
  try {
    const body = approveSubmissionSchema.parse(req.body);

    // Get submission first to check if it's imported (has sourceUrl)
    let submissionForBackground: any;
    try {
      submissionForBackground = await prisma.memeSubmission.findUnique({
        where: { id },
        select: { sourceUrl: true },
      });
    } catch (error) {
      // Ignore, will check in transaction
    }
    const result = await prisma
      .$transaction(
        async (tx) => {
          // Get submission WITHOUT tags to avoid transaction abort if MemeSubmissionTag table doesn't exist
          // The table may not exist on production, so we fetch without tags from the start
          try {
            submission = await tx.memeSubmission.findUnique({
              where: { id },
            });
            // Add empty tags array to match expected structure
            if (submission) {
              submission.tags = [];
            }
          } catch (error: any) {
            console.error('Error fetching submission:', error);
            throw new Error('Failed to fetch submission');
          }

          if (!submission) {
            throw new Error('SUBMISSION_NOT_FOUND');
          }
          if (submission.channelId !== channelId) {
            throw new Error('SUBMISSION_FORBIDDEN');
          }

          if (submission.status !== 'pending') {
            throw new Error('SUBMISSION_NOT_PENDING');
          }

          // Get channel to use default price and slug for Socket.IO
          debugLog('[DEBUG] Fetching channel for default price', { channelId });

          const channel = await tx.channel.findUnique({
            where: { id: channelId },
            select: {
              defaultPriceCoins: true,
              slug: true,
              submissionRewardCoins: true, // legacy
              submissionRewardCoinsUpload: true,
              submissionRewardCoinsPool: true,
              submissionRewardOnlyWhenLive: true, // legacy (ignored for rewards in this rollout)
            },
          });

          debugLog('[DEBUG] Channel fetched', { channelId, found: !!channel, defaultPriceCoins: channel?.defaultPriceCoins });

          const defaultPrice = channel?.defaultPriceCoins ?? 100; // Use channel default or 100 as fallback
          const sourceKind = String((submission as any)?.sourceKind || '').toLowerCase();
          const rewardForApproval =
            sourceKind === 'pool'
              ? (channel as any)?.submissionRewardCoinsPool ?? 0
              : (channel as any)?.submissionRewardCoinsUpload ?? (channel as any)?.submissionRewardCoins ?? 0;

          // Pool submission: no file processing. Just create ChannelMeme + legacy Meme from MemeAsset.
          if (sourceKind === 'pool' && (submission as any).memeAssetId) {
            const asset = await tx.memeAsset.findUnique({
              where: { id: String((submission as any).memeAssetId) },
              select: { id: true, type: true, fileUrl: true, fileHash: true, durationMs: true, purgedAt: true },
            });
            if (!asset || asset.purgedAt) throw new Error('MEME_ASSET_NOT_FOUND');
            if (!asset.fileUrl) throw new Error('MEDIA_NOT_AVAILABLE');

            // Upsert ChannelMeme
            const cm = await tx.channelMeme.upsert({
              where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId: asset.id } },
              create: {
                channelId: submission.channelId,
                memeAssetId: asset.id,
                status: 'approved',
                title: submission.title,
                priceCoins: body.priceCoins || defaultPrice,
                addedByUserId: submission.submitterUserId,
                approvedByUserId: req.userId!,
                approvedAt: new Date(),
              },
              update: {
                status: 'approved',
                deletedAt: null,
                title: submission.title,
                priceCoins: body.priceCoins || defaultPrice,
                approvedByUserId: req.userId!,
                approvedAt: new Date(),
              },
            });

            // Create legacy Meme if needed (for back-compat, rollups and existing overlay flows).
            const legacy =
              cm.legacyMemeId
                ? await tx.meme.findUnique({ where: { id: cm.legacyMemeId } })
                : await tx.meme.create({
                    data: {
                      channelId: submission.channelId,
                      title: submission.title,
                      type: asset.type,
                      fileUrl: asset.fileUrl,
                      fileHash: asset.fileHash,
                      durationMs: asset.durationMs,
                      priceCoins: body.priceCoins || defaultPrice,
                      status: 'approved',
                      createdByUserId: submission.submitterUserId,
                      approvedByUserId: req.userId!,
                    },
                  });

            if (!cm.legacyMemeId && legacy?.id) {
              await tx.channelMeme.update({
                where: { id: cm.id },
                data: { legacyMemeId: legacy.id },
              });
            }

            // Mark submission approved
            await tx.memeSubmission.update({ where: { id }, data: { status: 'approved' } });

            // Return legacy-shaped meme for current response compatibility
            return legacy as any;
          }

          // Determine fileUrl: handle deduplication for both uploaded and imported files
          let finalFileUrl: string;
          let fileHash: string | null = null;
          let filePath: string | null = null; // Declare filePath in wider scope

          debugLog('[DEBUG] Processing file URL', { submissionId: id, hasSourceUrl: !!submission.sourceUrl, fileUrlTemp: submission.fileUrlTemp });

          if (submission.sourceUrl) {
            // Imported meme - use sourceUrl temporarily, download will happen in background
            // This prevents timeout issues - we approve immediately and download async
            finalFileUrl = submission.sourceUrl;
          } else {
            // Uploaded file - check if already deduplicated or perform deduplication
            // Validate path to prevent path traversal attacks
            try {
              const uploadsDir = path.join(process.cwd(), 'uploads');
              // If fileUrlTemp starts with /, remove it before validation
              const relativePath = submission.fileUrlTemp.startsWith('/') ? submission.fileUrlTemp.slice(1) : submission.fileUrlTemp;

              debugLog('[DEBUG] Validating file path', { submissionId: id, fileUrlTemp: submission.fileUrlTemp, relativePath, uploadsDir });

              filePath = validatePathWithinDirectory(relativePath, uploadsDir);

              debugLog('[DEBUG] Path validated', { submissionId: id, filePath, fileExists: fs.existsSync(filePath) });
            } catch (pathError: any) {
              debugLog('[DEBUG] Path validation failed', { submissionId: id, fileUrlTemp: submission.fileUrlTemp, error: pathError?.message });
              console.error(`Path validation failed for submission.fileUrlTemp: ${submission.fileUrlTemp}`, pathError.message);
              throw new Error('Invalid file path: File path contains invalid characters or path traversal attempt');
            }

            // Check if file already exists in FileHash (was deduplicated during upload)
            const existingHash = await getFileHashByPath(submission.fileUrlTemp);

            if (existingHash) {
              // File was already deduplicated - use existing path and increment reference
              finalFileUrl = submission.fileUrlTemp;
              fileHash = existingHash;
              await incrementFileHashReference(existingHash);
            } else if (filePath && fs.existsSync(filePath)) {
              // File exists but not in FileHash - calculate hash and deduplicate with timeout
              try {
                // Add timeout for hash calculation to prevent hanging
                const hashPromise = calculateFileHash(filePath);
                const hashTimeout = new Promise<string>((_, reject) => {
                  setTimeout(() => reject(new Error('Hash calculation timeout')), 10000); // 10 second timeout
                });

                const hash = await Promise.race([hashPromise, hashTimeout]);
                const stats = await getFileStats(filePath);
                const result = await findOrCreateFileHash(filePath, hash, stats.mimeType, stats.size);
                finalFileUrl = result.filePath;
                fileHash = hash;
                debugLog(`File deduplication on approve: ${result.isNew ? 'new file' : 'duplicate found'}, hash: ${hash}`);
              } catch (error: any) {
                console.error('File hash calculation failed during approve:', error.message);
                // Fallback to original path - don't fail the approval
                finalFileUrl = submission.fileUrlTemp;
                fileHash = null;
              }
            } else {
              throw new Error('Uploaded file not found');
            }
          }

          // Get tags: use tags from body if provided, otherwise use tags from submission
          // Handle case when tags table doesn't exist - with timeout protection
          const tagNames =
            body.tags && body.tags.length > 0
              ? body.tags
              : submission.tags && Array.isArray(submission.tags) && submission.tags.length > 0
                ? submission.tags.map((st: any) => st.tag?.name || st.tag).filter(Boolean)
                : [];

          let tagIds: string[] = [];
          if (tagNames.length > 0) {
            try {
              const tagsPromise = getOrCreateTags(tagNames);
              const tagsTimeout = new Promise<string[]>((resolve) => {
                setTimeout(() => {
                  console.warn('Tags creation timeout, proceeding without tags');
                  resolve([]);
                }, 3000); // 3 second timeout for tags
              });
              tagIds = await Promise.race([tagsPromise, tagsTimeout]);
            } catch (error: any) {
              console.warn('Error creating tags, proceeding without tags:', error.message);
              tagIds = [];
            }
          }

          // Get video duration from metadata if available
          const STANDARD_DURATION_MS = 15000; // 15 seconds (15000ms) fallback
          let durationMs = body.durationMs || STANDARD_DURATION_MS;

          // Try to get real video duration from file metadata
          if (!submission.sourceUrl && filePath && fs.existsSync(filePath)) {
            try {
              const metadata = await getVideoMetadata(filePath);
              if (metadata && metadata.duration > 0) {
                durationMs = Math.round(metadata.duration * 1000); // Convert seconds to milliseconds
              }
            } catch (error: any) {
              console.warn('Failed to get video duration, using default:', error.message);
              // Use body.durationMs or fallback to standard
              durationMs = body.durationMs || STANDARD_DURATION_MS;
            }
          }

          // Use channel default price or body price
          const priceCoins = body.priceCoins || defaultPrice;

          // Update submission
          try {
            await tx.memeSubmission.update({
              where: { id },
              data: {
                status: 'approved',
              },
            });
          } catch (error: any) {
            console.error('Error updating submission status:', error);
            throw new Error('Failed to update submission status');
          }

          // Create meme with tags (only if we have tagIds)
          const memeData: any = {
            channelId: submission.channelId,
            title: submission.title,
            type: submission.type,
            fileUrl: finalFileUrl,
            fileHash: fileHash, // Store hash for deduplication tracking
            durationMs,
            priceCoins,
            status: 'approved',
            createdByUserId: submission.submitterUserId,
            approvedByUserId: req.userId!,
          };

          // Only add tags if we have tagIds
          if (tagIds.length > 0) {
            memeData.tags = {
              create: tagIds.map((tagId) => ({
                tagId,
              })),
            };
          }

          try {
            debugLog('[DEBUG] Creating meme in transaction', {
              submissionId: id,
              channelId: submission.channelId,
              hasTags: tagIds.length > 0,
              fileUrl: finalFileUrl,
            });

            const meme = await tx.meme.create({
              data: memeData,
              include: {
                createdBy: {
                  select: {
                    id: true,
                    displayName: true,
                    channel: {
                      select: {
                        slug: true,
                      },
                    },
                  },
                },
                ...(tagIds.length > 0
                  ? {
                      tags: {
                        include: {
                          tag: true,
                        },
                      },
                    }
                  : {}),
              },
            });

            debugLog('[DEBUG] Meme created successfully', { submissionId: id, memeId: meme.id });

            // Dual-write: create global MemeAsset + ChannelMeme for the shared pool.
            // Important: pool visibility moderation is handled on MemeAsset level; creating it here is safe.
            try {
              const existingAsset =
                fileHash
                  ? await tx.memeAsset.findFirst({ where: { fileHash }, select: { id: true } })
                  : await tx.memeAsset.findFirst({
                      where: { fileHash: null, fileUrl: finalFileUrl, type: submission.type, durationMs },
                      select: { id: true },
                    });

              const assetId =
                existingAsset?.id ??
                (
                  await tx.memeAsset.create({
                    data: {
                      type: submission.type,
                      fileUrl: finalFileUrl,
                      fileHash,
                      durationMs,
                      createdByUserId: submission.submitterUserId || null,
                    },
                    select: { id: true },
                  })
                ).id;

              await tx.channelMeme.upsert({
                where: { channelId_memeAssetId: { channelId: submission.channelId, memeAssetId: assetId } },
                create: {
                  channelId: submission.channelId,
                  memeAssetId: assetId,
                  legacyMemeId: meme.id,
                  status: 'approved',
                  title: submission.title,
                  priceCoins,
                  addedByUserId: submission.submitterUserId || null,
                  approvedByUserId: req.userId!,
                  approvedAt: new Date(),
                },
                update: {
                  legacyMemeId: meme.id,
                  status: 'approved',
                  title: submission.title,
                  priceCoins,
                  approvedByUserId: req.userId!,
                  approvedAt: new Date(),
                  deletedAt: null,
                },
              });
            } catch (e) {
              // Do not fail approval if pool dual-write fails (backfill can reconcile later).
              console.warn('[approveSubmission] Dual-write to MemeAsset/ChannelMeme failed (ignored):', (e as any)?.message);
            }

            // Reward submitter for approved submission (per-channel setting)
            // Only if enabled (>0) and submitter is not the moderator approving.
            // Policy: reward is granted ALWAYS (no online check) for both upload/url and pool.
            if (rewardForApproval > 0 && submission.submitterUserId && submission.submitterUserId !== req.userId) {
              const updatedWallet = await tx.wallet.upsert({
                where: {
                  userId_channelId: {
                    userId: submission.submitterUserId,
                    channelId: submission.channelId,
                  },
                },
                create: {
                  userId: submission.submitterUserId,
                  channelId: submission.channelId,
                  balance: rewardForApproval,
                },
                update: {
                  balance: { increment: rewardForApproval },
                },
                select: {
                  balance: true,
                },
              });

              submissionRewardEvent = {
                userId: submission.submitterUserId,
                channelId: submission.channelId,
                balance: updatedWallet.balance,
                delta: rewardForApproval,
                reason: 'submission_approved_reward',
                channelSlug: channel?.slug,
              };
            }

            return meme;
          } catch (error: any) {
            debugLog('[DEBUG] Error creating meme', {
              submissionId: id,
              errorMessage: error?.message,
              errorName: error?.name,
              errorCode: error instanceof PrismaClientKnownRequestError ? error.code : undefined,
            });
            console.error('Error creating meme:', error);
            // Check if it's a constraint violation or other Prisma error
            if (error instanceof PrismaClientKnownRequestError) {
              if (error.code === 'P2002') {
                throw new Error('Meme with this data already exists');
              }
              if (error.code === 'P2003') {
                throw new Error('Invalid reference in meme data');
              }
            }
            throw new Error('Failed to create meme');
          }
        },
        {
          timeout: 30000, // 30 second timeout for transaction
          maxWait: 10000, // 10 second max wait for transaction to start
        }
      )
      .catch((txError: any) => {
        debugLog('[DEBUG] Transaction failed', {
          submissionId: id,
          errorMessage: txError?.message,
          errorName: txError?.name,
          errorCode: txError?.code,
        });
        throw txError;
      });

    debugLog('[DEBUG] Transaction completed successfully', { submissionId: id, resultId: (result as any)?.id });

    // Emit Socket.IO event for submission approval
    try {
      const io: Server = req.app.get('io');
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true },
      });
      if (channel) {
        const channelSlug = String(channel.slug).toLowerCase();
        const evt = {
          event: 'submission:approved' as const,
          submissionId: id,
          channelId,
          channelSlug,
          moderatorId: req.userId || undefined,
          userIds: req.userId ? [req.userId] : undefined,
          source: 'local' as const,
        };
        emitSubmissionEvent(io, evt);
        void relaySubmissionEventToPeer(evt);
      }
    } catch (error) {
      console.error('Error emitting submission:approved event:', error);
      // Don't fail the request if Socket.IO emit fails
    }

    // Emit wallet update for rewarded submitter (if configured)
    if (submissionRewardEvent) {
      try {
        const io: Server = req.app.get('io');
        emitWalletUpdated(io, submissionRewardEvent);
        void relayWalletUpdatedToPeer(submissionRewardEvent);
      } catch (err) {
        console.error('Error emitting wallet:updated for submission reward:', err);
      }
    }

    // Imported memes keep using their original sourceUrl as fileUrl.
    // This avoids broken local /uploads links if background downloads fail or go to a different instance/dir.

    // NOTE: kept for future background handling (was present in original file).
    void submissionForBackground;

    res.json(result);
  } catch (error: any) {
    debugError('[DEBUG] Error in approveSubmission', error);
    console.error('Error in approveSubmission:', error);

    // Don't send response if headers already sent
    if (res.headersSent) {
      console.error('Error occurred after response was sent in approveSubmission');
      return;
    }

    // Handle validation errors (ZodError)
    if (error instanceof ZodError) {
      return res.status(400).json({
        error: 'Validation error',
        message: 'Validation failed',
        details: error.errors,
      });
    }

    // Handle Prisma errors
    if (error instanceof PrismaClientKnownRequestError || error instanceof PrismaClientUnknownRequestError) {
      const errorCode = error instanceof PrismaClientKnownRequestError ? error.code : undefined;
      const errorMeta = error instanceof PrismaClientKnownRequestError ? error.meta : undefined;

      debugLog('[DEBUG] Prisma error in approveSubmission', { submissionId: id, errorCode, errorMessage: error.message, meta: errorMeta });
      console.error('Prisma error in approveSubmission:', error.message, errorCode, errorMeta);

      // Handle transaction aborted error (25P02)
      if (error.message?.includes('current transaction is aborted') || error.message?.includes('25P02') || errorCode === 'P2025') {
        return res.status(500).json({
          error: 'Database transaction error',
          message: 'Transaction was aborted. Please try again.',
        });
      }

      // Handle record not found (P2025)
      if (errorCode === 'P2025') {
        return res.status(404).json({
          error: 'Record not found',
          message: 'The requested record was not found in the database.',
        });
      }

      // Handle other Prisma errors with more detail
      return res.status(500).json({
        error: 'Database error',
        message:
          process.env.NODE_ENV === 'development'
            ? `Database error: ${error.message}${errorCode ? ` (code: ${errorCode})` : ''}`
            : 'An error occurred while processing the request. Please try again.',
      });
    }

    // Handle specific error messages
    if (error.message === 'SUBMISSION_NOT_FOUND') {
      return res.status(404).json({ errorCode: 'SUBMISSION_NOT_FOUND', error: 'Submission not found', details: { entity: 'submission', id } });
    }
    if (error.message === 'SUBMISSION_FORBIDDEN') {
      return res.status(403).json({ errorCode: 'FORBIDDEN', error: 'Forbidden', details: { entity: 'submission', id } });
    }
    if (error.message === 'SUBMISSION_NOT_PENDING') {
      return res.status(409).json({
        errorCode: 'SUBMISSION_NOT_PENDING',
        error: 'Submission is not pending',
        details: { entity: 'submission', id, expectedStatus: 'pending', actualStatus: submission?.status ?? null },
      });
    }

    if (error.message === 'MEME_ASSET_NOT_FOUND') {
      return res.status(404).json({
        errorCode: 'MEME_ASSET_NOT_FOUND',
        error: 'Meme asset not found',
        details: { entity: 'memeAsset', id: submission?.memeAssetId ?? null },
      });
    }
    if (error.message === 'MEDIA_NOT_AVAILABLE') {
      return res.status(410).json({
        errorCode: 'MEDIA_NOT_AVAILABLE',
        error: 'Media not available',
        details: { entity: 'memeAsset', id: submission?.memeAssetId ?? null, reason: 'missing_fileUrl' },
      });
    }

    if (error.message === 'Uploaded file not found') {
      return res.status(404).json({
        errorCode: 'MEDIA_NOT_AVAILABLE',
        error: 'Media not available',
        details: { entity: 'upload', id, path: submission?.fileUrlTemp ?? null, reason: 'file_missing_on_disk' },
      });
    }

    // Handle file operation errors with more specific messages
    if (
      error.message?.includes('Hash calculation timeout') ||
      error.message?.includes('file') ||
      error.message?.includes('File') ||
      error.message?.includes('Invalid file path') ||
      error.message?.includes('Uploaded file not found')
    ) {
      console.error('File operation error in approveSubmission:', error.message, {
        submissionId: id,
        fileUrlTemp: submission?.fileUrlTemp,
        stack: error.stack,
      });
      return res.status(500).json({
        error: 'File operation error',
        message: error.message?.includes('not found')
          ? 'The uploaded file was not found. Please try uploading again.'
          : 'An error occurred while processing the file. Please try again.',
      });
    }

    // Handle all other errors
    return res.status(500).json({
      error: 'Internal server error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'An error occurred while processing the request',
    });
  }
};

export const rejectSubmission = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const body = rejectSubmissionSchema.parse(req.body);

    const submission = await prisma.memeSubmission.findUnique({
      where: { id },
      select: { id: true, channelId: true, status: true },
    });

    if (!submission) {
      return res.status(404).json({ errorCode: 'SUBMISSION_NOT_FOUND', error: 'Submission not found', details: { entity: 'submission', id } });
    }
    if (submission.channelId !== channelId) {
      return res.status(403).json({ errorCode: 'FORBIDDEN', error: 'Forbidden', details: { entity: 'submission', id, channelId: submission.channelId } });
    }
    if (submission.status !== 'pending') {
      return res.status(409).json({
        errorCode: 'SUBMISSION_NOT_PENDING',
        error: 'Submission is not pending',
        details: { entity: 'submission', id, expectedStatus: 'pending', actualStatus: submission.status },
      });
    }

    const updated = await prisma.memeSubmission.update({
      where: { id },
      data: {
        status: 'rejected',
        moderatorNotes: body.moderatorNotes || null,
      },
    });

    // Don't delete file on reject - keep it for potential future use

    // Log admin action
    await logAdminAction(
      'reject_submission',
      req.userId!,
      channelId,
      id,
      {
        submissionId: id,
        notes: body.moderatorNotes || null,
      },
      true,
      req
    );

    // Emit Socket.IO event for submission rejection
    try {
      const io: Server = req.app.get('io');
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true },
      });
      if (channel) {
        const channelSlug = String(channel.slug).toLowerCase();
        const evt = {
          event: 'submission:rejected' as const,
          submissionId: id,
          channelId,
          channelSlug,
          moderatorId: req.userId || undefined,
          userIds: req.userId ? [req.userId] : undefined,
          source: 'local' as const,
        };
        emitSubmissionEvent(io, evt);
        void relaySubmissionEventToPeer(evt);
      }
    } catch (error) {
      console.error('Error emitting submission:rejected event:', error);
      // Don't fail the request if Socket.IO emit fails
    }

    res.json(updated);
  } catch (error: any) {
    console.error('Error in rejectSubmission:', error);
    if (!res.headersSent) {
      // Handle validation errors (ZodError)
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Validation failed',
          details: error.errors,
        });
      }

      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to reject submission',
      });
    }
  }
};

export const needsChangesSubmission = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const maxFromEnv = parseInt(String(process.env.SUBMISSION_MAX_RESUBMITS || ''), 10);
  const MAX_RESUBMITS = Number.isFinite(maxFromEnv) && maxFromEnv >= 0 ? maxFromEnv : 2;

  try {
    const body = needsChangesSubmissionSchema.parse(req.body);

    const submission = await prisma.memeSubmission.findUnique({
      where: { id },
      select: { id: true, channelId: true, status: true, submitterUserId: true, revision: true },
    });

    if (!submission) {
      return res.status(404).json({ errorCode: 'SUBMISSION_NOT_FOUND', error: 'Submission not found', details: { entity: 'submission', id } });
    }
    if (submission.channelId !== channelId) {
      return res.status(403).json({ errorCode: 'FORBIDDEN', error: 'Forbidden', details: { entity: 'submission', id, channelId: submission.channelId } });
    }
    if (submission.status !== 'pending') {
      return res.status(409).json({
        errorCode: 'SUBMISSION_NOT_PENDING',
        error: 'Submission is not pending',
        details: { entity: 'submission', id, expectedStatus: 'pending', actualStatus: submission.status },
      });
    }

    // If attempts are exhausted, "needs changes" would dead-end the user. Force reject instead.
    if (submission.revision >= MAX_RESUBMITS) {
      return res.status(400).json({
        errorCode: 'BAD_REQUEST',
        error: 'No resubmits remaining',
        message: `This submission already used ${submission.revision}/${MAX_RESUBMITS} resubmits. Please reject instead.`,
        details: { entity: 'submission', id, revision: submission.revision, maxResubmits: MAX_RESUBMITS },
      });
    }

    const updated = await prisma.memeSubmission.update({
      where: { id },
      data: {
        status: 'needs_changes',
        moderatorNotes: body.moderatorNotes,
      },
    });

    await logAdminAction(
      'needs_changes_submission',
      req.userId!,
      channelId,
      id,
      {
        submissionId: id,
        revision: submission.revision,
        maxResubmits: MAX_RESUBMITS,
        notes: body.moderatorNotes,
      },
      true,
      req
    );

    // Emit Socket.IO event to both streamer channel room and submitter user room.
    try {
      const io: Server = req.app.get('io');
      const channel = await prisma.channel.findUnique({
        where: { id: channelId },
        select: { slug: true },
      });
      if (channel) {
        const channelSlug = String(channel.slug).toLowerCase();
        const evt = {
          event: 'submission:needs_changes' as const,
          submissionId: id,
          channelId,
          channelSlug,
          submitterId: submission.submitterUserId,
          moderatorId: req.userId || undefined,
          userIds: [submission.submitterUserId].filter(Boolean),
          source: 'local' as const,
        };
        emitSubmissionEvent(io, evt);
        void relaySubmissionEventToPeer(evt);
      }
    } catch (error) {
      console.error('Error emitting submission:needs_changes event:', error);
    }

    return res.json(updated);
  } catch (error: any) {
    console.error('Error in needsChangesSubmission:', error);
    if (!res.headersSent) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          error: 'Validation error',
          message: 'Validation failed',
          details: error.errors,
        });
      }
      return res.status(500).json({
        error: 'Internal server error',
        message: 'Failed to update submission',
      });
    }
  }
};


