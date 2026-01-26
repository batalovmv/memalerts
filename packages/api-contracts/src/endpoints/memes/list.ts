import { z } from 'zod';
import { MemeListItemSchema } from '../../entities/meme';
import { PaginationQuerySchema } from '../../common/pagination';
import { createPaginatedSchema } from '../../common/responses';

export const ListChannelMemesParamsSchema = z.object({
  channelId: z.string().uuid(),
});

export const ListChannelMemesQuerySchema = PaginationQuerySchema.extend({
  sortBy: z.enum(['createdAt', 'priceCoins', 'activationsCount']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  tags: z.string().optional(),
  search: z.string().max(200).optional(),
});

export const ListChannelMemesResponseSchema = createPaginatedSchema(MemeListItemSchema);

export type ListChannelMemesParams = z.infer<typeof ListChannelMemesParamsSchema>;
export type ListChannelMemesQuery = z.infer<typeof ListChannelMemesQuerySchema>;
export type ListChannelMemesResponse = z.infer<typeof ListChannelMemesResponseSchema>;
