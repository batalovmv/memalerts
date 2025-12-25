import { logger } from '../utils/logger.js';
import WebSocketImpl from 'ws';

export type VkVideoIncomingMessage = {
  vkvideoChannelId: string;
  text: string;
  userId: string;
  displayName: string;
  senderLogin?: string | null;
};

function normalizeId(v: any): string {
  return String(v ?? '').trim();
}

function normalizeText(v: any): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeLogin(v: any): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

function ensureWebSocketCtor(): any {
  // Prefer built-in WebSocket (Node 20+). Fall back to `ws` for Node 18/older runtimes.
  const WS: any = (globalThis as any).WebSocket;
  return WS || (WebSocketImpl as any);
}

export class VkVideoChatBot {
  private wsByChannelId = new Map<string, any>();
  private stopped = false;

  constructor(
    private cfg: {
      wsUrlTemplate: string; // must include "{channelId}"
      authHeaderName?: string | null;
      authHeaderValue?: string | null;
      sendMessageFormat?: 'plain' | 'json';
    },
    private onMessage: (msg: VkVideoIncomingMessage) => void,
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
    const ws =
      WS === (WebSocketImpl as any)
        ? new WS(url, Object.keys(headers).length ? { headers } : undefined)
        : new WS(url, [], Object.keys(headers).length ? { headers } : undefined);
    this.wsByChannelId.set(vkvideoChannelId, ws);

    ws.addEventListener('open', () => {
      logger.info('vkvideo_chatbot.ws_open', { vkvideoChannelId });
    });
    ws.addEventListener('close', (ev: any) => {
      logger.warn('vkvideo_chatbot.ws_close', { vkvideoChannelId, code: ev?.code, reason: String(ev?.reason || '') });
      this.wsByChannelId.delete(vkvideoChannelId);
    });
    ws.addEventListener('error', (ev: any) => {
      logger.warn('vkvideo_chatbot.ws_error', { vkvideoChannelId, error: String(ev?.message || ev?.error || '') });
    });
    ws.addEventListener('message', (ev: any) => {
      const raw = ev?.data;
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

    const payload =
      this.cfg.sendMessageFormat === 'json'
        ? JSON.stringify({ type: 'message', text: msg })
        : msg;

    ws.send(payload);
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

    let obj: any = null;
    if (asText.startsWith('{') || asText.startsWith('[')) {
      try {
        obj = JSON.parse(asText);
      } catch {
        obj = null;
      }
    }

    // Heuristic extraction
    const payload = obj ?? { text: asText };
    const text = normalizeText(payload?.text ?? payload?.message ?? payload?.data?.text ?? payload?.data?.message);
    if (!text) return;

    const userId = normalizeId(payload?.user?.id ?? payload?.user_id ?? payload?.from_id ?? payload?.author?.id);
    const displayName = normalizeId(payload?.user?.name ?? payload?.user?.displayName ?? payload?.author?.name ?? payload?.from_name);
    const senderLogin = normalizeLogin(payload?.user?.login ?? payload?.user?.username ?? payload?.author?.login ?? payload?.author?.username);

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


