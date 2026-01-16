import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const sockets: FakeWebSocket[] = [];

class FakeWebSocket {
  handlers = new Map<string, (ev: unknown) => void>();
  sent: string[] = [];
  constructor(public url: string) {
    sockets.push(this);
  }
  addEventListener(event: string, handler: (ev: unknown) => void) {
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
      handler({ data });
      return;
    }
    handler(data);
  }
}

beforeEach(() => {
  sockets.length = 0;
  (globalThis as unknown as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

import { VkVideoPubSubClient } from '../../src/bots/vkvideoPubsubClient.js';

describe('vkvideo pubsub client', () => {
  it('connects and subscribes, then forwards push messages', () => {
    const pushes: Array<{ channel: string; data: unknown }> = [];
    const client = new VkVideoPubSubClient({
      url: 'wss://pubsub.example/ws',
      token: 'token-1',
      subscriptions: [{ channel: 'channel-1', token: 'sub-token' }],
      onPush: (push) => pushes.push(push),
    });

    client.start();
    expect(sockets).toHaveLength(1);

    const ws = sockets[0];
    ws.trigger('open');
    expect(ws.sent.length).toBeGreaterThan(0);
    const connectPayload = JSON.parse(ws.sent[0] || '{}');
    expect(connectPayload.connect?.token).toBe('token-1');

    ws.trigger('message', JSON.stringify({ id: 1, connect: {} }));
    expect(client.isConnected()).toBe(true);
    expect(ws.sent.length).toBeGreaterThan(1);
    const subscribePayload = JSON.parse(ws.sent[1] || '{}');
    expect(subscribePayload.subscribe?.channel).toBe('channel-1');
    expect(subscribePayload.subscribe?.token).toBe('sub-token');

    ws.trigger('message', JSON.stringify({ push: { channel: 'channel-1', pub: { data: { ok: true } } } }));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]).toEqual({ channel: 'channel-1', data: { ok: true } });
  });
});
