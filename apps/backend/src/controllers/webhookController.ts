import { Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import crypto from 'crypto';
import {
  twitchCheerEventSchema,
  twitchFollowEventSchema,
  twitchRaidEventSchema,
  twitchRedemptionEventSchema,
  twitchSubscribeEventSchema,
  twitchSubscriptionGiftEventSchema,
  twitchSubscriptionMessageEventSchema,
} from '../shared/schemas.js';
import { markCreditsSessionOffline, startOrResumeCreditsSession } from '../realtime/creditsSessionStore.js';
import { getStreamDurationSnapshot, handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';

// Prisma typings may lag behind during staged deployments/migrations; use a local escape hatch.
const prismaAny = prisma as any;

function safeNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function readTierCoins(map: any, tierKey: string): number {
  const key = String(tierKey || '').trim();
  if (!key || !map || typeof map !== 'object') return 0;
  const v = safeNum((map as any)[key]);
  return v > 0 ? Math.floor(v) : 0;
}

function parseEventSubTimestampToMs(raw: string): number | null {
  const s = String(raw || '').trim();
  if (!s) return null;
  // Some implementations send epoch ms as string; accept it.
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  // Twitch docs use RFC3339/ISO8601 timestamps like "2025-01-01T00:00:00Z".
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function safeEqual(a: string, b: string): boolean {
  // Constant-time compare to avoid leaking signature info.
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export const webhookController = {
  handleEventSub: async (req: Request, res: Response) => {
    // Handle challenge verification
    if (req.body.subscription && req.body.subscription.status === 'webhook_callback_verification_pending') {
      const challenge = req.body.challenge;
      return res.status(200).send(challenge);
    }

    // Verify HMAC signature
    const messageId = req.headers['twitch-eventsub-message-id'] as string;
    const messageTimestamp = req.headers['twitch-eventsub-message-timestamp'] as string;
    const messageSignature = req.headers['twitch-eventsub-message-signature'] as string;

    if (!messageId || !messageTimestamp || !messageSignature) {
      return res.status(403).json({ error: 'Missing signature headers' });
    }

    // Twitch signs the raw request body bytes. Prefer captured rawBody; fallback to JSON.stringify for safety.
    const rawBody =
      (req as any)?.rawBody && Buffer.isBuffer((req as any).rawBody)
        ? ((req as any).rawBody as Buffer).toString('utf8')
        : JSON.stringify(req.body);
    const hmacMessage = messageId + messageTimestamp + rawBody;
    const hmac = crypto
      .createHmac('sha256', process.env.TWITCH_EVENTSUB_SECRET!)
      .update(hmacMessage)
      .digest('hex');
    const expectedSignature = 'sha256=' + hmac;

    if (!safeEqual(messageSignature, expectedSignature)) {
      return res.status(403).json({ error: 'Invalid signature' });
    }

    // Check timestamp (should be within 10 minutes)
    const timestamp = parseEventSubTimestampToMs(messageTimestamp);
    if (!timestamp) {
      return res.status(403).json({ error: 'Invalid timestamp' });
    }
    const now = Date.now();
    if (Math.abs(now - timestamp) > 10 * 60 * 1000) {
      return res.status(403).json({ error: 'Request too old' });
    }

    const subscriptionType = String(req.body?.subscription?.type || '').trim();

    async function recordAndMaybeClaim(params: {
      channelId: string;
      providerEventId: string;
      providerAccountId: string;
      eventType:
        | 'twitch_follow'
        | 'twitch_subscribe'
        | 'twitch_resub_message'
        | 'twitch_gift_sub'
        | 'twitch_cheer'
        | 'twitch_raid'
        | 'twitch_channel_points_redemption'
        | 'twitch_chat_first_message'
        | 'twitch_chat_messages_threshold'
        | 'twitch_chat_daily_streak';
      currency: 'twitch_channel_points' | 'twitch_bits' | 'twitch_units';
      amount: number;
      coinsToGrant: number;
      status: 'observed' | 'eligible' | 'ignored' | 'failed';
      reason?: string | null;
      eventAt?: Date | null;
      linkedUserId?: string | null;
    }): Promise<{ createdPending: boolean; claimedWalletEvents: any[] }> {
      const linkedUserId = String(params.linkedUserId || '').trim() || null;
      const claimedWalletEvents: any[] = [];
      const r = await prisma.$transaction(async (tx) => {
        const rec = await recordExternalRewardEventTx({
          tx: tx as any,
          provider: 'twitch',
          providerEventId: params.providerEventId,
          channelId: params.channelId,
          providerAccountId: params.providerAccountId,
          eventType: params.eventType,
          currency: params.currency,
          amount: params.amount,
          coinsToGrant: params.coinsToGrant,
          status: params.status,
          reason: params.reason ?? null,
          eventAt: params.eventAt ?? null,
          rawPayloadJson: rawBody,
        });

        if (linkedUserId && params.status === 'eligible' && params.coinsToGrant > 0) {
          const events = await claimPendingCoinGrantsTx({
            tx: tx as any,
            userId: linkedUserId,
            provider: 'twitch',
            providerAccountId: params.providerAccountId,
          });
          if (events.length) claimedWalletEvents.push(...events);
        }

        return rec;
      });

      return { createdPending: Boolean((r as any)?.createdPending), claimedWalletEvents };
    }

    // Handle redemption event
    if (req.body.subscription?.type === 'channel.channel_points_custom_reward_redemption.add') {
      try {
        const event = twitchRedemptionEventSchema.parse(req.body.event);

        // Find channel by broadcaster_user_id
        const channel = await prismaAny.channel.findUnique({
          where: { twitchChannelId: event.broadcaster_user_id },
          // Perf: avoid loading channel.users (unused here); keep payload minimal.
          select: {
            id: true,
            slug: true,
            rewardIdForCoins: true,
            coinPerPointRatio: true,
            rewardOnlyWhenLive: true,
            twitchAutoRewardsJson: true,
          },
        });

        if (!channel) {
          return res.status(200).json({ message: 'Channel not found, ignoring' });
        }

        const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
        const byRewardIdCoins = safeNum((cfg as any)?.channelPoints?.byRewardId?.[event.reward.id]);
        const ruleEnabled = Boolean((cfg as any)?.channelPoints?.enabled);
        const mappedCoins = Number.isFinite(byRewardIdCoins) && byRewardIdCoins > 0 ? Math.floor(byRewardIdCoins) : 0;

        const legacyEnabled = Boolean((channel as any)?.rewardIdForCoins && (channel as any)?.rewardIdForCoins === event.reward.id);
        const legacyCoins = legacyEnabled ? Math.floor(event.reward.cost * safeNum((channel as any)?.coinPerPointRatio ?? 1)) : 0;

        // Prefer auto-rewards mapping when explicitly enabled; fall back to legacy single reward mapping.
        const coinsGranted = ruleEnabled ? mappedCoins : legacyCoins;
        const shouldCheckLive =
          (cfg as any)?.channelPoints?.onlyWhenLive !== undefined ? Boolean((cfg as any)?.channelPoints?.onlyWhenLive) : Boolean((channel as any)?.rewardOnlyWhenLive);

        if (coinsGranted > 0) {
          // Optional restriction: grant coins only when stream is online.
          if (shouldCheckLive) {
            const snap = await getStreamDurationSnapshot(String(channel.slug || '').toLowerCase());
            if (snap.status !== 'online') {
              await recordAndMaybeClaim({
                channelId: channel.id,
                providerEventId: String(event.id),
                providerAccountId: String(event.user_id),
                eventType: 'twitch_channel_points_redemption',
                currency: 'twitch_channel_points',
                amount: event.reward.cost,
                coinsToGrant: 0,
                status: 'ignored',
                reason: 'offline',
                eventAt: new Date(event.redeemed_at),
              });
              return res.status(200).json({ message: 'Redemption skipped (offline)', errorCode: 'REWARD_DISABLED_OFFLINE' });
            }
          }

          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: event.user_id });
          const outcome = await recordAndMaybeClaim({
            channelId: channel.id,
            providerEventId: String(event.id),
            providerAccountId: String(event.user_id),
            eventType: 'twitch_channel_points_redemption',
            currency: 'twitch_channel_points',
            amount: event.reward.cost,
            coinsToGrant: coinsGranted,
            status: 'eligible',
            reason: null,
            eventAt: new Date(event.redeemed_at),
            linkedUserId,
          });

          // Optional: keep Redemption table for linked users only (stats/debug).
          if (linkedUserId) {
            try {
              await prisma.redemption.create({
                data: {
                  channelId: channel.id,
                  userId: linkedUserId,
                  twitchRedemptionId: event.id,
                  pointsSpent: event.reward.cost,
                  coinsGranted,
                  status: 'completed',
                },
                select: { id: true },
              });
            } catch {
              // ignore (dedup or table missing in older envs)
            }
          }

          // Emit wallet updates (if any) AFTER commit.
          if (outcome.claimedWalletEvents.length) {
            try {
              const io = req.app.get('io');
              for (const ev of outcome.claimedWalletEvents) {
                emitWalletUpdated(io, ev);
                void relayWalletUpdatedToPeer(ev);
              }
            } catch {
              // ignore
            }
          }
        }

        return res.status(200).json({ message: 'Redemption processed' });
      } catch (error) {
        console.error('Error processing redemption:', error);
        return res.status(500).json({ error: 'Internal server error' });
      }
    }

    // Follow greetings (EventSub: channel.follow)
    if (req.body.subscription?.type === 'channel.follow') {
      try {
        const event = twitchFollowEventSchema.parse(req.body.event);

        // Find channel
        const channel = await prismaAny.channel.findUnique({
          where: { twitchChannelId: event.broadcaster_user_id },
          select: { id: true, followGreetingsEnabled: true, followGreetingTemplate: true, twitchAutoRewardsJson: true, slug: true },
        });
        if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });

        // Twitch auto rewards: Follow (one-time by default).
        try {
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.follow ?? null;
          const enabled = Boolean(rule?.enabled);
          const coins = Math.floor(safeNum(rule?.coins ?? 0));
          const onceEver = rule?.onceEver === undefined ? true : Boolean(rule?.onceEver);
          const onlyWhenLive = Boolean(rule?.onlyWhenLive);

          if (enabled && coins > 0) {
            if (onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
              if (snap.status !== 'online') {
                // Still record event for analytics/dedup, but do not award.
                await recordAndMaybeClaim({
                  channelId: channel.id,
                  providerEventId: onceEver
                    ? stableProviderEventId({ provider: 'twitch', rawPayloadJson: '{}', fallbackParts: ['follow', channel.id, event.user_id] })
                    : `${messageId}:follow`,
                  providerAccountId: event.user_id,
                  eventType: 'twitch_follow',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: 0,
                  status: 'ignored',
                  reason: 'offline',
                  eventAt: new Date(event.followed_at),
                });
              } else {
                const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: event.user_id });
                const outcome = await recordAndMaybeClaim({
                  channelId: channel.id,
                  providerEventId: onceEver
                    ? stableProviderEventId({ provider: 'twitch', rawPayloadJson: '{}', fallbackParts: ['follow', channel.id, event.user_id] })
                    : `${messageId}:follow`,
                  providerAccountId: event.user_id,
                  eventType: 'twitch_follow',
                  currency: 'twitch_units',
                  amount: 1,
                  coinsToGrant: coins,
                  status: 'eligible',
                  reason: null,
                  eventAt: new Date(event.followed_at),
                  linkedUserId,
                });
                if (outcome.claimedWalletEvents.length) {
                  try {
                    const io = req.app.get('io');
                    for (const ev of outcome.claimedWalletEvents) {
                      emitWalletUpdated(io, ev);
                      void relayWalletUpdatedToPeer(ev);
                    }
                  } catch {
                    // ignore
                  }
                }
              }
            } else {
              const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: event.user_id });
              const outcome = await recordAndMaybeClaim({
                channelId: channel.id,
                providerEventId: onceEver
                  ? stableProviderEventId({ provider: 'twitch', rawPayloadJson: '{}', fallbackParts: ['follow', channel.id, event.user_id] })
                  : `${messageId}:follow`,
                providerAccountId: event.user_id,
                eventType: 'twitch_follow',
                currency: 'twitch_units',
                amount: 1,
                coinsToGrant: coins,
                status: 'eligible',
                reason: null,
                eventAt: new Date(event.followed_at),
                linkedUserId,
              });
              if (outcome.claimedWalletEvents.length) {
                try {
                  const io = req.app.get('io');
                  for (const ev of outcome.claimedWalletEvents) {
                    emitWalletUpdated(io, ev);
                    void relayWalletUpdatedToPeer(ev);
                  }
                } catch {
                  // ignore
                }
              }
            }
          }
        } catch {
          // ignore auto-rewards failures (follow greeting must still work)
        }

        if (!channel.followGreetingsEnabled) return res.status(200).json({ message: 'Follow greetings disabled' });

        // Dedupe by EventSub message id (unique per event delivery; Twitch retries keep the same id).
        try {
          await prisma.chatBotEventDedup.create({
            data: { channelId: channel.id, kind: 'follow', eventId: messageId },
            select: { id: true },
          });
        } catch (e: any) {
          if (e?.code === 'P2002') {
            return res.status(200).json({ message: 'Duplicate follow ignored' });
          }
          throw e;
        }

        const sub = await prisma.chatBotSubscription.findUnique({
          where: { channelId: channel.id },
          select: { enabled: true, twitchLogin: true },
        });
        if (!sub?.enabled || !sub.twitchLogin) {
          return res.status(200).json({ message: 'Bot not enabled for channel, ignoring' });
        }

        const template = String(channel.followGreetingTemplate || 'Спасибо за фоллоу, {user}!').trim();
        const msg = template.replace(/\{user\}/g, event.user_name);
        if (!msg) return res.status(200).json({ message: 'Empty greeting, ignoring' });

        await prisma.chatBotOutboxMessage.create({
          data: { channelId: channel.id, twitchLogin: sub.twitchLogin, message: msg, status: 'pending' },
          select: { id: true },
        });

        return res.status(200).json({ message: 'Follow greeting enqueued' });
      } catch (error) {
        console.error('Error processing follow event:', error);
        return res.status(200).json({ message: 'Follow event error (ignored)' });
      }
    }

    // Twitch auto rewards: Subs / resub messages / gifts / bits / raids.
    // These are independent from follow greetings and do not require the chat bot.
    if (
      subscriptionType === 'channel.subscribe' ||
      subscriptionType === 'channel.subscription.message' ||
      subscriptionType === 'channel.subscription.gift' ||
      subscriptionType === 'channel.cheer' ||
      subscriptionType === 'channel.raid'
    ) {
      try {
        const eventAt = new Date();

        const findChannel = async (broadcasterId: string) => {
          return await prismaAny.channel.findUnique({
            where: { twitchChannelId: broadcasterId },
            select: { id: true, slug: true, twitchAutoRewardsJson: true },
          });
        };

        if (subscriptionType === 'channel.subscribe') {
          const ev = twitchSubscribeEventSchema.parse(req.body.event);
          const channel = await findChannel(ev.broadcaster_user_id);
          if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.subscribe ?? null;
          if (!rule?.enabled) return res.status(200).json({ message: 'Auto rewards disabled' });

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
            if (snap.status !== 'online') return res.status(200).json({ message: 'Auto reward skipped (offline)' });
          }

          const isPrime = Boolean((ev as any)?.is_prime);
          const tier = String((ev as any)?.tier || '').trim() || '1000';
          const tierCoins = readTierCoins((rule as any)?.tierCoins, tier);
          const primeCoins = Math.floor(safeNum((rule as any)?.primeCoins ?? 0));
          const coins = isPrime ? primeCoins || tierCoins : tierCoins;
          if (coins <= 0) return res.status(200).json({ message: 'Auto reward skipped (0 coins)' });

          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: ev.user_id });
          const outcome = await recordAndMaybeClaim({
            channelId: channel.id,
            providerEventId: `${messageId}:sub`,
            providerAccountId: ev.user_id,
            eventType: 'twitch_subscribe',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt,
            linkedUserId,
          });

          if (outcome.claimedWalletEvents.length) {
            try {
              const io = req.app.get('io');
              for (const e of outcome.claimedWalletEvents) {
                emitWalletUpdated(io, e);
                void relayWalletUpdatedToPeer(e);
              }
            } catch {
              // ignore
            }
          }

          return res.status(200).json({ message: 'Auto reward processed' });
        }

        if (subscriptionType === 'channel.subscription.message') {
          const ev = twitchSubscriptionMessageEventSchema.parse(req.body.event);
          const channel = await findChannel(ev.broadcaster_user_id);
          if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.resubMessage ?? null;
          if (!rule?.enabled) return res.status(200).json({ message: 'Auto rewards disabled' });

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
            if (snap.status !== 'online') return res.status(200).json({ message: 'Auto reward skipped (offline)' });
          }

          const tier = String((ev as any)?.tier || '').trim() || '1000';
          const tierCoins = readTierCoins((rule as any)?.tierCoins, tier);
          const primeCoins = Math.floor(safeNum((rule as any)?.primeCoins ?? 0));
          const bonus = Math.floor(safeNum((rule as any)?.bonusCoins ?? 0));
          const coins = (primeCoins || tierCoins) + (bonus > 0 ? bonus : 0);
          if (coins <= 0) return res.status(200).json({ message: 'Auto reward skipped (0 coins)' });

          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: ev.user_id });
          const outcome = await recordAndMaybeClaim({
            channelId: channel.id,
            providerEventId: `${messageId}:resub_msg`,
            providerAccountId: ev.user_id,
            eventType: 'twitch_resub_message',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt,
            linkedUserId,
          });

          if (outcome.claimedWalletEvents.length) {
            try {
              const io = req.app.get('io');
              for (const e of outcome.claimedWalletEvents) {
                emitWalletUpdated(io, e);
                void relayWalletUpdatedToPeer(e);
              }
            } catch {
              // ignore
            }
          }

          return res.status(200).json({ message: 'Auto reward processed' });
        }

        if (subscriptionType === 'channel.subscription.gift') {
          const ev = twitchSubscriptionGiftEventSchema.parse(req.body.event);
          const channel = await findChannel(ev.broadcaster_user_id);
          if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.giftSub ?? null;
          if (!rule?.enabled) return res.status(200).json({ message: 'Auto rewards disabled' });

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
            if (snap.status !== 'online') return res.status(200).json({ message: 'Auto reward skipped (offline)' });
          }

          const tier = String((ev as any)?.tier || '').trim() || '1000';
          const total = Math.max(1, Math.floor(safeNum((ev as any)?.total ?? 1)));
          const giverCoinsPerOne = readTierCoins((rule as any)?.giverTierCoins, tier);
          const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * total : 0;
          const recipientCoins = Math.floor(safeNum((rule as any)?.recipientCoins ?? 0));

          const claimedEvents: any[] = [];

          const giverId = String((ev as any)?.user_id || '').trim();
          if (giverId && giverCoins > 0) {
            const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: giverId });
            const o = await recordAndMaybeClaim({
              channelId: channel.id,
              providerEventId: `${messageId}:gift_giver`,
              providerAccountId: giverId,
              eventType: 'twitch_gift_sub',
              currency: 'twitch_units',
              amount: total,
              coinsToGrant: giverCoins,
              status: 'eligible',
              reason: null,
              eventAt,
              linkedUserId,
            });
            if (o.claimedWalletEvents.length) claimedEvents.push(...o.claimedWalletEvents);
          }

          const recipientId = String((ev as any)?.recipient_user_id || '').trim();
          if (recipientId && recipientCoins > 0) {
            const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: recipientId });
            const o = await recordAndMaybeClaim({
              channelId: channel.id,
              providerEventId: `${messageId}:gift_recipient:${recipientId}`,
              providerAccountId: recipientId,
              eventType: 'twitch_gift_sub',
              currency: 'twitch_units',
              amount: 1,
              coinsToGrant: recipientCoins,
              status: 'eligible',
              reason: null,
              eventAt,
              linkedUserId,
            });
            if (o.claimedWalletEvents.length) claimedEvents.push(...o.claimedWalletEvents);
          }

          if (claimedEvents.length) {
            try {
              const io = req.app.get('io');
              for (const e of claimedEvents) {
                emitWalletUpdated(io, e);
                void relayWalletUpdatedToPeer(e);
              }
            } catch {
              // ignore
            }
          }

          return res.status(200).json({ message: 'Auto reward processed' });
        }

        if (subscriptionType === 'channel.cheer') {
          const ev = twitchCheerEventSchema.parse(req.body.event);
          const channel = await findChannel(ev.broadcaster_user_id);
          if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.cheer ?? null;
          if (!rule?.enabled) return res.status(200).json({ message: 'Auto rewards disabled' });

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
            if (snap.status !== 'online') return res.status(200).json({ message: 'Auto reward skipped (offline)' });
          }

          const userId = String((ev as any)?.user_id || '').trim();
          const bits = Math.max(0, Math.floor(safeNum((ev as any)?.bits ?? 0)));
          if (!userId || bits <= 0) return res.status(200).json({ message: 'Auto reward skipped' });

          const minBits = Math.max(1, Math.floor(safeNum((rule as any)?.minBits ?? 1)));
          if (bits < minBits) return res.status(200).json({ message: 'Auto reward skipped (below minBits)' });

          const bitsPerCoin = Math.max(1, Math.floor(safeNum((rule as any)?.bitsPerCoin ?? 1)));
          const coins = Math.floor(bits / bitsPerCoin);
          if (coins <= 0) return res.status(200).json({ message: 'Auto reward skipped (0 coins)' });

          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: userId });
          const outcome = await recordAndMaybeClaim({
            channelId: channel.id,
            providerEventId: `${messageId}:cheer`,
            providerAccountId: userId,
            eventType: 'twitch_cheer',
            currency: 'twitch_bits',
            amount: bits,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt,
            linkedUserId,
          });

          if (outcome.claimedWalletEvents.length) {
            try {
              const io = req.app.get('io');
              for (const e of outcome.claimedWalletEvents) {
                emitWalletUpdated(io, e);
                void relayWalletUpdatedToPeer(e);
              }
            } catch {
              // ignore
            }
          }

          return res.status(200).json({ message: 'Auto reward processed' });
        }

        if (subscriptionType === 'channel.raid') {
          const ev = twitchRaidEventSchema.parse(req.body.event);
          const channel = await findChannel(ev.to_broadcaster_user_id);
          if (!channel) return res.status(200).json({ message: 'Channel not found, ignoring' });
          const cfg = (channel as any)?.twitchAutoRewardsJson ?? null;
          const rule = (cfg as any)?.raid ?? null;
          if (!rule?.enabled) return res.status(200).json({ message: 'Auto rewards disabled' });

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(String((channel as any)?.slug || '').toLowerCase());
            if (snap.status !== 'online') return res.status(200).json({ message: 'Auto reward skipped (offline)' });
          }

          const raiderId = String((ev as any)?.from_broadcaster_user_id || '').trim();
          const viewers = Math.max(0, Math.floor(safeNum((ev as any)?.viewer_count ?? 0)));
          if (!raiderId) return res.status(200).json({ message: 'Auto reward skipped' });

          const baseCoins = Math.floor(safeNum((rule as any)?.baseCoins ?? 0));
          const perViewer = Math.floor(safeNum((rule as any)?.coinsPerViewer ?? 0));
          const minViewers = Math.floor(safeNum((rule as any)?.minViewers ?? 0));
          if (minViewers > 0 && viewers < minViewers) return res.status(200).json({ message: 'Auto reward skipped (minViewers)' });
          const coins = baseCoins + Math.max(0, perViewer) * viewers;
          if (coins <= 0) return res.status(200).json({ message: 'Auto reward skipped (0 coins)' });

          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'twitch', platformUserId: raiderId });
          const outcome = await recordAndMaybeClaim({
            channelId: channel.id,
            providerEventId: `${messageId}:raid`,
            providerAccountId: raiderId,
            eventType: 'twitch_raid',
            currency: 'twitch_units',
            amount: viewers,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
            eventAt,
            linkedUserId,
          });

          if (outcome.claimedWalletEvents.length) {
            try {
              const io = req.app.get('io');
              for (const e of outcome.claimedWalletEvents) {
                emitWalletUpdated(io, e);
                void relayWalletUpdatedToPeer(e);
              }
            } catch {
              // ignore
            }
          }

          return res.status(200).json({ message: 'Auto reward processed' });
        }
      } catch (error) {
        console.error('Error processing twitch auto reward event:', error);
        return res.status(200).json({ message: 'Auto reward error (ignored)' });
      }
    }

    // Credits session boundaries (used for chatters/donors persistence with reconnect window).
    if (req.body.subscription?.type === 'stream.online' || req.body.subscription?.type === 'stream.offline') {
      try {
        const broadcasterId = String(req.body?.event?.broadcaster_user_id || '').trim();
        if (!broadcasterId) {
          return res.status(200).json({ message: 'No broadcaster id, ignoring' });
        }

        const channel = await prisma.channel.findUnique({
          where: { twitchChannelId: broadcasterId },
          select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true },
        });
        const slug = String((channel as any)?.slug || '').toLowerCase();
        if (!slug) {
          return res.status(200).json({ message: 'Channel not found, ignoring' });
        }
        const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
          ? Number((channel as any).creditsReconnectWindowMinutes)
          : 60;

        if (req.body.subscription.type === 'stream.online') {
          await startOrResumeCreditsSession(slug, windowMin);
          // Stream duration "smart command" state (pause credit is per-channel setting).
          let breakCreditMinutes = 60;
          try {
            const raw = String((channel as any)?.streamDurationCommandJson || '').trim();
            if (raw) {
              const parsed = JSON.parse(raw);
              const v = Number((parsed as any)?.breakCreditMinutes);
              if (Number.isFinite(v)) breakCreditMinutes = v;
            }
          } catch {
            // ignore invalid JSON
          }
          await handleStreamOnline(slug, breakCreditMinutes);
        } else {
          await markCreditsSessionOffline(slug, windowMin);
          await handleStreamOffline(slug);
        }

        return res.status(200).json({ message: 'Stream session processed' });
      } catch (error) {
        console.error('Error processing stream session event:', error);
        return res.status(200).json({ message: 'Stream session error (ignored)' });
      }
    }

    res.status(200).json({ message: 'Event received' });
  },
};


