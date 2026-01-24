import type { OpenApiContext } from '../context.js';

export function registerModerationPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericArraySchema } = ctx.responses;
  const { idParam } = ctx.params;

  registerJsonPath({
    method: 'get',
    path: '/moderation/meme-assets',
    tags: ['Moderation'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/moderation/meme-assets/:id/hide',
    tags: ['Moderation'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/moderation/meme-assets/:id/unhide',
    tags: ['Moderation'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/moderation/meme-assets/:id/delete',
    tags: ['Moderation'],
    request: { params: idParam },
  });
}
