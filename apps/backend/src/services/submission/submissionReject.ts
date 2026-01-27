import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { ZodError } from 'zod';
import { rejectSubmissionSchema } from '../../shared/schemas.js';
import { ERROR_CODES } from '../../shared/errors.js';
import type { AdminSubmissionDeps } from './submissionTypes.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { logger } from '../../utils/logger.js';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { getErrorMessage } from './submissionShared.js';
import { evaluateAndApplySpamBan } from '../spamBan.js';
import { prisma } from '../../lib/prisma.js';
export const rejectSubmissionWithRepos = async (deps: AdminSubmissionDeps, req: AuthRequest, res: Response) => {
  const { channels, submissions } = deps;
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const body = rejectSubmissionSchema.parse(req.body);

    const submission = await submissions.findUnique({
      where: { id },
      select: { id: true, channelId: true, status: true, submitterUserId: true },
    });

    if (!submission) {
      return res.status(404).json({
        errorCode: 'SUBMISSION_NOT_FOUND',
        error: 'Submission not found',
        details: { entity: 'submission', id },
      });
    }
    const ownsChannel = await assertChannelOwner({
      userId: req.userId,
      requestChannelId: channelId,
      channelId: submission.channelId,
      res,
      notFound: { errorCode: ERROR_CODES.SUBMISSION_NOT_FOUND, entity: 'submission', id },
    });
    if (!ownsChannel) return;
    if (submission.status !== 'pending') {
      return res.status(409).json({
        errorCode: 'SUBMISSION_NOT_PENDING',
        error: 'Submission is not pending',
        details: { entity: 'submission', id, expectedStatus: 'pending', actualStatus: submission.status },
      });
    }

    const updated = await submissions.update({
      where: { id },
      data: {
        status: 'rejected',
        moderatorNotes: body.moderatorNotes || null,
      },
    });

    if (submission.submitterUserId) {
      try {
        await prisma.channelSubmissionStreak.update({
          where: { channelId_userId: { channelId: submission.channelId, userId: submission.submitterUserId } },
          data: { streakCount: 0, lastRejectedAt: new Date() },
        });
      } catch {
        // Best-effort: streak row may not exist yet.
        await prisma.channelSubmissionStreak.create({
          data: {
            channelId: submission.channelId,
            userId: submission.submitterUserId,
            streakCount: 0,
            lastRejectedAt: new Date(),
          },
        }).catch(() => {});
      }
    }

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
      const channel = await channels.findUnique({
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
      logger.error('admin.submissions.emit_rejected_failed', { errorMessage: getErrorMessage(error) });
      // Don't fail the request if Socket.IO emit fails
    }

    if (submission.submitterUserId) {
      try {
        await evaluateAndApplySpamBan(submission.submitterUserId);
      } catch (spamError) {
        logger.warn('submission.spam_ban_check_failed', { errorMessage: getErrorMessage(spamError) });
      }
    }

    res.json(updated);
  } catch (error: unknown) {
    logger.error('admin.submissions.reject_failed', { errorMessage: getErrorMessage(error) });
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
