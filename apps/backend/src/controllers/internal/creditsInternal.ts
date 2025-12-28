import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { addCreditsChatter, addCreditsDonor } from '../../realtime/creditsSessionStore.js';
import type { Server } from 'socket.io';
import { emitCreditsState } from '../../realtime/creditsState.js';
import { shouldIgnoreCreditsChatter } from '../../utils/creditsIgnore.js';
import { isLocalhostAddress } from '../../utils/isLocalhostAddress.js';

// Reuse the same internal header name pattern as other relays.
const INTERNAL_HEADER = 'x-memalerts-internal';
const INTERNAL_HEADER_VALUE = 'credits-event';

// Hot-path optimizations:
// - cache slug -> {channelId, reconnectWindowMinutes} to avoid DB hit per chatter
// - throttle credits:state push to avoid emitting on every chat message during bursts
type ChannelLookupCacheEntry = { channelId: string | null; reconnectWindowMinutes: number; ts: number };
const channelLookupBySlug = new Map<string, ChannelLookupCacheEntry>();
const CHANNEL_LOOKUP_TTL_MS = 60_000;

type EmitThrottleState = { lastEmitAt: number; timer: NodeJS.Timeout | null };
const emitStateBySlug = new Map<string, EmitThrottleState>();
const EMIT_MIN_INTERVAL_MS = 1_000;

function isLocalRequest(req: Request): boolean {
  return isLocalhostAddress(req.socket.remoteAddress);
}

function isInternal(req: Request): boolean {
  const v = (req.headers as any)[INTERNAL_HEADER] || (req.headers as any)[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}

function toSlug(v: any): string {
  return String(v || '').trim().toLowerCase();
}

async function getChannelContextBySlug(slug: string): Promise<{ channelId: string | null; reconnectWindowMinutes: number }> {
  const s = toSlug(slug);
  if (!s) return { channelId: null, reconnectWindowMinutes: 60 };

  const now = Date.now();
  const cached = channelLookupBySlug.get(s);
  if (cached && now - cached.ts < CHANNEL_LOOKUP_TTL_MS) {
    return { channelId: cached.channelId, reconnectWindowMinutes: cached.reconnectWindowMinutes };
  }

  const channel = await prisma.channel.findUnique({
    where: { slug: s },
    select: { id: true, creditsReconnectWindowMinutes: true },
  });
  const channelId = String((channel as any)?.id || '').trim() || null;
  const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
    ? Number((channel as any).creditsReconnectWindowMinutes)
    : 60;
  const reconnectWindowMinutes = Math.max(1, Math.min(24 * 60, Math.floor(windowMin)));

  channelLookupBySlug.set(s, { channelId, reconnectWindowMinutes, ts: now });
  return { channelId, reconnectWindowMinutes };
}

function scheduleEmitCreditsState(io: Server | undefined, slug: string): void {
  if (!io) return;
  const s = toSlug(slug);
  if (!s) return;

  const now = Date.now();
  const st = emitStateBySlug.get(s) || { lastEmitAt: 0, timer: null };

  // If we can emit immediately (and no pending timer), do it.
  if (!st.timer && now - st.lastEmitAt >= EMIT_MIN_INTERVAL_MS) {
    st.lastEmitAt = now;
    emitStateBySlug.set(s, st);
    void emitCreditsState(io, s);
    return;
  }

  // Otherwise, coalesce multiple events into a single delayed emit.
  if (st.timer) {
    emitStateBySlug.set(s, st);
    return;
  }
  const delay = Math.max(0, EMIT_MIN_INTERVAL_MS - (now - st.lastEmitAt));
  st.timer = setTimeout(() => {
    const cur = emitStateBySlug.get(s) || null;
    if (cur) cur.timer = null;
    if (cur) cur.lastEmitAt = Date.now();
    if (cur) emitStateBySlug.set(s, cur);
    void emitCreditsState(io, s);
  }, delay);
  emitStateBySlug.set(s, st);
}

export const creditsInternalController = {
  chatter: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const slug = toSlug((req.body as any)?.channelSlug);
    const userId = String((req.body as any)?.userId || '').trim();
    const displayName = String((req.body as any)?.displayName || '').trim();
    const avatarUrl = (req.body as any)?.avatarUrl ?? null;
    if (!slug || !userId || !displayName) return res.status(400).json({ error: 'Bad Request' });

    const { channelId, reconnectWindowMinutes } = await getChannelContextBySlug(slug);

    if (channelId) {
      const ignore = await shouldIgnoreCreditsChatter({ channelId, creditsUserId: userId, displayName });
      if (ignore) return res.json({ ok: true, ignored: true });
    }

    await addCreditsChatter(slug, userId, displayName, avatarUrl, reconnectWindowMinutes);

    // Best-effort: push fresh state to connected overlays immediately.
    try {
      const io: Server | undefined = (req.app as any)?.get?.('io');
      if (io) {
        scheduleEmitCreditsState(io, slug);
      }
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  },

  donor: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const slug = toSlug((req.body as any)?.channelSlug);
    const name = String((req.body as any)?.name || '').trim();
    const amount = Number((req.body as any)?.amount);
    const currency = String((req.body as any)?.currency || 'RUB').trim();
    const avatarUrl = (req.body as any)?.avatarUrl ?? null;
    if (!slug || !name || !Number.isFinite(amount)) return res.status(400).json({ error: 'Bad Request' });

    const { reconnectWindowMinutes } = await getChannelContextBySlug(slug);

    await addCreditsDonor(slug, name, amount, currency, avatarUrl, reconnectWindowMinutes);

    // Best-effort: push fresh state to connected overlays immediately.
    try {
      const io: Server | undefined = (req.app as any)?.get?.('io');
      if (io) {
        scheduleEmitCreditsState(io, slug);
      }
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  },
};


