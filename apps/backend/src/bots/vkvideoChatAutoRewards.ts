import { prisma } from '../lib/prisma.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { logger } from '../utils/logger.js';
import { asArray, asRecord, getErrorMessage, utcDayKey, utcDayKeyYesterday } from './vkvideoChatbotShared.js';

type RewardTx = Parameters<typeof recordExternalRewardEventTx>[0]['tx'];

type IncomingChat = {
  text: string;
  userId: string;
  displayName: string;
  senderLogin: string | null;
};

type ChatAutoRewardsParams = {
  channelId: string;
  channelSlug: string;
  vkvideoChannelId: string;
  streamId: string | null;
  incoming: IncomingChat;
  memalertsUserId: string | null;
  autoRewardsCfg: unknown | null;
};

export async function handleVkvideoChatAutoRewards(params: ChatAutoRewardsParams): Promise<void> {
  try {
    const cfg = params.autoRewardsCfg ?? null;
    const cfgRec = cfg && typeof cfg === 'object' ? asRecord(cfg) : {};
    const chatCfgRaw = cfgRec.chat ?? null;
    if (!chatCfgRaw || typeof chatCfgRaw !== 'object') return;
    const chatCfg = asRecord(chatCfgRaw);

    const redis = await getRedisClient();
    const now = new Date();
    const day = utcDayKey(now);
    const yesterday = utcDayKeyYesterday(now);

    const streamId = params.streamId || null;
    const isOnline = Boolean(streamId);

    const award = async (awardParams: {
      providerEventId: string;
      eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
      amount: number;
      coins: number;
      rawMeta: unknown;
    }) => {
      const coins = Number.isFinite(awardParams.coins) ? Math.floor(awardParams.coins) : 0;
      if (coins <= 0) return;

      const linkedUserId = params.memalertsUserId || null;
      await prisma.$transaction(async (tx: RewardTx) => {
        await recordExternalRewardEventTx({
          tx,
          provider: 'vkvideo',
          providerEventId: awardParams.providerEventId,
          channelId: params.channelId,
          providerAccountId: params.incoming.userId,
          eventType: awardParams.eventType,
          currency: 'twitch_units',
          amount: awardParams.amount,
          coinsToGrant: coins,
          status: 'eligible',
          reason: null,
          eventAt: now,
          rawPayloadJson: JSON.stringify(awardParams.rawMeta ?? {}),
        });

        // If user already linked, claim immediately (no realtime emit here; runner is out-of-process).
        if (linkedUserId) {
          await claimPendingCoinGrantsTx({
            tx,
            userId: linkedUserId,
            provider: 'vkvideo',
            providerAccountId: params.incoming.userId,
          });
        }
      });
    };

    // Daily streak: award once per day on first chat message.
    const streakCfg = asRecord(chatCfg.dailyStreak);
    if (streakCfg.enabled) {
      // Prefer Redis for cross-restart stability; fallback to DB-only dedupe with "best-effort streak=1".
      let nextStreak = 1;
      if (redis) {
        const k = nsKey('vkvideo_auto_rewards', `streak:${params.channelId}:${params.incoming.userId}`);
        const raw = await redis.get(k);
        let lastDate: string | null = null;
        let streak = 0;
        try {
          if (raw) {
            const parsed = JSON.parse(raw) as unknown;
            const parsedRec = asRecord(parsed);
            lastDate = typeof parsedRec.lastDate === 'string' ? parsedRec.lastDate : null;
            streak = Number.isFinite(Number(parsedRec.streak)) ? Math.floor(Number(parsedRec.streak)) : 0;
          }
        } catch {
          lastDate = null;
          streak = 0;
        }

        if (lastDate !== day) {
          nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
          await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });
        } else {
          nextStreak = 0; // already handled today
        }
      } else {
        // No redis: we can still award once per day using providerEventId dedupe, but streak can't be tracked reliably.
        nextStreak = 1;
      }

      if (nextStreak > 0) {
        const coinsByStreak = streakCfg.coinsByStreak ?? null;
        const coins =
          coinsByStreak && typeof coinsByStreak === 'object'
            ? Number(asRecord(coinsByStreak)[String(nextStreak)] ?? 0)
            : Number(streakCfg.coinsPerDay ?? 0);
        const providerEventId = stableProviderEventId({
          provider: 'vkvideo',
          rawPayloadJson: '{}',
          fallbackParts: ['chat_daily_streak', params.channelId, params.incoming.userId, day],
        });
        await award({
          providerEventId,
          eventType: 'twitch_chat_daily_streak',
          amount: nextStreak,
          coins,
          rawMeta: {
            kind: 'vkvideo_chat_daily_streak',
            channelSlug: params.channelSlug,
            vkvideoUserId: params.incoming.userId,
            day,
            streak: nextStreak,
          },
        });
      }
    }

    // First message per stream: award once per user per stream session.
    const firstCfg = asRecord(chatCfg.firstMessage);
    if (firstCfg.enabled) {
      const onlyWhenLive = firstCfg.onlyWhenLive === undefined ? true : Boolean(firstCfg.onlyWhenLive);
      if (!onlyWhenLive || isOnline) {
        const sid = String(streamId || '').trim();
        if (sid) {
          if (redis) {
            const k = nsKey('vkvideo_auto_rewards', `first:${params.channelId}:${sid}:${params.incoming.userId}`);
            const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
            if (ok === 'OK') {
              const providerEventId = stableProviderEventId({
                provider: 'vkvideo',
                rawPayloadJson: '{}',
                fallbackParts: ['chat_first_message', params.channelId, sid, params.incoming.userId],
              });
              await award({
                providerEventId,
                eventType: 'twitch_chat_first_message',
                amount: 1,
                coins: Number(firstCfg.coins ?? 0),
                rawMeta: {
                  kind: 'vkvideo_chat_first_message',
                  channelSlug: params.channelSlug,
                  vkvideoUserId: params.incoming.userId,
                  streamId: sid,
                },
              });
            }
          } else {
            // Without Redis we skip (too spammy without dedupe across restarts).
          }
        }
      }
    }

    // Message count thresholds per stream.
    const thrCfg = asRecord(chatCfg.messageThresholds);
    if (thrCfg.enabled) {
      const onlyWhenLive = thrCfg.onlyWhenLive === undefined ? true : Boolean(thrCfg.onlyWhenLive);
      if (!onlyWhenLive || isOnline) {
        const sid = String(streamId || '').trim();
        if (sid && redis) {
          const kCount = nsKey('vkvideo_auto_rewards', `msgcount:${params.channelId}:${sid}:${params.incoming.userId}`);
          const n = await redis.incr(kCount);
          if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

          const thresholds = asArray(thrCfg.thresholds);
          const hit = thresholds.some((t) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
          if (hit) {
            const coinsByThreshold = thrCfg.coinsByThreshold ?? null;
            const coins =
              coinsByThreshold && typeof coinsByThreshold === 'object'
                ? Number(asRecord(coinsByThreshold)[String(n)] ?? 0)
                : 0;
            const providerEventId = stableProviderEventId({
              provider: 'vkvideo',
              rawPayloadJson: '{}',
              fallbackParts: ['chat_messages_threshold', params.channelId, sid, params.incoming.userId, String(n)],
            });
            await award({
              providerEventId,
              eventType: 'twitch_chat_messages_threshold',
              amount: n,
              coins,
              rawMeta: {
                kind: 'vkvideo_chat_messages_threshold',
                channelSlug: params.channelSlug,
                vkvideoUserId: params.incoming.userId,
                streamId: sid,
                count: n,
              },
            });
          }
        }
      }
    }
  } catch (e: unknown) {
    // Never fail credits/commands flow because of auto rewards.
    logger.warn('vkvideo_chatbot.auto_rewards_failed', { errorMessage: getErrorMessage(e) });
  }
}
