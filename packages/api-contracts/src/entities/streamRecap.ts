import { z } from 'zod';

import { StreamProviderSchema } from '../common/enums';

export const StreamRecapSessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable().optional(),
  provider: StreamProviderSchema.optional(),
});

export const StreamRecapSummarySchema = z.object({
  totalActivations: z.number(),
  uniqueViewers: z.number(),
  coinsSpent: z.number(),
});

export const StreamRecapMemeSchema = z.object({
  id: z.string(),
  title: z.string(),
  priceCoins: z.number(),
  fileUrl: z.string().nullable().optional(),
  previewUrl: z.string().nullable().optional(),
  activations: z.number().optional(),
  coinsSpent: z.number().optional(),
  createdAt: z.string().optional(),
});

export const StreamRecapViewerSchema = z.object({
  userId: z.string(),
  displayName: z.string(),
  profileImageUrl: z.string().nullable().optional(),
  activations: z.number(),
  coinsSpent: z.number(),
});

export const StreamRecapSchema = z.object({
  session: StreamRecapSessionSchema,
  summary: StreamRecapSummarySchema,
  topMemes: z.array(StreamRecapMemeSchema),
  topViewers: z.array(StreamRecapViewerSchema),
  newMemes: z.array(StreamRecapMemeSchema),
});

export type StreamRecapSession = z.infer<typeof StreamRecapSessionSchema>;
export type StreamRecapSummary = z.infer<typeof StreamRecapSummarySchema>;
export type StreamRecapMeme = z.infer<typeof StreamRecapMemeSchema>;
export type StreamRecapViewer = z.infer<typeof StreamRecapViewerSchema>;
export type StreamRecap = z.infer<typeof StreamRecapSchema>;
