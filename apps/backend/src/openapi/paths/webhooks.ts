import type { OpenApiContext } from '../context.js';

export function registerWebhookPaths(ctx: OpenApiContext) {
  const { registerJsonPath } = ctx.responses;
  const { TwitchEventSubBody, OkResponse } = ctx.schemas;

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
}
