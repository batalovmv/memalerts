import type { OpenApiContext } from '../context.js';

export function registerInternalPaths(ctx: OpenApiContext) {
  const { responses } = ctx;
  const { registerJsonPath } = responses;

  registerJsonPath({
    method: 'post',
    path: '/internal/wallet-updated',
    tags: ['Internal'],
    description: 'Internal-only relay for wallet events (localhost + secret headers).',
    security: [],
  });

  registerJsonPath({
    method: 'post',
    path: '/internal/submission-event',
    tags: ['Internal'],
    description: 'Internal-only relay for submission events (localhost + secret headers).',
    security: [],
  });

  registerJsonPath({
    method: 'post',
    path: '/internal/credits/chatter',
    tags: ['Internal'],
    description: 'Internal-only credits overlay chatter relay.',
    security: [],
  });

  registerJsonPath({
    method: 'post',
    path: '/internal/credits/donor',
    tags: ['Internal'],
    description: 'Internal-only credits overlay donor relay.',
    security: [],
  });
}
