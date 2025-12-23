import { getRuntimeConfig } from '../config/runtimeConfig';

export const login = (redirectTo?: string): void => {
  const runtime = getRuntimeConfig();
  const envUrl = import.meta.env.VITE_API_URL;
  let apiUrl: string;

  // Prefer runtime config if available (enterprise pattern: runtime env, same build)
  if (runtime?.apiBaseUrl !== undefined) {
    apiUrl = runtime.apiBaseUrl === '' ? window.location.origin : runtime.apiBaseUrl;
  } else if (envUrl !== undefined) {
    // If VITE_API_URL is explicitly set (even if empty string), use it
    // Empty string means use relative URLs (same origin)
    if (envUrl === '') {
      // Empty string means use relative URLs - use current origin
      apiUrl = window.location.origin;
    } else {
      apiUrl = envUrl;
    }
  } else if (import.meta.env.PROD) {
    // In production, use same origin
    apiUrl = window.location.origin;
  } else {
    // In development, use localhost
    apiUrl = 'http://localhost:3001';
  }

  // Get current path if redirectTo is not provided
  const redirectPath = redirectTo || window.location.pathname;

  // Build auth URL with redirect_to parameter
  const authUrl = new URL(`${apiUrl}/auth/twitch`);
  if (redirectPath && redirectPath !== '/') {
    authUrl.searchParams.set('redirect_to', redirectPath);
  }

  window.location.href = authUrl.toString();
};


