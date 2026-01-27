import type { OpenApiContext } from '../context.js';

export function registerAuthPaths(ctx: OpenApiContext) {
  const { registry, authSecurity, params, responses, schemas } = ctx;
  const { providerParam, externalAccountIdParam } = params;
  const { registerJsonPath } = responses;
  const { OkResponse } = schemas;
  const { genericArraySchema } = responses;

  registry.registerPath({
    method: 'get',
    path: '/auth/twitch',
    tags: ['Auth'],
    security: [],
    responses: {
      302: { description: 'Redirect to Twitch OAuth' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/twitch/callback',
    tags: ['Auth'],
    security: [],
    responses: {
      302: { description: 'OAuth callback redirect' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/twitch/complete',
    tags: ['Auth'],
    security: [],
    responses: {
      302: { description: 'Beta auth completion redirect' },
    },
  });

  registerJsonPath({
    method: 'get',
    path: '/auth/accounts',
    tags: ['Auth'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'delete',
    path: '/auth/accounts/:externalAccountId',
    tags: ['Auth'],
    request: { params: externalAccountIdParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/youtube/link/force-ssl',
    tags: ['Auth'],
    security: authSecurity,
    responses: {
      302: { description: 'Redirect to YouTube OAuth (force-ssl scope)' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/:provider',
    tags: ['Auth'],
    security: [],
    request: { params: providerParam },
    responses: {
      302: { description: 'Redirect to provider OAuth' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/:provider/callback',
    tags: ['Auth'],
    security: [],
    request: { params: providerParam },
    responses: {
      302: { description: 'OAuth callback redirect' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/:provider/link',
    tags: ['Auth'],
    request: { params: providerParam },
    responses: {
      302: { description: 'Redirect to provider linking OAuth' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/auth/:provider/link/callback',
    tags: ['Auth'],
    security: [],
    request: { params: providerParam },
    responses: {
      302: { description: 'Provider linking callback redirect' },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/auth/logout',
    tags: ['Auth'],
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });
}
