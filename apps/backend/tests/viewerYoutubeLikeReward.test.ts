import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import * as youtubeApi from '../src/utils/youtubeApi.js';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser, createWallet, createYouTubeLikeRewardClaim } from './factories/index.js';

type AccountShape = {
  id: string;
  accessToken: string | null;
  refreshToken: string | null;
  tokenExpiresAt: Date | null;
  scopes: string | null;
};

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

describe('viewer YouTube like reward', () => {
  const originalEnv = { ...process.env };
  const strongScope = 'https://www.googleapis.com/auth/youtube.force-ssl';

  let accountSpy: ReturnType<typeof vi.spyOn>;
  let ratingSpy: ReturnType<typeof vi.spyOn>;
  let liveSpy: ReturnType<typeof vi.spyOn>;
  let streamerTokenSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';

    const defaultAccount: AccountShape = {
      id: 'acc_1',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: strongScope,
    };
    accountSpy = vi.spyOn(youtubeApi, 'getYouTubeExternalAccount').mockResolvedValue(defaultAccount);
    vi.spyOn(youtubeApi, 'getValidYouTubeAccessTokenByExternalAccountId').mockResolvedValue('token');
    ratingSpy = vi.spyOn(youtubeApi, 'getYouTubeVideoRating').mockResolvedValue('like');
    liveSpy = vi.spyOn(youtubeApi, 'fetchLiveVideoIdByChannelId').mockResolvedValue(null);
    streamerTokenSpy = vi.spyOn(youtubeApi, 'getValidYouTubeAccessToken').mockResolvedValue(null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns disabled when feature is off', async () => {
    const channel = await createChannel({
      slug: 'yt-disabled',
      youtubeLikeRewardEnabled: false,
      youtubeLikeRewardCoins: 0,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('disabled');
  });

  it('returns need_youtube_link when no account found', async () => {
    accountSpy.mockResolvedValue(null);
    const channel = await createChannel({
      slug: 'yt-link',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('need_youtube_link');
  });

  it('returns need_relink_scopes when account lacks force-ssl scope', async () => {
    accountSpy.mockResolvedValue({
      id: 'acc_2',
      accessToken: null,
      refreshToken: null,
      tokenExpiresAt: null,
      scopes: 'https://www.googleapis.com/auth/youtube.readonly',
    });
    const channel = await createChannel({
      slug: 'yt-scopes',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('need_relink_scopes');
    expect(Array.isArray(res.body?.requiredScopes)).toBe(true);
  });

  it('returns not_live when onlyWhenLive is enforced and live video is missing', async () => {
    liveSpy.mockResolvedValue(null);
    streamerTokenSpy.mockResolvedValue(null);
    const channel = await createChannel({
      slug: 'yt-live',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: true,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('not_live');
  });

  it('returns cooldown when lastCheckedAt is too recent', async () => {
    const channel = await createChannel({
      slug: 'yt-cooldown',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createYouTubeLikeRewardClaim({
      channelId: channel.id,
      userId: user.id,
      videoId: 'vid1',
      lastCheckedAt: new Date(),
    });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('cooldown');
  });

  it('returns not_liked when rating is not like', async () => {
    ratingSpy.mockResolvedValue('dislike');
    const channel = await createChannel({
      slug: 'yt-not-liked',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });

    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('not_liked');
    expect(res.body?.rating).toBe('dislike');
  });

  it('returns already_awarded when reward was already granted', async () => {
    const channel = await createChannel({
      slug: 'yt-awarded',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 100,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createYouTubeLikeRewardClaim({
      channelId: channel.id,
      userId: user.id,
      videoId: 'vid1',
      awardedAt: new Date(),
      coinsGranted: 77,
    });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('already_awarded');
    expect(res.body?.coinsGranted).toBe(77);
  });

  it('awards coins when video is liked', async () => {
    const channel = await createChannel({
      slug: 'yt-award',
      youtubeLikeRewardEnabled: true,
      youtubeLikeRewardCoins: 150,
      youtubeLikeRewardOnlyWhenLive: false,
    });
    const user = await createUser({ role: 'viewer', hasBetaAccess: false, channelId: null });
    await createWallet({ userId: user.id, channelId: channel.id, balance: 20 });

    const token = makeJwt({ userId: user.id, role: user.role, channelId: null });
    const res = await request(makeApp())
      .post('/rewards/youtube/like/claim')
      .set('Host', 'example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({ channelSlug: channel.slug, videoId: 'vid1' });

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('awarded');
    expect(res.body?.coinsGranted).toBe(150);
    expect(res.body?.balance).toBe(170);

    const wallet = await prisma.wallet.findUnique({
      where: { userId_channelId: { userId: user.id, channelId: channel.id } },
      select: { balance: true },
    });
    expect(wallet?.balance).toBe(170);
  });
});
