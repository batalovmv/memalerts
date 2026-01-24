import type { OpenApiContext } from '../context.js';

export function registerDebugPaths(ctx: OpenApiContext) {
  const { registerJsonPath } = ctx.responses;

  registerJsonPath({
    method: 'get',
    path: '/debug-ip',
    tags: ['Debug'],
    description: 'Debug-only endpoint (enabled by DEBUG_LOGS).',
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/debug-auth',
    tags: ['Debug'],
    description: 'Debug-only endpoint (enabled by DEBUG_AUTH).',
    security: [],
  });
}
