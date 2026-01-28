import { z } from 'zod';

export const QueueItemSchema = z.object({
  activationId: z.string(),
  memeTitle: z.string(),
  senderName: z.string().nullable(),
  priceCoins: z.number().int().min(0),
});

export const QueueCurrentSchema = QueueItemSchema.extend({
  memeAssetId: z.string(),
  startedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().min(0),
});

export const QueueStateSchema = z.object({
  revision: z.number().int(),
  intakePaused: z.boolean(),
  playbackPaused: z.boolean(),
  overlayConnected: z.boolean(),
  overlayCount: z.number().int().min(0),
  current: QueueCurrentSchema.nullable(),
  next: z.array(QueueItemSchema),
  queueLength: z.number().int().min(0),
  pendingSubmissions: z.number().int().min(0),
});

export type QueueItem = z.infer<typeof QueueItemSchema>;
export type QueueCurrent = z.infer<typeof QueueCurrentSchema>;
export type QueueState = z.infer<typeof QueueStateSchema>;
