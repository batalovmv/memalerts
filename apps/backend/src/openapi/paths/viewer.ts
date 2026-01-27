import type { OpenApiContext } from '../context.js';

export function registerViewerPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericArraySchema } = ctx.responses;
  const { UserPreferencesBody, PatchUserPreferencesBody } = ctx.schemas;
  const { slugParam, genericIdParam, activateMemeQuery } = ctx.params;

  registerJsonPath({
    method: 'get',
    path: '/me',
    tags: ['Viewer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/me/preferences',
    tags: ['Viewer'],
    responseSchema: UserPreferencesBody,
  });

  registerJsonPath({
    method: 'patch',
    path: '/me/preferences',
    tags: ['Viewer'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: PatchUserPreferencesBody,
            example: { theme: 'dark', autoplayMemesEnabled: false },
          },
        },
      },
    },
    responseSchema: UserPreferencesBody,
  });

  registerJsonPath({
    method: 'get',
    path: '/wallet',
    tags: ['Viewer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/memes',
    tags: ['Viewer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/:slug',
    tags: ['Viewer'],
    request: { params: slugParam },
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/:slug/wallet',
    tags: ['Viewer'],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/channels/:slug/bonuses/daily',
    tags: ['Viewer'],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/channels/:slug/bonuses/watch',
    tags: ['Viewer'],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/:slug/achievements/me',
    tags: ['Viewer'],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/:slug/memes',
    tags: ['Viewer'],
    request: { params: slugParam },
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/:slug/leaderboard',
    tags: ['Viewer'],
    request: { params: slugParam },
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/channels/memes/search',
    tags: ['Viewer'],
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/memes/stats',
    tags: ['Viewer'],
    security: [],
  });

  registerJsonPath({
    method: 'get',
    path: '/memes/pool',
    tags: ['Viewer'],
    security: [],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/memes/:id/activate',
    tags: ['Viewer'],
    request: {
      params: genericIdParam,
      query: activateMemeQuery,
    },
  });

}
