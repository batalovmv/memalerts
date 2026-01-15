import type { AuthRequest } from '../../middleware/auth.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { logger } from '../../utils/logger.js';

export async function resolveSubmissionTagIds(opts: {
  req: AuthRequest;
  channelId: string;
  tags: string[];
}): Promise<string[]> {
  const { req, channelId, tags } = opts;
  let tagIds: string[] = [];
  try {
    const tagsPromise = getOrCreateTags(tags);
    const tagsTimeout = new Promise<string[]>((resolve) => {
      setTimeout(() => {
        logger.warn('submission.tags.creation_timeout', {
          requestId: req.requestId,
          userId: req.userId,
          channelId,
        });
        resolve([]);
      }, 5000);
    });
    tagIds = await Promise.race([tagsPromise, tagsTimeout]);
  } catch (error) {
    logger.warn('submission.tags.creation_failed', {
      requestId: req.requestId,
      userId: req.userId,
      channelId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    tagIds = [];
  }
  return tagIds;
}
