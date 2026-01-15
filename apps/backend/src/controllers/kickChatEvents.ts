import type { Prisma } from '@prisma/client';
import type { Server } from 'socket.io';
import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot, getStreamSessionSnapshot } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { enqueueChatOutboxJob } from '../queues/chatOutboxQueue.js';
import { ingestCreditsChatter } from './internal/creditsInternal.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import type { WalletUpdatedEvent } from '../realtime/walletBridge.js';
import { TransactionEventBuffer } from '../utils/transactionEventBuffer.js';
import { logger } from '../utils/logger.js';
import {
  type ChatCommandRole,
  type KickWebhookRequest,
  asRecord,
  canTriggerCommand,
  emptyWalletEvents,
  errCode,
  normalizeAllowedRolesList,
  normalizeAllowedUsersList,
  normalizeLogin,
  normalizeMessage,
  parseAutoRewardsCfg,
  safeErrorMessage,
  safeString,
  utcDayKey,
  utcDayKeyYesterday,
  getKickEventRec,
} from './kickWebhookShared.js';

type TxClient = Prisma.TransactionClient;

function extractKickChatMessageSent(payload: unknown): {
  kickChannelId: string | null;
  platformUserId: string | null;
  login: string | null;
  displayName: string | null;
  text: string | null;
  avatarUrl: string | null;
  roles: Set<ChatCommandRole>;
} {
  const rootRec = asRecord(payload);
  const eventRec = getKickEventRec(payload);
  const channelRec = asRecord(eventRec.broadcaster ?? eventRec.channel ?? {});
  const kickChannelId =
    String(
      channelRec.user_id ?? channelRec.id ?? channelRec.channel_id ?? rootRec.channel_id ?? rootRec.broadcaster_user_id ?? ''
    ).trim() || null;

  const senderRec = asRecord(eventRec.sender ?? eventRec.user ?? eventRec.chatter ?? eventRec.author ?? {});
  const platformUserId =
    String(senderRec.user_id ?? senderRec.id ?? senderRec.userId ?? eventRec.user_id ?? eventRec.userId ?? '').trim() || null;
  const loginRaw = String(senderRec.username ?? senderRec.user_name ?? senderRec.login ?? senderRec.name ?? '').trim() || null;
  const displayName =
    String(
      senderRec.display_name ??
        senderRec.displayName ??
        senderRec.username ??
        senderRec.name ??
        senderRec.callingName ??
        ''
    ).trim() || null;
  const avatarUrl = String(senderRec.profile_image_url ?? senderRec.avatar_url ?? senderRec.avatarUrl ?? '').trim() || null;

  const msgRec = asRecord(eventRec.message ?? eventRec.chat_message ?? eventRec.chatMessage ?? eventRec.data ?? {});
  const text = normalizeMessage(msgRec.content ?? msgRec.message ?? msgRec.text ?? eventRec.content ?? eventRec.message ?? '');

  const roles = new Set<ChatCommandRole>();
  const identityRec = asRecord(senderRec.identity);
  const badgesRaw = Array.isArray(identityRec.badges)
    ? identityRec.badges
    : Array.isArray(senderRec.badges)
      ? senderRec.badges
      : Array.isArray(identityRec.roles)
        ? identityRec.roles
        : [];
  for (const badge of badgesRaw) {
    const badgeRec = asRecord(badge);
    const name = safeString(badgeRec.name ?? badgeRec.type ?? badgeRec.id ?? badge).toLowerCase();
    if (!name) continue;
    if (/mod|moderator|broadcaster|streamer/.test(name)) roles.add('moderator');
    if (name.includes('sub')) roles.add('subscriber');
    if (name.includes('vip')) roles.add('vip');
  }

  return {
    kickChannelId,
    platformUserId,
    login: loginRaw ? normalizeLogin(loginRaw) : null,
    displayName: displayName || loginRaw || platformUserId,
    text: text || null,
    avatarUrl,
    roles,
  };
}

export async function handleKickChatMessageSent(params: {
  req: KickWebhookRequest;
  payload: unknown;
  messageId: string;
}): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { req, payload, messageId } = params;
  const io = req.app?.get?.('io') as Server | undefined;
  const eventBuffer = new TransactionEventBuffer();
  let outcome!: {
    httpStatus: number;
    body: Record<string, unknown>;
    channelId: string | null;
    channelSlug: string | null;
    credits: { userId: string; displayName: string; avatarUrl: string | null } | null;
    claimedWalletEvents: WalletUpdatedEvent[];
  };
  try {
    const chat = extractKickChatMessageSent(payload);
    outcome = await prisma.$transaction(async (tx: TxClient) => {
      const enqueueWalletEvents = (events: WalletUpdatedEvent[]) => {
        if (!io) return;
        if (!events.length) return;
        for (const ev of events) {
          eventBuffer.add(() => {
            emitWalletUpdated(io, ev);
            void relayWalletUpdatedToPeer(ev);
          });
        }
      };
      // 1) Delivery-level idempotency (dedup by Kick-Event-Message-Id).
      try {
        await tx.externalWebhookDeliveryDedup.create({
          data: {
            provider: 'kick',
            messageId,
          },
          select: { id: true },
        });
      } catch (e: unknown) {
        if (errCode(e) === 'P2002') {
          return {
            httpStatus: 200,
            body: { ok: true, duplicate: true },
            channelId: null,
            channelSlug: null,
            credits: null,
            claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
          };
        }
        throw e;
      }

      if (!chat.kickChannelId || !chat.platformUserId || !chat.text) {
        return {
          httpStatus: 200,
          body: { ok: true, ignored: true, reason: 'missing_identity' },
          channelId: null,
          channelSlug: null,
          credits: null,
          claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
        };
      }

      // Map Kick channel -> MemAlerts Channel via KickChatBotSubscription (already configured by streamer).
      const sub = await tx.kickChatBotSubscription.findFirst({
        where: { kickChannelId: chat.kickChannelId, enabled: true },
        orderBy: { createdAt: 'desc' },
        select: { channelId: true, channel: { select: { slug: true } } },
      });
      const channelId = String(sub?.channelId ?? '').trim() || null;
      const channelSlug = String(sub?.channel?.slug ?? '').trim().toLowerCase() || null;
      if (!channelId || !channelSlug) {
        return {
          httpStatus: 200,
          body: { ok: true, ignored: true, reason: 'channel_not_mapped' },
          channelId: null,
          channelSlug: null,
          credits: null,
          claimedWalletEvents: emptyWalletEvents<WalletUpdatedEvent>(),
        };
      }

      const msgNorm = normalizeMessage(chat.text).toLowerCase();
      if (msgNorm) {
        const cmd = await tx.chatBotCommand.findFirst({
          where: { channelId, enabled: true, triggerNormalized: msgNorm },
          select: { response: true, onlyWhenLive: true, allowedUsers: true, allowedRoles: true },
        });
        const response = String(cmd?.response ?? '').trim();
        if (response) {
          const allowedUsers = normalizeAllowedUsersList(cmd?.allowedUsers);
          const allowedRoles = normalizeAllowedRolesList(cmd?.allowedRoles);
          const senderLogin = chat.login || '';

          if (
            canTriggerCommand({
              senderLogin,
              senderRoles: chat.roles,
              allowedUsers,
              allowedRoles,
            })
          ) {
            if (cmd?.onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(channelSlug);
              if (snap.status === 'online') {
                const outboxRow = await tx.kickChatBotOutboxMessage.create({
                  data: {
                    channelId,
                    kickChannelId: chat.kickChannelId,
                    message: response,
                    status: 'pending',
                  },
                  select: { id: true },
                });
                eventBuffer.add(() => void enqueueChatOutboxJob({ platform: 'kick', outboxId: outboxRow.id, channelId }));
              }
            } else {
              const outboxRow = await tx.kickChatBotOutboxMessage.create({
                data: {
                  channelId,
                  kickChannelId: chat.kickChannelId,
                  message: response,
                  status: 'pending',
                },
                select: { id: true },
              });
              eventBuffer.add(() => void enqueueChatOutboxJob({ platform: 'kick', outboxId: outboxRow.id, channelId }));
            }
          }
        }
      }

      const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
        provider: 'kick',
        platformUserId: chat.platformUserId,
      });
      const creditsUserId = memalertsUserId || `kick:${chat.platformUserId}`;

      // Auto rewards: chat activity (reuses Channel.twitchAutoRewardsJson.chat config).
      const claimedWalletEvents: WalletUpdatedEvent[] = [];
      try {
        const ch = await tx.channel.findUnique({
          where: { id: channelId },
          select: { id: true, twitchAutoRewardsJson: true },
        });
        const cfg = parseAutoRewardsCfg(ch?.twitchAutoRewardsJson);
        const chatCfg = cfg?.chat;
        if (chatCfg) {
          const redis = await getRedisClient();
          if (redis) {
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
              rawMeta: Record<string, unknown> | null;
            }) => {
              const coins = Number.isFinite(awardParams.coins) ? Math.floor(awardParams.coins) : 0;
              if (coins <= 0) return;
              await recordExternalRewardEventTx({
                tx,
                provider: 'kick',
                providerEventId: awardParams.providerEventId,
                channelId,
                providerAccountId: chat.platformUserId!,
                eventType: awardParams.eventType,
                currency: 'twitch_units',
                amount: awardParams.amount,
                coinsToGrant: coins,
                status: 'eligible',
                reason: null,
                eventAt: now,
                rawPayloadJson: JSON.stringify(awardParams.rawMeta ?? {}),
              });

              if (memalertsUserId) {
                const events = await claimPendingCoinGrantsTx({
                  tx,
                  userId: memalertsUserId,
                  provider: 'kick',
                  providerAccountId: chat.platformUserId!,
                });
                if (events.length) {
                  claimedWalletEvents.push(...events);
                  enqueueWalletEvents(events);
                }
              }
            };

            // Daily streak: award once per day on first chat message.
            const streakCfg = chatCfg.dailyStreak ?? null;
            if (streakCfg?.enabled) {
              const k = nsKey('kick_auto_rewards', `streak:${channelId}:${chat.platformUserId}`);
              const raw = await redis.get(k);
              let lastDate: string | null = null;
              let streak = 0;
              try {
                if (raw) {
                  const parsed = JSON.parse(raw);
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

                const coinsByStreak = streakCfg?.coinsByStreak ?? null;
                const coins =
                  coinsByStreak && typeof coinsByStreak === 'object'
                    ? Number(coinsByStreak[String(nextStreak)] ?? 0)
                    : Number(streakCfg?.coinsPerDay ?? 0);

                const providerEventId = stableProviderEventId({
                  provider: 'kick',
                  rawPayloadJson: '{}',
                  fallbackParts: ['chat_daily_streak', channelId, chat.platformUserId, day],
                });
                await award({
                  providerEventId,
                  eventType: 'twitch_chat_daily_streak',
                  amount: nextStreak,
                  coins,
                  rawMeta: {
                    kind: 'kick_chat_daily_streak',
                    channelSlug,
                    kickUserId: chat.platformUserId,
                    day,
                    streak: nextStreak,
                  },
                });
              }
            }

            // First message per stream: award once per user per stream session.
            const firstCfg = chatCfg.firstMessage ?? null;
            if (firstCfg?.enabled) {
              const onlyWhenLive = firstCfg.onlyWhenLive === undefined ? true : Boolean(firstCfg.onlyWhenLive);
              if (!onlyWhenLive || isOnline) {
                const sid = String(session.sessionId || '').trim();
                if (sid) {
                  const k = nsKey('kick_auto_rewards', `first:${channelId}:${sid}:${chat.platformUserId}`);
                  const ok = await redis.set(k, '1', { NX: true, EX: 48 * 60 * 60 });
                  if (ok === 'OK') {
                    const providerEventId = stableProviderEventId({
                      provider: 'kick',
                      rawPayloadJson: '{}',
                      fallbackParts: ['chat_first_message', channelId, sid, chat.platformUserId],
                    });
                    await award({
                      providerEventId,
                      eventType: 'twitch_chat_first_message',
                      amount: 1,
                      coins: Number(firstCfg.coins ?? 0),
                      rawMeta: {
                        kind: 'kick_chat_first_message',
                        channelSlug,
                        kickUserId: chat.platformUserId,
                        sessionId: sid,
                      },
                    });
                  }
                }
              }
            }

            // Message count thresholds per stream.
            const thrCfg = chatCfg.messageThresholds ?? null;
            if (thrCfg?.enabled) {
              const onlyWhenLive = thrCfg.onlyWhenLive === undefined ? true : Boolean(thrCfg.onlyWhenLive);
              if (!onlyWhenLive || isOnline) {
                const sid = String(session.sessionId || '').trim();
                if (sid) {
                  const kCount = nsKey('kick_auto_rewards', `msgcount:${channelId}:${sid}:${chat.platformUserId}`);
                  const n = await redis.incr(kCount);
                  if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

                  const thresholds = Array.isArray(thrCfg.thresholds) ? thrCfg.thresholds : [];
                  const hit = thresholds.some((t) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
                  if (hit) {
                    const coinsByThreshold = thrCfg.coinsByThreshold ?? null;
                    const coins = Number(coinsByThreshold?.[String(n)] ?? 0);
                    const providerEventId = stableProviderEventId({
                      provider: 'kick',
                      rawPayloadJson: '{}',
                      fallbackParts: ['chat_messages_threshold', channelId, sid, chat.platformUserId, String(n)],
                    });
                    await award({
                      providerEventId,
                      eventType: 'twitch_chat_messages_threshold',
                      amount: n,
                      coins,
                      rawMeta: {
                        kind: 'kick_chat_messages_threshold',
                        channelSlug,
                        kickUserId: chat.platformUserId,
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
      } catch (e: unknown) {
        // Never fail chat commands / credits because of auto rewards.
        logger.warn('kick.webhook.auto_rewards_failed', { errorMessage: safeErrorMessage(e) });
      }

      const credits = {
        userId: creditsUserId,
        displayName: chat.displayName || creditsUserId,
        avatarUrl: chat.avatarUrl ?? null,
      };
      if (channelSlug) {
        eventBuffer.add(async () => {
          try {
            await ingestCreditsChatter({
              io,
              channelSlug,
              userId: credits.userId,
              displayName: credits.displayName,
              avatarUrl: credits.avatarUrl,
            });
          } catch (e: unknown) {
            logger.warn('kick.webhook.credits_ingest_failed', { errorMessage: safeErrorMessage(e) });
          }
        });
      }

      return {
        httpStatus: 200,
        body: { ok: true },
        channelId,
        channelSlug,
        credits,
        claimedWalletEvents,
      };
    });
    eventBuffer.commit();
  } finally {
    await eventBuffer.flush();
  }

  return { httpStatus: outcome.httpStatus, body: outcome.body };
}
