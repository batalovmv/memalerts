import { z } from 'zod';
import { PaginationMetaSchema } from './pagination';
import { ApiErrorSchema } from './errors';

export function createSuccessSchema<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    success: z.literal(true),
    data: dataSchema,
  });
}

export function createPaginatedSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    success: z.literal(true),
    data: z.object({
      items: z.array(itemSchema),
      pagination: PaginationMetaSchema,
    }),
  });
}

export const ErrorResponseSchema = z.object({
  success: z.literal(false),
  error: ApiErrorSchema,
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
