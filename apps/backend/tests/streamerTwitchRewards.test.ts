import { beforeEach, describe, expect, it, vi } from 'vitest';

const twitchApiMocks = vi.hoisted(() => ({
  getChannelInformation: vi.fn(),
  getAuthenticatedTwitchUser: vi.fn(),
  getChannelRewards: vi.fn(),
  createChannelReward: vi.fn(),
  updateChannelReward: vi.fn(),
  deleteChannelReward: vi.fn(),
  getEventSubSubscriptions: vi.fn(),
  createEventSubSubscription: vi.fn(),
  deleteEventSubSubscription: vi.fn(),
  createEventSubSubscriptionOfType: vi.fn(),
}));

vi.mock('../src/utils/twitchApi.js', async () => {
  const actual = await vi.importActual('../src/utils/twitchApi.js');
  return { ...actual, ...twitchApiMocks };
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

describe('streamer twitch rewards', () => {
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
    process.env.TWITCH_CLIENT_ID = 'test-twitch-client-id';
    process.env.TWITCH_CLIENT_SECRET = 'test-twitch-client-secret';
    process.env.TWITCH_EVENTSUB_SECRET = 'test-eventsub-secret';

    twitchApiMocks.getChannelInformation.mockResolvedValue({ broadcaster_type: 'affiliate' });
    twitchApiMocks.getAuthenticatedTwitchUser.mockResolvedValue({ id: 'twitch-user' });
    twitchApiMocks.getChannelRewards.mockResolvedValue({ data: [] });
    twitchApiMocks.createChannelReward.mockResolvedValue({ data: [] });
    twitchApiMocks.updateChannelReward.mockResolvedValue({ data: [] });
    twitchApiMocks.deleteChannelReward.mockResolvedValue(undefined);
    twitchApiMocks.getEventSubSubscriptions.mockResolvedValue({ data: [] });
    twitchApiMocks.createEventSubSubscription.mockResolvedValue({ data: [] });
    twitchApiMocks.deleteEventSubSubscription.mockResolvedValue(undefined);
    twitchApiMocks.createEventSubSubscriptionOfType.mockResolvedValue({ data: [] });
  });

  it('returns Twitch reward eligibility for the streamer channel', async () => {
    const channel = await createChannel({
      slug: 'twitch-eligibility',
      name: 'Twitch Eligibility',
      twitchChannelId: 'twitch-chan-1',
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    twitchApiMocks.getChannelInformation.mockResolvedValue({ broadcaster_type: 'affiliate' });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .get('/streamer/twitch/reward/eligibility')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.eligible).toBe(true);
    expect(res.body?.broadcasterType).toBe('affiliate');
    expect(res.body?.checkedBroadcasterId).toBe(channel.twitchChannelId);
  });

  it('enables rewards, creates the channel reward, and subscribes to EventSub', async () => {
    const channel = await createChannel({
      slug: 'twitch-reward-create',
      name: 'Twitch Reward Create',
      twitchChannelId: 'twitch-chan-2',
      rewardEnabled: false,
      rewardIdForCoins: null,
      coinIconUrl: null,
    });
    const streamer = await createUser({
      role: 'streamer',
      channelId: channel.id,
      twitchAccessToken: 'user-access-token',
    });

    twitchApiMocks.getAuthenticatedTwitchUser.mockResolvedValue({ id: channel.twitchChannelId });
    twitchApiMocks.getChannelInformation.mockResolvedValue({ broadcaster_type: 'affiliate' });
    twitchApiMocks.getChannelRewards.mockResolvedValue({ data: [] });
    twitchApiMocks.createChannelReward.mockResolvedValue({
      data: [
        {
          id: 'reward-1',
          title: 'Get 50 Coins',
          image: { url_1x: 'https://cdn.example/coin.png' },
        },
      ],
    });
    twitchApiMocks.getEventSubSubscriptions.mockResolvedValue({ data: [] });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({
        rewardEnabled: true,
        rewardCost: 200,
        rewardCoins: 50,
        rewardTitle: 'Reward Title',
      });

    expect(res.status).toBe(200);
    expect(res.body?.rewardEnabled).toBe(true);
    expect(res.body?.rewardIdForCoins).toBe('reward-1');
    expect(res.body?.coinIconUrl).toBe('https://cdn.example/coin.png');
    expect(twitchApiMocks.createChannelReward).toHaveBeenCalledTimes(1);
    expect(twitchApiMocks.createEventSubSubscription).toHaveBeenCalledTimes(1);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { rewardEnabled: true, rewardIdForCoins: true, coinIconUrl: true },
    });
    expect(stored?.rewardEnabled).toBe(true);
    expect(stored?.rewardIdForCoins).toBe('reward-1');
    expect(stored?.coinIconUrl).toBe('https://cdn.example/coin.png');
  });

  it('updates existing rewards and deletes stale rewards on enable', async () => {
    const channel = await createChannel({
      slug: 'twitch-reward-update',
      name: 'Twitch Reward Update',
      twitchChannelId: 'twitch-chan-3',
      rewardEnabled: false,
      rewardIdForCoins: 'reward-keep',
      rewardCost: 100,
      rewardCoins: 10,
    });
    const streamer = await createUser({
      role: 'streamer',
      channelId: channel.id,
      twitchAccessToken: 'user-access-token',
    });

    twitchApiMocks.getAuthenticatedTwitchUser.mockResolvedValue({ id: channel.twitchChannelId });
    twitchApiMocks.getChannelInformation.mockResolvedValue({ broadcaster_type: 'affiliate' });
    twitchApiMocks.getChannelRewards
      .mockResolvedValueOnce({
        data: [
          { id: 'reward-keep', title: 'Get 10 Coins', image: { url_1x: 'https://cdn.example/old.png' } },
          { id: 'reward-old', title: 'Coins test', image: null },
        ],
      })
      .mockResolvedValueOnce({
        data: [{ id: 'reward-keep', title: 'Get 25 Coins', image: { url_1x: 'https://cdn.example/new.png' } }],
      });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({
        rewardEnabled: true,
        rewardCost: 250,
        rewardCoins: 25,
        rewardTitle: 'Updated Reward',
      });

    expect(res.status).toBe(200);
    expect(twitchApiMocks.updateChannelReward).toHaveBeenCalledTimes(1);
    expect(twitchApiMocks.createChannelReward).not.toHaveBeenCalled();
    expect(twitchApiMocks.deleteChannelReward).toHaveBeenCalledWith(
      streamer.id,
      channel.twitchChannelId,
      'reward-old'
    );
    expect(res.body?.rewardIdForCoins).toBe('reward-keep');
    expect(res.body?.coinIconUrl).toBe('https://cdn.example/new.png');
  });

  it('configures Twitch auto rewards EventSub subscriptions', async () => {
    const channel = await createChannel({
      slug: 'twitch-auto-rewards',
      name: 'Twitch Auto Rewards',
      twitchChannelId: 'twitch-chan-4',
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp())
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({
        twitchAutoRewards: {
          v: 1,
          follow: { enabled: true, coins: 10, onceEver: true },
        },
      });

    expect(res.status).toBe(200);
    expect(twitchApiMocks.getEventSubSubscriptions).toHaveBeenCalledWith(channel.twitchChannelId);
    expect(twitchApiMocks.createEventSubSubscriptionOfType).toHaveBeenCalledTimes(1);
    expect(twitchApiMocks.createEventSubSubscriptionOfType).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'channel.follow',
        version: '2',
        broadcasterId: channel.twitchChannelId,
        webhookUrl: 'https://example.com/webhooks/twitch/eventsub',
        condition: {
          broadcaster_user_id: channel.twitchChannelId,
          moderator_user_id: channel.twitchChannelId,
        },
      })
    );

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: { twitchAutoRewardsJson: true },
    });
    const storedConfig = stored?.twitchAutoRewardsJson as { v?: number; follow?: { enabled?: boolean } } | null;
    expect(storedConfig?.v).toBe(1);
    expect(storedConfig?.follow?.enabled).toBe(true);
  });
});
