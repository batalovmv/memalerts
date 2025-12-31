import { randomUUID } from 'crypto';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';

type StreamDurationMeta = {
  sessionId: string;
  status: 'online' | 'offline';
  // When the current session started (informational; duration is computed from accumMs + lastOnlineAt).
  sessionStartedAt: number;
  // Total accumulated online time in milliseconds for the current session, excluding the current online segment.
  accumMs: number;
  // When we last went online (start of current online segment). Only meaningful when status === 'online'.
  lastOnlineAt: number | null;
  // When we last went offline. Only meaningful when status === 'offline'.
  offlineAt: number | null;
  // Updated on any event.
  updatedAt: number;
};

function normalizeSlug(slug: string): string {
  return String(slug || '').trim().toLowerCase();
}

function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}

function kMeta(slug: string) {
  return nsKey('streamDuration', `session:${slug}:meta`);
}

function ttlSeconds(): number {
  // Keep recent session state for a while (covers typical stream lengths + pauses).
  return 48 * 60 * 60; // 48h
}

async function readMeta(slug: string): Promise<StreamDurationMeta | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const raw = await client.hGetAll(kMeta(slug));
  if (!raw || !raw.sessionId) return null;

  const sessionStartedAt = Number(raw.sessionStartedAt);
  const accumMs = Number(raw.accumMs);
  const lastOnlineAt = raw.lastOnlineAt ? Number(raw.lastOnlineAt) : null;
  const offlineAt = raw.offlineAt ? Number(raw.offlineAt) : null;
  const updatedAt = Number(raw.updatedAt);
  const status = raw.status === 'offline' ? 'offline' : 'online';

  return {
    sessionId: String(raw.sessionId),
    status,
    sessionStartedAt: Number.isFinite(sessionStartedAt) ? sessionStartedAt : Date.now(),
    accumMs: Number.isFinite(accumMs) ? Math.max(0, Math.floor(accumMs)) : 0,
    lastOnlineAt: Number.isFinite(lastOnlineAt as any) ? (lastOnlineAt as any) : null,
    offlineAt: Number.isFinite(offlineAt as any) ? (offlineAt as any) : null,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

async function writeMeta(slug: string, meta: StreamDurationMeta): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.hSet(kMeta(slug), {
    sessionId: meta.sessionId,
    status: meta.status,
    sessionStartedAt: String(meta.sessionStartedAt),
    accumMs: String(meta.accumMs),
    lastOnlineAt: meta.lastOnlineAt === null ? '' : String(meta.lastOnlineAt),
    offlineAt: meta.offlineAt === null ? '' : String(meta.offlineAt),
    updatedAt: String(meta.updatedAt),
  });
  await client.expire(kMeta(slug), ttlSeconds());
}

function newSession(now: number): StreamDurationMeta {
  return {
    sessionId: randomUUID(),
    status: 'online',
    sessionStartedAt: now,
    accumMs: 0,
    lastOnlineAt: now,
    offlineAt: null,
    updatedAt: now,
  };
}

export async function handleStreamOnline(channelSlug: string, breakCreditMinutes: number): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const now = Date.now();
  const creditMin = clampInt(breakCreditMinutes, 0, 24 * 60);

  const meta = await readMeta(slug);
  if (!meta) {
    await writeMeta(slug, newSession(now));
    return;
  }

  // Already online: just touch timestamp.
  if (meta.status === 'online') {
    const updated: StreamDurationMeta = { ...meta, updatedAt: now, lastOnlineAt: meta.lastOnlineAt ?? now, offlineAt: null };
    await writeMeta(slug, updated);
    return;
  }

  // Resume vs reset based on offline gap.
  const offlineAt = meta.offlineAt ?? now;
  const gapMs = Math.max(0, now - offlineAt);
  if (gapMs <= creditMin * 60_000) {
    const resumed: StreamDurationMeta = {
      ...meta,
      status: 'online',
      lastOnlineAt: now,
      offlineAt: null,
      updatedAt: now,
    };
    await writeMeta(slug, resumed);
    return;
  }

  // New session.
  await writeMeta(slug, newSession(now));
}

export async function handleStreamOffline(channelSlug: string): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const now = Date.now();
  const meta = await readMeta(slug);
  if (!meta) {
    // Create offline meta so command can still report 0 and "offline" state.
    const offline: StreamDurationMeta = {
      sessionId: randomUUID(),
      status: 'offline',
      sessionStartedAt: now,
      accumMs: 0,
      lastOnlineAt: null,
      offlineAt: now,
      updatedAt: now,
    };
    await writeMeta(slug, offline);
    return;
  }

  // If we were online, close current online segment into accumMs.
  let accumMs = meta.accumMs;
  if (meta.status === 'online' && meta.lastOnlineAt) {
    accumMs = Math.max(0, accumMs + Math.max(0, now - meta.lastOnlineAt));
  }

  const updated: StreamDurationMeta = {
    ...meta,
    status: 'offline',
    accumMs,
    lastOnlineAt: null,
    offlineAt: meta.offlineAt ?? now,
    updatedAt: now,
  };
  await writeMeta(slug, updated);
}

export async function getStreamDurationSnapshot(channelSlug: string): Promise<{ status: 'online' | 'offline'; totalMinutes: number }> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return { status: 'offline', totalMinutes: 0 };

  const now = Date.now();
  const meta = await readMeta(slug);
  if (!meta) return { status: 'offline', totalMinutes: 0 };

  let totalMs = meta.accumMs;
  if (meta.status === 'online' && meta.lastOnlineAt) {
    totalMs += Math.max(0, now - meta.lastOnlineAt);
  }

  const totalMinutes = Math.floor(Math.max(0, totalMs) / 60_000);
  return { status: meta.status, totalMinutes };
}






