import type { OpenApiContext } from '../context.js';

export function registerStreamerPaths(ctx: OpenApiContext) {
  const { registerJsonPath, genericArraySchema } = ctx.responses;
  const {
    ApproveSubmissionBody,
    RejectSubmissionBody,
    NeedsChangesSubmissionBody,
    BulkSubmissionsBody,
    UpdateMemeBody,
    UpdateChannelSettingsBody,
    CreatePromotionBody,
    UpdatePromotionBody,
    OverlayPresetsBody,
    OkResponse,
  } = ctx.schemas;
  const { idParam, providerOutboxParam, providerParam } = ctx.params;

  registerJsonPath({
    method: 'get',
    path: '/streamer/submissions',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/submissions/:id/approve',
    tags: ['Streamer'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: ApproveSubmissionBody,
            example: { priceCoins: 100, durationMs: 15000, tags: ['demo'] },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/submissions/:id/reject',
    tags: ['Streamer'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: RejectSubmissionBody,
            example: { moderatorNotes: 'Needs better quality' },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/submissions/:id/needs-changes',
    tags: ['Streamer'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: NeedsChangesSubmissionBody,
            example: { moderatorNotes: 'Please trim the start' },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/submissions/bulk',
    tags: ['Streamer'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: BulkSubmissionsBody,
            example: {
              ids: ['92a2b6a7-148c-47ef-8a9c-1d7f2f0f6d2d'],
              action: 'approve',
            },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/memes',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/starter-memes',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'patch',
    path: '/streamer/memes/:id',
    tags: ['Streamer'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: UpdateMemeBody,
            example: { title: 'New title', priceCoins: 120 },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'delete',
    path: '/streamer/memes/:id',
    tags: ['Streamer'],
    request: { params: idParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/memes/:id/ai/regenerate',
    tags: ['Streamer'],
    request: { params: idParam },
  });

  registerJsonPath({
    method: 'patch',
    path: '/streamer/channel/settings',
    tags: ['Streamer'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: UpdateChannelSettingsBody,
            example: { submissionsEnabled: true, submissionRewardCoinsUpload: 50 },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/twitch/reward/eligibility',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/submissions-control/link',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/submissions-control/link/rotate',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/promotions',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/promotions',
    tags: ['Streamer'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: CreatePromotionBody,
            example: {
              name: 'Launch promo',
              discountPercent: 25,
              startDate: '2026-01-01T00:00:00.000Z',
              endDate: '2026-02-01T00:00:00.000Z',
            },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'patch',
    path: '/streamer/promotions/:id',
    tags: ['Streamer'],
    request: {
      params: idParam,
      body: {
        content: {
          'application/json': {
            schema: UpdatePromotionBody,
            example: { discountPercent: 30, isActive: true },
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'delete',
    path: '/streamer/promotions/:id',
    tags: ['Streamer'],
    request: { params: idParam },
    responseSchema: OkResponse,
    responseExample: { ok: true },
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/stats/channel',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/stream-recap/latest',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/overlay/token',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/overlay/token/rotate',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/overlay/preview-meme',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/overlay/preview-memes',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/overlay/presets',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'put',
    path: '/streamer/overlay/presets',
    tags: ['Streamer'],
    request: {
      body: {
        content: {
          'application/json': {
            schema: OverlayPresetsBody,
          },
        },
      },
    },
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/bot/enable',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/bot/disable',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'post',
    path: '/streamer/bot/say',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bot/outbox/:provider/:id',
    tags: ['Streamer'],
    request: { params: providerOutboxParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/vkvideo/candidates',
    tags: ['Streamer'],
    responseSchema: genericArraySchema,
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/vkvideo/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/vkvideo/bot/link',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/streamer/bots/vkvideo/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/twitch/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/twitch/bot/link',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/streamer/bots/twitch/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/youtube/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bots/youtube/bot/link',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'delete',
    path: '/streamer/bots/youtube/bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'patch',
    path: '/streamer/bots/:provider',
    tags: ['Streamer'],
    request: { params: providerParam },
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/entitlements/custom-bot',
    tags: ['Streamer'],
  });

  registerJsonPath({
    method: 'get',
    path: '/streamer/bot/subscription',
    tags: ['Streamer'],
  });
}
