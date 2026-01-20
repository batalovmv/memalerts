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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function isLocalRequest(req: Request): boolean {
  return isLocalhostAddress(req.socket.remoteAddress);
}

function isInternal(req: Request): boolean {
  const headers = asRecord(req.headers);
  const v = headers[INTERNAL_HEADER] || headers[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}

function toSlug(v: unknown): string {
  return String(v || '')
    .trim()
    .toLowerCase();
}

async function getChannelContextBySlug(
  slug: string
): Promise<{ channelId: string | null; reconnectWindowMinutes: number }> {
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
  const channelId = String(channel?.id || '').trim() || null;
  const windowMin = Number.isFinite(channel?.creditsReconnectWindowMinutes)
    ? Number(channel?.creditsReconnectWindowMinutes)
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

export async function ingestCreditsChatter(params: {
  io?: Server;
  channelSlug: string;
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
}): Promise<{ ok: true; ignored?: true }> {
  const slug = toSlug(params.channelSlug);
  const userId = String(params.userId || '').trim();
  const displayName = String(params.displayName || '').trim();
  const avatarUrl = params.avatarUrl ?? null;
  if (!slug || !userId || !displayName) return { ok: true, ignored: true };

  const { channelId, reconnectWindowMinutes } = await getChannelContextBySlug(slug);
  if (channelId) {
    const ignore = await shouldIgnoreCreditsChatter({ channelId, creditsUserId: userId, displayName });
    if (ignore) return { ok: true, ignored: true };
  }

  await addCreditsChatter(slug, userId, displayName, avatarUrl, reconnectWindowMinutes);
  scheduleEmitCreditsState(params.io, slug);
  return { ok: true };
}

export const creditsInternalController = {
  chatter: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const bodyRec = asRecord(req.body);
    const slug = toSlug(bodyRec.channelSlug);
    const userId = String(bodyRec.userId || '').trim();
    const displayName = String(bodyRec.displayName || '').trim();
    const avatarUrl = typeof bodyRec.avatarUrl === 'string' ? bodyRec.avatarUrl : null;
    if (!slug || !userId || !displayName) return res.status(400).json({ error: 'Bad Request' });

    // Best-effort: push fresh state to connected overlays immediately.
    let io: Server | undefined = undefined;
    try {
      const appRec = asRecord(req.app);
      const getFn = appRec.get;
      io = typeof getFn === 'function' ? (getFn as (key: string) => Server | undefined)('io') : undefined;
    } catch {
      // ignore
    }
    const r = await ingestCreditsChatter({ io, channelSlug: slug, userId, displayName, avatarUrl });
    return res.json(r);
  },

  donor: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const bodyRec = asRecord(req.body);
    const slug = toSlug(bodyRec.channelSlug);
    const name = String(bodyRec.name || '').trim();
    const amount = Number(bodyRec.amount);
    const currency = String(bodyRec.currency || 'RUB').trim();
    const avatarUrl = typeof bodyRec.avatarUrl === 'string' ? bodyRec.avatarUrl : null;
    if (!slug || !name || !Number.isFinite(amount)) return res.status(400).json({ error: 'Bad Request' });

    const { reconnectWindowMinutes } = await getChannelContextBySlug(slug);

    await addCreditsDonor(slug, name, amount, currency, avatarUrl, reconnectWindowMinutes);

    // Best-effort: push fresh state to connected overlays immediately.
    try {
      const appRec = asRecord(req.app);
      const getFn = appRec.get;
      const io: Server | undefined =
        typeof getFn === 'function' ? (getFn as (key: string) => Server | undefined)('io') : undefined;
      if (io) {
        scheduleEmitCreditsState(io, slug);
      }
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  },
};
