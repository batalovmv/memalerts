import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { BoostyApiClient } from '../utils/boostyApi.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { fetchDiscordGuildMember } from '../utils/discordApi.js';

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

// Test hook (no side effects)
export const __test__pickMatchedTierRole = pickMatchedTierRole;
export const __test__normalizeTierRoles = normalizeTierRoles;

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
        const guildId = String(process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID || '').trim();
        const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
        if (!guildId || !botToken) {
          logger.warn('boosty.rewards.discord_roles.missing_env', {
            hasGuildId: Boolean(guildId),
            hasBotToken: Boolean(botToken),
          });
        } else {
          const channels = await prisma.channel.findMany({
            where: {
              boostyCoinsPerSub: { gt: 0 },
              boostyDiscordTierRolesJson: { not: null },
            } as any,
            select: {
              id: true,
              slug: true,
              boostyCoinsPerSub: true,
              boostyDiscordTierRolesJson: true,
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

          // Prepare channel configs once (so we can do 1 Discord member fetch per user per run).
          const channelConfigs = (channels as any[])
            .map((ch) => {
              const coins = Number(ch.boostyCoinsPerSub || 0);
              const tierRoles = normalizeTierRoles(ch.boostyDiscordTierRolesJson);
              // Legacy fallback: if tierRoles is empty but old single-role column is set.
              if (tierRoles.length === 0) {
                const legacyRoleId = String(ch.boostyDiscordRoleId || '').trim();
                if (legacyRoleId) tierRoles.push({ tier: 'default', roleId: legacyRoleId });
              }
              return {
                id: String(ch.id),
                slug: String(ch.slug || '').toLowerCase(),
                coins,
                tierRoles,
              };
            })
            .filter((c) => Number.isFinite(c.coins) && c.coins > 0 && c.tierRoles.length > 0);

          for (const acc of discordAccounts as any[]) {
            const discordUserId = String(acc.providerAccountId || '').trim();
            if (!discordUserId) continue;

            usersChecked += 1;
            const member = await fetchDiscordGuildMember({ botToken, guildId, userId: discordUserId });
            const roles = member.member?.roles || [];
            if (!Array.isArray(roles) || roles.length === 0) continue;

            for (const ch of channelConfigs) {
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
      } else {
        const channels = await prisma.channel.findMany({
          where: {
            boostyCoinsPerSub: { gt: 0 },
            boostyBlogName: { not: null },
          } as any,
          select: {
            id: true,
            slug: true,
            boostyBlogName: true,
            boostyCoinsPerSub: true,
          } as any,
        });
        channelsCount = (channels as any[]).length;

        for (const ch of channels as any[]) {
          const blogName = normBlogName(ch.boostyBlogName);
          const coins = Number(ch.boostyCoinsPerSub || 0);
          if (!blogName || !Number.isFinite(coins) || coins <= 0) continue;

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

            try {
              const result = await prisma.$transaction(async (tx) => {
                await (tx as any).boostySubscriptionReward.create({
                  data: {
                    channelId: ch.id,
                    userId: acc.userId,
                    boostyBlogName: blogName,
                    boostySubscriptionId: subscriptionId,
                    coinsGranted: coins,
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
                    balance: { increment: coins },
                  },
                  create: {
                    userId: acc.userId,
                    channelId: ch.id,
                    balance: coins,
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
                delta: coins,
                reason: 'boosty_subscription',
                channelSlug: String(ch.slug || '').toLowerCase() || undefined,
                source: 'local',
              });
              void relayWalletUpdatedToPeer({
                userId: acc.userId,
                channelId: ch.id,
                balance: result.balance,
                delta: coins,
                reason: 'boosty_subscription',
                channelSlug: String(ch.slug || '').toLowerCase() || undefined,
                source: 'local',
              });
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


