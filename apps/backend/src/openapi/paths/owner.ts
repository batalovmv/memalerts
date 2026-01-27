import type { OpenApiContext } from '../context.js';

export function registerOwnerPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericArraySchema } = ctx.responses;
  const { walletAdjustParams, idParam, userIdParam } = ctx.params;

  registerJsonPath({
    method: 'get',
    path: '/owner/wallets/options',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/wallets',
    tags: ['Owner'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/wallets/:userId/:channelId/adjust',
    tags: ['Owner'],
    request: { params: walletAdjustParams },
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/youtube/default/status',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/youtube/default/link',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/owner/bots/youtube/default',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/vkvideo/default/status',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/vkvideo/default/link',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/owner/bots/vkvideo/default',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/twitch/default/status',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/bots/twitch/default/link',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/owner/bots/twitch/default',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/entitlements/custom-bot',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/entitlements/custom-bot/grant',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/entitlements/custom-bot/revoke',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/channels/resolve',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/entitlements/custom-bot/grant-by-provider',
    tags: ['Owner'],
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/meme-assets',
    tags: ['Owner'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/meme-assets/:id/hide',
    tags: ['Owner'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/meme-assets/:id/unhide',
    tags: ['Owner'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/meme-assets/:id/purge',
    tags: ['Owner'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/meme-assets/:id/restore',
    tags: ['Owner'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/moderators',
    tags: ['Owner'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/moderators/:userId/grant',
    tags: ['Owner'],
    request: { params: userIdParam },
  });

  registerJsonPath({
    method: 'post',
    path: '/owner/moderators/:userId/revoke',
    tags: ['Owner'],
    request: { params: userIdParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/owner/ai/status',
    tags: ['Owner'],
  });
}
