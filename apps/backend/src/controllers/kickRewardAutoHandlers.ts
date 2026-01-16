import { getStreamDurationSnapshot, handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { asRecord, readTierCoins, safeNum, type AutoRewardsCfg } from './kickWebhookShared.js';

type KickRewardResponse = { httpStatus: number; body: Record<string, unknown> };

type RecordKickReward = (params: {
  providerEventId: string;
  providerAccountId: string;
  eventType:
    | 'twitch_follow'
    | 'twitch_subscribe'
    | 'twitch_resub_message'
    | 'twitch_gift_sub'
    | 'twitch_cheer'
    | 'twitch_raid'
    | 'twitch_chat_first_message'
    | 'twitch_chat_messages_threshold'
    | 'twitch_chat_daily_streak';
  currency: 'twitch_bits' | 'twitch_units';
  amount: number;
  coinsToGrant: number;
  status: 'observed' | 'eligible' | 'ignored' | 'failed';
  reason?: string | null;
}) => Promise<void>;

export async function handleKickLivestreamStatus(params: {
  payload: unknown;
  slug: string;
  streamDurationCommandJson: string | null;
}): Promise<KickRewardResponse> {
  const statusRaw = String(
    (params.payload as { data?: { event?: { status?: string; state?: string } } })?.data?.event?.status ??
      (params.payload as { data?: { event?: { status?: string; state?: string } } })?.data?.event?.state ??
      (params.payload as { event?: { status?: string } })?.event?.status ??
      (params.payload as { status?: string })?.status ??
      ''
  )
    .trim()
    .toLowerCase();
  const isOnline =
    statusRaw.includes('online') ||
    statusRaw.includes('live') ||
    statusRaw.includes('started') ||
    statusRaw.includes('start');
  const isOffline =
    statusRaw.includes('offline') ||
    statusRaw.includes('ended') ||
    statusRaw.includes('stopped') ||
    statusRaw.includes('end');

  if (isOnline || isOffline) {
    let breakCreditMinutes = 60;
    try {
      const raw = String(params.streamDurationCommandJson ?? '').trim();
      if (raw) {
        const parsedRec = asRecord(JSON.parse(raw));
        const v = Number(parsedRec.breakCreditMinutes ?? parsedRec.break_credit_minutes ?? 0);
        if (Number.isFinite(v)) breakCreditMinutes = v;
      }
    } catch {
      // ignore invalid JSON
    }

    if (isOnline) await handleStreamOnline(params.slug, breakCreditMinutes);
    if (isOffline) await handleStreamOffline(params.slug);
  }

  return { httpStatus: 200, body: { ok: true } };
}

export async function handleKickFollow(params: {
  actorId: string | null;
  cfg: AutoRewardsCfg | null;
  messageId: string;
  channelId: string;
  slug: string;
  record: RecordKickReward;
}): Promise<KickRewardResponse> {
  const rule = params.cfg?.follow ?? null;
  const enabled = Boolean(rule?.enabled);
  const coins = Math.floor(safeNum(rule?.coins ?? 0));
  const onceEver = rule?.onceEver === undefined ? true : Boolean(rule?.onceEver);
  const onlyWhenLive = Boolean(rule?.onlyWhenLive);

  if (!params.actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' } };

  if (!enabled || coins <= 0) {
    await params.record({
      providerEventId: onceEver
        ? stableProviderEventId({
            provider: 'kick',
            rawPayloadJson: '{}',
            fallbackParts: ['follow', params.channelId, params.actorId],
          })
        : `${params.messageId}:follow`,
      providerAccountId: params.actorId,
      eventType: 'twitch_follow',
      currency: 'twitch_units',
      amount: 1,
      coinsToGrant: 0,
      status: 'ignored',
      reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
    });
    return { httpStatus: 200, body: { ok: true } };
  }

  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(params.slug);
    if (snap.status !== 'online') {
      await params.record({
        providerEventId: onceEver
          ? stableProviderEventId({
              provider: 'kick',
              rawPayloadJson: '{}',
              fallbackParts: ['follow', params.channelId, params.actorId],
            })
          : `${params.messageId}:follow`,
        providerAccountId: params.actorId,
        eventType: 'twitch_follow',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: 0,
        status: 'ignored',
        reason: 'offline',
      });
      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
    }
  }

  await params.record({
    providerEventId: onceEver
      ? stableProviderEventId({
          provider: 'kick',
          rawPayloadJson: '{}',
          fallbackParts: ['follow', params.channelId, params.actorId],
        })
      : `${params.messageId}:follow`,
    providerAccountId: params.actorId,
    eventType: 'twitch_follow',
    currency: 'twitch_units',
    amount: 1,
    coinsToGrant: coins,
    status: 'eligible',
    reason: null,
  });
  return { httpStatus: 200, body: { ok: true } };
}

export async function handleKickSubscriptionNew(params: {
  actorId: string | null;
  cfg: AutoRewardsCfg | null;
  messageId: string;
  slug: string;
  tier: string | null;
  record: RecordKickReward;
}): Promise<KickRewardResponse> {
  const rule = params.cfg?.subscribe ?? null;
  if (!params.actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' } };
  if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' } };

  const onlyWhenLive = Boolean(rule?.onlyWhenLive);
  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(params.slug);
    if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
  }

  const coins = readTierCoins(rule?.tierCoins, params.tier ?? '');
  if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' } };

  await params.record({
    providerEventId: `${params.messageId}:sub`,
    providerAccountId: params.actorId,
    eventType: 'twitch_subscribe',
    currency: 'twitch_units',
    amount: 1,
    coinsToGrant: coins,
    status: 'eligible',
    reason: null,
  });
  return { httpStatus: 200, body: { ok: true } };
}

export async function handleKickSubscriptionRenewal(params: {
  actorId: string | null;
  cfg: AutoRewardsCfg | null;
  messageId: string;
  slug: string;
  tier: string | null;
  record: RecordKickReward;
}): Promise<KickRewardResponse> {
  const rule = params.cfg?.resubMessage ?? null;
  if (!params.actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' } };
  if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' } };

  const onlyWhenLive = Boolean(rule?.onlyWhenLive);
  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(params.slug);
    if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
  }

  const tierCoins = readTierCoins(rule?.tierCoins, params.tier ?? '');
  const bonus = Math.floor(safeNum(rule?.bonusCoins ?? 0));
  const coins = tierCoins + (bonus > 0 ? bonus : 0);
  if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' } };

  await params.record({
    providerEventId: `${params.messageId}:renewal`,
    providerAccountId: params.actorId,
    eventType: 'twitch_resub_message',
    currency: 'twitch_units',
    amount: 1,
    coinsToGrant: coins,
    status: 'eligible',
    reason: null,
  });
  return { httpStatus: 200, body: { ok: true } };
}

export async function handleKickSubscriptionGifts(params: {
  actorId: string | null;
  recipients: string[];
  total: number;
  cfg: AutoRewardsCfg | null;
  messageId: string;
  slug: string;
  tier: string | null;
  record: RecordKickReward;
}): Promise<KickRewardResponse> {
  const rule = params.cfg?.giftSub ?? null;
  if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' } };

  const onlyWhenLive = Boolean(rule?.onlyWhenLive);
  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(params.slug);
    if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
  }

  const giverId = params.actorId;
  const giftsCount = params.total > 0 ? params.total : 1;
  const giverCoinsPerOne = readTierCoins(rule?.giverTierCoins, params.tier ?? '');
  const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * giftsCount : 0;
  const recipientCoins = Math.floor(safeNum(rule?.recipientCoins ?? 0));

  if (giverId && giverCoins > 0) {
    await params.record({
      providerEventId: `${params.messageId}:gift_giver`,
      providerAccountId: giverId,
      eventType: 'twitch_gift_sub',
      currency: 'twitch_units',
      amount: giftsCount,
      coinsToGrant: giverCoins,
      status: 'eligible',
      reason: null,
    });
  }

  if (recipientCoins > 0 && params.recipients.length) {
    for (const rid of params.recipients) {
      await params.record({
        providerEventId: `${params.messageId}:gift_recipient:${rid}`,
        providerAccountId: rid,
        eventType: 'twitch_gift_sub',
        currency: 'twitch_units',
        amount: 1,
        coinsToGrant: recipientCoins,
        status: 'eligible',
        reason: null,
      });
    }
  }

  return { httpStatus: 200, body: { ok: true } };
}

export async function handleKickKicksGifted(params: {
  actorId: string | null;
  kicks: number;
  cfg: AutoRewardsCfg | null;
  messageId: string;
  slug: string;
  record: RecordKickReward;
}): Promise<KickRewardResponse> {
  const rule = params.cfg?.cheer ?? null;
  if (!params.actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' } };
  if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' } };

  const onlyWhenLive = Boolean(rule?.onlyWhenLive);
  if (onlyWhenLive) {
    const snap = await getStreamDurationSnapshot(params.slug);
    if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
  }

  const minKicks = Math.max(1, Math.floor(safeNum(rule?.minBits ?? 1)));
  if (params.kicks <= 0 || params.kicks < minKicks)
    return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'below_min' } };

  const kicksPerCoin = Math.max(1, Math.floor(safeNum(rule?.bitsPerCoin ?? 1)));
  const coins = Math.floor(params.kicks / kicksPerCoin);
  if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' } };

  await params.record({
    providerEventId: `${params.messageId}:kicks_gifted`,
    providerAccountId: params.actorId,
    eventType: 'twitch_cheer',
    currency: 'twitch_units',
    amount: params.kicks,
    coinsToGrant: coins,
    status: 'eligible',
    reason: null,
  });
  return { httpStatus: 200, body: { ok: true } };
}
