import { z } from 'zod';

import { SubmissionAiStatusSchema } from '../common/enums';

export const MemeTypeSchema = z.enum(['video', 'audio', 'image', 'gif']);
export const MemeStatusSchema = z.enum([
  'approved',
  'pending',
  'rejected',
  'disabled',
  'active',
  'inactive',
  'deleted',
]);

export const MemeVariantSchema = z.object({
  format: z.enum(['webm', 'mp4', 'preview']),
  fileUrl: z.string(),
  sourceType: z.string(),
  fileSizeBytes: z.number().int().nullable(),
});

export const TagSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(50),
});

export const MemeAuthorSchema = z.object({
  id: z.string().uuid(),
  displayName: z.string(),
});

export const MemeListItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  type: MemeTypeSchema,

  fileUrl: z.string(),
  previewUrl: z.string().nullable(),
  variants: z.array(MemeVariantSchema),

  priceCoins: z.number().int().min(0),

  durationMs: z.number().int().min(0),
  activationsCount: z.number().int().min(0),
  createdAt: z.string().datetime(),
});

export const MemeDetailSchema = MemeListItemSchema.extend({
  status: MemeStatusSchema.optional(),

  channelMemeId: z.string().optional(),
  legacyMemeId: z.string().optional(),
  memeAssetId: z.string().nullable().optional(),
  playFileUrl: z.string().nullable().optional(),
  fileHash: z.string().nullable().optional(),
  channelId: z.string().optional(),
  deletedAt: z.string().datetime().nullable().optional(),

  basePriceCoins: z.number().int().min(0).optional(),
  dynamicPriceCoins: z.number().int().min(0).optional(),
  priceMultiplier: z.number().min(0).max(10).optional(),
  priceTrend: z.enum(['rising', 'falling', 'stable']).optional(),

  cooldownMinutes: z.number().int().min(0).optional(),
  cooldownSecondsRemaining: z.number().int().min(0).optional(),
  cooldownUntil: z.string().datetime().nullable().optional(),

  tags: z.array(TagSchema).optional(),

  aiAutoTitle: z.string().nullable().optional(),
  aiAutoDescription: z.string().nullable().optional(),
  aiAutoTagNames: z.array(z.string()).nullable().optional(),
  aiStatus: SubmissionAiStatusSchema.nullable().optional(),

  qualityScore: z.number().min(0).max(100).nullable().optional(),

  isFavorite: z.boolean().optional(),
  isHidden: z.boolean().optional(),

  createdBy: MemeAuthorSchema.nullable().optional(),
});

export type MemeType = z.infer<typeof MemeTypeSchema>;
export type MemeStatus = z.infer<typeof MemeStatusSchema>;
export type MemeVariant = z.infer<typeof MemeVariantSchema>;
export type Tag = z.infer<typeof TagSchema>;
export type MemeAuthor = z.infer<typeof MemeAuthorSchema>;
export type MemeListItem = z.infer<typeof MemeListItemSchema>;
export type MemeDetail = z.infer<typeof MemeDetailSchema>;
