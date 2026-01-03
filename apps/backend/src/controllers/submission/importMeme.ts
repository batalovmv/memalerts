import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { importMemeSchema } from '../../shared/index.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { calculateFileHash, decrementFileHashReference, downloadFileFromUrl, findOrCreateFileHash, getFileStats } from '../../utils/fileHash.js';
import { validateFileContent } from '../../utils/fileTypeValidator.js';
import { getStreamDurationSnapshot } from '../../realtime/streamDurationStore.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { makeAutoDescription } from '../../utils/ai/description.js';
import fs from 'fs';

async function safeUnlink(filePath: string): Promise<void> {
  try {
    await fs.promises.unlink(filePath);
  } catch {
    // ignore
  }
}

export const importMeme = async (req: AuthRequest, res: Response) => {
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

  // Owner bypass must be based on JWT channelId to avoid mismatches.
  // If the authenticated user is the streamer/admin for this channel (req.channelId === target channelId),
  // then import should be auto-approved (no pending request).
  const isOwner =
    !!req.userId && !!req.channelId && (req.userRole === 'streamer' || req.userRole === 'admin') && String(req.channelId) === String(channelId);

  // Block viewer submissions when disabled (global per-channel gate).
  // IMPORTANT: enforce server-side before heavy work (download/hash).
  if (!isOwner && !(channel as any).submissionsEnabled) {
    return res.status(403).json({
      error: 'Submissions are disabled for this channel',
      errorCode: 'SUBMISSIONS_DISABLED',
    });
  }

  // Optional: allow submissions only while stream is online (best-effort).
  if (!isOwner && (channel as any).submissionsOnlyWhenLive) {
    const slug = String((channel as any).slug || '').toLowerCase();
    const snap = await getStreamDurationSnapshot(slug);
    if (snap.status !== 'online') {
      return res.status(403).json({
        error: 'Submissions are allowed only while the stream is live',
        errorCode: 'SUBMISSIONS_OFFLINE',
      });
    }
  }

  try {
    const body = importMemeSchema.parse(req.body);

    const titleInput = typeof (body as any).title === 'string' ? String((body as any).title).trim() : '';
    const userProvidedTitle = titleInput.length > 0;
    // DB requires non-empty title; if user omitted, use a safe placeholder and let AI replace it later.
    const finalTitle = userProvidedTitle ? titleInput : 'Мем';

    // Validate URL is from memalerts.com or cdns.memealerts.com
    const isValidUrl = body.sourceUrl.includes('memalerts.com') || body.sourceUrl.includes('cdns.memealerts.com');
    if (!isValidUrl) {
      return res.status(400).json({
        errorCode: 'INVALID_MEDIA_URL',
        error: 'Invalid media URL',
        details: { allowed: ['memalerts.com', 'cdns.memealerts.com'] },
      });
    }

    // Download the file to our server immediately (so we don't depend on external CDN),
    // then deduplicate by SHA-256 hash.
    let tempFilePath: string | null = null;
    let finalFilePath: string | null = null;
    let fileHash: string | null = null;
    let detectedDurationMs: number | null = null;
    try {
      tempFilePath = await downloadFileFromUrl(body.sourceUrl);

      // Validate file content using magic bytes (best-effort)
      // (downloaded files can be spoofed or corrupted)
      const contentValidation = await validateFileContent(tempFilePath, 'video/webm');
      if (!contentValidation.valid) {
        await safeUnlink(tempFilePath);
        return res.status(400).json({
          error: 'Invalid file content',
          message: contentValidation.error || 'File content does not look like a valid video',
        });
      }

      // Enforce size/duration limits
      const stat = await fs.promises.stat(tempFilePath);
      const MAX_SIZE = 50 * 1024 * 1024; // 50MB
      if (stat.size > MAX_SIZE) {
        await safeUnlink(tempFilePath);
        return res.status(413).json({
          errorCode: 'FILE_TOO_LARGE',
          error: 'File too large',
          details: { maxBytes: MAX_SIZE, sizeBytes: stat.size },
        });
      }

      const metadata = await getVideoMetadata(tempFilePath);
      const durationSec = metadata?.duration && metadata.duration > 0 ? metadata.duration : null;
      const durationMs = durationSec !== null ? Math.round(durationSec * 1000) : null;
      detectedDurationMs = durationMs;
      if (durationMs !== null && durationMs > 15000) {
        await safeUnlink(tempFilePath);
        return res.status(413).json({
          errorCode: 'VIDEO_TOO_LONG',
          error: 'Video is too long',
          details: { maxDurationMs: 15000, durationMs },
        });
      }

      const hash = await calculateFileHash(tempFilePath);
      const stats = await getFileStats(tempFilePath);
      const dedup = await findOrCreateFileHash(tempFilePath, hash, stats.mimeType, stats.size);
      finalFilePath = dedup.filePath;
      fileHash = hash;
    } catch (dlErr: any) {
      if (tempFilePath) {
        await safeUnlink(tempFilePath);
      }
      return res.status(502).json({
        errorCode: 'UPLOAD_FAILED',
        error: 'Upload failed',
        message: dlErr?.message || 'Download failed',
      });
    }

    // Invariant: if the target channel already has this asset enabled, return 409 for all submission endpoints.
    // For import we always have a fileHash unless hashing fails catastrophically.
    if (fileHash) {
      const existingAsset = await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: { id: true, type: true, fileUrl: true, fileHash: true, durationMs: true, purgeRequestedAt: true, purgedAt: true },
      });

      if (existingAsset) {
        // Safety: forbid re-import by hash if the asset was deleted (quarantine) or purged.
        if (existingAsset.purgeRequestedAt || existingAsset.purgedAt) {
          try {
            await decrementFileHashReference(fileHash);
          } catch {
            // ignore
          }
          return res.status(410).json({
            errorCode: 'ASSET_PURGED_OR_QUARANTINED',
            error: 'This meme was deleted and cannot be imported again',
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
          select: { id: true, deletedAt: true, legacyMemeId: true, memeAssetId: true },
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

          const defaultPrice = (channel as any).defaultPriceCoins ?? 100;
          const now = new Date();

          const restored = await prisma.channelMeme.update({
            where: { id: existingCm.id },
            data: {
              status: 'approved',
              deletedAt: null,
              title: finalTitle,
              priceCoins: defaultPrice,
              approvedByUserId: req.userId!,
              approvedAt: now,
            },
            select: { id: true, legacyMemeId: true, memeAssetId: true },
          });

          // Fast fallback for owner restore (so includeAi=1 is non-null immediately),
          // but keep aiStatus=pending so the real AI job (OpenAI) can overwrite with better data.
          const fallbackDesc = userProvidedTitle ? makeAutoDescription({ title: finalTitle, transcript: null, labels: [] }) : null;
          const fallbackTags = userProvidedTitle ? generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames : [];
          const fallbackSearchText = fallbackDesc ? String(fallbackDesc).slice(0, 4000) : null;

          await prisma.channelMeme.update({
            where: { id: restored.id },
            data: {
              aiAutoDescription: fallbackDesc ? String(fallbackDesc).slice(0, 2000) : null,
              aiAutoTagNamesJson: fallbackTags,
              searchText: fallbackSearchText,
            } as any,
          });

          const legacyData: any = {
            channelId,
            title: finalTitle,
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

          // Create a submission row to drive AI pipeline (real analysis is async).
          try {
            if (existingAsset.fileUrl) {
              await prisma.memeSubmission.create({
                data: {
                  channelId: String(channelId),
                  submitterUserId: req.userId!,
                  title: finalTitle,
                  type: existingAsset.type,
                  fileUrlTemp: existingAsset.fileUrl,
                  sourceKind: 'upload',
                  status: 'approved',
                  memeAssetId: existingAsset.id,
                  fileHash: existingAsset.fileHash ?? null,
                  durationMs: Number.isFinite(existingAsset.durationMs as any) && existingAsset.durationMs > 0 ? existingAsset.durationMs : null,
                  aiStatus: 'pending',
                } as any,
              });
            }
          } catch {
            // ignore
          }

          return res.status(201).json({
            ...(legacy as any),
            isDirectApproval: true,
            channelMemeId: restored.id,
            memeAssetId: restored.memeAssetId,
            sourceKind: 'url',
            isRestored: true,
            status: 'approved',
            deletedAt: null,
          });
        }
      }
    }

    // Get or create tags with timeout protection (same as createSubmission)
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

    // Owner bypass: create meme directly (approved) and dual-write to MemeAsset + ChannelMeme.
    if (isOwner) {
      const defaultPrice = (channel as any).defaultPriceCoins ?? 100;
      const durationMsSafe = Math.max(0, Math.min(detectedDurationMs ?? 0, 15000));

      const memeCreateData: any = {
        channelId,
        title: finalTitle,
        type: 'video',
        fileUrl: finalFilePath,
        fileHash,
        durationMs: durationMsSafe,
        priceCoins: defaultPrice,
        status: 'approved',
        createdByUserId: req.userId!,
        approvedByUserId: req.userId!,
      };

      if (tagIds.length > 0) {
        memeCreateData.tags = {
          create: tagIds.map((tagId) => ({ tagId })),
        };
      }

      let meme: any;
      try {
        meme = await prisma.meme.create({
          data: memeCreateData,
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
      } catch (dbError: any) {
        // Back-compat: MemeTag table might be missing on older DBs.
        if (dbError?.code === 'P2021' && dbError?.meta?.table === 'public.MemeTag') {
          meme = await prisma.meme.create({
            data: {
              channelId,
              title: finalTitle,
              type: 'video',
              fileUrl: finalFilePath,
              fileHash,
              durationMs: durationMsSafe,
              priceCoins: defaultPrice,
              status: 'approved',
              createdByUserId: req.userId!,
              approvedByUserId: req.userId!,
            },
          });
        } else {
          throw dbError;
        }
      }

      // Dual-write (required for strict client contract): create/find asset and upsert channel adoption.
      let memeAssetId: string | null = null;
      let channelMemeId: string | null = null;
      try {
        const existingAsset =
          fileHash
            ? await prisma.memeAsset.findFirst({ where: { fileHash }, select: { id: true } })
            : await prisma.memeAsset.findFirst({
                where: { fileHash: null, fileUrl: finalFilePath, type: 'video', durationMs: durationMsSafe },
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
                durationMs: durationMsSafe,
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
            title: finalTitle,
            priceCoins: defaultPrice,
            addedByUserId: req.userId!,
            approvedByUserId: req.userId!,
            approvedAt: new Date(),
          },
          update: {
            legacyMemeId: meme?.id || null,
            status: 'approved',
            title: finalTitle,
            priceCoins: defaultPrice,
            approvedByUserId: req.userId!,
            approvedAt: new Date(),
            deletedAt: null,
          },
          select: { id: true },
        });
        channelMemeId = cm.id;
      } catch (e: any) {
        if (e?.code === 'P2002') {
          return res.status(409).json({
            errorCode: 'ALREADY_IN_CHANNEL',
            error: 'This meme is already in your channel',
            requestId: req.requestId,
          });
        }
        throw e;
      }

      // Fast fallback for owner bypass (so includeAi=1 is non-null immediately),
      // but keep aiStatus=pending so the real AI job (OpenAI) can overwrite with better data.
      const fallbackDesc = userProvidedTitle ? makeAutoDescription({ title: finalTitle, transcript: null, labels: [] }) : null;
      const fallbackTags = userProvidedTitle ? generateTagNames({ title: finalTitle, transcript: null, labels: [] }).tagNames : [];
      const fallbackSearchText = fallbackDesc ? String(fallbackDesc).slice(0, 4000) : null;

      try {
        await prisma.channelMeme.updateMany({
          where: { id: channelMemeId! },
          data: {
            aiAutoDescription: fallbackDesc ? String(fallbackDesc).slice(0, 2000) : null,
            aiAutoTagNamesJson: fallbackTags,
            searchText: fallbackSearchText,
          } as any,
        });
      } catch {
        // ignore
      }

      // Create a submission row to drive AI pipeline (real analysis is async).
      try {
        await prisma.memeSubmission.create({
          data: {
            channelId: String(channelId),
            submitterUserId: req.userId!,
            title: finalTitle,
            type: 'video',
            fileUrlTemp: finalFilePath!,
            sourceKind: 'upload',
            status: 'approved',
            memeAssetId,
            fileHash,
            durationMs: durationMsSafe > 0 ? durationMsSafe : null,
            aiStatus: 'pending',
          } as any,
        });
      } catch {
        // ignore
      }

      return res.status(201).json({
        ...meme,
        isDirectApproval: true,
        channelMemeId,
        memeAssetId,
        isRestored: false,
        status: 'approved',
        deletedAt: null,
      });
    }

    // Create submission with local fileUrlTemp (not external URL)
    const submissionData: any = {
      channelId,
      submitterUserId: req.userId!,
      title: finalTitle,
      type: 'video', // Imported memes are treated as video
      fileUrlTemp: finalFilePath, // Local path (deduped)
      sourceUrl: body.sourceUrl,
      sourceKind: 'url',
      notes: body.notes || null,
      status: 'pending',
    };

    // Only add tags if we have tagIds
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
            title: finalTitle,
            type: 'video',
            // Keep fileUrlTemp as local stored path (same as the main path),
            // so approve/AI jobs can validate it and /uploads works.
            fileUrlTemp: finalFilePath ?? body.sourceUrl,
            sourceUrl: body.sourceUrl,
            sourceKind: 'url',
            notes: body.notes || null,
            status: 'pending',
          },
        });
      } else if (dbError?.message === 'Submission creation timeout') {
        return res.status(408).json({
          error: 'Request timeout',
          message: 'Submission creation timed out. Please try again.',
        });
      } else {
        throw dbError;
      }
    }

    // Send response immediately after creating submission
    res.status(201).json(submission);
  } catch (error) {
    throw error;
  }
};


