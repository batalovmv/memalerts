import { logger } from './logger.js';
import { isTransientHttpError } from './httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from './httpTimeouts.js';
import { getServiceRetryConfig, withRetry } from './retry.js';

export type DiscordGuildMember = {
  userId: string;
  roles: string[];
  raw: unknown;
};

type CachedMember = {
  ts: number;
  roles: string[];
};

const memberCache = new Map<string, CachedMember>();

function cacheKey(guildId: string, userId: string): string {
  return `${guildId}:${userId}`;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

async function fetchJsonSafe(
  url: string,
  init: RequestInit
): Promise<{ status: number; json: unknown; text: string | null }> {
  const timeoutMs = getServiceHttpTimeoutMs('DISCORD', 10_000, 1_000, 30_000);
  const resp = await fetchWithTimeout({
    url,
    service: 'discord',
    timeoutMs,
    timeoutReason: 'discord_timeout',
    init,
  });
  let json: unknown = null;
  let text: string | null = null;
  try {
    json = await resp.json();
  } catch {
    try {
      text = await resp.text();
    } catch {
      text = null;
    }
  }
  return { status: resp.status, json, text };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchDiscordGuildMember(params: {
  botToken: string;
  guildId: string;
  userId: string;
}): Promise<{ status: number; member: DiscordGuildMember | null; raw: unknown; text: string | null }> {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  const botToken = String(params.botToken || '').trim();
  if (!guildId || !userId || !botToken) return { status: 0, member: null, raw: null, text: null };

  const cacheTtlMs = clampInt(
    parseInt(String(process.env.DISCORD_MEMBER_CACHE_TTL_MS || ''), 10),
    0,
    10 * 60_000,
    15_000
  );
  const ck = cacheKey(guildId, userId);
  const cached = memberCache.get(ck);
  if (cached && Date.now() - cached.ts <= cacheTtlMs) {
    return { status: 200, member: { userId, roles: cached.roles, raw: null }, raw: null, text: null };
  }

  const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  const doFetch = async () =>
    await fetchJsonSafe(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bot ${botToken}`,
      },
    });

  const retryConfig = getServiceRetryConfig('discord', {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 2000,
  });

  const fetchWithRetry = async () =>
    await withRetry(doFetch, {
      service: 'discord',
      ...retryConfig,
      retryOnError: isTransientHttpError,
      retryOnResult: (result) => result.status >= 500,
      isSuccessResult: (result) => result.status >= 200 && result.status < 300,
    });

  let resp = await fetchWithRetry();
  if (resp.status === 429) {
    const respJson = asRecord(resp.json);
    const retryAfterSecRaw = Number(respJson.retry_after ?? respJson.retry_after_seconds ?? NaN);
    const retryMs = Number.isFinite(retryAfterSecRaw) ? Math.min(Math.max(retryAfterSecRaw * 1000, 250), 2000) : 1000;
    logger.warn('discord.rate_limited', { endpoint: 'guild_member', guildId, userId, retryMs });
    await sleep(retryMs);
    resp = await fetchWithRetry();
  }

  const rolesRaw = asRecord(resp.json).roles;
  const roles = Array.isArray(rolesRaw) ? rolesRaw.map((r) => String(r)).filter(Boolean) : [];
  if (resp.status >= 200 && resp.status < 300) {
    memberCache.set(ck, { ts: Date.now(), roles });
    return { status: resp.status, member: { userId, roles, raw: resp.json }, raw: resp.json, text: resp.text };
  }

  // Cache negative responses briefly to avoid hammering Discord on missing members.
  if (resp.status === 404 || resp.status === 403) {
    memberCache.set(ck, { ts: Date.now(), roles: [] });
  } else {
    logger.warn('discord.guild_member.fetch_failed', {
      status: resp.status,
      guildId,
      userId,
      body: resp.json ?? (resp.text ? resp.text.slice(0, 200) : null),
    });
  }

  return { status: resp.status, member: null, raw: resp.json, text: resp.text };
}

export async function addDiscordGuildMember(params: {
  botToken: string;
  guildId: string;
  userId: string;
  userAccessToken: string;
}): Promise<{ status: number; ok: boolean; raw: unknown; text: string | null }> {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  const botToken = String(params.botToken || '').trim();
  const userAccessToken = String(params.userAccessToken || '').trim();
  if (!guildId || !userId || !botToken || !userAccessToken) return { status: 0, ok: false, raw: null, text: null };

  const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  const retryConfig = getServiceRetryConfig('discord', {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 2000,
  });

  const resp = await withRetry(
    async () =>
      await fetchJsonSafe(url, {
        method: 'PUT',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Bot ${botToken}`,
        },
        body: JSON.stringify({ access_token: userAccessToken }),
      }),
    {
      service: 'discord',
      ...retryConfig,
      retryOnError: isTransientHttpError,
      retryOnResult: (result) => result.status >= 500,
      isSuccessResult: (result) => result.status >= 200 && result.status < 300,
    }
  );

  const ok = resp.status >= 200 && resp.status < 300;
  if (!ok && resp.status !== 204) {
    logger.warn('discord.guild_member.add_failed', {
      status: resp.status,
      guildId,
      userId,
      body: resp.json ?? (resp.text ? resp.text.slice(0, 200) : null),
    });
  } else {
    // Joining may change roles later; invalidate cache.
    memberCache.delete(cacheKey(guildId, userId));
  }

  return { status: resp.status, ok, raw: resp.json, text: resp.text };
}
