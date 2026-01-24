export type RuntimeConfig = {
  apiBaseUrl?: string;
  socketUrl?: string;
  uploadsBaseUrl?: string;
  publicBaseUrl?: string;
  socketTransports?: Array<'websocket' | 'polling'>;
  socketAllowPollingFallback?: boolean;
};

declare global {
  interface Window {
    __MEMALERTS_RUNTIME_CONFIG__?: RuntimeConfig;
  }
}

let cachedConfig: RuntimeConfig | null = null;

function applyProdDefaults(config: RuntimeConfig): RuntimeConfig {
  if (!import.meta.env.PROD) return config;

  let changed = false;
  const next: RuntimeConfig = { ...config };
  if (next.apiBaseUrl === undefined) {
    next.apiBaseUrl = '';
    changed = true;
  }
  if (next.socketUrl === undefined) {
    next.socketUrl = '';
    changed = true;
  }
  return changed ? next : config;
}

export function getRuntimeConfig(): RuntimeConfig | null {
  return cachedConfig ?? window.__MEMALERTS_RUNTIME_CONFIG__ ?? null;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cachedConfig) return cachedConfig;

  try {
    // Shared between web and overlay (served from site root).
    const res = await fetch('/config.json', { cache: 'no-store' });
    if (!res.ok) {
      cachedConfig = applyProdDefaults({});
      window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
      return cachedConfig;
    }

    const json = (await res.json()) as RuntimeConfig;
    cachedConfig = applyProdDefaults(json ?? {});
    window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
    return cachedConfig;
  } catch {
    cachedConfig = applyProdDefaults({});
    window.__MEMALERTS_RUNTIME_CONFIG__ = cachedConfig;
    return cachedConfig;
  }
}


