import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { twitchEventSubMessageSchema } from '../../shared/schemas.js';

export type RewardsSchemas = {
  TwitchEventSubBody: ReturnType<OpenAPIRegistry['register']>;
};

export function registerRewardsSchemas(registry: OpenAPIRegistry): RewardsSchemas {
  const TwitchEventSubBody = registry.register('TwitchEventSubBody', twitchEventSubMessageSchema);
  return { TwitchEventSubBody };
}
