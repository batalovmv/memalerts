import { prisma } from '../../lib/prisma.js';
import { logger } from '../../utils/logger.js';
import { resolveAiModerationFileContext } from './aiModerationFileContext.js';
import { runAiModerationPipeline } from './aiModerationPipeline.js';
import { persistAiModerationResults } from './aiModerationPersistence.js';
import { tryReuseAiResults } from './aiModerationReuse.js';
import { maybeAutoApproveSubmission } from './aiModerationAutoApprove.js';
import type { AiModerationSubmission } from './aiModerationTypes.js';

async function loadSubmissionForModeration(submissionId: string): Promise<AiModerationSubmission | null> {
  const submission = await prisma.memeSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      channelId: true,
      submitterUserId: true,
      memeAssetId: true,
      title: true,
      notes: true,
      status: true,
      sourceKind: true,
      fileUrlTemp: true,
      fileHash: true,
      durationMs: true,
      aiStatus: true,
      aiRetryCount: true,
    },
  });

  if (!submission) return null;
  if (submission.status !== 'pending' && submission.status !== 'approved') return null;
  {
    const sk = String(submission.sourceKind || '').toLowerCase();
    if (sk !== 'upload' && sk !== 'url') return null;
  }

  return submission;
}

export async function processOneSubmission(submissionId: string): Promise<void> {
  const now = new Date();
  const submission = await loadSubmissionForModeration(submissionId);
  if (!submission) return;

  const fileContext = await resolveAiModerationFileContext(submission, submissionId);
  const { fileUrl, localPath, localFileExists, localRootUsed, fileHash, durationMs } = fileContext;

  const reused = await tryReuseAiResults({ submission, fileHash, now });
  if (reused) return;

  if (fileUrl.startsWith('/uploads/') && localPath && !localFileExists) {
    logger.warn('ai_moderation.file_missing', {
      submissionId,
      fileUrl,
      uploadDirEnv: process.env.UPLOAD_DIR || null,
      localRootUsed,
      reason: 'missing_file_on_disk_before_processing',
    });
    throw new Error('missing_file_on_disk');
  }

  const pipeline = await runAiModerationPipeline({ submission, fileUrl, localPath });
  await persistAiModerationResults({ submission, fileHash, fileUrl, durationMs, now, pipeline });
  await maybeAutoApproveSubmission({ submission, fileUrl, fileHash, durationMs, pipeline });
}
