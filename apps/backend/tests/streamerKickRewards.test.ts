import { beforeEach, describe, expect, it, vi } from 'vitest';

const kickApiMocks = vi.hoisted(() => ({
  createKickEventSubscription: vi.fn(),
  getKickExternalAccount: vi.fn(),
  getValidKickAccessTokenByExternalAccountId: vi.fn(),
  listKickEventSubscriptions: vi.fn(),
}));

vi.mock('../src/utils/kickApi.js', async () => {
  const actual = await vi.importActual('../src/utils/kickApi.js');
  return { ...actual, ...kickApiMocks };
});

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('streamer kick rewards', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
    process.env.KICK_WEBHOOK_CALLBACK_URL = 'https://example.com/webhooks/kick/events';

    kickApiMocks.getKickExternalAccount.mockResolvedValue({ id: 'kick-acc', scopes: 'events:subscribe' });
    kickApiMocks.getValidKickAccessTokenByExternalAccountId.mockResolvedValue('kick-token');
    kickApiMocks.listKickEventSubscriptions.mockResolvedValue({ ok: true, subscriptions: [] });
    kickApiMocks.createKickEventSubscription.mockResolvedValue({ ok: true, subscriptionId: 'sub-1' });
  });

  it('enables kick rewards and creates the event subscription when missing', async () => {
    const channel = await createChannel({
      slug: 'kick-rewards',
      name: 'Kick Rewards',
      kickRewardEnabled: false,
      kickRewardsSubscriptionId: null,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardEnabled: true });

    expect(res.status).toBe(200);
    expect(res.body?.kickRewardEnabled).toBe(true);
    expect(res.body?.kickRewardsSubscriptionId).toBe('sub-1');

    expect(kickApiMocks.listKickEventSubscriptions).toHaveBeenCalledWith({ accessToken: 'kick-token' });
    expect(kickApiMocks.createKickEventSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'kick-token',
        callbackUrl: 'https://example.com/webhooks/kick/events',
        event: 'channel.reward.redemption.updated',
        version: 'v1',
      })
    );

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { kickRewardEnabled: true, kickRewardsSubscriptionId: true },
    });
    expect(stored?.kickRewardEnabled).toBe(true);
    expect(stored?.kickRewardsSubscriptionId).toBe('sub-1');
  });

  it('reuses existing Kick subscription without creating a new one', async () => {
    const channel = await createChannel({
      slug: 'kick-rewards-existing',
      name: 'Kick Rewards Existing',
      kickRewardEnabled: false,
      kickRewardsSubscriptionId: null,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    kickApiMocks.listKickEventSubscriptions.mockResolvedValue({
      ok: true,
      subscriptions: [
        {
          id: 'sub-existing',
          event: 'channel.reward.redemption.updated',
          callback_url: 'https://example.com/webhooks/kick/events',
        },
      ],
    });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardEnabled: true });

    expect(res.status).toBe(200);
    expect(res.body?.kickRewardsSubscriptionId).toBe('sub-existing');
    expect(kickApiMocks.createKickEventSubscription).not.toHaveBeenCalled();

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { kickRewardsSubscriptionId: true },
    });
    expect(stored?.kickRewardsSubscriptionId).toBe('sub-existing');
  });

  it('rejects when kick account is not linked', async () => {
    const channel = await createChannel({ slug: 'kick-missing', name: 'Kick Missing' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    kickApiMocks.getKickExternalAccount.mockResolvedValue(null);

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardEnabled: true });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('KICK_NOT_LINKED');
  });

  it('rejects when kick scopes are missing', async () => {
    const channel = await createChannel({ slug: 'kick-scopes', name: 'Kick Scopes' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    kickApiMocks.getKickExternalAccount.mockResolvedValue({ id: 'kick-acc', scopes: 'chat:read' });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardEnabled: true });

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('KICK_SCOPE_MISSING_EVENTS_SUBSCRIBE');
  });

  it('rejects when kick access token is missing', async () => {
    const channel = await createChannel({ slug: 'kick-token', name: 'Kick Token' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    kickApiMocks.getValidKickAccessTokenByExternalAccountId.mockResolvedValue(null);

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardEnabled: true });

    expect(res.status).toBe(401);
    expect(res.body?.errorCode).toBe('KICK_ACCESS_TOKEN_MISSING');
    expect(res.body?.requiresReauth).toBe(true);
  });

  it('validates kick reward fields', async () => {
    const channel = await createChannel({ slug: 'kick-validate', name: 'Kick Validate' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ kickRewardCoins: -5 });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('Invalid input');
    expect(Array.isArray(res.body?.details)).toBe(true);
  });
});
