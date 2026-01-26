import { z } from 'zod';

import {
  SubmissionAiDecisionSchema,
  SubmissionAiStatusSchema,
  SubmissionSourceKindSchema,
  SubmissionStatusSchema,
} from '../common/enums';
import { MemeTypeSchema, TagSchema } from './meme';

export const SubmissionSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: MemeTypeSchema,
  fileUrlTemp: z.string(),
  fileHash: z.string().nullable().optional(),
  durationMs: z.number().nullable().optional(),
  mimeType: z.string().nullable().optional(),
  fileSizeBytes: z.number().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  notes: z.string().nullable(),
  status: SubmissionStatusSchema,
  sourceKind: SubmissionSourceKindSchema.optional(),
  memeAssetId: z.string().nullable().optional(),
  moderatorNotes: z.string().nullable().optional(),
  revision: z.number().optional(),
  tags: z.array(z.object({ tag: TagSchema })).optional(),
  aiStatus: SubmissionAiStatusSchema.nullable().optional(),
  aiDecision: SubmissionAiDecisionSchema.nullable().optional(),
  aiRiskScore: z.number().nullable().optional(),
  aiLabelsJson: z.array(z.string()).nullable().optional(),
  aiTranscript: z.string().nullable().optional(),
  aiAutoTagNamesJson: z.array(z.string()).nullable().optional(),
  aiAutoDescription: z.string().nullable().optional(),
  aiModelVersionsJson: z.record(z.unknown()).nullable().optional(),
  aiCompletedAt: z.string().nullable().optional(),
  aiLastTriedAt: z.string().nullable().optional(),
  aiRetryCount: z.number().nullable().optional(),
  aiNextRetryAt: z.string().nullable().optional(),
  aiError: z.string().nullable().optional(),
  aiLockExpiresAt: z.string().nullable().optional(),
  aiProcessingStartedAt: z.string().nullable().optional(),
  submitter: z.object({
    id: z.string(),
    displayName: z.string(),
  }),
  createdAt: z.string(),
  updatedAt: z.string().optional(),
});

export type Submission = z.infer<typeof SubmissionSchema>;
