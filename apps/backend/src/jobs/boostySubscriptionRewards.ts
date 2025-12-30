import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { BoostyApiClient } from '../utils/boostyApi.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function normBlogName(s: unknown): string {
  return String(s || '').trim().toLowerCase();
}

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

      let grants = 0;
      let usersChecked = 0;

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

      logger.info('boosty.rewards.completed', {
        durationMs: Date.now() - startedAt,
        channels: (channels as any[]).length,
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


