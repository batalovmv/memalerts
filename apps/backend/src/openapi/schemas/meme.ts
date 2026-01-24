import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { updateMemeSchema } from '../../shared/schemas.js';

export type MemeSchemas = {
  UpdateMemeBody: ReturnType<OpenAPIRegistry['register']>;
};

export function registerMemeSchemas(registry: OpenAPIRegistry): MemeSchemas {
  const UpdateMemeBody = registry.register('UpdateMemeBody', updateMemeSchema);
  return { UpdateMemeBody };
}
