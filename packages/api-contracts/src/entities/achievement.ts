import { z } from 'zod';

export const AchievementScopeSchema = z.enum(['global', 'channel', 'event']);

export const AchievementItemSchema = z.object({
  key: z.string(),
  title: z.string(),
  description: z.string().optional(),
  scope: AchievementScopeSchema,
  target: z.number().optional(),
  progress: z.number().optional(),
  rewardCoins: z.number().optional(),
  achievedAt: z.string().nullable().optional(),
});

export const EventAchievementItemSchema = AchievementItemSchema.extend({
  scope: z.literal('event'),
  eventKey: z.string(),
  eventTitle: z.string(),
  eventEndsAt: z.string().optional(),
});

export const AchievementSnapshotSchema = z.object({
  global: z.array(AchievementItemSchema),
  channel: z.array(AchievementItemSchema),
  events: z.array(EventAchievementItemSchema).optional(),
});

export type AchievementScope = z.infer<typeof AchievementScopeSchema>;
export type AchievementItem = z.infer<typeof AchievementItemSchema>;
export type EventAchievementItem = z.infer<typeof EventAchievementItemSchema>;
export type AchievementSnapshot = z.infer<typeof AchievementSnapshotSchema>;
