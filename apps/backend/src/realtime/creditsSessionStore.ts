import { randomUUID } from 'crypto';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';

export type CreditsState = {
  chatters: Array<{ name: string; avatarUrl?: string | null }>;
  donors: Array<{ name: string; amount: number; currency: string; avatarUrl?: string | null }>;
};

type SessionMeta = {
  sessionId: string;
  status: 'online' | 'offline';
  startedAt: number;
  lastSeenAt: number;
  offlineAt: number | null;
  expiresAt: number | null;
};

type Chatter = { name: string; avatarUrl?: string | null; ts: number };
type Donor = { name: string; amount: number; currency: string; avatarUrl?: string | null; ts: number };

function clampInt(n: number, min: number, max: number): number {
  const x = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, x));
}

function normalizeSlug(slug: string): string {
  return String(slug || '').trim().toLowerCase();
}

function normalizeName(name: string): string {
  return String(name || '').trim();
}

function normalizeAvatarUrl(url: unknown): string | null {
  const s = String(url ?? '').trim();
  if (!s) return null;
  // Minimal safety: allow only http(s) to avoid javascript: etc.
  if (!/^https?:\/\//i.test(s)) return null;
  // Cap length to avoid abuse; overlay only needs a small URL.
  if (s.length > 500) return null;
  return s;
}

function donorKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

function kMeta(slug: string) {
  return nsKey('credits', `session:${slug}:meta`);
}
function kChatters(slug: string) {
  return nsKey('credits', `session:${slug}:chatters`); // hash userId -> displayName
}
function kChattersOrder(slug: string) {
  return nsKey('credits', `session:${slug}:chatters:order`); // zset userId -> firstSeenTs
}
function kDonors(slug: string) {
  return nsKey('credits', `session:${slug}:donors`); // hash donorKey -> json
}
function kDonorsOrder(slug: string) {
  return nsKey('credits', `session:${slug}:donors:order`); // zset donorKey -> ts
}

function onlineTtlSeconds(reconnectWindowMinutes: number): number {
  // Long TTL while online (kept alive by refreshes); avoid infinite growth.
  const minutes = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  return Math.max(6 * 60 * 60, minutes * 60 + 2 * 60 * 60); // at least 6h
}

function offlineTtlSeconds(reconnectWindowMinutes: number): number {
  const minutes = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  // Small buffer so we don't race with clients/bot.
  return minutes * 60 + 5 * 60;
}

async function touchTtl(slug: string, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  const ttl = clampInt(ttlSeconds, 60, 7 * 24 * 60 * 60);
  await Promise.allSettled([
    client.expire(kMeta(slug), ttl),
    client.expire(kChatters(slug), ttl),
    client.expire(kChattersOrder(slug), ttl),
    client.expire(kDonors(slug), ttl),
    client.expire(kDonorsOrder(slug), ttl),
  ]);
}

async function readMeta(slug: string): Promise<SessionMeta | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const raw = await client.hGetAll(kMeta(slug));
  if (!raw || !raw.sessionId) return null;
  const startedAt = Number(raw.startedAt);
  const lastSeenAt = Number(raw.lastSeenAt);
  const offlineAt = raw.offlineAt ? Number(raw.offlineAt) : null;
  const expiresAt = raw.expiresAt ? Number(raw.expiresAt) : null;
  const status = raw.status === 'offline' ? 'offline' : 'online';
  return {
    sessionId: String(raw.sessionId),
    status,
    startedAt: Number.isFinite(startedAt) ? startedAt : Date.now(),
    lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : Date.now(),
    offlineAt: Number.isFinite(offlineAt as any) ? (offlineAt as any) : null,
    expiresAt: Number.isFinite(expiresAt as any) ? (expiresAt as any) : null,
  };
}

async function writeMeta(slug: string, meta: SessionMeta, ttlSeconds: number): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.hSet(kMeta(slug), {
    sessionId: meta.sessionId,
    status: meta.status,
    startedAt: String(meta.startedAt),
    lastSeenAt: String(meta.lastSeenAt),
    offlineAt: meta.offlineAt === null ? '' : String(meta.offlineAt),
    expiresAt: meta.expiresAt === null ? '' : String(meta.expiresAt),
  });
  await touchTtl(slug, ttlSeconds);
}

async function clearSession(slug: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.del([kChatters(slug), kChattersOrder(slug), kDonors(slug), kDonorsOrder(slug)]);
}

export async function startOrResumeCreditsSession(
  channelSlug: string,
  reconnectWindowMinutes: number
): Promise<{ sessionId: string; resumed: boolean }> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return { sessionId: '', resumed: false };

  const now = Date.now();
  const windowMin = clampInt(reconnectWindowMinutes, 1, 24 * 60);

  const meta = await readMeta(slug);
  if (meta && meta.status === 'offline' && meta.offlineAt && now - meta.offlineAt <= windowMin * 60_000) {
    // Resume previous session.
    const resumedMeta: SessionMeta = {
      ...meta,
      status: 'online',
      lastSeenAt: now,
      offlineAt: null,
      expiresAt: null,
    };
    await writeMeta(slug, resumedMeta, onlineTtlSeconds(windowMin));
    return { sessionId: resumedMeta.sessionId, resumed: true };
  }

  // Start new session (reset).
  const sessionId = randomUUID();
  await clearSession(slug);
  await writeMeta(
    slug,
    {
      sessionId,
      status: 'online',
      startedAt: now,
      lastSeenAt: now,
      offlineAt: null,
      expiresAt: null,
    },
    onlineTtlSeconds(windowMin)
  );
  return { sessionId, resumed: false };
}

export async function markCreditsSessionOffline(channelSlug: string, reconnectWindowMinutes: number): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const now = Date.now();
  const windowMin = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  const meta = (await readMeta(slug)) ?? {
    sessionId: randomUUID(),
    status: 'offline' as const,
    startedAt: now,
    lastSeenAt: now,
    offlineAt: now,
    expiresAt: now + windowMin * 60_000,
  };

  const updated: SessionMeta = {
    ...meta,
    status: 'offline',
    lastSeenAt: now,
    offlineAt: meta.offlineAt ?? now,
    expiresAt: now + windowMin * 60_000,
  };
  await writeMeta(slug, updated, offlineTtlSeconds(windowMin));
}

export async function resetCreditsSession(channelSlug: string, reconnectWindowMinutes: number): Promise<{ sessionId: string }> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return { sessionId: '' };

  const now = Date.now();
  const windowMin = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  const sessionId = randomUUID();
  await clearSession(slug);
  await writeMeta(
    slug,
    {
      sessionId,
      status: 'online',
      startedAt: now,
      lastSeenAt: now,
      offlineAt: null,
      expiresAt: null,
    },
    onlineTtlSeconds(windowMin)
  );
  return { sessionId };
}

export async function addCreditsChatter(
  channelSlug: string,
  userId: string,
  displayName: string,
  avatarUrl: string | null | undefined,
  reconnectWindowMinutes: number
): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  const uid = String(userId || '').trim();
  if (!uid) return;
  const name = normalizeName(displayName);
  if (!name) return;

  const client = await getRedisClient();
  if (!client) return;

  const now = Date.now();
  const windowMin = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  const avatar = normalizeAvatarUrl(avatarUrl);

  // Ensure session exists (do not reset here).
  const meta = (await readMeta(slug)) ?? {
    sessionId: randomUUID(),
    status: 'online' as const,
    startedAt: now,
    lastSeenAt: now,
    offlineAt: null,
    expiresAt: null,
  };
  meta.lastSeenAt = now;
  meta.status = 'online';
  meta.offlineAt = null;
  meta.expiresAt = null;

  const chatter: Chatter = { name, avatarUrl: avatar, ts: now };
  await client.hSet(kChatters(slug), uid, JSON.stringify(chatter));
  // firstSeen only if not exists
  await client.zAdd(kChattersOrder(slug), [{ score: now, value: uid }], { NX: true });
  await writeMeta(slug, meta, onlineTtlSeconds(windowMin));
}

export async function addCreditsDonor(
  channelSlug: string,
  name: string,
  amount: number,
  currency: string,
  avatarUrl: string | null | undefined,
  reconnectWindowMinutes: number
): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  const donorName = normalizeName(name);
  if (!donorName) return;
  if (!Number.isFinite(amount)) return;
  const cur = String(currency || '').trim().toUpperCase() || 'RUB';

  const client = await getRedisClient();
  if (!client) return;

  const now = Date.now();
  const windowMin = clampInt(reconnectWindowMinutes, 1, 24 * 60);
  const key = donorKey(donorName);
  const avatar = normalizeAvatarUrl(avatarUrl);

  const meta = (await readMeta(slug)) ?? {
    sessionId: randomUUID(),
    status: 'online' as const,
    startedAt: now,
    lastSeenAt: now,
    offlineAt: null,
    expiresAt: null,
  };
  meta.lastSeenAt = now;
  meta.status = 'online';
  meta.offlineAt = null;
  meta.expiresAt = null;

  const donor: Donor = { name: donorName, amount: Math.max(0, Number(amount)), currency: cur, avatarUrl: avatar, ts: now };
  await client.hSet(kDonors(slug), key, JSON.stringify(donor));
  await client.zAdd(kDonorsOrder(slug), [{ score: now, value: key }], { NX: true });
  await writeMeta(slug, meta, onlineTtlSeconds(windowMin));
}

export async function getCreditsStateFromStore(channelSlug: string): Promise<CreditsState> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return { chatters: [], donors: [] };

  const client = await getRedisClient();
  if (!client) return { chatters: [], donors: [] };

  // Read ordered ids/keys; cap to avoid huge payloads.
  const [chatterIds, donorKeys] = await Promise.all([
    client.zRange(kChattersOrder(slug), 0, 499),
    client.zRange(kDonorsOrder(slug), 0, 199),
  ]);

  const chatters: Array<{ name: string; avatarUrl?: string | null }> = [];
  if (chatterIds.length) {
    const names = await client.hmGet(kChatters(slug), chatterIds);
    for (const n of names) {
      const raw = String(n || '').trim();
      if (!raw) continue;
      // Back-compat: previously stored plain displayName; now stored JSON {name, avatarUrl, ts}.
      if (raw.startsWith('{')) {
        try {
          const c = JSON.parse(raw) as Partial<Chatter>;
          const name = normalizeName((c as any)?.name || '');
          if (!name) continue;
          const avatarUrl = normalizeAvatarUrl((c as any)?.avatarUrl);
          chatters.push({ name, avatarUrl });
          continue;
        } catch {
          // fall through
        }
      }
      const name = normalizeName(raw);
      if (name) chatters.push({ name, avatarUrl: null });
    }
  }

  const donors: Array<{ name: string; amount: number; currency: string; avatarUrl?: string | null }> = [];
  if (donorKeys.length) {
    const raw = await client.hmGet(kDonors(slug), donorKeys);
    for (const s of raw) {
      if (!s) continue;
      try {
        const d = JSON.parse(s) as Donor;
        if (!d?.name) continue;
        donors.push({
          name: String(d.name),
          amount: Number(d.amount) || 0,
          currency: String(d.currency || 'RUB'),
          avatarUrl: normalizeAvatarUrl((d as any)?.avatarUrl),
        });
      } catch {
        // ignore
      }
    }
  }

  return { chatters, donors };
}


