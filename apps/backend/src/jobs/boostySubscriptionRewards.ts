import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { BoostyApiClient } from '../utils/boostyApi.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { fetchDiscordGuildMember } from '../utils/discordApi.js';
import { normTierKey } from '../utils/tierKey.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function normBlogName(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

function normalizeTierRoles(raw: any): Array<{ tier: string; roleId: string }> {
  const items = Array.isArray(raw) ? raw : [];
  const out: Array<{ tier: string; roleId: string }> = [];
  for (const it of items) {
    const tier = String(it?.tier ?? '').trim();
    const roleId = String(it?.roleId ?? '').trim();
    if (!tier || !roleId) continue;
    out.push({ tier, roleId });
  }
  return out;
}

function pickMatchedTierRole(params: {
  memberRoles: string[];
  tierRoles: Array<{ tier: string; roleId: string }>;
}): { tier: string; roleId: string } | null {
  const roles = Array.isArray(params.memberRoles) ? params.memberRoles : [];
  for (const tr of params.tierRoles) {
    if (roles.includes(tr.roleId)) return tr;
  }
  return null;
}

function normalizeTierCoins(raw: any): Array<{ tierKey: string; coins: number }> {
  // Accept both:
  // - array: [{ tierKey, coins }, ...] (preferred)
  // - object: { [tierKey]: coins }
  // NOTE: This is a best-effort runtime normalizer (scheduler must be resilient to old/dirty DB configs).
  // The admin API validation (Zod) is the strict gate that rejects duplicates case-insensitively.
  const out: Array<{ tierKey: string; coins: number }> = [];
  const seen = new Set<string>();

  if (Array.isArray(raw)) {
    for (const it of raw) {
      const tierKey = normTierKey(it?.tierKey);
      const coins = Number(it?.coins);
      if (!tierKey) continue;
      if (!Number.isFinite(coins) || coins < 0) continue;
      if (seen.has(tierKey)) continue;
      seen.add(tierKey);
      out.push({ tierKey, coins: Math.floor(coins) });
    }
    return out;
  }

  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, any>)) {
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

function pickCoinsForTier(params: {
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

function computeBoostyTierDelta(params: {
  // Source of truth: from DB (do NOT recompute from current config)
  coinsGranted: number;
  // What Boosty currently reports for the subscription
  tierKeyCurrent: string | null;
  // What current channel config maps this tier to (or fallback)
  targetCoins: number;
  // Tier key stored in DB row (represents the tier we granted for)
  tierKeyGranted: string | null;
}): { delta: number; nextCoinsGranted: number; nextTierKeyGranted: string | null } {
  const tierKeyGranted = normTierKey(params.tierKeyGranted) || null;
  const tierKeyCurrent = normTierKey(params.tierKeyCurrent) || null;

  const coinsGranted = Number.isFinite(params.coinsGranted) ? Math.max(0, Math.floor(params.coinsGranted)) : 0;
  const targetCoins = Number.isFinite(params.targetCoins) ? Math.max(0, Math.floor(params.targetCoins)) : 0;

  // 1) fallback-only: Boosty didn't provide a tier key.
  // Allow only the FIRST payout; never invent a tier key.
  if (tierKeyCurrent === null) {
    const nextCoinsGranted = coinsGranted === 0 ? Math.max(coinsGranted, targetCoins) : coinsGranted;
    const delta = nextCoinsGranted - coinsGranted;
    return { delta, nextCoinsGranted, nextTierKeyGranted: null };
  }

  // 2) sameTier: hard stop (prevents retro-payments when config changes).
  if (tierKeyGranted !== null && tierKeyGranted === tierKeyCurrent) {
    return { delta: 0, nextCoinsGranted: coinsGranted, nextTierKeyGranted: null };
  }

  // 3) tier-change (or previously unknown tier): monotonic grant, never decrease.
  const nextCoinsGranted = Math.max(coinsGranted, targetCoins);
  const delta = nextCoinsGranted - coinsGranted;

  return {
    delta,
    nextCoinsGranted,
    // Keep boostyTierKey as "granted tier"; update it only when we actually grant extra coins.
    nextTierKeyGranted: delta > 0 ? tierKeyCurrent : null,
  };
}

// Test hook (no side effects)
export const __test__pickMatchedTierRole = pickMatchedTierRole;
export const __test__normalizeTierRoles = normalizeTierRoles;
export const __test__normalizeTierCoins = normalizeTierCoins;
export const __test__pickCoinsForTier = pickCoinsForTier;
export const __test__computeBoostyTierDelta = computeBoostyTierDelta;

export function startBoostySubscriptionRewardsScheduler(io: Server) {
  const intervalMsRaw = parseInt(String(process.env.BOOSTY_REWARDS_SYNC_INTERVAL_MS || ''), 10);
  const initialDelayMsRaw = parseInt(String(process.env.BOOSTY_REWARDS_SYNC_INITIAL_DELAY_MS || ''), 10);
  const limitRaw = parseInt(String(process.env.BOOSTY_REWARDS_SUBSCRIPTIONS_LIMIT || ''), 10);

  const baseUrl = String(process.env.BOOSTY_API_BASE_URL || 'https://api.boosty.to').trim();
  const effectiveInterval = clampInt(intervalMsRaw, 60_000, 24 * 60 * 60_000, 5 * 60_000);
  const effectiveInitialDelay = clampInt(initialDelayMsRaw, 0, 24 * 60 * 60_000, 60_000);
  const effectiveLimit = clampInt(limitRaw, 1, 500, 200);

  let running = false;

  const runOnce = async () => {
    if (running) return;
    running = true;

    // Ensure only one instance (prod or beta) processes rewards on shared DB.
    const lockId = 91224001n;
    const startedAt = Date.now();

    try {
      const locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;

      const mode = String(process.env.BOOSTY_REWARDS_MODE || 'boosty_api').trim().toLowerCase();

      let grants = 0;
      let usersChecked = 0;
      let channelsCount = 0;

      if (mode === 'discord_roles') {
        const defaultGuildId =
          String(process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID || '').trim() ||
          // Legacy fallback (pre-multi-guild)
          String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
        const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
        if (!botToken) {
          logger.warn('boosty.rewards.discord_roles.missing_env', {
            hasBotToken: Boolean(botToken),
          });
          return;
        } else {
          const channels = await prisma.channel.findMany({
            where: {
              boostyCoinsPerSub: { gt: 0 },
              OR: [{ boostyDiscordTierRolesJson: { not: null } }, { boostyDiscordRoleId: { not: null } }],
            } as any,
            select: {
              id: true,
              slug: true,
              boostyCoinsPerSub: true,
              boostyDiscordTierRolesJson: true,
              discordSubscriptionsGuildId: true,
              // Legacy column (exists in DB from initial rollout; keep fallback for old configs).
              boostyDiscordRoleId: true,
            } as any,
          });
          channelsCount = (channels as any[]).length;

          // Users link Discord once (providerAccountId = Discord user id).
          const discordAccounts = await (prisma as any).externalAccount.findMany({
            where: { provider: 'discord' },
            select: { userId: true, providerAccountId: true },
          });

          // Prepare channel configs once, grouped by guildId (so we can do 1 Discord member fetch per user per guild per run).
          const channelConfigs = (channels as any[])
            .map((ch) => {
              const coins = Number(ch.boostyCoinsPerSub || 0);
              const tierRoles = normalizeTierRoles(ch.boostyDiscordTierRolesJson);
              // Legacy fallback: if tierRoles is empty but old single-role column is set.
              if (tierRoles.length === 0) {
                const legacyRoleId = String(ch.boostyDiscordRoleId || '').trim();
                if (legacyRoleId) tierRoles.push({ tier: 'default', roleId: legacyRoleId });
              }
              const guildId = String(ch.discordSubscriptionsGuildId || '').trim() || defaultGuildId;
              return {
                id: String(ch.id),
                slug: String(ch.slug || '').toLowerCase(),
                coins,
                tierRoles,
                guildId,
              };
            })
            .filter((c) => Boolean(c.guildId) && Number.isFinite(c.coins) && c.coins > 0 && c.tierRoles.length > 0);
          if (channelConfigs.length === 0) {
            logger.warn('boosty.rewards.discord_roles.no_channels_configured', { channelsScanned: channelsCount, hasDefaultGuildId: Boolean(defaultGuildId) });
            return;
          }

          const byGuildId = new Map<string, Array<(typeof channelConfigs)[number]>>();
          for (const ch of channelConfigs) {
            const g = String((ch as any).guildId || '').trim();
            if (!g) continue;
            const arr = byGuildId.get(g) || [];
            arr.push(ch);
            byGuildId.set(g, arr);
          }

          for (const [guildId, channelsForGuild] of byGuildId.entries()) {
            for (const acc of discordAccounts as any[]) {
              const discordUserId = String(acc.providerAccountId || '').trim();
              if (!discordUserId) continue;

              usersChecked += 1;
              const member = await fetchDiscordGuildMember({ botToken, guildId, userId: discordUserId });
              const roles = member.member?.roles || [];
              if (!Array.isArray(roles) || roles.length === 0) continue;

              for (const ch of channelsForGuild) {
                const matched = pickMatchedTierRole({ memberRoles: roles, tierRoles: ch.tierRoles });
                if (!matched) continue;

                try {
                  const result = await prisma.$transaction(async (tx) => {
                    await (tx as any).boostyDiscordSubscriptionRewardV2.create({
                      data: {
                        channelId: ch.id,
                        userId: acc.userId,
                        discordRoleId: matched.roleId,
                        discordTier: matched.tier,
                        coinsGranted: ch.coins,
                      },
                    });

                    const wallet = await tx.wallet.upsert({
                      where: {
                        userId_channelId: {
                          userId: acc.userId,
                          channelId: ch.id,
                        },
                      },
                      update: {
                        balance: { increment: ch.coins },
                      },
                      create: {
                        userId: acc.userId,
                        channelId: ch.id,
                        balance: ch.coins,
                      },
                      select: { balance: true },
                    });

                    return wallet;
                  });

                  grants += 1;
                  emitWalletUpdated(io, {
                    userId: acc.userId,
                    channelId: ch.id,
                    balance: result.balance,
                    delta: ch.coins,
                    reason: 'boosty_subscription',
                    channelSlug: ch.slug || undefined,
                    source: 'local',
                  });
                  void relayWalletUpdatedToPeer({
                    userId: acc.userId,
                    channelId: ch.id,
                    balance: result.balance,
                    delta: ch.coins,
                    reason: 'boosty_subscription',
                    channelSlug: ch.slug || undefined,
                    source: 'local',
                  });
                } catch (e: any) {
                  // Dedup: unique constraint -> already granted.
                  const isUnique = e?.code === 'P2002' || String(e?.message || '').includes('Unique constraint failed');
                  if (!isUnique) {
                    logger.error('boosty.rewards.discord_roles.grant_failed', {
                      channelId: ch.id,
                      userId: acc.userId,
                      errorMessage: e?.message,
                      errorCode: e?.code,
                    });
                  }
                }
              }
            }
          }
        }
      } else {
        const channels = await prisma.channel.findMany({
          where: {
            boostyBlogName: { not: null },
            OR: [{ boostyCoinsPerSub: { gt: 0 } }, { boostyTierCoinsJson: { not: null } }],
          } as any,
          select: {
            id: true,
            slug: true,
            boostyBlogName: true,
            boostyCoinsPerSub: true,
            boostyTierCoinsJson: true,
          } as any,
        });
        channelsCount = (channels as any[]).length;

        for (const ch of channels as any[]) {
          const blogName = normBlogName(ch.boostyBlogName);
          const fallbackCoins = Number(ch.boostyCoinsPerSub || 0);
          const tierCoins = normalizeTierCoins((ch as any).boostyTierCoinsJson);
          if (!blogName) continue;
          const hasFallback = Number.isFinite(fallbackCoins) && fallbackCoins > 0;
          const hasTiers = tierCoins.some((t) => Number.isFinite(t.coins) && t.coins > 0);
          if (!hasFallback && !hasTiers) continue;

          const accounts = await (prisma as any).externalAccount.findMany({
            where: {
              provider: 'boosty',
              user: { channelId: ch.id },
            },
            select: {
              id: true,
              userId: true,
              accessToken: true,
            },
          });

          for (const acc of accounts as any[]) {
            const accessToken = String(acc.accessToken || '').trim();
            if (!accessToken) continue;

            usersChecked += 1;

            const client = new BoostyApiClient({
              baseUrl,
              auth: { accessToken },
            });

            let subs;
            try {
              subs = await client.getUserSubscriptions({ limit: effectiveLimit, withFollow: false });
            } catch (e: any) {
              logger.warn('boosty.rewards.fetch_subscriptions_failed', {
                channelId: ch.id,
                userId: acc.userId,
                errorMessage: e?.message,
                errorCode: e?.code,
                status: e?.status,
              });
              continue;
            }

            const matched = subs.find((s) => normBlogName(s.blogName) === blogName && s.isActive !== false);
            if (!matched) continue;

            const subscriptionId =
              String(matched.id || '').trim() ||
              BoostyApiClient.stableProviderAccountId(`${blogName}:${acc.userId}`); // best-effort fallback

            const tierKey = normTierKey((matched as any).tierKey) || null;
            const targetCoins = pickCoinsForTier({ tierKey, tierCoins, fallbackCoins });
            // Keep backwards-compatible behavior: if config leads to 0 coins, skip.
            if (!Number.isFinite(targetCoins) || targetCoins <= 0) continue;

            try {
              const result = await prisma.$transaction(async (tx) => {
                // Concurrency safety:
                // - We keep the instance-level advisory lock, but also lock the specific reward row.
                // - Delta is only paid when tierKey CHANGES (prevents "config coins increased" retro-payments).

                type LockedRewardRow = { id: string; coinsGranted: number; boostyTierKey: string | null } | null;

                const selectLocked = async (): Promise<LockedRewardRow> => {
                  const rows = await (tx as any).$queryRaw<
                    Array<{ id: string; coinsGranted: number; boostyTierKey: string | null }>
                  >`
                    SELECT "id", "coinsGranted", "boostyTierKey"
                    FROM "BoostySubscriptionReward"
                    WHERE "channelId" = ${String(ch.id)}
                      AND "userId" = ${String(acc.userId)}
                      AND "boostySubscriptionId" = ${String(subscriptionId)}
                    FOR UPDATE
                  `;
                  return rows?.[0] ?? null;
                };

                let locked = await selectLocked();
                if (!locked) {
                  try {
                    await (tx as any).boostySubscriptionReward.create({
                      data: {
                        channelId: ch.id,
                        userId: acc.userId,
                        boostyBlogName: blogName,
                        boostySubscriptionId: subscriptionId,
                        // IMPORTANT: initialize as "nothing granted yet"; grant happens below under row lock.
                        boostyTierKey: null,
                        coinsGranted: 0,
                      },
                    });
                    locked = await selectLocked();
                  } catch (e: any) {
                    // If another tx created it concurrently, fall back to locked read.
                    const isUnique = e?.code === 'P2002' || String(e?.message || '').includes('Unique constraint failed');
                    if (!isUnique) throw e;
                    locked = await selectLocked();
                  }
                }

                const granted = Number(locked?.coinsGranted || 0);
                const grantedTierKey = normTierKey(locked?.boostyTierKey) || null;
                const { delta, nextCoinsGranted, nextTierKeyGranted } = computeBoostyTierDelta({
                  coinsGranted: granted,
                  tierKeyCurrent: tierKey,
                  targetCoins,
                  tierKeyGranted: grantedTierKey,
                });

                // Keep row up-to-date for audit/debug.
                // IMPORTANT: boostyTierKey is the tier we granted for (not "last seen").
                if (locked?.id && delta > 0) {
                  await (tx as any).boostySubscriptionReward.update({
                    where: { id: locked.id },
                    data: {
                      ...(nextTierKeyGranted !== null ? { boostyTierKey: nextTierKeyGranted } : {}),
                      ...(nextCoinsGranted !== granted ? { coinsGranted: nextCoinsGranted } : {}),
                    },
                    select: { id: true },
                  });
                }

                if (delta <= 0) {
                  const walletNoChange = await tx.wallet.findUnique({
                    where: { userId_channelId: { userId: acc.userId, channelId: ch.id } },
                    select: { balance: true },
                  });
                  return { balance: walletNoChange?.balance ?? 0, delta: 0 };
                }

                const wallet = await tx.wallet.upsert({
                  where: {
                    userId_channelId: {
                      userId: acc.userId,
                      channelId: ch.id,
                    },
                  },
                  update: {
                    balance: { increment: delta },
                  },
                  create: {
                    userId: acc.userId,
                    channelId: ch.id,
                    balance: delta,
                  },
                  select: { balance: true },
                });

                return { balance: wallet.balance, delta };
              });

              if (result.delta > 0) {
                grants += 1;
                emitWalletUpdated(io, {
                  userId: acc.userId,
                  channelId: ch.id,
                  balance: result.balance,
                  delta: result.delta,
                  reason: 'boosty_subscription',
                  channelSlug: String(ch.slug || '').toLowerCase() || undefined,
                  source: 'local',
                });
                void relayWalletUpdatedToPeer({
                  userId: acc.userId,
                  channelId: ch.id,
                  balance: result.balance,
                  delta: result.delta,
                  reason: 'boosty_subscription',
                  channelSlug: String(ch.slug || '').toLowerCase() || undefined,
                  source: 'local',
                });
              }
            } catch (e: any) {
              // Dedup: unique constraint -> already granted.
              const isUnique = e?.code === 'P2002' || String(e?.message || '').includes('Unique constraint failed');
              if (!isUnique) {
                logger.error('boosty.rewards.grant_failed', {
                  channelId: ch.id,
                  userId: acc.userId,
                  errorMessage: e?.message,
                  errorCode: e?.code,
                });
              }
            }
          }
        }
      }

      logger.info('boosty.rewards.completed', {
        durationMs: Date.now() - startedAt,
        mode,
        channels: channelsCount,
        usersChecked,
        grants,
      });
    } catch (e: any) {
      logger.error('boosty.rewards.failed', {
        durationMs: Date.now() - startedAt,
        errorMessage: e?.message,
      });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), effectiveInitialDelay);
  setInterval(() => void runOnce(), effectiveInterval);
}


