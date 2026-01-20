import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  externalAccount: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  globalVkVideoBotCredential: {
    findFirst: vi.fn(),
  },
}));

const vkvideoAuthMocks = vi.hoisted(() => ({
  refreshVkVideoToken: vi.fn(),
}));

vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/auth/providers/vkvideo.js', () => ({ refreshVkVideoToken: vkvideoAuthMocks.refreshVkVideoToken }));

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
    VKVIDEO_CLIENT_ID: 'client-id',
    VKVIDEO_CLIENT_SECRET: 'client-secret',
    VKVIDEO_TOKEN_URL: 'https://vkvideo.example/token',
    VKVIDEO_CALLBACK_URL: 'https://app.example/vkvideo/callback',
  };
  loggerMock.warn.mockReset();
  prismaMock.externalAccount.findFirst.mockReset();
  prismaMock.externalAccount.findUnique.mockReset();
  prismaMock.externalAccount.update.mockReset();
  prismaMock.globalVkVideoBotCredential.findFirst.mockReset();
  vkvideoAuthMocks.refreshVkVideoToken.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('vkvideo core', () => {
  it('guesses api base url from env', async () => {
    const { guessVkVideoApiBaseUrl } = await import('../src/utils/vkvideo/vkvideoCore.js');

    process.env.VKVIDEO_API_BASE_URL = 'https://api.vkvideo.test/';
    expect(guessVkVideoApiBaseUrl()).toBe('https://api.vkvideo.test');

    process.env.VKVIDEO_API_BASE_URL = '';
    process.env.VKVIDEO_USERINFO_URL = 'https://api.vkvideo.test/userinfo';
    expect(guessVkVideoApiBaseUrl()).toBe('https://api.vkvideo.test');

    process.env.VKVIDEO_USERINFO_URL = 'not-a-url';
    expect(guessVkVideoApiBaseUrl()).toBeNull();
  });

  it('returns ok results for successful GET', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(jsonResponse({ data: { ok: true } }));

    const { vkvideoGetJson } = await import('../src/utils/vkvideo/vkvideoCore.js');
    const result = await vkvideoGetJson({ accessToken: 'token', url: 'https://api.vkvideo.test/v1' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ data: { ok: true } });
  });

  it('returns error details for failed GET', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ error_description: 'bad request' }, { status: 400, statusText: 'Bad' })
    );

    const { vkvideoGetJson } = await import('../src/utils/vkvideo/vkvideoCore.js');
    const result = await vkvideoGetJson({ accessToken: 'token', url: 'https://api.vkvideo.test/v1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect(result.error).toContain('VKVideo API error: 400 bad request');
  });

  it('handles request failures with warnings', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

    const { vkvideoGetJson } = await import('../src/utils/vkvideo/vkvideoCore.js');
    const result = await vkvideoGetJson({ accessToken: 'token', url: 'https://api.vkvideo.test/v1' });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(loggerMock.warn).toHaveBeenCalledWith('vkvideo.request_failed', expect.any(Object));
  });

  it('posts json payloads with error handling', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('bad', { status: 500, statusText: 'Bad' }));

    const { vkvideoPostJson } = await import('../src/utils/vkvideo/vkvideoCore.js');
    const result = await vkvideoPostJson({
      accessToken: 'token',
      url: 'https://api.vkvideo.test/v1/post',
      body: { hello: 'world' },
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
  });
});

describe('vkvideo tokens', () => {
  it('returns cached access tokens when valid', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'vkvideo',
      accessToken: 'cached-token',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() + 120000),
      scopes: null,
    });

    const { getValidVkVideoAccessTokenByExternalAccountId } = await import('../src/utils/vkvideo/vkvideoTokens.js');
    const token = await getValidVkVideoAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('cached-token');
    expect(prismaMock.externalAccount.update).not.toHaveBeenCalled();
  });

  it('refreshes expired tokens', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'vkvideo',
      accessToken: 'expired',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'scope',
    });

    vkvideoAuthMocks.refreshVkVideoToken.mockResolvedValue({
      status: 200,
      data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, scope: ['scope'] },
      raw: {},
    });

    const { getValidVkVideoAccessTokenByExternalAccountId } = await import('../src/utils/vkvideo/vkvideoTokens.js');
    const token = await getValidVkVideoAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('new-token');
    expect(prismaMock.externalAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'ext-1' },
        data: expect.objectContaining({ accessToken: 'new-token' }),
      })
    );
  });

  it('returns null when no bot credential is configured', async () => {
    prismaMock.globalVkVideoBotCredential.findFirst.mockResolvedValue(null);

    const { getValidVkVideoBotAccessToken } = await import('../src/utils/vkvideo/vkvideoTokens.js');
    const token = await getValidVkVideoBotAccessToken();

    expect(token).toBeNull();
  });
});

describe('vkvideo channel', () => {
  it('returns error when api base url is missing', async () => {
    delete process.env.VKVIDEO_API_BASE_URL;
    delete process.env.VKVIDEO_USERINFO_URL;

    const { fetchVkVideoChannel } = await import('../src/utils/vkvideo/vkvideoChannel.js');
    const result = await fetchVkVideoChannel({ accessToken: 'token', channelUrl: 'vk.com/test' });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('VKVIDEO_API_BASE_URL');
  });

  it('parses channel details and websocket tokens', async () => {
    const core = await import('../src/utils/vkvideo/vkvideoCore.js');
    vi.spyOn(core, 'vkvideoGetJson')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { stream: { id: 'stream-1' }, channel: { web_socket_channels: ['room-1'] } } },
        error: null,
      })
      .mockResolvedValueOnce({ ok: true, status: 200, data: { data: { token: 'ws-token' } }, error: null })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { channel_tokens: [{ channel: 'room-1', token: 'sub-1' }] } },
        error: null,
      });

    const { fetchVkVideoChannel, fetchVkVideoWebsocketToken, fetchVkVideoWebsocketSubscriptionTokens } =
      await import('../src/utils/vkvideo/vkvideoChannel.js');

    const channel = await fetchVkVideoChannel({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      apiBaseUrl: 'https://api.vkvideo.test',
    });
    expect(channel.streamId).toBe('stream-1');
    expect(channel.webSocketChannels).toEqual(['room-1']);

    const token = await fetchVkVideoWebsocketToken({ accessToken: 'token', apiBaseUrl: 'https://api.vkvideo.test' });
    expect(token.token).toBe('ws-token');

    const subs = await fetchVkVideoWebsocketSubscriptionTokens({
      accessToken: 'token',
      channels: ['room-1'],
      apiBaseUrl: 'https://api.vkvideo.test',
    });
    expect(subs.tokensByChannel.get('room-1')).toBe('sub-1');
  });

  it('sends chat messages through post helper', async () => {
    const core = await import('../src/utils/vkvideo/vkvideoCore.js');
    const postSpy = vi.spyOn(core, 'vkvideoPostJson').mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
      error: null,
    });

    const { sendVkVideoChatMessage } = await import('../src/utils/vkvideo/vkvideoChannel.js');
    await sendVkVideoChatMessage({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      streamId: 'stream-1',
      text: 'Hello',
      apiBaseUrl: 'https://api.vkvideo.test',
    });

    const call = postSpy.mock.calls[0][0];
    expect(call.url).toContain('/v1/chat/message/send');
    expect(call.body).toMatchObject({
      parts: [{ text: { content: 'Hello' } }],
    });
  });
});

describe('vkvideo channel points', () => {
  it('fetches balance and rewards', async () => {
    const core = await import('../src/utils/vkvideo/vkvideoCore.js');
    vi.spyOn(core, 'vkvideoGetJson')
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { balance: 42, currency: 'points' } },
        error: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: { data: { rewards: [{ id: 'reward-1' }] } },
        error: null,
      });

    const { fetchVkVideoChannelPointBalance, fetchVkVideoChannelPointRewards } =
      await import('../src/utils/vkvideo/vkvideoChannelPoints.js');

    const balance = await fetchVkVideoChannelPointBalance({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      apiBaseUrl: 'https://api.vkvideo.test',
    });
    expect(balance.balance).toBe(42);
    expect(balance.currency).toBe('points');

    const rewards = await fetchVkVideoChannelPointRewards({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      apiBaseUrl: 'https://api.vkvideo.test',
    });
    expect(rewards.rewards).toHaveLength(1);
  });

  it('validates reward activation payloads', async () => {
    const core = await import('../src/utils/vkvideo/vkvideoCore.js');
    const postSpy = vi.spyOn(core, 'vkvideoPostJson').mockResolvedValue({
      ok: true,
      status: 200,
      data: { ok: true },
      error: null,
    });

    const { activateVkVideoChannelReward } = await import('../src/utils/vkvideo/vkvideoChannelPoints.js');

    const missing = await activateVkVideoChannelReward({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      rewardId: '',
      apiBaseUrl: 'https://api.vkvideo.test',
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toBe('missing_reward_id');

    await activateVkVideoChannelReward({
      accessToken: 'token',
      channelUrl: 'vk.com/test',
      rewardId: 'reward-1',
      message: 'Thanks!',
      apiBaseUrl: 'https://api.vkvideo.test',
    });

    expect(postSpy).toHaveBeenCalled();
    const body = postSpy.mock.calls[0][0].body as Record<string, unknown>;
    expect(body).toMatchObject({
      reward: {
        id: 'reward-1',
        message: {
          parts: [{ text: { content: 'Thanks!' } }],
        },
      },
    });
  });
});

describe('vkvideo roles', () => {
  it('validates url template', async () => {
    delete process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE;

    const { fetchVkVideoUserRolesOnChannel } = await import('../src/utils/vkvideo/vkvideoRoles.js');
    const missing = await fetchVkVideoUserRolesOnChannel({
      accessToken: 'token',
      vkvideoChannelId: 'chan',
      vkvideoUserId: 'user',
    });
    expect(missing.ok).toBe(false);

    process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE = 'https://vkvideo.example/{channelId}';
    const invalid = await fetchVkVideoUserRolesOnChannel({
      accessToken: 'token',
      vkvideoChannelId: 'chan',
      vkvideoUserId: 'user',
    });
    expect(invalid.ok).toBe(false);
  });

  it('fetches role ids from api', async () => {
    process.env.VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE =
      'https://vkvideo.example/channels/{channelId}/users/{userId}/roles';

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      jsonResponse({ data: { roles: [{ id: '1' }, { id: 2 }, { id: '1' }] } })
    );

    const { fetchVkVideoUserRolesOnChannel } = await import('../src/utils/vkvideo/vkvideoRoles.js');
    const result = await fetchVkVideoUserRolesOnChannel({
      accessToken: 'token',
      vkvideoChannelId: 'chan',
      vkvideoUserId: 'user',
    });

    expect(result.ok).toBe(true);
    expect(result.roleIds).toEqual(['1', '2']);
  });
});
