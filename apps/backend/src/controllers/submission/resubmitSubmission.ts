import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import type { Server } from 'socket.io';
import { ZodError } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { resubmitSubmissionSchema } from '../../shared/schemas.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { logAdminAction } from '../../utils/auditLogger.js';
import { emitSubmissionEvent, relaySubmissionEventToPeer } from '../../realtime/submissionBridge.js';
import { assertSubmissionOwner } from '../../utils/accessControl.js';
import { logger } from '../../utils/logger.js';

export const resubmitSubmission = async (req: AuthRequest, res: Response) => {
  const { id } = req.params;
  const userId = req.userId;

  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const maxFromEnv = parseInt(String(process.env.SUBMISSION_MAX_RESUBMITS || ''), 10);
  const MAX_RESUBMITS = Number.isFinite(maxFromEnv) && maxFromEnv >= 0 ? maxFromEnv : 2;

  try {
    const body = resubmitSubmissionSchema.parse(req.body);

    const existing = await assertSubmissionOwner(userId, id, res);
    if (!existing) return;

    if (existing.status !== 'needs_changes') {
      return res.status(400).json({ error: 'Submission is not awaiting changes' });
    }

    if (existing.revision >= MAX_RESUBMITS) {
      return res.status(400).json({
        error: 'No resubmits remaining',
        message: `This submission already used ${existing.revision}/${MAX_RESUBMITS} resubmits.`,
      });
    }

    const tagIds = await getOrCreateTags(body.tags || []);

    const updated = await prisma.$transaction(async (tx) => {
      // Update base fields + increment revision + clear moderatorNotes.
      const next = await tx.memeSubmission.update({
        where: { id },
        data: {
          title: body.title,
          notes: body.notes ?? null,
          status: 'pending',
          moderatorNotes: null,
          revision: { increment: 1 },
        },
      });

      // Update tags (best-effort; some deployments may not have the table).
      if (tagIds.length > 0) {
        try {
          await tx.memeSubmissionTag.deleteMany({ where: { submissionId: id } });
          await tx.memeSubmissionTag.createMany({
            data: tagIds.map((tagId) => ({ submissionId: id, tagId })),
            skipDuplicates: true,
          });
        } catch (error) {
          const err = error as { code?: string; meta?: { table?: string } };
          // Ignore missing-table errors for back-compat.
          if (!(err.code === 'P2021' && err.meta?.table === 'public.MemeSubmissionTag')) {
            throw error;
          }
        }
      } else {
        // If no tags provided, still try to clear existing.
        try {
          await tx.memeSubmissionTag.deleteMany({ where: { submissionId: id } });
        } catch (error) {
          const err = error as { code?: string; meta?: { table?: string } };
          if (!(err.code === 'P2021' && err.meta?.table === 'public.MemeSubmissionTag')) {
            throw error;
          }
        }
      }

      return next;
    });

    // Log as an audit action (reusing audit logger; actor is the submitter).
    await logAdminAction(
      'resubmit_submission',
      userId,
      existing.channelId,
      id,
      { submissionId: id, revisionAfter: existing.revision + 1, maxResubmits: MAX_RESUBMITS },
      true,
      req
    );

    // Emit realtime event so streamer list can refresh.
    try {
      const io: Server = req.app.get('io');
      const channel = await prisma.channel.findUnique({
        where: { id: existing.channelId },
        select: { slug: true },
      });
      if (channel) {
        const channelSlug = String(channel.slug).toLowerCase();
        const evt = {
          event: 'submission:resubmitted' as const,
          submissionId: id,
          channelId: existing.channelId,
          channelSlug,
          submitterId: userId,
          source: 'local' as const,
        };
        emitSubmissionEvent(io, evt);
        void relaySubmissionEventToPeer(evt);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error('submission.resubmitted_emit_failed', { errorMessage });
    }

    return res.json(updated);
  } catch (error) {
    const err = error as Error;
    logger.error('submission.resubmit_failed', { errorMessage: err.message });
    if (error instanceof ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    return res.status(500).json({ error: 'Internal server error', message: 'Failed to resubmit submission' });
  }
};



