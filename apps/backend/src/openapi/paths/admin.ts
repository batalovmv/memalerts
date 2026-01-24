import type { OpenApiContext } from '../context.js';

export function registerAdminPaths(ctx: OpenApiContext) {
  const { registry, responses } = ctx;
  const { htmlResponse, textResponse } = responses;

  registry.registerPath({
    method: 'get',
    path: '/admin/queues',
    tags: ['Admin'],
    responses: {
      200: htmlResponse('Bull Board UI (requires admin + Redis enabled)'),
      503: textResponse('BullMQ is disabled or Redis is not configured.'),
    },
  });
}
