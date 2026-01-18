import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  channel: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const jwtMock = vi.hoisted(() => ({
  signJwt: vi.fn(() => 'credits-token'),
}));

const twitchMock = vi.hoisted(() => ({
  getEventSubSubscriptions: vi.fn(),
  deleteEventSubSubscription: vi.fn(),
  createStreamOnlineEventSubSubscription: vi.fn(),
  createStreamOfflineEventSubSubscription: vi.fn(),
}));

const creditsStoreMock = vi.hoisted(() => ({
  resetCreditsSession: vi.fn(),
  getCreditsStateFromStore: vi.fn(),
}));

vi.mock('../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../src/utils/jwt.js', () => jwtMock);
vi.mock('../src/utils/twitchApi.js', () => twitchMock);
vi.mock('../src/realtime/creditsSessionStore.js', () => creditsStoreMock);

import {
  getCreditsToken,
  getCreditsReconnectWindow,
  getCreditsState,
  getCreditsIgnoredChatters,
  rotateCreditsToken,
  resetCredits,
  saveCreditsSettings,
  setCreditsIgnoredChatters,
  setCreditsReconnectWindow,
} from '../src/controllers/admin/creditsOverlay.js';

type TestRes = {
  statusCode: number;
  body?: unknown;
  status: (code: number) => TestRes;
  json: (body: unknown) => TestRes;
};

type TestReq = {
  channelId?: string | null;
  userId?: string | null;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  app?: { get: (name: string) => unknown };
  get?: (name: string) => string | undefined;
};

function makeRes(): TestRes {
  const res: TestRes = {
    statusCode: 200,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

function makeReq(overrides: Partial<TestReq> = {}): TestReq {
  return {
    channelId: 'channel-1',
    userId: 'user-1',
    body: {},
    headers: {},
    app: { get: vi.fn() },
    get: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  prismaMock.channel.findUnique.mockReset();
  prismaMock.channel.update.mockReset();
  jwtMock.signJwt.mockClear();
  twitchMock.getEventSubSubscriptions.mockReset();
  twitchMock.deleteEventSubSubscription.mockReset();
  twitchMock.createStreamOnlineEventSubSubscription.mockReset();
  twitchMock.createStreamOfflineEventSubSubscription.mockReset();
  creditsStoreMock.resetCreditsSession.mockReset();
  creditsStoreMock.getCreditsStateFromStore.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('credits overlay admin', () => {
  it('returns 400 when channelId is missing for token', async () => {
    const req = makeReq({ channelId: null });
    const res = makeRes();

    await getCreditsToken(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'MISSING_CHANNEL_ID' });
  });

  it('returns 404 when channel is missing for token', async () => {
    prismaMock.channel.findUnique.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();

    await getCreditsToken(req as never, res as never);

    expect(res.statusCode).toBe(404);
    expect(res.body).toMatchObject({ errorCode: 'CHANNEL_NOT_FOUND' });
  });

  it('issues credits token and ensures eventsub subscriptions', async () => {
    const originalEnv = { ...process.env };
    process.env = { ...originalEnv, DOMAIN: 'example.com', TWITCH_EVENTSUB_SECRET: 'secret' };

    prismaMock.channel.findUnique.mockResolvedValue({
      slug: 'Test',
      creditsStyleJson: '{"ok":true}',
      creditsTokenVersion: 3,
      creditsReconnectWindowMinutes: 10,
      twitchChannelId: 'twitch-1',
    });
    twitchMock.getEventSubSubscriptions.mockResolvedValue({ data: [] });

    const req = makeReq({ get: vi.fn().mockReturnValue('example.com') });
    const res = makeRes();

    await getCreditsToken(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ token: 'credits-token', creditsStyleJson: '{"ok":true}' });
    expect(twitchMock.createStreamOnlineEventSubSubscription).toHaveBeenCalled();
    expect(twitchMock.createStreamOfflineEventSubSubscription).toHaveBeenCalled();

    process.env = originalEnv;
  });

  it('rotates credits token and disconnects overlay sockets', async () => {
    prismaMock.channel.update.mockResolvedValue({
      slug: 'Channel',
      creditsTokenVersion: 2,
    });

    const socketA = { data: { isCreditsOverlay: true }, disconnect: vi.fn() };
    const socketB = { data: { isCreditsOverlay: false }, disconnect: vi.fn() };
    const ioMock = {
      in: vi.fn().mockReturnValue({
        fetchSockets: vi.fn().mockResolvedValue([socketA, socketB]),
      }),
    };

    const req = makeReq({ app: { get: vi.fn().mockReturnValue(ioMock) } });
    const res = makeRes();

    await rotateCreditsToken(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(jwtMock.signJwt).toHaveBeenCalled();
    expect(socketA.disconnect).toHaveBeenCalledWith(true);
    expect(socketB.disconnect).not.toHaveBeenCalled();
  });

  it('clears credits style when empty string is provided', async () => {
    prismaMock.channel.update.mockResolvedValue({ slug: 'Channel', creditsStyleJson: null });

    const ioEmit = vi.fn();
    const ioMock = { to: vi.fn().mockReturnValue({ emit: ioEmit }) };
    const req = makeReq({
      body: { creditsStyleJson: '   ' },
      app: { get: vi.fn().mockReturnValue(ioMock) },
    });
    const res = makeRes();

    await saveCreditsSettings(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ ok: true, creditsStyleJson: null });
    expect(ioEmit).toHaveBeenCalledWith('credits:config', { creditsStyleJson: null });
  });

  it('rejects oversized credits style payload', async () => {
    const req = makeReq({ body: { creditsStyleJson: 'a'.repeat(50001) } });
    const res = makeRes();

    await saveCreditsSettings(req as never, res as never);

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'BAD_REQUEST' });
  });

  it('updates reconnect window minutes', async () => {
    prismaMock.channel.update.mockResolvedValue({ creditsReconnectWindowMinutes: 42 });
    const req = makeReq({ body: { minutes: 42 } });
    const res = makeRes();

    await setCreditsReconnectWindow(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ creditsReconnectWindowMinutes: 42 });
  });

  it('resets credits session and notifies overlays', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({ slug: 'Channel', creditsReconnectWindowMinutes: 5 });
    creditsStoreMock.resetCreditsSession.mockResolvedValue(undefined);

    const ioEmit = vi.fn();
    const ioMock = { to: vi.fn().mockReturnValue({ emit: ioEmit }) };
    const req = makeReq({ app: { get: vi.fn().mockReturnValue(ioMock) } });
    const res = makeRes();

    await resetCredits(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(creditsStoreMock.resetCreditsSession).toHaveBeenCalledWith('channel', 5);
    expect(ioEmit).toHaveBeenCalledWith('credits:state', { chatters: [], donors: [] });
  });

  it('returns credits state from store', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({ slug: 'Channel', creditsReconnectWindowMinutes: 12 });
    creditsStoreMock.getCreditsStateFromStore.mockResolvedValue({ chatters: ['a'], donors: ['b'] });

    const req = makeReq();
    const res = makeRes();

    await getCreditsState(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      channelSlug: 'channel',
      creditsReconnectWindowMinutes: 12,
      chatters: ['a'],
      donors: ['b'],
    });
  });

  it('returns reconnect window minutes', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({ creditsReconnectWindowMinutes: 15 });

    const req = makeReq();
    const res = makeRes();

    await getCreditsReconnectWindow(req as never, res as never);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ creditsReconnectWindowMinutes: 15 });
  });

  it('reads and updates ignored chatters list', async () => {
    prismaMock.channel.findUnique.mockResolvedValue({ creditsIgnoredChattersJson: ['a', 'b'] });
    prismaMock.channel.update.mockResolvedValue({ creditsIgnoredChattersJson: ['foo', 'bar'] });

    const readReq = makeReq();
    const readRes = makeRes();

    await getCreditsIgnoredChatters(readReq as never, readRes as never);

    expect(readRes.statusCode).toBe(200);
    expect(readRes.body).toMatchObject({ creditsIgnoredChatters: ['a', 'b'] });

    const writeReq = makeReq({
      body: { creditsIgnoredChatters: ['foo', 'bar', 'bar', ' ', 'x'.repeat(100)] },
    });
    const writeRes = makeRes();

    await setCreditsIgnoredChatters(writeReq as never, writeRes as never);

    expect(writeRes.statusCode).toBe(200);
    expect(prismaMock.channel.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { creditsIgnoredChattersJson: ['foo', 'bar'] } })
    );
  });
});
