import { z } from 'zod';
import type { AnyZodObject, ZodTypeAny } from 'zod';
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import {
  approveSubmissionSchema,
  bulkSubmissionsSchema,
  createPoolSubmissionSchema,
  createPromotionSchema,
  createSubmissionSchema,
  importMemeSchema,
  needsChangesSubmissionSchema,
  overlayPresetsBodySchema,
  patchUserPreferencesSchema,
  rejectSubmissionSchema,
  resubmitSubmissionSchema,
  twitchEventSubMessageSchema,
  updateChannelSettingsSchema,
  updateMemeSchema,
  updatePromotionSchema,
  userPreferencesSchema,
} from '../shared/schemas.js';
import { ERROR_CODES } from '../shared/errors.js';

extendZodWithOpenApi(z);

const registry = new OpenAPIRegistry();
const authSecurity: Array<Record<string, string[]>> = [{ cookieAuth: [] }, { bearerAuth: [] }];

const errorCodeEnum = z.enum(Object.values(ERROR_CODES) as [string, ...string[]]);

const ErrorResponse = registry.register(
  'ErrorResponse',
  z.object({
    errorCode: errorCodeEnum,
    error: z.string(),
    requestId: z.string().optional(),
    traceId: z.string().nullable().optional(),
    details: z.unknown().optional(),
  })
);

registry.registerComponent('securitySchemes', 'cookieAuth', {
  type: 'apiKey',
  in: 'cookie',
  name: 'token',
  description: 'Session cookie (prod). Beta uses token_beta. For automation, use Authorization: Bearer <token>.',
});
registry.registerComponent('securitySchemes', 'bearerAuth', {
  type: 'http',
  scheme: 'bearer',
});

const OkResponse = registry.register('OkResponse', z.object({ ok: z.boolean() }));

const HealthResponse = registry.register(
  'HealthResponse',
  z.object({
    status: z.string(),
    build: z.object({
      name: z.string().nullable(),
      version: z.string().nullable(),
      deployTrigger: z.string().nullable(),
    }),
    instance: z.object({
      port: z.string().nullable(),
      domain: z.string().nullable(),
      instance: z.string().nullable(),
      instanceId: z.string().nullable(),
    }),
  })
);

const HealthzResponse = registry.register(
  'HealthzResponse',
  z.object({
    status: z.string(),
    service: z.string().nullable().optional(),
    env: z.string().nullable().optional(),
    instanceId: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    time: z.string(),
  })
);

const ReadyzResponse = registry.register(
  'ReadyzResponse',
  z.object({
    status: z.string(),
    service: z.string().nullable().optional(),
    env: z.string().nullable().optional(),
    instanceId: z.string().nullable().optional(),
    version: z.string().nullable().optional(),
    time: z.string(),
    checks: z.object({
      database: z.string(),
    }),
  })
);

const HealthCircuitsResponse = registry.register(
  'HealthCircuitsResponse',
  z.object({
    status: z.string(),
    circuits: z.array(z.record(z.unknown())),
  })
);

const HealthWorkersResponse = registry.register(
  'HealthWorkersResponse',
  z.object({
    workers: z.array(z.record(z.unknown())),
    queues: z.record(z.unknown()),
  })
);

const CreateSubmissionForm = registry.register(
  'CreateSubmissionForm',
  createSubmissionSchema.extend({
    file: z.string().openapi({ format: 'binary', description: 'Video file upload' }),
  })
);

const ImportMemeBody = registry.register('ImportMemeBody', importMemeSchema);
const CreatePoolSubmissionBody = registry.register('CreatePoolSubmissionBody', createPoolSubmissionSchema);
const ResubmitSubmissionBody = registry.register('ResubmitSubmissionBody', resubmitSubmissionSchema);
const ApproveSubmissionBody = registry.register('ApproveSubmissionBody', approveSubmissionSchema);
const RejectSubmissionBody = registry.register('RejectSubmissionBody', rejectSubmissionSchema);
const NeedsChangesSubmissionBody = registry.register('NeedsChangesSubmissionBody', needsChangesSubmissionSchema);
const BulkSubmissionsBody = registry.register('BulkSubmissionsBody', bulkSubmissionsSchema);
const UpdateMemeBody = registry.register('UpdateMemeBody', updateMemeSchema);
const UpdateChannelSettingsBody = registry.register('UpdateChannelSettingsBody', updateChannelSettingsSchema);
const CreatePromotionBody = registry.register('CreatePromotionBody', createPromotionSchema);
const UpdatePromotionBody = registry.register('UpdatePromotionBody', updatePromotionSchema);
const UserPreferencesBody = registry.register('UserPreferencesBody', userPreferencesSchema);
const PatchUserPreferencesBody = registry.register('PatchUserPreferencesBody', patchUserPreferencesSchema);
const OverlayPresetsBody = registry.register('OverlayPresetsBody', overlayPresetsBodySchema);
const TwitchEventSubBody = registry.register('TwitchEventSubBody', twitchEventSubMessageSchema);
const genericObjectSchema = z.record(z.unknown());
const genericArraySchema = z.array(genericObjectSchema);

const jsonResponse = (schema: ZodTypeAny, description = 'OK', example?: unknown) => ({
  description,
  content: {
    'application/json': {
      schema,
      ...(example !== undefined ? { example } : {}),
    },
  },
});

const textResponse = (description: string) => ({
  description,
  content: {
    'text/plain': {
      schema: z.string(),
    },
  },
});

const htmlResponse = (description: string) => ({
  description,
  content: {
    'text/html': {
      schema: z.string(),
    },
  },
});

type RequestSpec = {
  params?: AnyZodObject;
  query?: AnyZodObject;
  body?: {
    content: Record<string, { schema: ZodTypeAny; example?: unknown }>;
  };
};

type RegisterJsonPathParams = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  path: string;
  tags: string[];
  description?: string;
  security?: Array<Record<string, string[]>>;
  request?: RequestSpec;
  responseSchema?: ZodTypeAny;
  responseDescription?: string;
  responseExample?: unknown;
};

function registerJsonPath(params: RegisterJsonPathParams) {
  const {
    method,
    path,
    tags,
    description,
    security,
    request,
    responseSchema = genericObjectSchema,
    responseDescription = 'OK',
    responseExample,
  } = params;

  registry.registerPath({
    method,
    path,
    tags,
    description,
    ...(security ? { security } : {}),
    ...(request ? { request } : {}),
    responses: {
      200: jsonResponse(responseSchema, responseDescription, responseExample),
    },
  });
}

const slugParam = z.object({ slug: z.string().openapi({ example: 'demo' }) });
const tokenParam = z.object({ token: z.string().openapi({ example: 'overlay-token' }) });
const idParam = z.object({ id: z.string().uuid().openapi({ example: '2d5d4b69-2d8f-4a6e-9de1-9a51d0c1c9d1' }) });
const genericIdParam = z.object({ id: z.string().openapi({ example: 'resource-id' }) });
const channelIdParam = z.object({
  channelId: z.string().uuid().openapi({ example: 'ae2d1d19-c6fb-4b77-9c9b-22e4ff1f0c4a' }),
});
const userIdParam = z.object({
  userId: z.string().uuid().openapi({ example: 'fdc0d2f1-10cf-4d16-9fcb-6b2b2b3dc021' }),
});
const providerParam = z.object({ provider: z.string().openapi({ example: 'twitch' }) });
const providerOutboxParam = z.object({
  provider: z.string().openapi({ example: 'twitch' }),
  id: z.string().openapi({ example: 'outbox-id' }),
});
const activateMemeQuery = z.object({
  channelId: z.string().uuid().optional(),
  channelSlug: z.string().optional(),
});
const externalAccountIdParam = z.object({
  externalAccountId: z.string().uuid().openapi({ example: '1c3c9e2c-2c6e-4b3a-9c64-2c0f1b62f00e' }),
});
const walletAdjustParams = z.object({
  userId: z.string().uuid(),
  channelId: z.string().uuid(),
});
registry.registerPath({
  method: 'get',
  path: '/health',
  tags: ['Health'],
  security: [],
  responses: {
    200: jsonResponse(HealthResponse, 'OK', {
      status: 'ok',
      build: { name: '@memalerts/api', version: '1.0.0', deployTrigger: null },
      instance: { port: '3001', domain: null, instance: null, instanceId: null },
    }),
  },
});

registry.registerPath({
  method: 'get',
  path: '/healthz',
  tags: ['Health'],
  security: [],
  responses: {
    200: jsonResponse(HealthzResponse, 'OK', {
      status: 'ok',
      service: null,
      env: 'development',
      instanceId: null,
      version: '1.0.0',
      time: new Date().toISOString(),
    }),
  },
});

registry.registerPath({
  method: 'get',
  path: '/readyz',
  tags: ['Health'],
  security: [],
  responses: {
    200: jsonResponse(ReadyzResponse, 'OK', {
      status: 'ok',
      service: null,
      env: 'development',
      instanceId: null,
      version: '1.0.0',
      time: new Date().toISOString(),
      checks: { database: 'ok' },
    }),
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/circuits',
  tags: ['Health'],
  security: [],
  responses: {
    200: jsonResponse(HealthCircuitsResponse),
  },
});

registry.registerPath({
  method: 'get',
  path: '/health/workers',
  tags: ['Health'],
  security: [],
  responses: {
    200: jsonResponse(HealthWorkersResponse),
  },
});

registry.registerPath({
  method: 'get',
  path: '/metrics',
  tags: ['Metrics'],
  security: [],
  responses: {
    200: textResponse('Prometheus metrics'),
  },
});

registry.registerPath({
  method: 'post',
  path: '/csp-report',
  tags: ['Security'],
  security: [],
  responses: {
    204: { description: 'No Content' },
  },
});

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

registerJsonPath({
  method: 'post',
  path: '/internal/wallet-updated',
  tags: ['Internal'],
  description: 'Internal-only relay for wallet events (localhost + secret headers).',
  security: [],
});

registerJsonPath({
  method: 'post',
  path: '/internal/submission-event',
  tags: ['Internal'],
  description: 'Internal-only relay for submission events (localhost + secret headers).',
  security: [],
});

registerJsonPath({
  method: 'post',
  path: '/internal/credits/chatter',
  tags: ['Internal'],
  description: 'Internal-only credits overlay chatter relay.',
  security: [],
});

registerJsonPath({
  method: 'post',
  path: '/internal/credits/donor',
  tags: ['Internal'],
  description: 'Internal-only credits overlay donor relay.',
  security: [],
});

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

registerJsonPath({
  method: 'post',
  path: '/auth/boosty/link',
  tags: ['Auth'],
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
  method: 'post',
  path: '/rewards/youtube/like/claim',
  tags: ['Viewer'],
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
  method: 'get',
  path: '/channels/:slug/memes',
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

registerJsonPath({
  method: 'get',
  path: '/channels/:channelId/boosty-access',
  tags: ['Viewer'],
  request: { params: channelIdParam },
});
registerJsonPath({
  method: 'post',
  path: '/submissions',
  tags: ['Submissions'],
  request: {
    body: {
      content: {
        'multipart/form-data': {
          schema: CreateSubmissionForm,
          example: {
            title: 'My meme',
            type: 'video',
            notes: 'First upload',
            tags: ['demo'],
          },
        },
      },
    },
  },
  responseSchema: genericObjectSchema,
  responseExample: {
    id: '92a2b6a7-148c-47ef-8a9c-1d7f2f0f6d2d',
    status: 'pending',
    title: 'My meme',
  },
});

registerJsonPath({
  method: 'post',
  path: '/submissions/import',
  tags: ['Submissions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: ImportMemeBody,
          example: {
            title: 'Imported meme',
            sourceUrl: 'https://memalerts.com/memes/123',
            notes: 'Imported from pool',
            tags: ['demo'],
          },
        },
      },
    },
  },
});

registerJsonPath({
  method: 'post',
  path: '/submissions/pool',
  tags: ['Submissions'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreatePoolSubmissionBody,
          example: {
            channelId: 'ae2d1d19-c6fb-4b77-9c9b-22e4ff1f0c4a',
            memeAssetId: '5f2d3a1d-7b9b-4f51-8b26-3fd8b4f9d991',
            title: 'Pool meme',
          },
        },
      },
    },
  },
});

registerJsonPath({
  method: 'get',
  path: '/submissions/mine',
  tags: ['Submissions'],
  responseSchema: genericArraySchema,
});

registerJsonPath({
  method: 'post',
  path: '/submissions/:id/resubmit',
  tags: ['Submissions'],
  request: {
    params: idParam,
    body: {
      content: {
        'application/json': {
          schema: ResubmitSubmissionBody,
          example: {
            title: 'Fixed title',
            notes: 'Updated after feedback',
            tags: ['demo'],
          },
        },
      },
    },
  },
});

registerJsonPath({
  method: 'get',
  path: '/submissions',
  tags: ['Submissions'],
  responseSchema: genericArraySchema,
});
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
  method: 'get',
  path: '/streamer/credits/token',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/credits/state',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/credits/reconnect-window',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/credits/ignored-chatters',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/credits/ignored-chatters',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/credits/settings',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/credits/token/rotate',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/credits/reset',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/credits/reconnect-window',
  tags: ['Streamer'],
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
  method: 'get',
  path: '/streamer/bots/trovo/bot',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bots/trovo/bot/link',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'delete',
  path: '/streamer/bots/trovo/bot',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bots/kick/bot',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bots/kick/bot/link',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'delete',
  path: '/streamer/bots/kick/bot',
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
  path: '/streamer/bot/commands',
  tags: ['Streamer'],
  responseSchema: genericArraySchema,
});

registerJsonPath({
  method: 'post',
  path: '/streamer/bot/commands',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'patch',
  path: '/streamer/bot/commands/:id',
  tags: ['Streamer'],
  request: { params: genericIdParam },
});

registerJsonPath({
  method: 'delete',
  path: '/streamer/bot/commands/:id',
  tags: ['Streamer'],
  request: { params: genericIdParam },
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bot/subscription',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bot/follow-greetings',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/bot/follow-greetings/enable',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'post',
  path: '/streamer/bot/follow-greetings/disable',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'patch',
  path: '/streamer/bot/follow-greetings',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'get',
  path: '/streamer/bot/stream-duration',
  tags: ['Streamer'],
});

registerJsonPath({
  method: 'patch',
  path: '/streamer/bot/stream-duration',
  tags: ['Streamer'],
});
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
  path: '/owner/bots/trovo/default/status',
  tags: ['Owner'],
});

registerJsonPath({
  method: 'get',
  path: '/owner/bots/trovo/default/link',
  tags: ['Owner'],
});

registerJsonPath({
  method: 'delete',
  path: '/owner/bots/trovo/default',
  tags: ['Owner'],
});

registerJsonPath({
  method: 'get',
  path: '/owner/bots/kick/default/status',
  tags: ['Owner'],
});

registerJsonPath({
  method: 'get',
  path: '/owner/bots/kick/default/link',
  tags: ['Owner'],
});

registerJsonPath({
  method: 'delete',
  path: '/owner/bots/kick/default',
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

registerJsonPath({
  method: 'post',
  path: '/webhooks/twitch/eventsub',
  tags: ['Webhooks'],
  security: [],
  request: {
    body: {
      content: {
        'application/json': {
          schema: TwitchEventSubBody,
        },
      },
    },
  },
  responseSchema: OkResponse,
  responseExample: { ok: true },
});

registerJsonPath({
  method: 'post',
  path: '/webhooks/kick/events',
  tags: ['Webhooks'],
  security: [],
  responseSchema: OkResponse,
  responseExample: { ok: true },
});

registry.registerPath({
  method: 'get',
  path: '/admin/queues',
  tags: ['Admin'],
  responses: {
    200: htmlResponse('Bull Board UI (requires admin + Redis enabled)'),
    503: textResponse('BullMQ is disabled or Redis is not configured.'),
  },
});

registerJsonPath({
  method: 'post',
  path: '/test/login',
  tags: ['Test'],
  security: [],
  responseSchema: genericObjectSchema,
});

let cachedDocument: ReturnType<OpenApiGeneratorV3['generateDocument']> | null = null;

export function getOpenApiDocument() {
  if (cachedDocument) return cachedDocument;

  const generator = new OpenApiGeneratorV3(registry.definitions);
  cachedDocument = generator.generateDocument({
    openapi: '3.0.3',
    info: {
      title: 'MemAlerts API',
      version: '1.0.0',
      description:
        'API docs generated from code. Auth uses httpOnly cookies (token for prod, token_beta for beta). ' +
        'Bearer tokens are supported for scripts/testing. Prefer /v1 for new integrations.',
    },
    servers: [
      { url: '/v1', description: 'v1 (recommended)' },
      { url: '/', description: 'Legacy (unversioned)' },
    ],
    security: authSecurity,
  });

  return cachedDocument;
}

export { ErrorResponse };
