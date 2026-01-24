import type { OpenApiContext } from '../context.js';

export function registerPublicPaths(ctx: OpenApiContext) {
  const { registerJsonPath } = ctx.responses;
  const { slugParam } = ctx.params;
  const { OkResponse } = ctx.schemas;

  registerJsonPath({
    method: 'get',
    path: '/public/submissions/status',
    tags: ['Public'],
    security: [],
  });

  registerJsonPath({
    method: 'post',
    path: '/public/submissions/enable',
    tags: ['Public'],
    security: [],
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'post',
    path: '/public/submissions/disable',
    tags: ['Public'],
    security: [],
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'post',
    path: '/public/submissions/toggle',
    tags: ['Public'],
    security: [],
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'get',
    path: '/public/channels/:slug',
    tags: ['Public'],
    security: [],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/public/channels/:slug/memes',
    tags: ['Public'],
    security: [],
    request: { params: slugParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/public/channels/:slug/memes/search',
    tags: ['Public'],
    security: [],
    request: { params: slugParam },
  });
}
