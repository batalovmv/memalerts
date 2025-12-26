import { logger } from '../utils/logger.js';
import WebSocketImpl from 'ws';

function ensureWebSocketCtor(): any {
  // Prefer built-in WebSocket (Node 20+). Fall back to `ws` for Node 18/older runtimes.
  const WS: any = (globalThis as any).WebSocket;
  return WS || (WebSocketImpl as any);
}

type SubscriptionSpec = { channel: string; token?: string | null };

export type VkVideoPubSubPush = {
  channel: string;
  data: any;
};

export class VkVideoPubSubClient {
  private ws: any | null = null;
  private stopped = false;
  private nextId = 1;
  private connected = false;

  constructor(
    private opts: {
      url: string;
      token: string;
      subscriptions: SubscriptionSpec[];
      logContext?: Record<string, any>;
      onPush: (push: VkVideoPubSubPush) => void;
    },
  ) {}

  start(): void {
    if (this.stopped) return;
    if (this.ws) return;

    const WS = ensureWebSocketCtor();
    const ws =
      WS === (WebSocketImpl as any)
        ? new WS(this.opts.url)
        : new WS(this.opts.url, [], undefined);

    this.ws = ws;
    this.connected = false;
    this.nextId = 1;

    ws.addEventListener('open', () => {
      const ctx = this.opts.logContext || {};
      logger.info('vkvideo_pubsub.ws_open', { ...ctx });
      this.sendConnect();
    });

    ws.addEventListener('close', (ev: any) => {
      const ctx = this.opts.logContext || {};
      logger.warn('vkvideo_pubsub.ws_close', { ...ctx, code: ev?.code, reason: String(ev?.reason || '') });
      this.ws = null;
      this.connected = false;
      // Reconnect is handled by the runner (periodic resync).
    });

    ws.addEventListener('error', (ev: any) => {
      const ctx = this.opts.logContext || {};
      logger.warn('vkvideo_pubsub.ws_error', { ...ctx, error: String(ev?.message || ev?.error || '') });
    });

    ws.addEventListener('message', (ev: any) => {
      const raw = ev?.data;
      const text = typeof raw === 'string' ? raw : raw?.toString?.() || '';
      if (!text) return;
      this.handleFrame(text);
    });
  }

  isOpen(): boolean {
    return !!this.ws;
  }

  isConnected(): boolean {
    return this.connected;
  }

  stop(): void {
    this.stopped = true;
    const ws = this.ws;
    this.ws = null;
    this.connected = false;
    try {
      ws?.close?.();
    } catch {
      // ignore
    }
  }

  private send(obj: any) {
    if (!this.ws) return;
    try {
      // `ws` supports callback-style send; native WS may throw.
      const payload = JSON.stringify(obj);
      this.ws.send(payload, () => void 0);
    } catch {
      // ignore
    }
  }

  private sendConnect() {
    const id = this.nextId++;
    this.send({ id, connect: { token: this.opts.token } });
  }

  private sendSubscribe(channel: string, token?: string | null) {
    const id = this.nextId++;
    const sub: any = { channel };
    if (token) sub.token = token;
    this.send({ id, subscribe: sub });
  }

  private handleFrame(text: string) {
    let msg: any = null;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    // Centrifugo can send either an object or an array of objects.
    const arr = Array.isArray(msg) ? msg : [msg];
    for (const m of arr) {
      if (!m || typeof m !== 'object') continue;

      // Server ping -> client pong
      if (m.ping) {
        this.send({ pong: {} });
        continue;
      }

      // Connect result: after connect, subscribe to requested channels.
      if (m.id && m.connect) {
        this.connected = true;
        const ctx = this.opts.logContext || {};
        logger.info('vkvideo_pubsub.connected', { ...ctx });
        for (const s of this.opts.subscriptions) {
          const ch = String(s?.channel || '').trim();
          if (!ch) continue;
          this.sendSubscribe(ch, s?.token ?? null);
        }
        continue;
      }

      // Publications
      const push = m.push;
      const pubData = push?.pub?.data;
      const channel = String(push?.channel || '').trim();
      if (channel && pubData !== undefined) {
        this.opts.onPush({ channel, data: pubData });
      }
    }
  }
}


