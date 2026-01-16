import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const httpMocks = vi.hoisted(() => ({
  fetchWithTimeout: vi.fn(),
  getServiceHttpTimeoutMs: vi.fn(() => 1000),
}));

const retryMocks = vi.hoisted(() => ({
  withRetry: vi.fn(async (action: (attempt: number) => Promise<unknown>) => action(1)),
  getServiceRetryConfig: vi.fn((_service: string, defaults: unknown) => defaults),
}));

const loggerMock = vi.hoisted(() => ({
  warn: vi.fn(),
}));

const prismaMock = vi.hoisted(() => ({
  externalAccount: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  globalKickBotCredential: {
    findFirst: vi.fn(),
  },
  globalTrovoBotCredential: {
    findFirst: vi.fn(),
  },
}));

const kickAuthMocks = vi.hoisted(() => ({
  refreshKickToken: vi.fn(),
}));

const trovoAuthMocks = vi.hoisted(() => ({
  refreshTrovoToken: vi.fn(),
}));

vi.mock('../src/utils/httpTimeouts.js', () => ({
  fetchWithTimeout: httpMocks.fetchWithTimeout,
  getServiceHttpTimeoutMs: httpMocks.getServiceHttpTimeoutMs,
}));
vi.mock('../src/utils/retry.js', () => ({
  withRetry: retryMocks.withRetry,
  getServiceRetryConfig: retryMocks.getServiceRetryConfig,
}));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/auth/providers/kick.js', () => ({ refreshKickToken: kickAuthMocks.refreshKickToken }));
vi.mock('../src/auth/providers/trovo.js', () => ({ refreshTrovoToken: trovoAuthMocks.refreshTrovoToken }));

const baseEnv = { ...process.env };

function jsonResponse(
  body: unknown,
  init: { status?: number; statusText?: string; headers?: Record<string, string> } = {}
): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  process.env = {
    ...baseEnv,
    DISCORD_MEMBER_CACHE_TTL_MS: '60000',
    KICK_CLIENT_ID: 'kick-client',
    KICK_CLIENT_SECRET: 'kick-secret',
    KICK_REFRESH_URL: 'https://kick.example/token',
    TROVO_CLIENT_ID: 'trovo-client',
    TROVO_CLIENT_SECRET: 'trovo-secret',
  };
  httpMocks.fetchWithTimeout.mockReset();
  httpMocks.getServiceHttpTimeoutMs.mockReturnValue(1000);
  retryMocks.withRetry.mockClear();
  retryMocks.getServiceRetryConfig.mockClear();
  loggerMock.warn.mockReset();
  prismaMock.externalAccount.findFirst.mockReset();
  prismaMock.externalAccount.findUnique.mockReset();
  prismaMock.externalAccount.update.mockReset();
  prismaMock.globalKickBotCredential.findFirst.mockReset();
  prismaMock.globalTrovoBotCredential.findFirst.mockReset();
  kickAuthMocks.refreshKickToken.mockReset();
  trovoAuthMocks.refreshTrovoToken.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('discord api', () => {
  it('fetches guild members and caches roles', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ roles: ['role-1'] }));

    const { fetchDiscordGuildMember } = await import('../src/utils/discordApi.js');
    const first = await fetchDiscordGuildMember({ botToken: 'bot', guildId: 'guild', userId: 'user' });
    const second = await fetchDiscordGuildMember({ botToken: 'bot', guildId: 'guild', userId: 'user' });

    expect(first.member?.roles).toEqual(['role-1']);
    expect(second.member?.roles).toEqual(['role-1']);
    expect(httpMocks.fetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('adds guild members', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(new Response(null, { status: 204, statusText: 'No Content' }));

    const { addDiscordGuildMember } = await import('../src/utils/discordApi.js');
    const result = await addDiscordGuildMember({
      botToken: 'bot',
      guildId: 'guild',
      userId: 'user',
      userAccessToken: 'token',
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe(204);
  });
});

describe('boosty api', () => {
  it('parses user subscriptions and tiers', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse({
        data: [
          {
            id: 'sub-1',
            blog_name: 'creator',
            status: 'active',
            tier: { id: 'tier-1' },
          },
        ],
      })
    );

    const { BoostyApiClient } = await import('../src/utils/boostyApi.js');
    const client = new BoostyApiClient({ baseUrl: 'https://boosty.example', auth: { accessToken: 'token' } });
    const subs = await client.getUserSubscriptions();

    expect(subs).toHaveLength(1);
    expect(subs[0].tierKey).toBe('tier-1');
    expect(subs[0].blogName).toBe('creator');
  });

  it('tries multiple endpoints for best-effort user id', async () => {
    httpMocks.fetchWithTimeout
      .mockResolvedValueOnce(new Response('', { status: 404, statusText: 'Not Found' }))
      .mockResolvedValueOnce(jsonResponse({ id: 'user-1' }));

    const { BoostyApiClient } = await import('../src/utils/boostyApi.js');
    const client = new BoostyApiClient({ baseUrl: 'https://boosty.example', auth: { accessToken: 'token' } });
    const userId = await client.getMyUserIdBestEffort();

    expect(userId).toBe('user-1');
  });
});

describe('kick api', () => {
  it('returns cached kick access token', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'kick',
      accessToken: 'cached-token',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() + 120000),
      scopes: null,
    });

    const { getValidKickAccessTokenByExternalAccountId } = await import('../src/utils/kickApi.js');
    const token = await getValidKickAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('cached-token');
  });

  it('refreshes kick access tokens', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'kick',
      accessToken: 'expired',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'scope',
    });
    kickAuthMocks.refreshKickToken.mockResolvedValue({
      status: 200,
      data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, scope: ['scope'] },
      raw: {},
    });

    const { getValidKickAccessTokenByExternalAccountId } = await import('../src/utils/kickApi.js');
    const token = await getValidKickAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('new-token');
    expect(prismaMock.externalAccount.update).toHaveBeenCalled();
  });

  it('sends chat messages and parses retry headers', async () => {
    httpMocks.fetchWithTimeout.mockResolvedValueOnce(
      jsonResponse({ ok: true }, { status: 200, headers: { 'retry-after': '3' } })
    );

    const { sendKickChatMessage } = await import('../src/utils/kickApi.js');
    const result = await sendKickChatMessage({
      accessToken: 'token',
      kickChannelId: '123',
      content: 'Hello',
      sendChatUrl: 'https://kick.example/chat',
    });

    expect(result.ok).toBe(true);
    expect(result.retryAfterSeconds).toBe(3);
  });

  it('lists and creates event subscriptions', async () => {
    httpMocks.fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({ data: [{ event: 'stream.online' }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { subscription_id: 'sub-1' } }));

    const { listKickEventSubscriptions, createKickEventSubscription } = await import('../src/utils/kickApi.js');
    const list = await listKickEventSubscriptions({ accessToken: 'token' });
    expect(list.subscriptions).toHaveLength(1);

    const created = await createKickEventSubscription({
      accessToken: 'token',
      callbackUrl: 'https://example.com',
      event: 'stream.online',
    });
    expect(created.subscriptionId).toBe('sub-1');
  });
});

describe('trovo api', () => {
  it('returns cached trovo access token', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'trovo',
      accessToken: 'cached-token',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() + 120000),
      scopes: null,
    });

    const { getValidTrovoAccessTokenByExternalAccountId } = await import('../src/utils/trovoApi.js');
    const token = await getValidTrovoAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('cached-token');
  });

  it('refreshes trovo access tokens', async () => {
    prismaMock.externalAccount.findUnique.mockResolvedValue({
      id: 'ext-1',
      provider: 'trovo',
      accessToken: 'expired',
      refreshToken: 'refresh',
      tokenExpiresAt: new Date(Date.now() - 1000),
      scopes: 'scope',
    });
    trovoAuthMocks.refreshTrovoToken.mockResolvedValue({
      status: 200,
      data: { access_token: 'new-token', refresh_token: 'new-refresh', expires_in: 3600, scope: ['scope'] },
      raw: {},
    });

    const { getValidTrovoAccessTokenByExternalAccountId } = await import('../src/utils/trovoApi.js');
    const token = await getValidTrovoAccessTokenByExternalAccountId('ext-1');

    expect(token).toBe('new-token');
    expect(prismaMock.externalAccount.update).toHaveBeenCalled();
  });

  it('fetches chat tokens and sends messages', async () => {
    httpMocks.fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({ data: { token: 'chat-token' } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }, { status: 200 }));

    const { fetchTrovoChatToken, sendTrovoChatMessage } = await import('../src/utils/trovoApi.js');
    const token = await fetchTrovoChatToken({ accessToken: 'token', clientId: 'client' });
    expect(token.token).toBe('chat-token');

    const sent = await sendTrovoChatMessage({
      accessToken: 'token',
      clientId: 'client',
      trovoChannelId: 'chan',
      content: 'Hello',
    });
    expect(sent.ok).toBe(true);
  });
});
