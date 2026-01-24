import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { createPromotionSchema, updatePromotionSchema } from '../../shared/schemas.js';

export type PromotionSchemas = {
  CreatePromotionBody: ReturnType<OpenAPIRegistry['register']>;
  UpdatePromotionBody: ReturnType<OpenAPIRegistry['register']>;
};

export function registerPromotionSchemas(registry: OpenAPIRegistry): PromotionSchemas {
  const CreatePromotionBody = registry.register('CreatePromotionBody', createPromotionSchema);
  const UpdatePromotionBody = registry.register('UpdatePromotionBody', updatePromotionSchema);
  return { CreatePromotionBody, UpdatePromotionBody };
}
