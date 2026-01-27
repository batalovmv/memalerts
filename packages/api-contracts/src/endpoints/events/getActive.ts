import { z } from 'zod';

import { EventSchema } from '../../entities/event';

export const GetActiveEventsResponseSchema = z.object({
  events: z.array(EventSchema),
});

export type GetActiveEventsResponse = z.infer<typeof GetActiveEventsResponseSchema>;
