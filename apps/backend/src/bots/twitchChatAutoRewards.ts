import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { getStreamSessionSnapshot } from '../realtime/streamDurationStore.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { logger } from '../utils/logger.js';
import { asArray, asRecord, getErrorMessage, utcDayKey, utcDayKeyYesterday } from './chatbotSharedUtils.js';

type RewardTx = Parameters<typeof recordExternalRewardEventTx>[0]['tx'];

const autoRewardsCache = new Map<string, { v: unknown; ts: number }>(); // channelId -> twitchAutoRewardsJson
const AUTO_REWARDS_CACHE_MS = 60_000;

async function getTwitchAutoRewardsConfig(channelId: string): Promise<unknown | null> {
  const id = String(channelId || '').trim();
  if (!id) return null;
  const now = Date.now();
  const cached = autoRewardsCache.get(id);
  if (cached && now - cached.ts < AUTO_REWARDS_CACHE_MS) return cached.v ?? null;
  try {
    const ch = await prisma.channel.findUnique({ where: { id }, select: { twitchAutoRewardsJson: true } });
    const v = (ch as { twitchAutoRewardsJson?: unknown } | null)?.twitchAutoRewardsJson ?? null;
    autoRewardsCache.set(id, { v, ts: now });
    return v;
  } catch {
    autoRewardsCache.set(id, { v: null, ts: now });
    return null;
  }
}

export async function handleTwitchChatAutoRewards(params: {
  io: Server;
  channelId: string;
  channelSlug: string;
  twitchUserId: string;
  memalertsUserId: string | null;
}): Promise<void> {
  const { io, channelId, channelSlug, twitchUserId, memalertsUserId } = params;
  try {
    const cfg = await getTwitchAutoRewardsConfig(channelId);
    if (!cfg || typeof cfg !== 'object') return;

    const chatCfgRaw = asRecord(cfg).chat;
    if (!chatCfgRaw || typeof chatCfgRaw !== 'object') return;
    const chatCfg = asRecord(chatCfgRaw);

    const redis = await getRedisClient();
    if (!redis) return;

    const now = new Date();
    const day = utcDayKey(now);
    const yesterday = utcDayKeyYesterday(now);

    const session = await getStreamSessionSnapshot(channelSlug);
    const isOnline = session.status === 'online' && !!session.sessionId;

    const award = async (awardParams: {
      providerEventId: string;
      eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
      amount: number;
      coins: number;
    }) => {
      const coins = Number.isFinite(awardParams.coins) ? Math.floor(awardParams.coins) : 0;
      if (coins <= 0) return;

      const claimed = await prisma.$transaction(async (tx: RewardTx) => {
        await recordExternalRewardEventTx({
          tx,
          provider: 'twitch',
          providerEventId: awardParams.providerEventId,
          channelId,
          providerAccountId: twitchUserId,
          eventType: awardParams.eventType,
          currency: 'twitch_units',
          amount: awardParams.amount,
          coinsToGrant: coins,
          status: 'eligible',
          reason: null,
          eventAt: new Date(),
          rawPayloadJson: JSON.stringify({
            kind: awardParams.eventType,
            channelSlug,
            twitchUserId,
            day,
            sessionId: session.sessionId ?? null,
          }),
        });

        if (memalertsUserId) {
          return await claimPendingCoinGrantsTx({
            tx,
            userId: memalertsUserId,
            provider: 'twitch',
            providerAccountId: twitchUserId,
          });
        }
        return [];
      });

      if (claimed.length) {
        for (const ev of claimed) {
          emitWalletUpdated(io, ev);
          void relayWalletUpdatedToPeer(ev);
        }
      }
    };

    const streakCfg = asRecord(chatCfg.dailyStreak);
    if (streakCfg.enabled) {
      const k = nsKey('twitch_auto_rewards', `streak:${channelId}:${twitchUserId}`);
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
        const nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
        await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });

        const coinsByStreak = streakCfg.coinsByStreak ?? null;
        const coins =
          coinsByStreak && typeof coinsByStreak === 'object'
            ? Number(asRecord(coinsByStreak)[String(nextStreak)] ?? 0)
            : Number(streakCfg.coinsPerDay ?? 0);

        const providerEventId = stableProviderEventId({
          provider: 'twitch',
          rawPayloadJson: '{}',
          fallbackParts: ['chat_daily_streak', channelId, twitchUserId, day],
        });
        await award({ providerEventId, eventType: 'twitch_chat_daily_streak', amount: nextStreak, coins });
      }
    }

    const firstCfg = asRecord(chatCfg.firstMessage);
    if (firstCfg.enabled) {
      const onlyWhenLive = firstCfg.onlyWhenLive === undefined ? true : Boolean(firstCfg.onlyWhenLive);
      if (!onlyWhenLive || isOnline) {
        const sid = String(session.sessionId || '').trim();
        if (sid) {
          const k = nsKey('twitch_auto_rewards', `first:${channelId}:${sid}:${twitchUserId}`);
          const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
          if (ok === 'OK') {
            const providerEventId = stableProviderEventId({
              provider: 'twitch',
              rawPayloadJson: '{}',
              fallbackParts: ['chat_first_message', channelId, sid, twitchUserId],
            });
            await award({
              providerEventId,
              eventType: 'twitch_chat_first_message',
              amount: 1,
              coins: Number(firstCfg.coins ?? 0),
            });
          }
        }
      }
    }

    const thrCfg = asRecord(chatCfg.messageThresholds);
    if (thrCfg.enabled) {
      const onlyWhenLive = thrCfg.onlyWhenLive === undefined ? true : Boolean(thrCfg.onlyWhenLive);
      if (!onlyWhenLive || isOnline) {
        const sid = String(session.sessionId || '').trim();
        if (sid) {
          const kCount = nsKey('twitch_auto_rewards', `msgcount:${channelId}:${sid}:${twitchUserId}`);
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
              provider: 'twitch',
              rawPayloadJson: '{}',
              fallbackParts: ['chat_messages_threshold', channelId, sid, twitchUserId, String(n)],
            });
            await award({ providerEventId, eventType: 'twitch_chat_messages_threshold', amount: n, coins });
          }
        }
      }
    }
  } catch (e: unknown) {
    logger.warn('chatbot.auto_rewards_failed', { errorMessage: getErrorMessage(e) });
  }
}
