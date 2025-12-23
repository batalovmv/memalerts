export type RuntimeConfig = {
  /**
   * Base URL for API requests.
   * - "" (empty string) means same-origin relative requests (recommended).
   * - "https://..." for absolute URL.
   */
  apiBaseUrl?: string;
  /**
   * Base URL for Socket.IO connection.
   * - "" (empty string) means same-origin (window.location.origin).
   * - "https://..." for absolute URL.
   */
  socketUrl?: string;
  /**
   * Optional base URL for uploaded static files (/uploads/*).
   * - "" (empty string) means same-origin (recommended if nginx serves uploads on the same domain).
   * - "https://..." for absolute URL (useful if uploads are hosted elsewhere).
   */
  uploadsBaseUrl?: string;
  /**
   * Optional public site base URL for building share links.
   * - "" (empty string) means same-origin.
   * - "https://..." for absolute URL.
   */
  publicBaseUrl?: string;
  /**
   * Optional Socket.IO transports override.
   * Example: ["websocket"] to force WebSocket-only (recommended for production to avoid polling load).
   */
  socketTransports?: Array<'websocket' | 'polling'>;
  /**
   * If true, the client may fall back to polling when websocket-only connect fails.
   * Default: dev=true, prod=false (to surface misconfigured proxies instead of silently increasing load).
   */
  socketAllowPollingFallback?: boolean;
};

declare global {
  interface Window {
    __MEMALERTS_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

let cachedConfig: RuntimeConfig | null = null;

export function getRuntimeConfig(): RuntimeConfig | null {
  return cachedConfig ?? window.__MEMALERTS_RUNTIME_CONFIG__ ?? null;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) {
      cachedConfig = {};
      window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
      return cachedConfig;
    }

    const json = (await res.json()) as RuntimeConfig;
    cachedConfig = json ?? {};
    window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
    return cachedConfig;
  } catch {
    cachedConfig = {};
    window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
    return cachedConfig;
  }
}


