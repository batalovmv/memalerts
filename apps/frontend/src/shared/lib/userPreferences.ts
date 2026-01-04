import { api } from '@/lib/api';

export type ThemePreference = 'light' | 'dark';

export type UserPreferences = {
  theme?: ThemePreference;
  autoplayMemesEnabled?: boolean;
  memeModalMuted?: boolean;
  memeModalVolume?: number; // 0..1
  coinsInfoSeen?: boolean;
};

type ApiErrorLike = { response?: { status?: number } };

let cached: UserPreferences | null = null;
let inFlight: Promise<UserPreferences | null> | null = null;
let backendSupported: boolean | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 1;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function normalize(raw: unknown): UserPreferences {
  if (!isRecord(raw)) return {};
  const out: UserPreferences = {};
  if (raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme;
  if (typeof raw.autoplayMemesEnabled === 'boolean') out.autoplayMemesEnabled = raw.autoplayMemesEnabled;
  if (typeof raw.memeModalMuted === 'boolean') out.memeModalMuted = raw.memeModalMuted;
  if (typeof raw.memeModalVolume === 'number') out.memeModalVolume = clamp01(raw.memeModalVolume);
  if (typeof raw.coinsInfoSeen === 'boolean') out.coinsInfoSeen = raw.coinsInfoSeen;
  return out;
}

/**
 * Backend-first user preferences.
 *
 * Expected API (to be implemented in backend):
 * - GET /me/preferences -> UserPreferences
 * - PATCH /me/preferences (partial) -> UserPreferences
 *
 * We intentionally degrade gracefully:
 * - 401/403/404 -> returns null (caller can fall back to localStorage defaults)
 */
export async function getUserPreferences(): Promise<UserPreferences | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;
  if (backendSupported === false) return null;

  inFlight = (async () => {
    try {
      const res = await api.get<unknown>('/me/preferences', { timeout: 8000 });
      // If nginx SPA fallback catches this route, we'll get HTML instead of JSON.
      // Treat it as "endpoint not supported" to avoid noisy PATCH attempts.
      if (typeof res === 'string') {
        backendSupported = false;
        return null;
      }
      backendSupported = true;
      cached = normalize(res);
      return cached;
    } catch (e: unknown) {
      const err = e as ApiErrorLike;
      const status = err?.response?.status;
      if (status === 404 || status === 405) backendSupported = false;
      if (status === 401 || status === 403 || status === 404) return null;
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export async function patchUserPreferences(patch: Partial<UserPreferences>): Promise<UserPreferences | null> {
  try {
    if (backendSupported === false) return null;
    // Avoid PATCH noise on public pages (e.g. /channel/:slug) where backend/proxy may not allow PATCH.
    // Preferences are a dashboard/settings concern; public pages should stay read-only.
    try {
      const p = window.location?.pathname || '';
      if (p.startsWith('/channel/')) return null;
    } catch {
      // ignore
    }
    const res = await api.patch<unknown>('/me/preferences', patch, { timeout: 8000 });
    if (typeof res === 'string') {
      backendSupported = false;
      return null;
    }
    backendSupported = true;
    cached = normalize(res);
    return cached;
  } catch (e: unknown) {
    const err = e as ApiErrorLike;
    const status = err?.response?.status;
    // Some environments may not support this endpoint/method yet (back-compat).
    if (status === 404 || status === 405) backendSupported = false;
    if (status === 401 || status === 403 || status === 404 || status === 405) return null;
    return null;
  }
}

export function clearUserPreferencesCache(): void {
  cached = null;
  inFlight = null;
  backendSupported = null;
}


