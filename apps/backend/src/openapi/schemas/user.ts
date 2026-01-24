import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { patchUserPreferencesSchema, userPreferencesSchema } from '../../shared/schemas.js';

export type UserSchemas = {
  UserPreferencesBody: ReturnType<OpenAPIRegistry['register']>;
  PatchUserPreferencesBody: ReturnType<OpenAPIRegistry['register']>;
};

export function registerUserSchemas(registry: OpenAPIRegistry): UserSchemas {
  const UserPreferencesBody = registry.register('UserPreferencesBody', userPreferencesSchema);
  const PatchUserPreferencesBody = registry.register('PatchUserPreferencesBody', patchUserPreferencesSchema);
  return { UserPreferencesBody, PatchUserPreferencesBody };
}
