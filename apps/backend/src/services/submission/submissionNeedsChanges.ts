import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { ZodError } from 'zod';
import { needsChangesSubmissionSchema } from '../../shared/schemas.js';
import { ERROR_CODES } from '../../shared/errors.js';
import type { AdminSubmissionDeps } from './submissionTypes.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { logger } from '../../utils/logger.js';
import { assertChannelOwner } from '../../utils/accessControl.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { getErrorMessage } from './submissionShared.js';
export const needsChangesSubmissionWithRepos = async (deps: AdminSubmissionDeps, req: AuthRequest, res: Response) => {
  const { channels, submissions } = deps;
  const { id } = req.params;
  const channelId = req.channelId;

  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const maxFromEnv = parseInt(String(process.env.SUBMISSION_MAX_RESUBMITS || ''), 10);
  const MAX_RESUBMITS = Number.isFinite(maxFromEnv) && maxFromEnv >= 0 ? maxFromEnv : 2;

  try {
    const body = needsChangesSubmissionSchema.parse(req.body);

    const submission = await submissions.findUnique({
      where: { id },
      select: { id: true, channelId: true, status: true, submitterUserId: true, revision: true },
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

    // If attempts are exhausted, "needs changes" would dead-end the user. Force reject instead.
    if (submission.revision >= MAX_RESUBMITS) {
      return res.status(400).json({
        errorCode: 'BAD_REQUEST',
        error: 'No resubmits remaining',
        message: `This submission already used ${submission.revision}/${MAX_RESUBMITS} resubmits. Please reject instead.`,
        details: { entity: 'submission', id, revision: submission.revision, maxResubmits: MAX_RESUBMITS },
      });
    }

    const updated = await submissions.update({
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
      const channel = await channels.findUnique({
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
      logger.error('admin.submissions.emit_needs_changes_failed', { errorMessage: getErrorMessage(error) });
    }

    return res.json(updated);
  } catch (error: unknown) {
    logger.error('admin.submissions.needs_changes_failed', { errorMessage: getErrorMessage(error) });
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

export type SubmissionService = {
  create: (req: AuthRequest, res: Response) => Promise<unknown>;
  getAdminSubmissions: (req: AuthRequest, res: Response) => Promise<unknown>;
  approve: (req: AuthRequest, res: Response) => Promise<unknown>;
  reject: (req: AuthRequest, res: Response) => Promise<unknown>;
  needsChanges: (req: AuthRequest, res: Response) => Promise<unknown>;
};
