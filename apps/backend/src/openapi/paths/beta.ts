import type { OpenApiContext } from '../context.js';

export function registerBetaPaths(ctx: OpenApiContext) {
  const { registerJsonPath } = ctx.responses;
  const { OkResponse } = ctx.schemas;
  const { idParam, userIdParam } = ctx.params;
  const { genericArraySchema } = ctx.responses;

  registerJsonPath({
    method: 'post',
    path: '/beta/request',
    tags: ['Beta'],
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'get',
    path: '/beta/status',
    tags: ['Beta'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/beta/requests',
    tags: ['Beta'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/beta/requests/:id/approve',
    tags: ['Beta'],
    request: { params: idParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/beta/requests/:id/reject',
    tags: ['Beta'],
    request: { params: idParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/beta/users',
    tags: ['Beta'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/beta/users/revoked',
    tags: ['Beta'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/beta/users/:userId/revoke',
    tags: ['Beta'],
    request: { params: userIdParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/beta/users/:userId/restore',
    tags: ['Beta'],
    request: { params: userIdParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });
}
