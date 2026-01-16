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
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  globalTwitchBotCredential: {
    findFirst: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
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
    TWITCH_CLIENT_ID: 'client-id',
    TWITCH_CLIENT_SECRET: 'client-secret',
  };
  circuitMocks.execute.mockClear();
  httpMocks.fetchWithTimeout.mockReset();
  httpMocks.getServiceHttpTimeoutMs.mockReturnValue(1000);
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  prismaMock.externalAccount.findUnique.mockReset();
  prismaMock.externalAccount.update.mockReset();
  prismaMock.globalTwitchBotCredential.findFirst.mockReset();
  prismaMock.user.findUnique.mockReset();
  prismaMock.user.update.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('twitch app token', () => {
  it('fetches an app access token', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(jsonResponse({ access_token: 'app_token' }));

    const { getAppAccessToken } = await import('../src/utils/twitch/twitchAppToken.js');
    const token = await getAppAccessToken();

    expect(token).toBe('app_token');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://id.twitch.tv/oauth2/token',
      expect.objectContaining({ method: 'POST' })
    );
    const body = fetchSpy.mock.calls[0][1]?.body as URLSearchParams;
    expect(body.get('client_id')).toBe('client-id');
    expect(body.get('client_secret')).toBe('client-secret');
    expect(body.get('grant_type')).toBe('client_credentials');
  });

  it('throws when app token response is invalid', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('bad', { status: 400, statusText: 'Bad' }));

    const { getAppAccessToken } = await import('../src/utils/twitch/twitchAppToken.js');

    await expect(getAppAccessToken()).rejects.toThrow(/Failed to get app access token: 400/);
  });
});

describe('twitch api request', () => {
  it('uses existing token and sends authenticated request', async () => {
    const tokens = await import('../src/utils/twitch/twitchTokens.js');
    vi.spyOn(tokens, 'getValidAccessToken').mockResolvedValue('user-token');
    vi.spyOn(tokens, 'refreshAccessToken').mockResolvedValue(null);

    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ data: ['ok'] }));

    const { twitchApiRequest } = await import('../src/utils/twitch/twitchApiRequest.js');
    const result = await twitchApiRequest('users', 'GET', 'user-id');

    expect(result).toEqual({ data: ['ok'] });
    const call = httpMocks.fetchWithTimeout.mock.calls[0][0];
    expect(call.url).toBe('https://api.twitch.tv/helix/users');
    expect(call.init?.headers).toMatchObject({
      'Client-ID': 'client-id',
      Authorization: 'Bearer user-token',
    });
  });

  it('refreshes token on 401 and retries', async () => {
    const tokens = await import('../src/utils/twitch/twitchTokens.js');
    vi.spyOn(tokens, 'getValidAccessToken').mockResolvedValue('old-token');
    vi.spyOn(tokens, 'refreshAccessToken').mockResolvedValue('new-token');

    httpMocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response('unauthorized', { status: 401, statusText: 'Unauthorized' }))
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: '1' }] }));

    const { twitchApiRequest } = await import('../src/utils/twitch/twitchApiRequest.js');
    const result = await twitchApiRequest('users', 'GET', 'user-id');

    expect(result).toEqual({ data: [{ id: '1' }] });
    const retryCall = httpMocks.fetchWithTimeout.mock.calls[1][0];
    expect(retryCall.init?.headers).toMatchObject({ Authorization: 'Bearer new-token' });
  });

  it('fails when no access token is available', async () => {
    const tokens = await import('../src/utils/twitch/twitchTokens.js');
    vi.spyOn(tokens, 'getValidAccessToken').mockResolvedValue(null);
    vi.spyOn(tokens, 'refreshAccessToken').mockResolvedValue(null);

    const { twitchApiRequest } = await import('../src/utils/twitch/twitchApiRequest.js');

    await expect(twitchApiRequest('users', 'GET', 'user-id')).rejects.toMatchObject({ code: 'TWITCH_NO_TOKEN' });
    expect(httpMocks.fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('throws structured errors for non-ok responses', async () => {
    const tokens = await import('../src/utils/twitch/twitchTokens.js');
    vi.spyOn(tokens, 'getValidAccessToken').mockResolvedValue('user-token');

    httpMocks.fetchWithTimeout.mockResolvedValueOnce(new Response('oops', { status: 500, statusText: 'Server Error' }));

    const { twitchApiRequest } = await import('../src/utils/twitch/twitchApiRequest.js');

    await expect(twitchApiRequest('users', 'GET', 'user-id')).rejects.toMatchObject({
      status: 500,
      body: 'oops',
    });
  });
});

describe('twitch rewards', () => {
  it('creates, updates, and lists rewards via api request', async () => {
    const apiModule = await import('../src/utils/twitch/twitchApiRequest.js');
    const requestSpy = vi.spyOn(apiModule, 'twitchApiRequest').mockResolvedValue({ data: [] });

    const { createChannelReward, updateChannelReward, getChannelRewards } = await import('../src/utils/twitch/twitchRewards.js');

    await createChannelReward('user-id', 'broadcaster', 'My Reward', 250);
    expect(requestSpy).toHaveBeenCalledWith(
      'channel_points/custom_rewards?broadcaster_id=broadcaster',
      'POST',
      'user-id',
      expect.objectContaining({
        title: 'My Reward',
        cost: 250,
        prompt: 'My Reward',
      })
    );

    await updateChannelReward('user-id', 'broadcaster', 'reward-id', { is_enabled: false });
    expect(requestSpy).toHaveBeenCalledWith(
      'channel_points/custom_rewards?broadcaster_id=broadcaster&id=reward-id',
      'PATCH',
      'user-id',
      { is_enabled: false }
    );

    await getChannelRewards('user-id', 'broadcaster');
    expect(requestSpy).toHaveBeenCalledWith('channel_points/custom_rewards?broadcaster_id=broadcaster', 'GET', 'user-id');
  });

  it('swallows 204/empty responses on delete', async () => {
    const apiModule = await import('../src/utils/twitch/twitchApiRequest.js');
    const requestSpy = vi.spyOn(apiModule, 'twitchApiRequest').mockRejectedValueOnce(new Error('Unexpected end of JSON input'));

    const { deleteChannelReward } = await import('../src/utils/twitch/twitchRewards.js');
    await expect(deleteChannelReward('user-id', 'broadcaster', 'reward-id')).resolves.toBeUndefined();
    expect(requestSpy).toHaveBeenCalledWith(
      'channel_points/custom_rewards?broadcaster_id=broadcaster&id=reward-id',
      'DELETE',
      'user-id'
    );
  });
});

describe('twitch eventsub', () => {
  it('creates, lists, and deletes subscriptions', async () => {
    const appToken = await import('../src/utils/twitch/twitchAppToken.js');
    vi.spyOn(appToken, 'getAppAccessToken').mockResolvedValue('app-token');

    httpMocks.fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({ data: [{ id: 'sub-1' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: [] }))
      .mockResolvedValueOnce(new Response(null, { status: 204, statusText: 'No Content' }));

    const { createEventSubSubscription, getEventSubSubscriptions, deleteEventSubSubscription } = await import(
      '../src/utils/twitch/twitchEventSub.js'
    );

    const created = await createEventSubSubscription('user-id', 'broadcaster', 'https://hook', 'secret');
    expect(created.data?.[0]?.id).toBe('sub-1');
    const createCall = httpMocks.fetchWithTimeout.mock.calls[0][0];
    const createBody = JSON.parse(String(createCall.init?.body || '{}')) as Record<string, unknown>;
    expect(createCall.url).toBe('https://api.twitch.tv/helix/eventsub/subscriptions');
    expect(createBody.type).toBe('channel.channel_points_custom_reward_redemption.add');
    expect(createBody).toMatchObject({
      condition: { broadcaster_user_id: 'broadcaster' },
      transport: { method: 'webhook', callback: 'https://hook', secret: 'secret' },
    });

    await getEventSubSubscriptions('broadcaster');
    const listCall = httpMocks.fetchWithTimeout.mock.calls[1][0];
    expect(listCall.url).toBe('https://api.twitch.tv/helix/eventsub/subscriptions?user_id=broadcaster');

    await expect(deleteEventSubSubscription('sub-1')).resolves.toBeUndefined();
    const deleteCall = httpMocks.fetchWithTimeout.mock.calls[2][0];
    expect(deleteCall.url).toContain('id=sub-1');
    expect(deleteCall.init?.method).toBe('DELETE');
  });
});

describe('twitch tokens', () => {
  it('returns cached access token when not expired', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'twitch',
      accessToken: 'cached-token',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() + 120000),
      scopes: null,
    });

    const { getValidTwitchAccessTokenByExternalAccountId } = await import('../src/utils/twitch/twitchTokens.js');
    const token = await getValidTwitchAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('cached-token');
    expect(prismaMock.externalAccount.update).not.toHaveBeenCalled();
  });

  it('refreshes access token when expired', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'twitch',
      accessToken: 'expired',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'user:read:email',
    });

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        access_token: 'new-token',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        scope: ['user:read:email'],
      })
    );

    const { getValidTwitchAccessTokenByExternalAccountId } = await import('../src/utils/twitch/twitchTokens.js');
    const token = await getValidTwitchAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('new-token');
    expect(prismaMock.externalAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ext-1' },
        data: expect.objectContaining({ accessToken: 'new-token' }),
      })
    );
  });

  it('returns null when no bot credential is available', async () => {
    prismaMock.globalTwitchBotCredential.findFirst.mockResolvedValue(null);

    const { getValidTwitchBotAccessToken } = await import('../src/utils/twitch/twitchTokens.js');
    const token = await getValidTwitchBotAccessToken();

    expect(token).toBeNull();
  });

  it('refreshes user access tokens', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ twitchRefreshToken: 'refresh' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({
        access_token: 'user-token',
        refresh_token: 'user-refresh',
      })
    );

    const { refreshAccessToken } = await import('../src/utils/twitch/twitchTokens.js');
    const token = await refreshAccessToken('user-id');

    expect(token).toBe('user-token');
    expect(prismaMock.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-id' },
        data: { twitchAccessToken: 'user-token', twitchRefreshToken: 'user-refresh' },
      })
    );
  });
});

describe('twitch users', () => {
  it('returns authenticated user details', async () => {
    const apiModule = await import('../src/utils/twitch/twitchApiRequest.js');
    vi.spyOn(apiModule, 'twitchApiRequest').mockResolvedValue({
      data: [{ id: '123', display_name: 'Test User' }],
    });

    const { getAuthenticatedTwitchUser } = await import('../src/utils/twitch/twitchUsers.js');
    const user = await getAuthenticatedTwitchUser('user-id');

    expect(user).toEqual({ id: '123', display_name: 'Test User' });
  });

  it('falls back to app token for channel info', async () => {
    const apiModule = await import('../src/utils/twitch/twitchApiRequest.js');
    vi.spyOn(apiModule, 'twitchApiRequest').mockRejectedValue(new Error('user token failed'));

    const appToken = await import('../src/utils/twitch/twitchAppToken.js');
    vi.spyOn(appToken, 'getAppAccessToken').mockResolvedValue('app-token');

    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse({ data: [{ broadcaster_type: 'partner', login: 'Streamer' }] })
    );

    const { getChannelInformation } = await import('../src/utils/twitch/twitchUsers.js');
    const info = await getChannelInformation('user-id', 'broadcaster');

    expect(info?.broadcaster_type).toBe('partner');
    expect(info?._meta?.tokenMode).toBe('app');
  });

  it('uses user token when available for channel info', async () => {
    const apiModule = await import('../src/utils/twitch/twitchApiRequest.js');
    vi.spyOn(apiModule, 'twitchApiRequest').mockResolvedValue({
      data: [{ broadcaster_type: 'affiliate' }],
    });

    const { getChannelInformation } = await import('../src/utils/twitch/twitchUsers.js');
    const info = await getChannelInformation('user-id', 'broadcaster');

    expect(info?.broadcaster_type).toBe('affiliate');
    expect(info?._meta?.tokenMode).toBe('user');
  });

  it('gets login using app token', async () => {
    const appToken = await import('../src/utils/twitch/twitchAppToken.js');
    vi.spyOn(appToken, 'getAppAccessToken').mockResolvedValue('app-token');

    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ data: [{ login: 'Test_User' }] }));

    const { getTwitchLoginByUserId } = await import('../src/utils/twitch/twitchUsers.js');
    const login = await getTwitchLoginByUserId('123');

    expect(login).toBe('test_user');
  });
});
