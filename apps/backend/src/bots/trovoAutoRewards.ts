import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot, getStreamSessionSnapshot } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { logger } from '../utils/logger.js';
import {
  asArray,
  asRecord,
  getErrorMessage,
  readTierCoins,
  safeNum,
  utcDayKey,
  utcDayKeyYesterday,
  type TrovoChannelState,
} from './trovoChatbotShared.js';
type AutoRewardsCache = Map<string, { ts: number; cfg: unknown | null }>;
export function createTrovoAutoRewards(params?: { autoRewardsCacheMs?: number }) {
  const autoRewardsByChannelId: AutoRewardsCache = new Map();
  const AUTO_REWARDS_CACHE_MS = params?.autoRewardsCacheMs ?? 60_000;
  async function getAutoRewardsConfig(channelId: string): Promise<unknown | null> {
    const id = String(channelId || '').trim();
    if (!id) return null;
    const now = Date.now();
    const cached = autoRewardsByChannelId.get(id);
    if (cached && now - cached.ts < AUTO_REWARDS_CACHE_MS) return cached.cfg ?? null;
    try {
      const ch = await prisma.channel.findUnique({ where: { id }, select: { twitchAutoRewardsJson: true } });
      const cfg = (ch as { twitchAutoRewardsJson?: unknown } | null)?.twitchAutoRewardsJson ?? null;
      autoRewardsByChannelId.set(id, { ts: now, cfg });
      return cfg ?? null;
    } catch {
      autoRewardsByChannelId.set(id, { ts: now, cfg: null });
      return null;
    }
  }

  const handleAutoRewards = async (params: {
    st: TrovoChannelState;
    envelope: unknown;
    chat: unknown;
  }): Promise<{ skipCommands: boolean }> => {
    const chatRec = asRecord(params.chat);
    const chatType = Number.isFinite(Number(chatRec.type)) ? Number(chatRec.type) : null;

    try {
      const cfg = await getAutoRewardsConfig(params.st.channelId);
      if (cfg && typeof cfg === 'object') {
        const channelCfg = asRecord(cfg);
        const eventAt = (() => {
          const ts = chatRec.send_time ?? chatRec.sendTime ?? chatRec.timestamp ?? null;
          const n = Number(ts);
          if (Number.isFinite(n)) return new Date(n < 1e12 ? n * 1000 : n);
          const parsed = Date.parse(String(ts || ''));
          return Number.isFinite(parsed) ? new Date(parsed) : new Date();
        })();

        const providerAccountId = String(chatRec.uid ?? chatRec.sender_id ?? '').trim() || null;
        const envelopeRec = asRecord(params.envelope);
        const envelopeData = asRecord(envelopeRec.data);
        const eventEid = String(envelopeData.eid ?? chatRec.eid ?? chatRec.id ?? chatRec.msg_id ?? '').trim();

        const recordAndMaybeClaim = async (recordParams: {
          providerEventId: string;
          providerAccountId: string;
          eventType:
            | 'twitch_follow'
            | 'twitch_subscribe'
            | 'twitch_resub_message'
            | 'twitch_gift_sub'
            | 'twitch_raid'
            | 'twitch_chat_first_message'
            | 'twitch_chat_messages_threshold'
            | 'twitch_chat_daily_streak';
          currency: 'twitch_units';
          amount: number;
          coinsToGrant: number;
          status: 'eligible' | 'ignored';
          reason?: string | null;
          rawMeta: unknown;
        }) => {
          const coins = Number.isFinite(recordParams.coinsToGrant) ? Math.floor(recordParams.coinsToGrant) : 0;
          await prisma.$transaction(async (tx: Parameters<typeof recordExternalRewardEventTx>[0]['tx']) => {
            await recordExternalRewardEventTx({
              tx,
              provider: 'trovo',
              providerEventId: recordParams.providerEventId,
              channelId: params.st.channelId,
              providerAccountId: recordParams.providerAccountId,
              eventType: recordParams.eventType,
              currency: recordParams.currency,
              amount: recordParams.amount,
              coinsToGrant: coins,
              status: recordParams.status,
              reason: recordParams.reason ?? null,
              eventAt,
              rawPayloadJson: JSON.stringify(recordParams.rawMeta ?? {}),
            });

            const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({
              provider: 'trovo',
              platformUserId: recordParams.providerAccountId,
            });
            if (linkedUserId && recordParams.status === 'eligible' && coins > 0) {
              await claimPendingCoinGrantsTx({
                tx,
                userId: linkedUserId,
                provider: 'trovo',
                providerAccountId: recordParams.providerAccountId,
              });
            }
          });
        };

        if (chatType === 5003 && providerAccountId) {
          const rule = asRecord(channelCfg.follow);
          const enabled = Boolean(rule.enabled);
          const coins = Math.floor(safeNum(rule.coins ?? 0));
          const onceEver = rule.onceEver === undefined ? true : Boolean(rule.onceEver);
          const onlyWhenLive = Boolean(rule.onlyWhenLive);

          if (!enabled || coins <= 0) {
            await recordAndMaybeClaim({
              providerEventId: onceEver
                ? stableProviderEventId({
                    provider: 'trovo',
                    rawPayloadJson: '{}',
                    fallbackParts: ['follow', params.st.channelId, providerAccountId],
                  })
                : `${eventEid}:follow`,
              providerAccountId,
              eventType: 'twitch_follow',
              currency: 'twitch_units',
              amount: 1,
              coinsToGrant: 0,
              status: 'ignored',
              reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
              rawMeta: { kind: 'trovo_follow', channelSlug: params.st.slug, trovoUserId: providerAccountId },
            });
          } else {
            if (onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(params.st.slug);
              if (snap.status !== 'online') {
                await recordAndMaybeClaim({
                  providerEventId: onceEver
                    ? stableProviderEventId({
                        provider: 'trovo',
                        rawPayloadJson: '{}',
                        fallbackParts: ['follow', params.st.channelId, providerAccountId],
                      })
                    : `${eventEid}:follow`,
                  providerAccountId,
                  eventType: 'twitch_follow',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: 0,
                  status: 'ignored',
                  reason: 'offline',
                  rawMeta: { kind: 'trovo_follow', channelSlug: params.st.slug, trovoUserId: providerAccountId },
                });
              } else {
                await recordAndMaybeClaim({
                  providerEventId: onceEver
                    ? stableProviderEventId({
                        provider: 'trovo',
                        rawPayloadJson: '{}',
                        fallbackParts: ['follow', params.st.channelId, providerAccountId],
                      })
                    : `${eventEid}:follow`,
                  providerAccountId,
                  eventType: 'twitch_follow',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: coins,
                  status: 'eligible',
                  reason: null,
                  rawMeta: { kind: 'trovo_follow', channelSlug: params.st.slug, trovoUserId: providerAccountId },
                });
              }
            } else {
              await recordAndMaybeClaim({
                providerEventId: onceEver
                  ? stableProviderEventId({
                      provider: 'trovo',
                      rawPayloadJson: '{}',
                      fallbackParts: ['follow', params.st.channelId, providerAccountId],
                    })
                  : `${eventEid}:follow`,
                providerAccountId,
                eventType: 'twitch_follow',
                currency: 'twitch_units',
                amount: 1,
                coinsToGrant: coins,
                status: 'eligible',
                reason: null,
                rawMeta: { kind: 'trovo_follow', channelSlug: params.st.slug, trovoUserId: providerAccountId },
              });
            }
          }
          return { skipCommands: true };
        }

        if (chatType === 5001 && providerAccountId) {
          const rule = asRecord(channelCfg.subscribe);
          if (rule.enabled) {
            const onlyWhenLive = Boolean(rule.onlyWhenLive);
            if (!onlyWhenLive || (await getStreamDurationSnapshot(params.st.slug)).status === 'online') {
              const tier = String(chatRec.sub_lv ?? chatRec.sub_tier ?? chatRec.tier ?? '1000').trim() || '1000';
              const coins = readTierCoins(rule.tierCoins, tier);
              if (coins > 0) {
                await recordAndMaybeClaim({
                  providerEventId: `${eventEid}:sub`,
                  providerAccountId,
                  eventType: 'twitch_subscribe',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: coins,
                  status: 'eligible',
                  reason: null,
                  rawMeta: { kind: 'trovo_subscribe', channelSlug: params.st.slug, trovoUserId: providerAccountId, tier },
                });
              }
            }
          }
          return { skipCommands: true };
        }

        if ((chatType === 5005 || chatType === 5006) && providerAccountId) {
          const rule = asRecord(channelCfg.giftSub);
          if (rule.enabled) {
            const onlyWhenLive = Boolean(rule.onlyWhenLive);
            if (!onlyWhenLive || (await getStreamDurationSnapshot(params.st.slug)).status === 'online') {
              let count = 1;
              try {
                const parsed = JSON.parse(String(chatRec.content ?? '')) as unknown;
                const parsedRec = asRecord(parsed);
                const num = parsedRec.num ?? parsedRec.count ?? parsedRec.total ?? null;
                if (Number.isFinite(Number(num))) count = Math.max(1, Math.floor(Number(num)));
              } catch {
                // ignore
              }

              const tier = String(chatRec.sub_lv ?? chatRec.sub_tier ?? chatRec.tier ?? '1000').trim() || '1000';
              const giverCoinsPerOne = readTierCoins(rule.giverTierCoins, tier);
              const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * count : 0;
              const recipientCoins = Math.floor(safeNum(rule.recipientCoins ?? 0));

              if (giverCoins > 0) {
                await recordAndMaybeClaim({
                  providerEventId: `${eventEid}:gift_giver`,
                  providerAccountId,
                  eventType: 'twitch_gift_sub',
                  currency: 'twitch_units',
                  amount: count,
                  coinsToGrant: giverCoins,
                  status: 'eligible',
                  reason: null,
                  rawMeta: {
                    kind: 'trovo_gift_sub_giver',
                    channelSlug: params.st.slug,
                    trovoUserId: providerAccountId,
                    tier,
                    count,
                  },
                });
              }

              const contentData = asRecord(chatRec.content_data ?? chatRec.contentData);
              const recArr = asArray(contentData.users);
              for (const u of recArr) {
                const userRec = asRecord(u);
                const rid = String(userRec.uid ?? userRec.id ?? '').trim();
                if (!rid) continue;
                await recordAndMaybeClaim({
                  providerEventId: `${eventEid}:gift_recipient:${rid}`,
                  providerAccountId: rid,
                  eventType: 'twitch_gift_sub',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: recipientCoins,
                  status: 'eligible',
                  reason: null,
                  rawMeta: { kind: 'trovo_gift_sub_recipient', channelSlug: params.st.slug, trovoUserId: rid },
                });
              }
            }
          }
          return { skipCommands: true };
        }

        if (chatType === 5008 && providerAccountId) {
          const rule = asRecord(channelCfg.raid);
          if (rule.enabled) {
            const onlyWhenLive = Boolean(rule.onlyWhenLive);
            if (!onlyWhenLive || (await getStreamDurationSnapshot(params.st.slug)).status === 'online') {
              const baseCoins = Math.floor(safeNum(rule.baseCoins ?? 0));
              const perViewer = Math.floor(safeNum(rule.coinsPerViewer ?? 0));
              const viewers = Math.max(0, Math.floor(safeNum(chatRec.viewer_count ?? chatRec.viewers ?? 0)));
              const minViewers = Math.floor(safeNum(rule.minViewers ?? 0));
              if (minViewers <= 0 || viewers >= minViewers) {
                const coins = baseCoins + Math.max(0, perViewer) * viewers;
                if (coins > 0) {
                  await recordAndMaybeClaim({
                    providerEventId: `${eventEid}:raid`,
                    providerAccountId,
                    eventType: 'twitch_raid',
                    currency: 'twitch_units',
                    amount: viewers,
                    coinsToGrant: coins,
                    status: 'eligible',
                    reason: null,
                    rawMeta: { kind: 'trovo_raid', channelSlug: params.st.slug, trovoUserId: providerAccountId, viewers },
                  });
                }
              }
            }
          }
          return { skipCommands: true };
        }

        if (chatType === 0 && providerAccountId) {
          const chatCfgRaw = channelCfg.chat;
          if (chatCfgRaw && typeof chatCfgRaw === 'object') {
            const chatCfg = asRecord(chatCfgRaw);
            const redis = await getRedisClient();
            if (redis) {
              const now = new Date();
              const day = utcDayKey(now);
              const yesterday = utcDayKeyYesterday(now);
              const session = await getStreamSessionSnapshot(params.st.slug);
              const isOnline = session.status === 'online' && !!session.sessionId;

              const award = async (awardParams: {
                providerEventId: string;
                eventType:
                  | 'twitch_chat_first_message'
                  | 'twitch_chat_messages_threshold'
                  | 'twitch_chat_daily_streak';
                amount: number;
                coins: number;
                rawMeta: unknown;
              }) => {
                const coins = Number.isFinite(awardParams.coins) ? Math.floor(awardParams.coins) : 0;
                if (coins <= 0) return;
                await recordAndMaybeClaim({
                  providerEventId: awardParams.providerEventId,
                  providerAccountId,
                  eventType: awardParams.eventType,
                  currency: 'twitch_units',
                  amount: awardParams.amount,
                  coinsToGrant: coins,
                  status: 'eligible',
                  reason: null,
                  rawMeta: awardParams.rawMeta,
                });
              };

              const streakCfg = asRecord(chatCfg.dailyStreak);
              if (streakCfg.enabled) {
                const k = nsKey('trovo_auto_rewards', `streak:${params.st.channelId}:${providerAccountId}`);
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
                  await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), {
                    EX: 90 * 24 * 60 * 60,
                  });

                  const coinsByStreak = streakCfg.coinsByStreak ?? null;
                  const coins =
                    coinsByStreak && typeof coinsByStreak === 'object'
                      ? Number(asRecord(coinsByStreak)[String(nextStreak)] ?? 0)
                      : Number(streakCfg.coinsPerDay ?? 0);

                  const providerEventId = stableProviderEventId({
                    provider: 'trovo',
                    rawPayloadJson: '{}',
                    fallbackParts: ['chat_daily_streak', params.st.channelId, providerAccountId, day],
                  });
                  await award({
                    providerEventId,
                    eventType: 'twitch_chat_daily_streak',
                    amount: nextStreak,
                    coins,
                    rawMeta: {
                      kind: 'trovo_chat_daily_streak',
                      channelSlug: params.st.slug,
                      trovoUserId: providerAccountId,
                      day,
                      streak: nextStreak,
                    },
                  });
                }
              }

              const firstCfg = asRecord(chatCfg.firstMessage);
              if (firstCfg.enabled) {
                const onlyWhenLive = firstCfg.onlyWhenLive === undefined ? true : Boolean(firstCfg.onlyWhenLive);
                if (!onlyWhenLive || isOnline) {
                  const sid = String(session.sessionId || '').trim();
                  if (sid) {
                    const k = nsKey('trovo_auto_rewards', `first:${params.st.channelId}:${sid}:${providerAccountId}`);
                    const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
                    if (ok === 'OK') {
                      const providerEventId = stableProviderEventId({
                        provider: 'trovo',
                        rawPayloadJson: '{}',
                        fallbackParts: ['chat_first_message', params.st.channelId, sid, providerAccountId],
                      });
                      await award({
                        providerEventId,
                        eventType: 'twitch_chat_first_message',
                        amount: 1,
                        coins: Number(firstCfg.coins ?? 0),
                        rawMeta: {
                          kind: 'trovo_chat_first_message',
                          channelSlug: params.st.slug,
                          trovoUserId: providerAccountId,
                          sessionId: sid,
                        },
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
                    const kCount = nsKey(
                      'trovo_auto_rewards',
                      `msgcount:${params.st.channelId}:${sid}:${providerAccountId}`
                    );
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
                        provider: 'trovo',
                        rawPayloadJson: '{}',
                        fallbackParts: ['chat_messages_threshold', params.st.channelId, sid, providerAccountId, String(n)],
                      });
                      await award({
                        providerEventId,
                        eventType: 'twitch_chat_messages_threshold',
                        amount: n,
                        coins,
                        rawMeta: {
                          kind: 'trovo_chat_messages_threshold',
                          channelSlug: params.st.slug,
                          trovoUserId: providerAccountId,
                          sessionId: sid,
                          count: n,
                        },
                      });
                    }
                  }
                }
              }
            }
          }
        }
      }
    } catch (e: unknown) {
      logger.warn('trovo_chatbot.auto_rewards_failed', {
        channelId: params.st.channelId,
        errorMessage: getErrorMessage(e),
      });
    }

    return { skipCommands: false };
  };

  return { handleAutoRewards };
}
