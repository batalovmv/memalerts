import { z } from 'zod';

export function createOpenApiParameters() {
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

  return {
    slugParam,
    tokenParam,
    idParam,
    genericIdParam,
    channelIdParam,
    userIdParam,
    providerParam,
    providerOutboxParam,
    activateMemeQuery,
    externalAccountIdParam,
    walletAdjustParams,
  };
}

export type OpenApiParameters = ReturnType<typeof createOpenApiParameters>;
