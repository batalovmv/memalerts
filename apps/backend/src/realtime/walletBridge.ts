import { Server } from 'socket.io';

export type WalletUpdatedEvent = {
  userId: string;
  channelId: string;
  balance: number;
  delta?: number;
  reason?: string;
  channelSlug?: string;
  source?: 'local' | 'relay';
};

const INTERNAL_HEADER = 'x-memalerts-internal';
const INTERNAL_HEADER_VALUE = 'wallet-updated';

function getPeerBaseUrl(): string | null {
  const port = String(process.env.PORT || '3001');
  // Two-instance setup on same VPS: 3001 (prod), 3002 (beta)
  if (port === '3001') return 'http://127.0.0.1:3002';
  if (port === '3002') return 'http://127.0.0.1:3001';
  return null;
}

export function emitWalletUpdated(io: Server, data: WalletUpdatedEvent): void {
  io.to(`user:${data.userId}`).emit('wallet:updated', data);
  if (data.channelSlug) {
    io.to(`channel:${String(data.channelSlug).toLowerCase()}`).emit('wallet:updated', data);
  }
}

export async function relayWalletUpdatedToPeer(data: WalletUpdatedEvent): Promise<void> {
  const peer = getPeerBaseUrl();
  if (!peer) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1500);

  try {
    await fetch(`${peer}/internal/wallet-updated`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        [INTERNAL_HEADER]: INTERNAL_HEADER_VALUE,
      },
      body: JSON.stringify({ ...data, source: 'relay' }),
      signal: controller.signal,
    });
  } catch (err) {
    // Non-fatal: local emit already happened.
    console.warn('[walletBridge] relay to peer failed (continuing):', (err as any)?.message || err);
  } finally {
    clearTimeout(timeout);
  }
}

export function isInternalWalletRelayRequest(headers: Record<string, any>): boolean {
  const v = headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}


