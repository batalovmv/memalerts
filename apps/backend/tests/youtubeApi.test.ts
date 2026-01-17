import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const circuitMocks = vi.hoisted(() => ({
  execute: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}));

const httpMocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getServiceHttpTimeoutMs: vi.fn(() => 1000),
}));

const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  externalAccount: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  globalYouTubeBotCredential: {
    findFirst: vi.fn(),
  },
}));

const googleMocks = vi.hoisted(() => ({
  fetchGoogleTokenInfo: vi.fn(),
}));

vi.mock('../src/utils/circuitBreaker.js', () => ({
  getCircuitBreaker: () => ({ execute: circuitMocks.execute }),
}));

vi.mock('../src/utils/httpTimeouts.js', () => ({
  fetchWithTimeout: httpMocks.fetchWithTimeout,
  getServiceHttpTimeoutMs: httpMocks.getServiceHttpTimeoutMs,
}));

vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/auth/providers/youtube.js', () => ({
  fetchGoogleTokenInfo: googleMocks.fetchGoogleTokenInfo,
}));

const baseEnv = { ...process.env };

function jsonResponse(body: unknown, init: { status?: number; statusText?: string } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  process.env = {
    ...baseEnv,
    YOUTUBE_CLIENT_ID: 'client-id',
    YOUTUBE_CLIENT_SECRET: 'client-secret',
  };
  circuitMocks.execute.mockClear();
  httpMocks.fetchWithTimeout.mockReset();
  httpMocks.getServiceHttpTimeoutMs.mockReturnValue(1000);
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  prismaMock.externalAccount.findMany.mockReset();
  prismaMock.externalAccount.findUnique.mockReset();
  prismaMock.externalAccount.update.mockReset();
  prismaMock.globalYouTubeBotCredential.findFirst.mockReset();
  googleMocks.fetchGoogleTokenInfo.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('youtube http', () => {
  it('returns parsed json on success', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ items: [1, 2] }));

    const { youtubeGetJson } = await import('../src/utils/youtube/youtubeHttp.js');
    const data = await youtubeGetJson<{ items: number[] }>({ accessToken: 'token', url: 'https://example.com' });

    expect(data.items).toEqual([1, 2]);
    const call = httpMocks.fetchWithTimeout.mock.calls[0][0];
    expect(call.init?.headers).toMatchObject({ Authorization: 'Bearer token' });
  });

  it('throws YouTubeHttpError with reason and message', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse(
        {
          error: { message: 'quota exceeded', errors: [{ reason: 'quotaExceeded' }] },
        },
        { status: 403, statusText: 'Forbidden' }
      )
    );

    const { youtubeGetJson, YouTubeHttpError } = await import('../src/utils/youtube/youtubeHttp.js');

    let err: unknown = null;
    try {
      await youtubeGetJson({ accessToken: 'token', url: 'https://example.com' });
    } catch (error) {
      err = error;
    }

    expect(err).toBeInstanceOf(YouTubeHttpError);
    expect(err).toMatchObject({
      status: 403,
      errorReason: 'quotaExceeded',
      errorMessage: 'quota exceeded',
    });
  });
});

describe('youtube tokens', () => {
  it('returns cached token when valid', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'youtube',
      accessToken: 'cached-token',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() + 120000),
      scopes: null,
    });

    const { getValidYouTubeAccessTokenByExternalAccountId } = await import('../src/utils/youtube/youtubeTokens.js');
    const token = await getValidYouTubeAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('cached-token');
    expect(prismaMock.externalAccount.update).not.toHaveBeenCalled();
  });

  it('refreshes expired external account token', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'youtube',
      accessToken: 'expired',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'scope',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ access_token: 'new-token', expires_in: 3600, scope: 'scope' })
    );

    const { getValidYouTubeAccessTokenByExternalAccountId } = await import('../src/utils/youtube/youtubeTokens.js');
    const token = await getValidYouTubeAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('new-token');
    expect(prismaMock.externalAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ext-1' },
        data: expect.objectContaining({ accessToken: 'new-token' }),
      })
    );
  });

  it('returns missing env reason for refresh diagnostics', async () => {
    delete process.env.YOUTUBE_CLIENT_ID;
    delete process.env.YOUTUBE_CLIENT_SECRET;

    const { refreshYouTubeAccessTokenDetailed } = await import('../src/utils/youtube/youtubeTokens.js');
    const result = await refreshYouTubeAccessTokenDetailed('user-id');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_oauth_env');
  });

  it('returns valid access token via external account lookup', async () => {
    prismaMock.externalAccount.findMany.mockResolvedValue([
      {
        id: 'ext-1',
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(Date.now() + 120000),
        scopes: 'https://www.googleapis.com/auth/youtube.readonly',
      },
    ]);

    const { getValidYouTubeAccessToken } = await import('../src/utils/youtube/youtubeTokens.js');
    const token = await getValidYouTubeAccessToken('user-id');

    expect(token).toBe('token');
  });
});

describe('youtube channels', () => {
  it('fetches channel id and profile by access token', async () => {
    const youtubeHttp = await import('../src/utils/youtube/youtubeHttp.js');
    vi.spyOn(youtubeHttp, 'youtubeGetJson')
      .mockResolvedValueOnce({ items: [{ id: 'channel-1' }] })
      .mockResolvedValueOnce({
        items: [
          {
            id: 'channel-1',
            snippet: {
              title: 'My Channel',
              thumbnails: { high: { url: 'https://img.example/high.png' } },
            },
          },
        ],
      });

    const { fetchMyYouTubeChannelIdByAccessToken, fetchMyYouTubeChannelProfileByAccessToken } =
      await import('../src/utils/youtube/youtubeChannels.js');

    await expect(fetchMyYouTubeChannelIdByAccessToken('token')).resolves.toBe('channel-1');
    await expect(fetchMyYouTubeChannelProfileByAccessToken('token')).resolves.toEqual({
      channelId: 'channel-1',
      title: 'My Channel',
      avatarUrl: 'https://img.example/high.png',
    });
  });

  it('fetches public channel profile via oembed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ title: 'Public Channel', thumbnail_url: 'https://img.example/thumb.png' })
    );

    const { fetchYouTubeChannelProfilePublicByChannelId } = await import('../src/utils/youtube/youtubeChannels.js');
    const profile = await fetchYouTubeChannelProfilePublicByChannelId('channel-1');

    expect(profile).toEqual({ title: 'Public Channel', avatarUrl: 'https://img.example/thumb.png' });
  });

  it('returns diagnostics when no external account exists', async () => {
    prismaMock.externalAccount.findMany.mockResolvedValue([]);

    const { fetchMyYouTubeChannelIdDetailed } = await import('../src/utils/youtube/youtubeChannels.js');
    const result = await fetchMyYouTubeChannelIdDetailed('user-id');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('no_external_account');
  });

  it('returns missing scopes diagnostics', async () => {
    prismaMock.externalAccount.findMany.mockResolvedValue([
      {
        id: 'ext-1',
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(Date.now() + 120000),
        scopes: 'profile email',
      },
    ]);
    googleMocks.fetchGoogleTokenInfo.mockResolvedValue(null);

    const { fetchMyYouTubeChannelIdDetailed } = await import('../src/utils/youtube/youtubeChannels.js');
    const result = await fetchMyYouTubeChannelIdDetailed('user-id');

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing_scopes');
    expect(result.requiredScopesMissing).toContain('https://www.googleapis.com/auth/youtube.readonly');
  });

  it('returns channel id when token is valid', async () => {
    prismaMock.externalAccount.findMany.mockResolvedValue([
      {
        id: 'ext-1',
        accessToken: 'token',
        refreshToken: 'refresh',
        tokenExpiresAt: new Date(Date.now() + 120000),
        scopes: 'https://www.googleapis.com/auth/youtube.readonly',
      },
    ]);

    const youtubeHttp = await import('../src/utils/youtube/youtubeHttp.js');
    vi.spyOn(youtubeHttp, 'youtubeGetJson').mockResolvedValueOnce({ items: [{ id: 'channel-1' }] });

    const { fetchMyYouTubeChannelIdDetailed } = await import('../src/utils/youtube/youtubeChannels.js');
    const result = await fetchMyYouTubeChannelIdDetailed('user-id');

    expect(result.ok).toBe(true);
    expect(result.channelId).toBe('channel-1');
  });
});

describe('youtube live', () => {
  it('derives live video and chat ids from youtube api', async () => {
    const youtubeHttp = await import('../src/utils/youtube/youtubeHttp.js');
    vi.spyOn(youtubeHttp, 'youtubeGetJson')
      .mockResolvedValueOnce({ items: [{ id: { videoId: 'video-1' } }] })
      .mockResolvedValueOnce({ items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-1' } }] });

    const { fetchLiveVideoIdByChannelId, fetchActiveLiveChatIdByVideoId } =
      await import('../src/utils/youtube/youtubeLive.js');

    await expect(fetchLiveVideoIdByChannelId({ accessToken: 'token', youtubeChannelId: 'chan' })).resolves.toBe(
      'video-1'
    );
    await expect(fetchActiveLiveChatIdByVideoId({ accessToken: 'token', videoId: 'video-1' })).resolves.toBe('chat-1');
  });

  it('normalizes video rating values', async () => {
    const youtubeHttp = await import('../src/utils/youtube/youtubeHttp.js');
    vi.spyOn(youtubeHttp, 'youtubeGetJson')
      .mockResolvedValueOnce({ items: [{ rating: 'like' }] })
      .mockResolvedValueOnce({ items: [{ rating: 'unknown' }] });

    const { getYouTubeVideoRating } = await import('../src/utils/youtube/youtubeLive.js');

    await expect(getYouTubeVideoRating({ accessToken: 'token', videoId: 'video-1' })).resolves.toBe('like');
    await expect(getYouTubeVideoRating({ accessToken: 'token', videoId: 'video-2' })).resolves.toBe('unspecified');
  });

  it('lists live chat messages with defaults', async () => {
    const youtubeHttp = await import('../src/utils/youtube/youtubeHttp.js');
    vi.spyOn(youtubeHttp, 'youtubeGetJson').mockResolvedValueOnce({
      items: [{ id: 'msg-1' }],
      nextPageToken: 'next',
    });

    const { listLiveChatMessages } = await import('../src/utils/youtube/youtubeLive.js');
    const result = await listLiveChatMessages({ accessToken: 'token', liveChatId: 'chat-1', maxResults: 500 });

    expect(result.items).toHaveLength(1);
    expect(result.nextPageToken).toBe('next');
    expect(result.pollingIntervalMillis).toBe(2000);
  });

  it('sends live chat messages and handles errors', async () => {
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('bad', { status: 400, statusText: 'Bad' }))
      .mockResolvedValueOnce(new Response(null, { status: 204, statusText: 'No Content' }));

    const { sendLiveChatMessage } = await import('../src/utils/youtube/youtubeLive.js');

    await expect(
      sendLiveChatMessage({ accessToken: 'token', liveChatId: 'chat-1', messageText: 'Hi!' })
    ).rejects.toThrow(/YouTube API error: 400/);

    await expect(
      sendLiveChatMessage({ accessToken: 'token', liveChatId: 'chat-1', messageText: 'Hi!' })
    ).resolves.toBeUndefined();
  });
});
