import type { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { registerChannelSchemas } from './channel.js';
import { registerCommonSchemas } from './common.js';
import { registerMemeSchemas } from './meme.js';
import { registerPromotionSchemas } from './promotion.js';
import { registerRewardsSchemas } from './rewards.js';
import { registerSubmissionSchemas } from './submission.js';
import { registerUserSchemas } from './user.js';

export function registerSchemas(registry: OpenAPIRegistry) {
  return {
    ...registerCommonSchemas(registry),
    ...registerUserSchemas(registry),
    ...registerSubmissionSchemas(registry),
    ...registerMemeSchemas(registry),
    ...registerChannelSchemas(registry),
    ...registerPromotionSchemas(registry),
    ...registerRewardsSchemas(registry),
  };
}

export type OpenApiSchemas = ReturnType<typeof registerSchemas>;
