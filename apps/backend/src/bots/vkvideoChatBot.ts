import { logger } from '../utils/logger.js';
import WebSocketImpl from 'ws';

export type VkVideoIncomingMessage = {
  vkvideoChannelId: string;
  text: string;
  userId: string;
  displayName: string;
  senderLogin?: string | null;
};

type WebSocketLike = {
  addEventListener: (event: string, handler: (ev: unknown) => void) => void;
  send: (data: string, cb?: (err?: unknown) => void) => unknown;
  close?: () => void;
};

type WebSocketCtor = new (
  url: string,
  protocolsOrOptions?: string[] | string | { headers?: Record<string, string> },
  options?: { headers?: Record<string, string> }
) => WebSocketLike;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function normalizeId(v: unknown): string {
  return String(v ?? '').trim();
}

function normalizeText(v: unknown): string {
  return String(v ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

function normalizeLogin(v: unknown): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function ensureWebSocketCtor(): WebSocketCtor {
  // Prefer built-in WebSocket (Node 20+). Fall back to `ws` for Node 18/older runtimes.
  const globalWs = (globalThis as { WebSocket?: WebSocketCtor }).WebSocket;
  return globalWs || (WebSocketImpl as unknown as WebSocketCtor);
}

export class VkVideoChatBot {
  private wsByChannelId = new Map<string, WebSocketLike>();
  private stopped = false;

  constructor(
    private cfg: {
      wsUrlTemplate: string; // must include "{channelId}"
      authHeaderName?: string | null;
      authHeaderValue?: string | null;
      sendMessageFormat?: 'plain' | 'json';
    },
    private onMessage: (msg: VkVideoIncomingMessage) => void
  ) {}

  isJoined(vkvideoChannelId: string): boolean {
    return this.wsByChannelId.has(vkvideoChannelId);
  }

  async join(vkvideoChannelId: string): Promise<void> {
    if (this.stopped) return;
    if (this.wsByChannelId.has(vkvideoChannelId)) return;

    const WS = ensureWebSocketCtor();
    const url = this.cfg.wsUrlTemplate.replace(/\{channelId\}/g, encodeURIComponent(vkvideoChannelId));
    const headers: Record<string, string> = {};
    if (this.cfg.authHeaderName && this.cfg.authHeaderValue) {
      headers[this.cfg.authHeaderName] = this.cfg.authHeaderValue;
    }

    // Note: constructor signatures differ between native WebSocket and `ws`.
    // Native WebSocket supports (url, protocols, options), while `ws` supports (url, options).
    const usingWsImpl = WS === (WebSocketImpl as unknown as WebSocketCtor);
    const ws = usingWsImpl
      ? new WS(url, Object.keys(headers).length ? { headers } : undefined)
      : new WS(url, [], Object.keys(headers).length ? { headers } : undefined);
    this.wsByChannelId.set(vkvideoChannelId, ws);

    ws.addEventListener('open', () => {
      logger.info('vkvideo_chatbot.ws_open', { vkvideoChannelId });
    });
    ws.addEventListener('close', (ev: unknown) => {
      const rec = asRecord(ev);
      logger.warn('vkvideo_chatbot.ws_close', {
        vkvideoChannelId,
        code: rec.code,
        reason: String(rec.reason ?? ''),
      });
      this.wsByChannelId.delete(vkvideoChannelId);
    });
    ws.addEventListener('error', (ev: unknown) => {
      const rec = asRecord(ev);
      logger.warn('vkvideo_chatbot.ws_error', {
        vkvideoChannelId,
        error: String(rec.message ?? rec.error ?? ''),
      });
    });
    ws.addEventListener('message', (ev: unknown) => {
      const raw = asRecord(ev).data;
      const text = typeof raw === 'string' ? raw : raw?.toString?.() || '';
      this.handleRawMessage(vkvideoChannelId, text);
    });
  }

  async part(vkvideoChannelId: string): Promise<void> {
    const ws = this.wsByChannelId.get(vkvideoChannelId);
    if (!ws) return;
    try {
      ws.close?.();
    } catch {
      // ignore
    } finally {
      this.wsByChannelId.delete(vkvideoChannelId);
    }
  }

  async say(vkvideoChannelId: string, message: string): Promise<void> {
    const ws = this.wsByChannelId.get(vkvideoChannelId);
    if (!ws) throw new Error('not_connected');

    const msg = normalizeText(message);
    if (!msg) return;

    const payload = this.cfg.sendMessageFormat === 'json' ? JSON.stringify({ type: 'message', text: msg }) : msg;

    try {
      // `ws` supports callback-style send: ws.send(data, cb).
      // Native WebSocket may throw synchronously on send.
      await new Promise<void>((resolve, reject) => {
        const ret = ws.send(payload, (err?: unknown) => {
          if (err) reject(err);
          else resolve();
        });
        // If ws.send doesn't accept callback, it'll likely ignore it and return void.
        // In that case, resolve immediately.
        if (ret === undefined) resolve();
      });
    } catch (e: unknown) {
      const errorMessage = getErrorMessage(e);
      logger.warn('vkvideo_chatbot.ws_send_failed', { vkvideoChannelId, errorMessage });
      throw new Error(`ws_send_failed:${errorMessage}`);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    const ids = Array.from(this.wsByChannelId.keys());
    await Promise.all(ids.map((id) => this.part(id)));
  }

  private handleRawMessage(vkvideoChannelId: string, raw: string) {
    // Best-effort parsing. VKVideo chat protocol is configured externally via WS URL.
    // We support either plain text payloads or JSON payloads.
    const asText = normalizeText(raw);
    if (!asText) return;

    let obj: unknown = null;
    if (asText.startsWith('{') || asText.startsWith('[')) {
      try {
        obj = JSON.parse(asText);
      } catch {
        obj = null;
      }
    }

    // Heuristic extraction
    const payload = obj ?? { text: asText };
    const payloadRec = asRecord(payload);
    const payloadData = asRecord(payloadRec.data);
    const text = normalizeText(payloadRec.text ?? payloadRec.message ?? payloadData.text ?? payloadData.message);
    if (!text) return;

    const payloadUser = asRecord(payloadRec.user);
    const payloadAuthor = asRecord(payloadRec.author);
    const userId = normalizeId(payloadUser.id ?? payloadRec.user_id ?? payloadRec.from_id ?? payloadAuthor.id);
    const displayName = normalizeId(
      payloadUser.name ?? payloadUser.displayName ?? payloadAuthor.name ?? payloadRec.from_name
    );
    const senderLogin = normalizeLogin(
      payloadUser.login ?? payloadUser.username ?? payloadAuthor.login ?? payloadAuthor.username
    );

    if (!userId || !displayName) return;

    this.onMessage({
      vkvideoChannelId,
      text,
      userId,
      displayName,
      senderLogin: senderLogin || null,
    });
  }
}
