import type { OpenApiContext } from '../context.js';

export function registerOverlayPaths(ctx: OpenApiContext) {
  const { registry, params, responses } = ctx;
  const { tokenParam } = params;
  const { htmlResponse } = responses;

  registry.registerPath({
    method: 'get',
    path: '/overlay/credits/t/:token',
    tags: ['Overlay'],
    security: [],
    request: { params: tokenParam },
    responses: {
      200: htmlResponse('Credits overlay HTML'),
    },
  });
}
