import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import { importMemeSchema } from '../../shared/index.js';
import { getVideoMetadata } from '../../utils/videoValidator.js';
import { getOrCreateTags } from '../../utils/tags.js';
import { calculateFileHash, downloadFileFromUrl, findOrCreateFileHash, getFileStats } from '../../utils/fileHash.js';
import { validateFileContent } from '../../utils/fileTypeValidator.js';
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
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  try {
    const body = importMemeSchema.parse(req.body);

    // Validate URL is from memalerts.com or cdns.memealerts.com
    const isValidUrl = body.sourceUrl.includes('memalerts.com') || body.sourceUrl.includes('cdns.memealerts.com');
    if (!isValidUrl) {
      return res.status(400).json({ error: 'Source URL must be from memalerts.com or cdns.memealerts.com' });
    }

    // Download the file to our server immediately (so we don't depend on external CDN),
    // then deduplicate by SHA-256 hash.
    let tempFilePath: string | null = null;
    let finalFilePath: string | null = null;
    let fileHash: string | null = null;
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
        return res.status(400).json({
          error: `Video file size (${(stat.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`,
        });
      }

      const metadata = await getVideoMetadata(tempFilePath);
      const durationSec = metadata?.duration && metadata.duration > 0 ? metadata.duration : null;
      const durationMs = durationSec !== null ? Math.round(durationSec * 1000) : null;
      if (durationMs !== null && durationMs > 15000) {
        await safeUnlink(tempFilePath);
        return res.status(400).json({
          error: `Video duration (${(durationMs / 1000).toFixed(2)}s) exceeds maximum allowed duration (15s)`,
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
        error: 'Failed to import meme from source URL',
        message: dlErr?.message || 'Download failed',
      });
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

    // Create submission with local fileUrlTemp (not external URL)
    const submissionData: any = {
      channelId,
      submitterUserId: req.userId!,
      title: body.title,
      type: 'video', // Imported memes are treated as video
      fileUrlTemp: finalFilePath, // Local path (deduped)
      sourceUrl: body.sourceUrl,
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
            title: body.title,
            type: 'video',
            fileUrlTemp: body.sourceUrl,
            sourceUrl: body.sourceUrl,
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


