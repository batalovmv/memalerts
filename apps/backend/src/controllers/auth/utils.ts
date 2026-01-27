import type { AuthRequest } from '../../middleware/auth.js';

// Helper function to get redirect URL based on environment and request
export const getRedirectUrl = (req?: AuthRequest, stateOrigin?: string): string => {
  if (stateOrigin) {
    return stateOrigin;
  }

  if (req) {
    const host = req.get('host') || '';
    if (host.includes('beta.')) {
      const betaUrl = `https://${host.split(':')[0]}`;
      return betaUrl;
    }
  }

  if (process.env.WEB_URL) {
    return process.env.WEB_URL;
  }

  if (process.env.NODE_ENV === 'production' && process.env.DOMAIN) {
    const fallbackUrl = `https://${process.env.DOMAIN}`;
    return fallbackUrl;
  }

  return 'http://localhost:5173';
};

export const DEFAULT_LINK_REDIRECT = '/settings/accounts';

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, '');
}

function deriveBaseDomain(domain: string): string {
  let base = normalizeHost(domain);
  const prefixes = ['beta.', 'www.', 'api.'];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (base.startsWith(prefix)) {
        base = base.slice(prefix.length);
        changed = true;
      }
    }
  }
  return base;
}

function isAllowedOriginHost(hostname: string, req?: AuthRequest): boolean {
  const host = normalizeHost(hostname);
  if (!host) return false;

  const allowed = new Set<string>();
  const envDomain = String(process.env.DOMAIN || '').trim();
  if (envDomain) {
    const base = deriveBaseDomain(envDomain);
    if (base) {
      allowed.add(base);
      allowed.add(`www.${base}`);
      allowed.add(`beta.${base}`);
    }
  }

  const envWebUrl = String(process.env.WEB_URL || '').trim();
  if (envWebUrl) {
    try {
      const webHost = normalizeHost(new URL(envWebUrl).hostname);
      const base = deriveBaseDomain(webHost);
      if (base) {
        allowed.add(base);
        allowed.add(`www.${base}`);
        allowed.add(`beta.${base}`);
      }
    } catch {
      // ignore invalid WEB_URL
    }
  }

  if (req) {
    const reqHost = normalizeHost(req.get('host') || '');
    if (reqHost) allowed.add(reqHost);
    if (!envDomain) {
      const base = deriveBaseDomain(reqHost);
      if (base) {
        allowed.add(base);
        allowed.add(`www.${base}`);
        allowed.add(`beta.${base}`);
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    allowed.add('localhost');
    allowed.add('127.0.0.1');
    allowed.add('0.0.0.0');
  }

  if (allowed.has(host)) return true;

  for (const allowedHost of allowed) {
    if (allowedHost && host.endsWith(`.${allowedHost}`)) return true;
  }

  return false;
}

export function sanitizeOrigin(input: unknown, req?: AuthRequest): string | null {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!isAllowedOriginHost(url.hostname, req)) return null;

  return url.origin;
}

const REDIRECT_ALLOWLIST = new Set<string>([
  '/settings/accounts',
  '/settings/bot',
  '/settings/bot/youtube',
  '/dashboard',
  '/',
]);

export function sanitizeRedirectTo(input: unknown): string {
  const redirectTo = typeof input === 'string' ? input.trim() : '';
  if (!redirectTo) return DEFAULT_LINK_REDIRECT;

  if (!redirectTo.startsWith('/')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.startsWith('//')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('://')) return DEFAULT_LINK_REDIRECT;
  if (redirectTo.includes('\\')) return DEFAULT_LINK_REDIRECT;
  if (!REDIRECT_ALLOWLIST.has(redirectTo)) return DEFAULT_LINK_REDIRECT;

  return redirectTo;
}

export function buildRedirectWithError(
  baseUrl: string,
  redirectPath: string,
  params: Record<string, string | undefined>
) {
  const url = new URL(`${baseUrl}${redirectPath}`);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return url.toString();
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function wantsJson(req: AuthRequest): boolean {
  const accept = String(req.get('accept') || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  const reqRec = req as unknown as Record<string, unknown>;
  if (reqRec?.xhr) return true;
  return false;
}
