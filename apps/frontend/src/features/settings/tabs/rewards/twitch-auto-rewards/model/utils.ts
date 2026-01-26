import type { KvRow, PlatformCode } from '@/features/settings/tabs/rewards/twitch-auto-rewards/model/types';
import type { TwitchAutoRewardsV1 } from '@memalerts/api-contracts';

export const PLATFORM_TITLES: Record<PlatformCode, string> = {
  TW: 'Twitch',
  K: 'Kick',
  TR: 'Trovo',
  VK: 'VKVideo',
};

export function rowsFromRecord(rec: Record<string, number> | undefined): KvRow[] {
  if (!rec) return [];
  return Object.entries(rec)
    .map(([key, value]) => ({ key: String(key), value: Number.isFinite(value) ? String(value) : '' }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function recordFromRows(rows: KvRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    const k = String(row.key || '').trim();
    const vStr = String(row.value || '').trim();
    if (!k) continue;
    const v = Number.parseInt(vStr || '0', 10);
    if (!Number.isFinite(v) || v <= 0) continue;
    out[k] = v;
  }
  return out;
}

export function intOrEmpty(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}

export function bool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function base(value: TwitchAutoRewardsV1 | null): TwitchAutoRewardsV1 {
  return value ?? { v: 1 };
}

