import type { TwitchAutoRewardsV1 } from '@memalerts/api-contracts';

import { parseIntSafe, toRecord } from '@/shared/lib/parsing';

export { parseIntSafe, toRecord };

export function getBoolean(obj: unknown, key: string): boolean | undefined {
  const r = toRecord(obj);
  if (!r) return undefined;
  const v = r[key];
  return typeof v === 'boolean' ? v : undefined;
}

export function normalizeTwitchAutoRewards(raw: unknown): TwitchAutoRewardsV1 | null {
  const r = toRecord(raw);
  if (!r) return null;
  if (r.v !== 1) return null;
  return raw as TwitchAutoRewardsV1;
}

export type BoostyAccessStatus = 'need_discord_link' | 'need_join_guild' | 'not_subscribed' | 'subscribed';

export type BoostyAccessResponse = {
  status: BoostyAccessStatus;
  requiredGuild: {
    guildId: string;
    autoJoin: boolean;
    name: string | null;
    inviteUrl: string | null;
  };
  matchedTier: string | null;
  matchedRoleId: string | null;
};

export function normalizeBoostyAccess(raw: unknown): BoostyAccessResponse | null {
  const r = toRecord(raw);
  if (!r) return null;

  const statusRaw = r.status;
  const status: BoostyAccessStatus | null =
    statusRaw === 'need_discord_link' || statusRaw === 'need_join_guild' || statusRaw === 'not_subscribed' || statusRaw === 'subscribed'
      ? statusRaw
      : null;
  if (!status) return null;

  const rg = toRecord(r.requiredGuild);
  if (!rg) return null;
  const guildId = typeof rg.guildId === 'string' ? rg.guildId : typeof rg.id === 'string' ? rg.id : null;
  const autoJoin = typeof rg.autoJoin === 'boolean' ? rg.autoJoin : null;
  if (!guildId || autoJoin === null) return null;

  const asNullableString = (v: unknown): string | null => (typeof v === 'string' ? v : v === null ? null : null);

  const matchedTier =
    typeof r.matchedTier === 'string' ? r.matchedTier : typeof rg.matchedTier === 'string' ? rg.matchedTier : null;
  const matchedRoleId =
    typeof r.matchedRoleId === 'string' ? r.matchedRoleId : typeof rg.matchedRoleId === 'string' ? rg.matchedRoleId : null;

  return {
    status,
    requiredGuild: {
      guildId,
      autoJoin,
      name: asNullableString(rg.name),
      inviteUrl: asNullableString(rg.inviteUrl),
    },
    matchedTier,
    matchedRoleId,
  };
}

