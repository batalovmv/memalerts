import { z } from 'zod';

import { AchievementItemSchema } from '../../entities/achievement';

export const GetChannelStreamerAchievementsParamsSchema = z.object({
  slug: z.string(),
});

export const GetChannelStreamerAchievementsResponseSchema = z.object({
  achievements: z.array(AchievementItemSchema),
});

export type GetChannelStreamerAchievementsParams = z.infer<typeof GetChannelStreamerAchievementsParamsSchema>;
export type GetChannelStreamerAchievementsResponse = z.infer<typeof GetChannelStreamerAchievementsResponseSchema>;

