import type { Server } from 'socket.io';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { BoostyApiClient } from '../utils/boostyApi.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { fetchDiscordGuildMember } from '../utils/discordApi.js';
import { WalletService } from '../services/WalletService.js';
import {
  clampInt,
  computeBoostyTierDelta,
  normBlogName,
  normalizeTierCoins,
  normalizeTierRoles,
  pickCoinsForTier,
  pickMatchedTierRole,
} from './boostySubscriptionRewardsHelpers.js';
import { normTierKey } from '../utils/tierKey.js';

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

      const mode = String(process.env.BOOSTY_REWARDS_MODE || 'boosty_api')
        .trim()
        .toLowerCase();

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
          const channelWhere: Prisma.ChannelWhereInput = {
            boostyCoinsPerSub: { gt: 0 },
            OR: [{ boostyDiscordTierRolesJson: { not: Prisma.DbNull } }, { boostyDiscordRoleId: { not: null } }],
          };
          const channels = await prisma.channel.findMany({
            where: channelWhere,
            select: {
              id: true,
              slug: true,
              boostyCoinsPerSub: true,
              boostyDiscordTierRolesJson: true,
              discordSubscriptionsGuildId: true,
              // Legacy column (exists in DB from initial rollout; keep fallback for old configs).
              boostyDiscordRoleId: true,
            },
          });
          channelsCount = channels.length;

          // Users link Discord once (providerAccountId = Discord user id).
          const discordAccounts = await prisma.externalAccount.findMany({
            where: { provider: 'discord' },
            select: { userId: true, providerAccountId: true },
          });

          // Prepare channel configs once, grouped by guildId (so we can do 1 Discord member fetch per user per guild per run).
          const channelConfigs = channels
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
            logger.warn('boosty.rewards.discord_roles.no_channels_configured', {
              channelsScanned: channelsCount,
              hasDefaultGuildId: Boolean(defaultGuildId),
            });
            return;
          }

          const byGuildId = new Map<string, Array<(typeof channelConfigs)[number]>>();
          for (const ch of channelConfigs) {
            const g = String(ch.guildId || '').trim();
            if (!g) continue;
            const arr = byGuildId.get(g) || [];
            arr.push(ch);
            byGuildId.set(g, arr);
          }

          for (const [guildId, channelsForGuild] of byGuildId.entries()) {
            for (const acc of discordAccounts) {
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
                    await tx.boostyDiscordSubscriptionRewardV2.create({
                      data: {
                        channelId: ch.id,
                        userId: acc.userId,
                        discordRoleId: matched.roleId,
                        discordTier: matched.tier,
                        coinsGranted: ch.coins,
                      },
                    });

                    const wallet = await WalletService.incrementBalance(
                      tx,
                      { userId: acc.userId, channelId: ch.id },
                      ch.coins
                    );

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
                } catch (e: unknown) {
                  // Dedup: unique constraint -> already granted.
                  const errorMessage = e instanceof Error ? e.message : String(e);
                  const errorCode =
                    typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : null;
                  const isUnique = errorCode === 'P2002' || errorMessage.includes('Unique constraint failed');
                  if (!isUnique) {
                    logger.error('boosty.rewards.discord_roles.grant_failed', {
                      channelId: ch.id,
                      userId: acc.userId,
                      errorMessage,
                      errorCode,
                    });
                  }
                }
              }
            }
          }
        }
      } else {
        const channelWhere: Prisma.ChannelWhereInput = {
          boostyBlogName: { not: null },
          OR: [{ boostyCoinsPerSub: { gt: 0 } }, { boostyTierCoinsJson: { not: Prisma.DbNull } }],
        };
        const channels = await prisma.channel.findMany({
          where: channelWhere,
          select: {
            id: true,
            slug: true,
            boostyBlogName: true,
            boostyCoinsPerSub: true,
            boostyTierCoinsJson: true,
          },
        });
        channelsCount = channels.length;

        for (const ch of channels) {
          const blogName = normBlogName(ch.boostyBlogName);
          const fallbackCoins = Number(ch.boostyCoinsPerSub || 0);
          const tierCoins = normalizeTierCoins(ch.boostyTierCoinsJson);
          if (!blogName) continue;
          const hasFallback = Number.isFinite(fallbackCoins) && fallbackCoins > 0;
          const hasTiers = tierCoins.some((t) => Number.isFinite(t.coins) && t.coins > 0);
          if (!hasFallback && !hasTiers) continue;

          const accounts = await prisma.externalAccount.findMany({
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

          for (const acc of accounts) {
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
            } catch (e: unknown) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              const errorCode =
                typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : null;
              const status =
                typeof e === 'object' && e !== null && 'status' in e ? (e as { status?: unknown }).status : null;
              logger.warn('boosty.rewards.fetch_subscriptions_failed', {
                channelId: ch.id,
                userId: acc.userId,
                errorMessage,
                errorCode,
                status,
              });
              continue;
            }

            const matched = subs.find((s) => normBlogName(s.blogName) === blogName && s.isActive !== false);
            if (!matched) continue;

            const subscriptionId =
              String(matched.id || '').trim() || BoostyApiClient.stableProviderAccountId(`${blogName}:${acc.userId}`); // best-effort fallback

            const tierKey = normTierKey(matched.tierKey) || null;
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
                  const rows = await tx.$queryRaw<
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
                    await tx.boostySubscriptionReward.create({
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
                  } catch (e: unknown) {
                    // If another tx created it concurrently, fall back to locked read.
                    const errorMessage = e instanceof Error ? e.message : String(e);
                    const errorCode =
                      typeof e === 'object' && e !== null && 'code' in e
                        ? String((e as { code?: unknown }).code)
                        : null;
                    const isUnique = errorCode === 'P2002' || errorMessage.includes('Unique constraint failed');
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
                  await tx.boostySubscriptionReward.update({
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

                const wallet = await WalletService.incrementBalance(
                  tx,
                  { userId: acc.userId, channelId: ch.id },
                  delta
                );

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
            } catch (e: unknown) {
              // Dedup: unique constraint -> already granted.
              const errorMessage = e instanceof Error ? e.message : String(e);
              const errorCode =
                typeof e === 'object' && e !== null && 'code' in e ? String((e as { code?: unknown }).code) : null;
              const isUnique = errorCode === 'P2002' || errorMessage.includes('Unique constraint failed');
              if (!isUnique) {
                logger.error('boosty.rewards.grant_failed', {
                  channelId: ch.id,
                  userId: acc.userId,
                  errorMessage,
                  errorCode,
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
    } catch (e: unknown) {
      const errorMessage = e instanceof Error ? e.message : String(e);
      logger.error('boosty.rewards.failed', {
        durationMs: Date.now() - startedAt,
        errorMessage,
      });
    } finally {
      await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), effectiveInitialDelay);
  setInterval(() => void runOnce(), effectiveInterval);
}
