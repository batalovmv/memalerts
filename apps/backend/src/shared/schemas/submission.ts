import { z } from 'zod';

export const submissionStatusSchema = z.enum(['pending', 'needs_changes', 'approved', 'rejected']);

export const createSubmissionSchema = z.object({
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    // Title can be omitted; we will auto-generate later (AI) and use a safe placeholder meanwhile.
    z.string().max(200).optional().default('')
  ),
  type: z.literal('video'), // Only video allowed
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const importMemeSchema = z.object({
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    // Title can be omitted; we will auto-generate later (AI) and use a safe placeholder meanwhile.
    z.string().max(200).optional().default('')
  ),
  sourceUrl: z.string().url(), // URL from memalerts.com
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Array of tag names
});

export const createPoolSubmissionSchema = z.object({
  channelId: z.string().uuid(),
  memeAssetId: z.string().uuid(),
  // Back-compat: older frontend sent only memeAssetId + channelId.
  // We still require a non-empty title in DB, so provide a safe default.
  title: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim() : v),
    // Allow omitted/empty; controller will decide: user-provided title > asset aiAutoTitle > safe placeholder.
    z.string().max(200).optional().default('')
  ),
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]),
});

export const approveSubmissionSchema = z.object({
  priceCoins: z.number().int().positive().optional().default(100), // Standard price: 100 coins
  durationMs: z.number().int().positive().optional().default(15000), // Standard duration: 15 seconds (15000ms)
  tags: z.array(z.string().min(1).max(50)).optional().default([]), // Tags to apply to approved meme
});

export const rejectSubmissionSchema = z.object({
  moderatorNotes: z.string().max(1000).optional().nullable(),
});

export const needsChangesSubmissionSchema = z.object({
  moderatorNotes: z.string().min(1).max(1000),
});

export const bulkSubmissionsSchema = z
  .object({
    ids: z.array(z.string().uuid()).min(1).max(200),
    action: z.enum(['approve', 'reject', 'needs_changes']),
    moderatorNotes: z.string().max(1000).optional().nullable(),
  })
  .superRefine((obj, ctx) => {
    if (obj.action === 'needs_changes' && !obj.moderatorNotes) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['moderatorNotes'],
        message: 'moderatorNotes is required for needs_changes',
      });
    }
  });

export const resubmitSubmissionSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(500).optional().nullable(),
  tags: z.array(z.string().min(1).max(50)).optional().default([]),
});
