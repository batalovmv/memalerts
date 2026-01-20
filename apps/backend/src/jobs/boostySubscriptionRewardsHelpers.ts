import { normTierKey } from '../utils/tierKey.js';

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function normBlogName(s: unknown): string {
  return String(s || '')
    .trim()
    .toLowerCase();
}

export function normalizeTierRoles(raw: unknown): Array<{ tier: string; roleId: string }> {
  const items = Array.isArray(raw) ? raw : [];
  const out: Array<{ tier: string; roleId: string }> = [];
  for (const it of items) {
    const item = it as { tier?: unknown; roleId?: unknown };
    const tier = String(item?.tier ?? '').trim();
    const roleId = String(item?.roleId ?? '').trim();
    if (!tier || !roleId) continue;
    out.push({ tier, roleId });
  }
  return out;
}

export function pickMatchedTierRole(params: {
  memberRoles: string[];
  tierRoles: Array<{ tier: string; roleId: string }>;
}): { tier: string; roleId: string } | null {
  const roles = Array.isArray(params.memberRoles) ? params.memberRoles : [];
  for (const tr of params.tierRoles) {
    if (roles.includes(tr.roleId)) return tr;
  }
  return null;
}

export function normalizeTierCoins(raw: unknown): Array<{ tierKey: string; coins: number }> {
  const out: Array<{ tierKey: string; coins: number }> = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const it of raw) {
      const item = it as { tierKey?: unknown; coins?: unknown };
      const tierKey = normTierKey(item?.tierKey);
      const coins = Number(item?.coins);
      if (!tierKey) continue;
      if (!Number.isFinite(coins) || coins < 0) continue;
      if (seen.has(tierKey)) continue;
      seen.add(tierKey);
      out.push({ tierKey, coins: Math.floor(coins) });
    }
    return out;
  }

  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const tierKey = normTierKey(k);
      const coins = Number(v);
      if (!tierKey) continue;
      if (!Number.isFinite(coins) || coins < 0) continue;
      if (seen.has(tierKey)) continue;
      seen.add(tierKey);
      out.push({ tierKey, coins: Math.floor(coins) });
    }
  }

  return out;
}

export function pickCoinsForTier(params: {
  tierKey: string | null;
  tierCoins: Array<{ tierKey: string; coins: number }>;
  fallbackCoins: number;
}): number {
  const fallback = Number.isFinite(params.fallbackCoins) ? Math.floor(params.fallbackCoins) : 0;
  const tierKey = normTierKey(params.tierKey);
  if (!tierKey) return fallback;

  const found = params.tierCoins.find((t) => t.tierKey === tierKey);
  return found ? found.coins : fallback;
}

export function computeBoostyTierDelta(params: {
  coinsGranted: number;
  tierKeyCurrent: string | null;
  targetCoins: number;
  tierKeyGranted: string | null;
}): { delta: number; nextCoinsGranted: number; nextTierKeyGranted: string | null } {
  const tierKeyGranted = normTierKey(params.tierKeyGranted) || null;
  const tierKeyCurrent = normTierKey(params.tierKeyCurrent) || null;

  const coinsGranted = Number.isFinite(params.coinsGranted) ? Math.max(0, Math.floor(params.coinsGranted)) : 0;
  const targetCoins = Number.isFinite(params.targetCoins) ? Math.max(0, Math.floor(params.targetCoins)) : 0;

  if (tierKeyCurrent === null) {
    const nextCoinsGranted = coinsGranted === 0 ? Math.max(coinsGranted, targetCoins) : coinsGranted;
    const delta = nextCoinsGranted - coinsGranted;
    return { delta, nextCoinsGranted, nextTierKeyGranted: null };
  }

  if (tierKeyGranted !== null && tierKeyGranted === tierKeyCurrent) {
    return { delta: 0, nextCoinsGranted: coinsGranted, nextTierKeyGranted: null };
  }

  const nextCoinsGranted = Math.max(coinsGranted, targetCoins);
  const delta = nextCoinsGranted - coinsGranted;

  return {
    delta,
    nextCoinsGranted,
    nextTierKeyGranted: delta > 0 ? tierKeyCurrent : null,
  };
}
