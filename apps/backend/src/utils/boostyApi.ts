import crypto from 'crypto';
import { isTransientHttpError } from './httpErrors.js';
import { fetchWithTimeout, getServiceHttpTimeoutMs } from './httpTimeouts.js';
import { getServiceRetryConfig, withRetry } from './retry.js';

export type BoostyAuth = {
  accessToken: string | null;
};

export type BoostyUserSubscription = {
  id: string | null;
  blogName: string | null;
  // Best-effort stable tier identifier (prefer id/uuid, fallback to slug/name).
  tierKey: string | null;
  isActive: boolean | null;
  raw: unknown;
};

function safeString(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function boolOrNull(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function parseSubscription(raw: unknown): BoostyUserSubscription {
  const data = asRecord(raw);
  const id =
    safeString(data.id) ||
    safeString(data.subscriptionId) ||
    safeString(data.subscription_id) ||
    safeString(data.uuid) ||
    null;

  const blogName =
    safeString(data.blogName) ||
    safeString(data.blog_name) ||
    safeString(asRecord(data.blog).name) ||
    safeString(asRecord(data.blog).blogName) ||
    safeString(asRecord(data.blog).blog_name) ||
    safeString(asRecord(data.blog).urlName) ||
    safeString(asRecord(data.blog).url_name) ||
    null;

  const isActive =
    boolOrNull(data.isActive) ??
    boolOrNull(data.is_active) ??
    boolOrNull(data.active) ??
    (typeof data.status === 'string' ? (data.status.toLowerCase() === 'active' ? true : null) : null);

  // tierKey extractor (priority: stable ids -> slugs -> names).
  const tierKey =
    // Common nesting variants: raw.level / raw.tier / raw.plan, and sometimes under raw.subscription.*
    safeString(asRecord(data.tier).id) ||
    safeString(asRecord(data.level).id) ||
    safeString(asRecord(data.plan).id) ||
    safeString(asRecord(asRecord(data.subscription).tier).id) ||
    safeString(asRecord(asRecord(data.subscription).level).id) ||
    safeString(asRecord(asRecord(data.subscription).plan).id) ||
    safeString(asRecord(data.tier).uuid) ||
    safeString(asRecord(data.level).uuid) ||
    safeString(asRecord(data.plan).uuid) ||
    safeString(asRecord(asRecord(data.subscription).tier).uuid) ||
    safeString(asRecord(asRecord(data.subscription).level).uuid) ||
    safeString(asRecord(asRecord(data.subscription).plan).uuid) ||
    safeString(asRecord(data.tier).slug) ||
    safeString(asRecord(data.level).slug) ||
    safeString(asRecord(data.plan).slug) ||
    safeString(asRecord(asRecord(data.subscription).tier).slug) ||
    safeString(asRecord(asRecord(data.subscription).level).slug) ||
    safeString(asRecord(asRecord(data.subscription).plan).slug) ||
    safeString(asRecord(data.tier).name) ||
    safeString(asRecord(data.level).name) ||
    safeString(asRecord(data.plan).name) ||
    safeString(asRecord(asRecord(data.subscription).tier).name) ||
    safeString(asRecord(asRecord(data.subscription).level).name) ||
    safeString(asRecord(asRecord(data.subscription).plan).name) ||
    null;

  return { id, blogName, tierKey, isActive, raw };
}

export class BoostyApiClient {
  private baseUrl: string;
  private auth: BoostyAuth;

  constructor(params: { baseUrl: string; auth: BoostyAuth }) {
    this.baseUrl = params.baseUrl.replace(/\/+$/, '');
    this.auth = params.auth;
  }

  async getUserSubscriptions(params?: { limit?: number; withFollow?: boolean }): Promise<BoostyUserSubscription[]> {
    const limit = params?.limit ?? 100;
    const withFollow = params?.withFollow ?? false;

    const url = new URL(`${this.baseUrl}/v1/user/subscriptions`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('with_follow', withFollow ? '1' : '0');

    const json = await this.getJson(url.toString());
    const jsonRecord = asRecord(json);
    const items =
      (Array.isArray(jsonRecord.data) ? jsonRecord.data : null) ??
      (Array.isArray(jsonRecord.items) ? jsonRecord.items : null) ??
      (Array.isArray(json) ? json : null) ??
      [];

    return items.map(parseSubscription);
  }

  // Best-effort "whoami" to get a stable Boosty user id for providerAccountId.
  // Boosty does not have a fully documented public API, so we try a few common endpoints and fall back gracefully.
  async getMyUserIdBestEffort(): Promise<string | null> {
    const candidates = ['/v1/user', '/v1/user/me', '/v1/user/profile', '/v1/user/current', '/v1/me'];
    for (const p of candidates) {
      const url = `${this.baseUrl}${p}`;
      const res = await this.tryGetJson(url);
      if (!res.ok) {
        // If endpoint doesn't exist, keep trying.
        if (res.status === 404) continue;
        // If auth fails or server errors, don't block linking; just fall back to token payload.
        continue;
      }
      const json = res.json;
      const jsonRecord = asRecord(json);
      const id =
        safeString(jsonRecord.id) ||
        safeString(jsonRecord.userId) ||
        safeString(jsonRecord.uid) ||
        safeString(jsonRecord.sub) ||
        safeString(asRecord(jsonRecord.user).id) ||
        safeString(asRecord(jsonRecord.user).userId) ||
        safeString(asRecord(jsonRecord.data).id) ||
        safeString(asRecord(jsonRecord.data).userId) ||
        null;
      if (id) return id;
    }
    return null;
  }

  static stableProviderAccountId(input: string): string {
    // Keep it short-ish while still extremely unlikely to collide.
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 48);
  }

  private async getJson(url: string): Promise<unknown> {
    const timeoutMs = getServiceHttpTimeoutMs('BOOSTY', 10_000, 1_000, 30_000);
    const retryConfig = getServiceRetryConfig('boosty', {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 3000,
    });

    const shouldRetry = (error: unknown) => {
      const err = error as { code?: string };
      if (err?.code === 'BOOSTY_NO_TOKEN') return false;
      return isTransientHttpError(error);
    };

    return await withRetry(
      async () => {
        const accessToken = safeString(this.auth.accessToken);
        if (!accessToken) {
          const err = new Error('Missing Boosty access token') as Error & { code?: string };
          err.code = 'BOOSTY_NO_TOKEN';
          throw err;
        }

        const res = await fetchWithTimeout({
          url,
          service: 'boosty',
          timeoutMs,
          timeoutReason: 'boosty_timeout',
          init: {
            method: 'GET',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${accessToken}`,
              // Best-effort "real world" headers.
              'user-agent': 'MemAlerts/boosty (server)',
              dnt: '1',
              'cache-control': 'no-cache',
              pragma: 'no-cache',
            },
          },
        });

        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        if (!res.ok) {
          const err = new Error(`Boosty API error: ${res.status}`) as Error & {
            code?: string;
            status?: number;
            body?: unknown;
          };
          err.code = 'BOOSTY_API_ERROR';
          err.status = res.status;
          err.body = json ?? text?.slice(0, 500) ?? null;
          throw err;
        }

        return json;
      },
      {
        service: 'boosty',
        ...retryConfig,
        retryOnError: shouldRetry,
      }
    );
  }

  private async tryGetJson(url: string): Promise<{ ok: boolean; status: number; json: unknown | null }> {
    const timeoutMs = getServiceHttpTimeoutMs('BOOSTY', 10_000, 1_000, 30_000);
    const retryConfig = getServiceRetryConfig('boosty', {
      maxAttempts: 3,
      baseDelayMs: 500,
      maxDelayMs: 3000,
    });

    return await withRetry(
      async () => {
        const accessToken = safeString(this.auth.accessToken);
        if (!accessToken) return { ok: false, status: 0, json: null };

        const res = await fetchWithTimeout({
          url,
          service: 'boosty',
          timeoutMs,
          timeoutReason: 'boosty_timeout',
          init: {
            method: 'GET',
            headers: {
              accept: 'application/json',
              authorization: `Bearer ${accessToken}`,
              'user-agent': 'MemAlerts/boosty (server)',
              dnt: '1',
              'cache-control': 'no-cache',
              pragma: 'no-cache',
            },
          },
        });

        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }

        return { ok: res.ok, status: res.status, json };
      },
      {
        service: 'boosty',
        ...retryConfig,
        retryOnError: isTransientHttpError,
        retryOnResult: (result) => result.status >= 500,
        isSuccessResult: (result) => result.ok,
      }
    );
  }
}
