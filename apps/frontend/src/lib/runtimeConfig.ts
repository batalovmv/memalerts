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



