import { z } from 'zod';

import { AchievementSnapshotSchema } from '../../entities/achievement';

export const GetChannelAchievementsParamsSchema = z.object({
  slug: z.string(),
});

export const GetChannelAchievementsResponseSchema = AchievementSnapshotSchema;

export type GetChannelAchievementsParams = z.infer<typeof GetChannelAchievementsParamsSchema>;
export type GetChannelAchievementsResponse = z.infer<typeof GetChannelAchievementsResponseSchema>;
