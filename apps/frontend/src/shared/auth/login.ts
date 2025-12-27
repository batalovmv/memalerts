import { getRuntimeConfig } from '../config/runtimeConfig';

function getApiOrigin(): string {
  const runtime = getRuntimeConfig();
  const envUrl = import.meta.env.VITE_API_URL;

  // Prefer runtime config if available (enterprise pattern: runtime env, same build)
  if (runtime?.apiBaseUrl !== undefined) {
    return runtime.apiBaseUrl === '' ? window.location.origin : runtime.apiBaseUrl;
  }

  // If VITE_API_URL is explicitly set (even if empty string), use it
  // Empty string means use relative URLs (same origin)
  if (envUrl !== undefined) {
    return envUrl === '' ? window.location.origin : envUrl;
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

function rememberLoginReturnTo(returnTo: string) {
  try {
    const mode =
      returnTo.startsWith('/channel/') || returnTo.startsWith('/submit') || returnTo.startsWith('/pool') ? 'viewer' : 'streamer';
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
  const effectiveRedirect = redirectPath && redirectPath !== '/' ? redirectPath : '/post-login';
  authUrl.searchParams.set('redirect_to', effectiveRedirect);

  // Reliable UX: if backend ignores redirect_to and sends user elsewhere (e.g. /settings/accounts),
  // we can still return them to the intended page after /me succeeds.
  if (effectiveRedirect && effectiveRedirect !== '/post-login') {
    rememberLoginReturnTo(effectiveRedirect);
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

  window.location.href = authUrl.toString();
};


