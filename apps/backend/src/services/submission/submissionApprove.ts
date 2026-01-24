import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { approveSubmissionSchema } from '../../shared/schemas.js';
import { ERROR_CODES } from '../../shared/errors.js';
import type { AdminSubmissionDeps } from './submissionTypes.js';
import { approveSubmissionInternal } from '../approveSubmissionInternal.js';
import { WalletService } from '../WalletService.js';
import { logger } from '../../utils/logger.js';
import { debugLog } from '../../utils/debug.js';
import { TransactionEventBuffer } from '../../utils/transactionEventBuffer.js';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { asRecord, getErrorMessage } from './submissionShared.js';
import { resolveApprovalInputs, type ApprovalSubmission } from './submissionApproveFileOps.js';
import { computeContentHash } from '../../utils/media/contentHash.js';
import { resolveLocalMediaPath } from '../../utils/media/resolveMediaPath.js';
import { ensureMemeAssetVariants } from '../memeAsset/ensureVariants.js';
import { enqueueSubmissionApprovedEvent, enqueueWalletRewardEvent } from './submissionNotifications.js';
import { handleApproveSubmissionError } from './submissionApproveErrors.js';

type Submission = ApprovalSubmission;
type PostApproveVariantInput = {
  memeAssetId: string;
  fileUrl: string;
  fileHash: string | null;
  durationMs: number;
};
export const approveSubmissionWithRepos = async (deps: AdminSubmissionDeps, req: AuthRequest, res: Response) => {
  const { submissions, transaction } = deps;
  const { id } = req.params;
  const channelId = req.channelId;
  let fileHashForCleanup: string | null = null;
  let fileHashRefAdded = false;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  debugLog('[DEBUG] approveSubmission started', { submissionId: id, channelId });

  let submission: Submission | null = null; // Declare submission in outer scope for error handling
  const postApproveVariantInputRef: { value: PostApproveVariantInput | null } = { value: null };
  try {
    const body = approveSubmissionSchema.parse(req.body);
    const io: Server = req.app.get('io');
    const eventBuffer = new TransactionEventBuffer();

    const precheck = await submissions.findUnique({
      where: { id },
      select: { id: true, channelId: true },
    });
    if (!precheck) {
      return res.status(404).json({
        errorCode: 'SUBMISSION_NOT_FOUND',
        error: 'Submission not found',
        details: { entity: 'submission', id },
      });
    }
    const ownsChannel = await assertChannelOwner({
      userId: req.userId,
      requestChannelId: channelId,
      channelId: precheck.channelId,
      res,
      notFound: { errorCode: ERROR_CODES.SUBMISSION_NOT_FOUND, entity: 'submission', id },
    });
    if (!ownsChannel) return;

    // Get submission first to check if it's imported (has sourceUrl)
    let submissionForBackground: { sourceUrl: string | null } | null = null;
    try {
      submissionForBackground = await submissions.findUnique({
        where: { id },
        select: { sourceUrl: true },
      });
    } catch {
      // Ignore, will check in transaction
    }
    const result = await (async () => {
      try {
        const txResult = await transaction(
          async (txRepos, tx) => {
            // Get submission WITHOUT tags to avoid transaction abort if MemeSubmissionTag table doesn't exist
            // The table may not exist on production, so we fetch without tags from the start
            try {
              submission = (await txRepos.submissions.findUnique({
                where: { id },
              })) as Submission | null;
              // Back-compat: Some deployments may not have MemeSubmissionTag table.
              // Keep approve flow working, but best-effort load tags when possible.
              if (submission) {
                const submissionWithTags = submission as Submission & { tags?: unknown[] };
                submissionWithTags.tags = [];
                try {
                  submissionWithTags.tags = await txRepos.submissions.findTags({
                    where: { submissionId: id },
                    include: { tag: { select: { name: true } } },
                  });
                } catch {
                  // Best-effort: never fail approve because tags couldn't be loaded.
                  // Common case: table missing (P2021). Other errors are tolerated too.
                  submissionWithTags.tags = [];
                }
              }
            } catch (error: unknown) {
              logger.error('admin.submissions.fetch_single_failed', { errorMessage: getErrorMessage(error) });
              throw new Error('Failed to fetch submission');
            }

            if (!submission) {
              throw new Error('SUBMISSION_NOT_FOUND');
            }
            if (submission.channelId !== channelId) {
              throw new Error('SUBMISSION_NOT_FOUND');
            }

            if (submission.status !== 'pending') {
              throw new Error('SUBMISSION_NOT_PENDING');
            }

            // Get channel to use default price and slug for Socket.IO
            debugLog('[DEBUG] Fetching channel for default price', { channelId });

            const channel = await txRepos.channels.findUnique({
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
            const channelSlug = channel?.slug ? String(channel.slug).toLowerCase() : null;
            const queueSubmissionApproved = () => {
              enqueueSubmissionApprovedEvent({
                io,
                eventBuffer,
                submissionId: id,
                channelId,
                channelSlug,
                moderatorId: req.userId,
              });
            };

            debugLog('[DEBUG] Channel fetched', {
              channelId,
              found: !!channel,
              defaultPriceCoins: channel?.defaultPriceCoins,
            });

            const defaultPrice = channel?.defaultPriceCoins ?? 100; // Use channel default or 100 as fallback
            const sourceKind = String(submission?.sourceKind || '').toLowerCase();
            const rewardForApproval =
              sourceKind === 'pool'
                ? (channel?.submissionRewardCoinsPool ?? 0)
                : (channel?.submissionRewardCoinsUpload ?? channel?.submissionRewardCoins ?? 0);

            // Pool submission: no file processing. Just create ChannelMeme + legacy Meme from MemeAsset.
            if (sourceKind === 'pool' && submission?.memeAssetId) {
              const asset = await txRepos.memes.asset.findUnique({
                where: { id: String(submission.memeAssetId) },
                select: { id: true, type: true, fileUrl: true, fileHash: true, durationMs: true, purgedAt: true },
              });
              if (!asset || asset.purgedAt) throw new Error('MEME_ASSET_NOT_FOUND');
              if (!asset.fileUrl) throw new Error('MEDIA_NOT_AVAILABLE');

              // Upsert ChannelMeme
              const cm = await txRepos.memes.channelMeme.upsert({
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
              const legacy = cm.legacyMemeId
                ? await txRepos.memes.meme.findUnique({ where: { id: cm.legacyMemeId } })
                : await txRepos.memes.meme.create({
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
                await txRepos.memes.channelMeme.update({
                  where: { id: cm.id },
                  data: { legacyMemeId: legacy.id },
                });
              }

              // Mark submission approved
              await txRepos.submissions.update({ where: { id }, data: { status: 'approved' } });

              queueSubmissionApproved();

              // Return legacy-shaped meme for current response compatibility
              return legacy;
            }

            const approvalInputs = await resolveApprovalInputs({
              submission,
              body,
              txRepos,
              channelId: submission.channelId,
              defaultPrice,
              req,
              id,
              fileHashForCleanup,
              fileHashRefAdded,
            });
            const { finalFileUrl, fileHash, durationMs, priceCoins, tagNames } = approvalInputs;
            fileHashForCleanup = approvalInputs.fileHashForCleanup;
            fileHashRefAdded = approvalInputs.fileHashRefAdded;
            let contentHash: string | null = null;
            try {
              const fileUrlForHash = finalFileUrl || submission.fileUrlTemp;
              if (fileUrlForHash) {
                const resolved = await resolveLocalMediaPath(fileUrlForHash);
                if (resolved) {
                  contentHash = await computeContentHash(resolved.localPath);
                  await resolved.cleanup();
                }
              }
            } catch (hashError) {
              const msg = hashError instanceof Error ? hashError.message : String(hashError);
              logger.warn('submission.approve.contenthash_failed', { submissionId: id, errorMessage: msg });
            }

            // Create approved meme + dual-write via shared internal helper (keeps AI auto-approve consistent).
            let approved: Awaited<ReturnType<typeof approveSubmissionInternal>>['legacyMeme'];
            try {
              const res = await approveSubmissionInternal({
                tx,
                submissionId: id,
                approvedByUserId: req.userId || null,
                resolved: {
                  finalFileUrl,
                  fileHash,
                  contentHash,
                  durationMs,
                  priceCoins,
                  tagNames,
                },
              });
              approved = res.legacyMeme;
              if (res.memeAssetId && finalFileUrl) {
                postApproveVariantInputRef.value = {
                  memeAssetId: res.memeAssetId,
                  fileUrl: finalFileUrl,
                  fileHash,
                  durationMs,
                };
              }
            } catch (error: unknown) {
              debugLog('[DEBUG] Error in approveSubmissionInternal', {
                submissionId: id,
                errorMessage: getErrorMessage(error),
                errorName: error instanceof Error ? error.name : undefined,
              });
              throw error;
            }

            // Reward submitter for approved submission (per-channel setting)
            // Only if enabled (>0) and submitter is not the moderator approving.
            // Policy: reward is granted ALWAYS (no online check) for both upload/url and pool.
            if (rewardForApproval > 0 && submission.submitterUserId && submission.submitterUserId !== req.userId) {
              const updatedWallet = await WalletService.incrementBalance(
                tx,
                { userId: submission.submitterUserId, channelId: submission.channelId },
                rewardForApproval
              );

              const submissionRewardEvent = {
                userId: submission.submitterUserId,
                channelId: submission.channelId,
                balance: updatedWallet.balance,
                delta: rewardForApproval,
                reason: 'submission_approved_reward',
                channelSlug: channel?.slug,
              };
              enqueueWalletRewardEvent({ io, eventBuffer, event: submissionRewardEvent });
            }

            queueSubmissionApproved();

            return approved;
          },
          {
            timeout: 30000, // 30 second timeout for transaction
            maxWait: 10000, // 10 second max wait for transaction to start
          }
        ).catch((txError: unknown) => {
          debugLog('[DEBUG] Transaction failed', {
            submissionId: id,
            errorMessage: getErrorMessage(txError),
            errorName: txError instanceof Error ? txError.name : undefined,
            errorCode: asRecord(txError).code,
          });
          throw txError;
        });
        eventBuffer.commit();
        return txResult;
      } finally {
        await eventBuffer.flush();
      }
    })();

    debugLog('[DEBUG] Transaction completed successfully', { submissionId: id, resultId: asRecord(result).id });

    // Imported memes keep using their original sourceUrl as fileUrl.
    // This avoids broken local /uploads links if background downloads fail or go to a different instance/dir.

    // NOTE: kept for future background handling (was present in original file).
    void submissionForBackground;

    const postApproveVariantInput = postApproveVariantInputRef.value;
    if (postApproveVariantInput) {
      void ensureMemeAssetVariants({
        memeAssetId: postApproveVariantInput.memeAssetId,
        sourceFileUrl: postApproveVariantInput.fileUrl,
        sourceFileHash: postApproveVariantInput.fileHash,
        sourceDurationMs: postApproveVariantInput.durationMs,
      }).catch((err) => {
        logger.warn('submission.approve.ensure_variants_failed', {
          submissionId: id,
          memeAssetId: postApproveVariantInput?.memeAssetId,
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      });
    }

    res.json(result);
  } catch (error: unknown) {
    await handleApproveSubmissionError({
      error,
      res,
      submission,
      submissionId: id,
      fileHashRefAdded,
      fileHashForCleanup,
    });
    return;
  }
};
