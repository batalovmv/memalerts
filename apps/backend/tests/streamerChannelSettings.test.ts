import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser } from './factories/index.js';

type EmitCall = { room: string; event: string; payload: unknown };

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp(emitted: EmitCall[]) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', {
    to(room: string) {
      return {
        emit(event: string, payload: unknown) {
          emitted.push({ room, event, payload });
        },
      };
    },
  });
  setupRoutes(app);
  return app;
}

describe('streamer channel settings', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
    process.env.TWITCH_EVENTSUB_SECRET = '';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('updates reward, submission, overlay, and color settings and emits events', async () => {
    const channel = await createChannel({
      slug: 'channel-settings',
      name: 'Channel Settings',
      rewardEnabled: false,
      rewardTitle: 'Old reward',
      rewardCost: 100,
      rewardCoins: 10,
      coinPerPointRatio: 1,
      submissionsEnabled: true,
      submissionsOnlyWhenLive: false,
      overlayMode: 'queue',
      overlayShowSender: false,
      overlayMaxConcurrent: 2,
      overlayStyleJson: null,
      primaryColor: '#111111',
      secondaryColor: '#222222',
      accentColor: '#333333',
      twitchAutoRewardsJson: null,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const emitted: EmitCall[] = [];
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const payload = {
      primaryColor: '#0A0A0A',
      secondaryColor: '#0B0B0B',
      accentColor: '#0C0C0C',
      coinPerPointRatio: 2.5,
      rewardTitle: 'Coins reward',
      rewardCost: 200,
      rewardCoins: 50,
      submissionsEnabled: false,
      submissionsOnlyWhenLive: true,
      overlayMode: 'simultaneous',
      overlayShowSender: true,
      overlayMaxConcurrent: 5,
      overlayStyleJson: '{"theme":"retro"}',
    };

    const res = await request(makeApp(emitted))
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body?.primaryColor).toBe(payload.primaryColor);
    expect(res.body?.secondaryColor).toBe(payload.secondaryColor);
    expect(res.body?.accentColor).toBe(payload.accentColor);
    expect(res.body?.coinPerPointRatio).toBe(payload.coinPerPointRatio);
    expect(res.body?.rewardTitle).toBe(payload.rewardTitle);
    expect(res.body?.rewardCost).toBe(payload.rewardCost);
    expect(res.body?.rewardCoins).toBe(payload.rewardCoins);
    expect(res.body?.submissionsEnabled).toBe(payload.submissionsEnabled);
    expect(res.body?.submissionsOnlyWhenLive).toBe(payload.submissionsOnlyWhenLive);
    expect(res.body?.overlayMode).toBe(payload.overlayMode);
    expect(res.body?.overlayShowSender).toBe(payload.overlayShowSender);
    expect(res.body?.overlayMaxConcurrent).toBe(payload.overlayMaxConcurrent);
    expect(res.body?.overlayStyleJson).toBe(payload.overlayStyleJson);

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: {
        primaryColor: true,
        secondaryColor: true,
        accentColor: true,
        coinPerPointRatio: true,
        rewardTitle: true,
        rewardCost: true,
        rewardCoins: true,
        submissionsEnabled: true,
        submissionsOnlyWhenLive: true,
        overlayMode: true,
        overlayShowSender: true,
        overlayMaxConcurrent: true,
        overlayStyleJson: true,
      },
    });

    expect(stored?.primaryColor).toBe(payload.primaryColor);
    expect(stored?.secondaryColor).toBe(payload.secondaryColor);
    expect(stored?.accentColor).toBe(payload.accentColor);
    expect(stored?.coinPerPointRatio).toBe(payload.coinPerPointRatio);
    expect(stored?.rewardTitle).toBe(payload.rewardTitle);
    expect(stored?.rewardCost).toBe(payload.rewardCost);
    expect(stored?.rewardCoins).toBe(payload.rewardCoins);
    expect(stored?.submissionsEnabled).toBe(payload.submissionsEnabled);
    expect(stored?.submissionsOnlyWhenLive).toBe(payload.submissionsOnlyWhenLive);
    expect(stored?.overlayMode).toBe(payload.overlayMode);
    expect(stored?.overlayShowSender).toBe(payload.overlayShowSender);
    expect(stored?.overlayMaxConcurrent).toBe(payload.overlayMaxConcurrent);
    expect(stored?.overlayStyleJson).toBe(payload.overlayStyleJson);

    const channelRoom = `channel:${channel.slug.toLowerCase()}`;
    const submissionsEvent = emitted.find((e) => e.room === channelRoom && e.event === 'submissions:status');
    expect(submissionsEvent?.payload).toEqual({ enabled: false, onlyWhenLive: true });
    const overlayEvent = emitted.find((e) => e.room === channelRoom && e.event === 'overlay:config');
    expect(overlayEvent?.payload).toEqual({
      overlayMode: payload.overlayMode,
      overlayShowSender: payload.overlayShowSender,
      overlayMaxConcurrent: payload.overlayMaxConcurrent,
      overlayStyleJson: payload.overlayStyleJson,
    });
  });

  it('supports partial updates without overwriting other fields', async () => {
    const channel = await createChannel({
      slug: 'partial-settings',
      name: 'Partial Settings',
      primaryColor: '#111111',
      secondaryColor: '#222222',
      submissionsEnabled: true,
      overlayMode: 'queue',
      overlayMaxConcurrent: 3,
    });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });

    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const res = await request(makeApp([]))
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ secondaryColor: '#AABBCC' });

    expect(res.status).toBe(200);
    expect(res.body?.secondaryColor).toBe('#AABBCC');
    expect(res.body?.primaryColor).toBe('#111111');
    expect(res.body?.submissionsEnabled).toBe(true);
    expect(res.body?.overlayMode).toBe('queue');

    const stored = await prisma.channel.findUnique({
      where: { id: channel.id },
      select: {
        primaryColor: true,
        secondaryColor: true,
        submissionsEnabled: true,
        overlayMode: true,
      },
    });
    expect(stored?.primaryColor).toBe('#111111');
    expect(stored?.secondaryColor).toBe('#AABBCC');
    expect(stored?.submissionsEnabled).toBe(true);
    expect(stored?.overlayMode).toBe('queue');
  });

  it('validates input values', async () => {
    const channel = await createChannel({ slug: 'invalid-settings', name: 'Invalid Settings' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const token = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });

    const res = await request(makeApp([]))
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ overlayMaxConcurrent: 10 });

    expect(res.status).toBe(400);
    expect(res.body?.error).toBe('Invalid input');
    expect(Array.isArray(res.body?.details)).toBe(true);
  });

  it('blocks non-streamer roles', async () => {
    const viewer = await createUser({ role: 'viewer', channelId: null });
    const token = makeJwt({ userId: viewer.id, role: viewer.role, channelId: viewer.channelId ?? null });

    const res = await request(makeApp([]))
      .patch('/streamer/channel/settings')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ submissionsEnabled: false });

    expect(res.status).toBe(403);
    expect(res.body?.errorCode).toBe('ROLE_REQUIRED');
  });
});
