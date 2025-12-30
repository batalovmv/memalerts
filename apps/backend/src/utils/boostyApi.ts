import crypto from 'crypto';

export type BoostyAuth = {
  accessToken: string | null;
};

export type BoostyUserSubscription = {
  id: string | null;
  blogName: string | null;
  isActive: boolean | null;
  raw: any;
};

function safeString(v: any): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s ? s : null;
}

function boolOrNull(v: any): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function parseSubscription(raw: any): BoostyUserSubscription {
  const id =
    safeString(raw?.id) ||
    safeString(raw?.subscriptionId) ||
    safeString(raw?.subscription_id) ||
    safeString(raw?.uuid) ||
    null;

  const blogName =
    safeString(raw?.blogName) ||
    safeString(raw?.blog_name) ||
    safeString(raw?.blog?.name) ||
    safeString(raw?.blog?.blogName) ||
    safeString(raw?.blog?.blog_name) ||
    safeString(raw?.blog?.urlName) ||
    safeString(raw?.blog?.url_name) ||
    null;

  const isActive =
    boolOrNull(raw?.isActive) ??
    boolOrNull(raw?.is_active) ??
    boolOrNull(raw?.active) ??
    (typeof raw?.status === 'string' ? (raw.status.toLowerCase() === 'active' ? true : null) : null);

  return { id, blogName, isActive, raw };
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
    const items =
      (Array.isArray(json?.data) ? json.data : null) ??
      (Array.isArray(json?.items) ? json.items : null) ??
      (Array.isArray(json) ? json : null) ??
      [];

    return items.map(parseSubscription);
  }

  static stableProviderAccountId(input: string): string {
    // Keep it short-ish while still extremely unlikely to collide.
    return crypto.createHash('sha256').update(input).digest('hex').slice(0, 48);
  }

  private async getJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const accessToken = safeString(this.auth.accessToken);
      if (!accessToken) {
        const e: any = new Error('Missing Boosty access token');
        e.code = 'BOOSTY_NO_TOKEN';
        throw e;
      }

      const res = await fetch(url, {
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
        signal: controller.signal,
      });

      const text = await res.text();
      let json: any = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }

      if (!res.ok) {
        const e: any = new Error(`Boosty API error: ${res.status}`);
        e.code = 'BOOSTY_API_ERROR';
        e.status = res.status;
        e.body = json ?? text?.slice(0, 500) ?? null;
        throw e;
      }

      return json;
    } finally {
      clearTimeout(timeout);
    }
  }
}


