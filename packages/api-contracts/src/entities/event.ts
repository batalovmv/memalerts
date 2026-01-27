import { z } from 'zod';

export const EventThemeSchema = z.object({
  accentColor: z.string().optional(),
  backgroundUrl: z.string().optional(),
  badgeKey: z.string().optional(),
});

export const EventSchema = z.object({
  id: z.string(),
  key: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  startsAt: z.string(),
  endsAt: z.string(),
  theme: EventThemeSchema.optional(),
});

export type EventTheme = z.infer<typeof EventThemeSchema>;
export type Event = z.infer<typeof EventSchema>;
