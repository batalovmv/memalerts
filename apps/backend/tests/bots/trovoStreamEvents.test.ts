import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const wsMocks = vi.hoisted(() => {
  const sockets: Array<{
    handlers: Map<string, (data: unknown) => void>;
    sent: string[];
    url: string;
    on: (event: string, handler: (data: unknown) => void) => void;
    send: (data: string) => void;
    close: () => void;
    trigger: (event: string, data?: unknown) => void;
  }> = [];

  class FakeWebSocket {
    handlers = new Map<string, (data: unknown) => void>();
    sent: string[] = [];
    constructor(public url: string) {
      sockets.push(this);
    }
    on(event: string, handler: (data: unknown) => void) {
      this.handlers.set(event, handler);
    }
    send(data: string) {
      this.sent.push(data);
    }
    close() {
      return;
    }
    trigger(event: string, data?: unknown) {
      const handler = this.handlers.get(event);
      if (!handler) return;
      if (event === 'message') {
        handler(data);
        return;
      }
      handler(data);
    }
  }

  return { sockets, FakeWebSocket };
});

const prismaMock = vi.hoisted(() => ({
  trovoChatBotSubscription: { findMany: vi.fn() },
  botIntegrationSettings: { findMany: vi.fn() },
  trovoBotIntegration: { findMany: vi.fn() },
}));

const fetchTrovoChatToken = vi.hoisted(() => vi.fn());
const getTrovoExternalAccount = vi.hoisted(() => vi.fn());
const getValidTrovoAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const handleStreamOnline = vi.hoisted(() => vi.fn());
const handleStreamOffline = vi.hoisted(() => vi.fn());

vi.mock('ws', () => ({ default: wsMocks.FakeWebSocket }));
vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/trovoApi.js', () => ({
  fetchTrovoChatToken,
  getTrovoExternalAccount,
  getValidTrovoAccessTokenByExternalAccountId,
}));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ handleStreamOnline, handleStreamOffline }));

import { createTrovoStreamEvents } from '../../src/bots/trovoStreamEvents.js';
import type { TrovoChannelState } from '../../src/bots/trovoChatbotShared.js';

describe('trovo stream events', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.TROVO_CLIENT_ID = 'trovo-client';
    wsMocks.sockets.length = 0;
    vi.clearAllMocks();
    prismaMock.trovoChatBotSubscription.findMany.mockResolvedValue([
      {
        channelId: 'channel-1',
        userId: 'user-1',
        trovoChannelId: 'trovo-1',
        channel: { slug: 'slug-1' },
      },
    ]);
    prismaMock.botIntegrationSettings.findMany.mockResolvedValue([]);
    prismaMock.trovoBotIntegration.findMany.mockResolvedValue([]);
    getTrovoExternalAccount.mockResolvedValue({ id: 'ext-1' });
    getValidTrovoAccessTokenByExternalAccountId.mockResolvedValue('access-token');
    fetchTrovoChatToken.mockResolvedValue({ ok: true, token: 'ws-token', status: 200 });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('dispatches chat messages after reward processing', async () => {
    const states = new Map<string, TrovoChannelState>();
    const handleIncomingChat = vi.fn();
    const handleChatRewards = vi.fn().mockResolvedValue({ skipCommands: false });

    const events = createTrovoStreamEvents(
      states,
      { wsUrl: 'wss://trovo.example/ws', stoppedRef: { value: false } },
      { handleIncomingChat, handleChatRewards }
    );

    await events.syncSubscriptions();
    await new Promise((r) => setTimeout(r, 0));

    const st = states.get('channel-1');
    expect(st).toBeTruthy();
    const ws = wsMocks.sockets[0];
    ws.trigger('open');

    const nonce = st?.wsAuthNonce;
    ws.trigger('message', JSON.stringify({ type: 'RESPONSE', nonce, data: { ok: true } }));

    ws.trigger(
      'message',
      JSON.stringify({
        type: 'CHAT',
        data: {
          chats: [
            { uid: 'viewer-1', nick_name: 'Viewer', user_name: 'viewer', content: 'Hello world' },
          ],
        },
      })
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(handleChatRewards).toHaveBeenCalled();
    expect(handleIncomingChat).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-1' }),
      expect.objectContaining({ userId: 'viewer-1', displayName: 'Viewer', text: 'Hello world' })
    );
  });

  it('handles online/offline status events', async () => {
    const states = new Map<string, TrovoChannelState>();
    const handleIncomingChat = vi.fn();
    const handleChatRewards = vi.fn().mockResolvedValue({ skipCommands: true });

    const events = createTrovoStreamEvents(
      states,
      { wsUrl: 'wss://trovo.example/ws', stoppedRef: { value: false } },
      { handleIncomingChat, handleChatRewards }
    );

    await events.syncSubscriptions();
    await new Promise((r) => setTimeout(r, 0));

    const st = states.get('channel-1');
    const ws = wsMocks.sockets[0];
    ws.trigger('open');
    ws.trigger('message', JSON.stringify({ type: 'RESPONSE', nonce: st?.wsAuthNonce, data: { ok: true } }));

    ws.trigger(
      'message',
      JSON.stringify({
        type: 'CHAT',
        data: { chats: [{ type: 5012, content: 'online' }] },
      })
    );
    ws.trigger(
      'message',
      JSON.stringify({
        type: 'CHAT',
        data: { chats: [{ type: 5012, content: 'offline' }] },
      })
    );

    await new Promise((r) => setTimeout(r, 0));

    expect(handleStreamOnline).toHaveBeenCalledWith('slug-1', 60);
    expect(handleStreamOffline).toHaveBeenCalledWith('slug-1');
  });
});
