import { logger } from './logger.js';

export type DiscordGuildMember = {
  userId: string;
  roles: string[];
  raw: any;
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

async function fetchJsonSafe(url: string, init: RequestInit): Promise<{ status: number; json: any; text: string | null }> {
  const controller = new AbortController();
  const timeoutMs = clampInt(parseInt(String(process.env.DISCORD_HTTP_TIMEOUT_MS || ''), 10), 1000, 30_000, 10_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    let json: any = null;
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
  } finally {
    clearTimeout(timeout);
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

export async function fetchDiscordGuildMember(params: {
  botToken: string;
  guildId: string;
  userId: string;
}): Promise<{ status: number; member: DiscordGuildMember | null; raw: any; text: string | null }> {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  const botToken = String(params.botToken || '').trim();
  if (!guildId || !userId || !botToken) return { status: 0, member: null, raw: null, text: null };

  const cacheTtlMs = clampInt(parseInt(String(process.env.DISCORD_MEMBER_CACHE_TTL_MS || ''), 10), 0, 10 * 60_000, 15_000);
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

  let resp = await doFetch();
  if (resp.status === 429) {
    const retryAfterSecRaw = Number(resp.json?.retry_after ?? resp.json?.retry_after_seconds ?? NaN);
    const retryMs = Number.isFinite(retryAfterSecRaw) ? Math.min(Math.max(retryAfterSecRaw * 1000, 250), 2000) : 1000;
    logger.warn('discord.rate_limited', { endpoint: 'guild_member', guildId, userId, retryMs });
    await sleep(retryMs);
    resp = await doFetch();
  }

  const roles = Array.isArray(resp.json?.roles) ? resp.json.roles.map((r: any) => String(r)).filter(Boolean) : [];
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
}): Promise<{ status: number; ok: boolean; raw: any; text: string | null }> {
  const guildId = String(params.guildId || '').trim();
  const userId = String(params.userId || '').trim();
  const botToken = String(params.botToken || '').trim();
  const userAccessToken = String(params.userAccessToken || '').trim();
  if (!guildId || !userId || !botToken || !userAccessToken) return { status: 0, ok: false, raw: null, text: null };

  const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  const resp = await fetchJsonSafe(url, {
    method: 'PUT',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Bot ${botToken}`,
    },
    body: JSON.stringify({ access_token: userAccessToken }),
  });

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


