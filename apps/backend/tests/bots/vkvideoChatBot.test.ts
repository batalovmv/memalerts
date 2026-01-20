import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  send(data: string, cb?: (err?: unknown) => void) {
    this.sent.push(data);
    if (cb) cb();
  }
  close() {
    return;
  }
  trigger(event: string, data?: unknown) {
    const handler = this.handlers.get(event);
    if (handler) handler(data);
  }
}

beforeEach(() => {
  sockets.length = 0;
  (globalThis as unknown as { WebSocket?: unknown }).WebSocket = FakeWebSocket;
});

afterEach(() => {
  delete (globalThis as unknown as { WebSocket?: unknown }).WebSocket;
});

import { VkVideoChatBot } from '../../src/bots/vkvideoChatBot.js';

describe('vkvideo chat bot', () => {
  it('joins and parses incoming messages', async () => {
    const onMessage = vi.fn();
    const bot = new VkVideoChatBot(
      { wsUrlTemplate: 'wss://ws.example/{channelId}', sendMessageFormat: 'json' },
      onMessage
    );

    await bot.join('vk-1');

    const ws = sockets[0];
    ws.trigger('message', {
      data: JSON.stringify({
        text: 'hello',
        user: { id: 'u1', name: 'Viewer', login: 'viewer' },
      }),
    });

    expect(onMessage).toHaveBeenCalledWith(
      expect.objectContaining({ vkvideoChannelId: 'vk-1', userId: 'u1', displayName: 'Viewer', text: 'hello' })
    );
  });

  it('sends messages over websocket', async () => {
    const bot = new VkVideoChatBot(
      { wsUrlTemplate: 'wss://ws.example/{channelId}', sendMessageFormat: 'json' },
      () => undefined
    );

    await bot.join('vk-2');
    await bot.say('vk-2', 'Hello');

    const ws = sockets[0];
    expect(ws.sent[0]).toBe(JSON.stringify({ type: 'message', text: 'Hello' }));
  });
});
