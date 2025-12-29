import { api } from '@/lib/api';

export type ThemePreference = 'light' | 'dark';

export type UserPreferences = {
  theme?: ThemePreference;
  autoplayMemesEnabled?: boolean;
  memeModalMuted?: boolean;
  coinsInfoSeen?: boolean;
};

type ApiErrorLike = { response?: { status?: number } };

let cached: UserPreferences | null = null;
let inFlight: Promise<UserPreferences | null> | null = null;

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function normalize(raw: unknown): UserPreferences {
  if (!isRecord(raw)) return {};
  const out: UserPreferences = {};
  if (raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme;
  if (typeof raw.autoplayMemesEnabled === 'boolean') out.autoplayMemesEnabled = raw.autoplayMemesEnabled;
  if (typeof raw.memeModalMuted === 'boolean') out.memeModalMuted = raw.memeModalMuted;
  if (typeof raw.coinsInfoSeen === 'boolean') out.coinsInfoSeen = raw.coinsInfoSeen;
  return out;
}

/**
 * Backend-first user preferences.
 *
 * Expected API (to be implemented in backend):
 * - GET /api/me/preferences -> UserPreferences
 * - PATCH /api/me/preferences (partial) -> UserPreferences
 *
 * We intentionally degrade gracefully:
 * - 401/403/404 -> returns null (caller can fall back to localStorage defaults)
 */
export async function getUserPreferences(): Promise<UserPreferences | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const res = await api.get<UserPreferences>('/api/me/preferences', { timeout: 8000 });
      cached = normalize(res);
      return cached;
    } catch (e: unknown) {
      const err = e as ApiErrorLike;
      const status = err?.response?.status;
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
    // Avoid PATCH noise on public pages (e.g. /channel/:slug) where backend/proxy may not allow PATCH.
    // Preferences are a dashboard/settings concern; public pages should stay read-only.
    try {
      const p = window.location?.pathname || '';
      if (p.startsWith('/channel/')) return null;
    } catch {
      // ignore
    }
    const res = await api.patch<UserPreferences>('/api/me/preferences', patch, { timeout: 8000 });
    cached = normalize(res);
    return cached;
  } catch (e: unknown) {
    const err = e as ApiErrorLike;
    const status = err?.response?.status;
    // Some environments may not support this endpoint/method yet (back-compat).
    if (status === 401 || status === 403 || status === 404 || status === 405) return null;
    return null;
  }
}

export function clearUserPreferencesCache(): void {
  cached = null;
  inFlight = null;
}


