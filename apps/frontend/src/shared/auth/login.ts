import { getRuntimeConfig } from '../config/runtimeConfig';

function isBetaHost(hostname: string): boolean {
  return hostname.includes('beta.');
}

function shouldIgnoreEnvApiUrl(envUrl: string): boolean {
  if (!import.meta.env.PROD) return false;
  try {
    const envHost = new URL(envUrl).hostname;
    const pageHost = window.location.hostname;
    return isBetaHost(envHost) !== isBetaHost(pageHost);
  } catch {
    return false;
  }
}

function getApiOrigin(): string {
  const runtime = getRuntimeConfig();
  const envUrl = import.meta.env.VITE_API_URL;

  // Prefer runtime config if available (enterprise pattern: runtime env, same build)
  if (runtime?.apiBaseUrl !== undefined) {
    if (runtime.apiBaseUrl === '') return window.location.origin;
    if (runtime.apiBaseUrl && shouldIgnoreEnvApiUrl(runtime.apiBaseUrl)) return window.location.origin;
    return runtime.apiBaseUrl;
  }

  // If VITE_API_URL is explicitly set (even if empty string), use it
  // Empty string means use relative URLs (same origin)
  if (envUrl !== undefined) {
    if (envUrl === '') return window.location.origin;
    if (shouldIgnoreEnvApiUrl(envUrl)) return window.location.origin;
    return envUrl;
  }

  // In production, use same origin; in development, use localhost
  if (import.meta.env.PROD) return window.location.origin;
  return 'http://localhost:3001';
}

/**
 * API origin for hard redirects to backend endpoints (OAuth/link flows).
 *
 * Note: This is intentionally an origin/base URL, not a path.
 */
export function getApiOriginForRedirect(): string {
  return getApiOrigin();
}

function sanitizeRedirectToPath(raw: string): string {
  const v = (raw || '').trim();
  if (!v) return '/post-login';

  // If it looks like a full URL, keep only the pathname.
  if (v.startsWith('http://') || v.startsWith('https://')) {
    try {
      return new URL(v).pathname || '/post-login';
    } catch {
      return '/post-login';
    }
  }

  // Allowlist logic on backend is path-only (no query); keep only the path segment.
  const noHash = v.split('#')[0] || v;
  const noQuery = (noHash.split('?')[0] || '').trim();
  if (!noQuery.startsWith('/')) return '/post-login';
  return noQuery || '/post-login';
}

function rememberLoginReturnTo(returnTo: string) {
  try {
    const path = sanitizeRedirectToPath(returnTo);
    const mode = path.startsWith('/channel/') || path.startsWith('/submit') || path.startsWith('/pool') ? 'viewer' : 'streamer';
    sessionStorage.setItem('memalerts:auth:returnTo', returnTo);
    sessionStorage.setItem('memalerts:auth:mode', mode);
    sessionStorage.setItem('memalerts:auth:setAt', String(Date.now()));
  } catch {
    // ignore
  }
}

export const login = (redirectTo?: string): void => {
  const apiUrl = getApiOrigin();

  // Get current path if redirectTo is not provided
  const redirectPath = redirectTo || window.location.pathname;

  // Build auth URL with redirect_to parameter
  const authUrl = new URL(`${apiUrl}/auth/twitch`);
  // If user logs in from "/" (no context), route them to a small post-login chooser.
  // If login is initiated from a contextual page (channel/pool/submit/etc), keep that return URL.
  const effectiveReturnTo = redirectPath && redirectPath !== '/' ? redirectPath : '/post-login';
  const effectiveRedirectTo = sanitizeRedirectToPath(effectiveReturnTo);
  authUrl.searchParams.set('redirect_to', effectiveRedirectTo);
  authUrl.searchParams.set('origin', window.location.origin);

  // Reliable UX: if backend ignores redirect_to and sends user elsewhere (e.g. /settings/accounts),
  // we can still return them to the intended page after /me succeeds.
  if (effectiveReturnTo && effectiveReturnTo !== '/post-login') {
    rememberLoginReturnTo(effectiveReturnTo);
  }

  window.location.href = authUrl.toString();
};

export const linkTwitchAccount = (redirectTo?: string): void => {
  const apiUrl = getApiOrigin();

  const redirectPath = redirectTo || '/settings/accounts';
  const authUrl = new URL(`${apiUrl}/auth/twitch/link`);
  if (redirectPath && redirectPath !== '/') {
    authUrl.searchParams.set('redirect_to', redirectPath);
  }
  // Important: keep environments separated on backend (prod/beta).
  authUrl.searchParams.set('origin', window.location.origin);

  window.location.href = authUrl.toString();
};

export const linkExternalAccount = (provider: string, redirectTo?: string): void => {
  const apiUrl = getApiOrigin();

  const redirectPath = redirectTo || '/settings/accounts';
  const safeProvider = encodeURIComponent(provider);
  const authUrl = new URL(`${apiUrl}/auth/${safeProvider}/link`);
  if (redirectPath && redirectPath !== '/') {
    authUrl.searchParams.set('redirect_to', redirectPath);
  }
  // Important: keep environments separated on backend (prod/beta).
  authUrl.searchParams.set('origin', window.location.origin);

  window.location.href = authUrl.toString();
};


