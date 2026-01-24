import { z } from 'zod';

export const userRoleSchema = z.enum(['viewer', 'streamer', 'admin']);

// Viewer UI preferences (cross-device, per-user)
export const userPreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).default('light'),
  autoplayMemesEnabled: z.boolean().default(true),
  memeModalMuted: z.boolean().default(false),
  coinsInfoSeen: z.boolean().default(false),
});

// PATCH body: subset of fields (partial)
export const patchUserPreferencesSchema = userPreferencesSchema.partial().refine((obj) => Object.keys(obj).length > 0, {
  message: 'At least one preference field must be provided',
});
