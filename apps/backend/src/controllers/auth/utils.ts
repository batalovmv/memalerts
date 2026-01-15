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
  const reqRec = (req as unknown) as Record<string, unknown>;
  if (reqRec?.xhr) return true;
  return false;
}
