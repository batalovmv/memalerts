import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { extractKickRewardRedemption } from './kickWebhookShared.js';

type TxClient = Prisma.TransactionClient;

export async function handleKickRewardRedemption(params: {
  payload: unknown;
  messageId: string;
}): Promise<{ httpStatus: number; body: Record<string, unknown> }> {
  const { payload, messageId } = params;
  const kind = String(
    (payload as { type?: string; event?: string; event_type?: string; name?: string })?.type ??
      (payload as { event?: string })?.event ??
      (payload as { event_type?: string })?.event_type ??
      (payload as { name?: string })?.name ??
      ''
  )
    .trim()
    .toLowerCase();
  const parsed = extractKickRewardRedemption(payload);

  const outcome = await prisma.$transaction(async (tx: TxClient) => {
    // 1) Delivery-level idempotency (dedup by Kick-Event-Message-Id).
    const dedup = await tx.externalWebhookDeliveryDedup.createMany({
      data: {
        provider: 'kick',
        messageId,
      },
      skipDuplicates: true,
    });
    if (dedup.count === 0) {
      return { httpStatus: 200, body: { ok: true, duplicate: true } };
    }

    // MVP: accept only reward redemption updates that are "accepted".
    if (kind && !kind.includes('reward') && !kind.includes('redemption')) {
      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'unsupported_event_type' } };
    }

    if (!parsed.kickChannelId || !parsed.providerAccountId) {
      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_identity' } };
    }

    const rawPayloadJson = JSON.stringify(payload ?? {});
    const fallbackEventId = stableProviderEventId({
      provider: 'kick',
      rawPayloadJson,
      fallbackParts: [
        parsed.kickChannelId,
        parsed.providerAccountId,
        parsed.rewardId || '',
        String(parsed.amount || 0),
        parsed.status || '',
      ],
    });
    const providerEventId = parsed.providerEventId || fallbackEventId;

    // Map Kick channel -> MemAlerts Channel via KickChatBotSubscription (already configured by streamer).
    const sub = await tx.kickChatBotSubscription.findFirst({
      where: { kickChannelId: parsed.kickChannelId, enabled: true },
      orderBy: { createdAt: 'desc' },
      select: { channelId: true },
    });
    if (!sub?.channelId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'channel_not_mapped' } };

    const channel = await tx.channel.findUnique({
      where: { id: sub.channelId },
      select: {
        id: true,
        slug: true,
        kickRewardEnabled: true,
        kickRewardIdForCoins: true,
        kickCoinPerPointRatio: true,
        kickRewardCoins: true,
        kickRewardOnlyWhenLive: true,
      },
    });
    if (!channel) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'channel_missing' } };

    // If Kick sends status updates, grant only when accepted.
    if (parsed.status && parsed.status !== 'accepted') {
      const r = await recordExternalRewardEventTx({
        tx,
        provider: 'kick',
        providerEventId,
        channelId: channel.id,
        providerAccountId: parsed.providerAccountId!,
        eventType: 'kick_reward_redemption',
        currency: 'kick_channel_points',
        amount: parsed.amount || 0,
        coinsToGrant: 0,
        status: 'ignored',
        reason: `status_${parsed.status}`,
        eventAt: parsed.eventAt,
        rawPayloadJson,
      });

      if (r.externalEventId) {
        await tx.externalWebhookDeliveryDedup.update({
          where: { provider_messageId: { provider: 'kick', messageId } },
          data: { externalEventId: r.externalEventId },
        });
      }

      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'not_accepted' } };
    }

    if (!channel.kickRewardEnabled) {
      const r = await recordExternalRewardEventTx({
        tx,
        provider: 'kick',
        providerEventId,
        channelId: channel.id,
        providerAccountId: parsed.providerAccountId!,
        eventType: 'kick_reward_redemption',
        currency: 'kick_channel_points',
        amount: parsed.amount || 0,
        coinsToGrant: 0,
        status: 'ignored',
        reason: 'kick_reward_disabled',
        eventAt: parsed.eventAt,
        rawPayloadJson,
      });

      if (r.externalEventId) {
        await tx.externalWebhookDeliveryDedup.update({
          where: { provider_messageId: { provider: 'kick', messageId } },
          data: { externalEventId: r.externalEventId },
        });
      }

      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'disabled' } };
    }

    // Optional restriction: grant only when stream is online (best-effort, keyed by MemAlerts channel slug).
    if (channel.kickRewardOnlyWhenLive) {
      const snap = await getStreamDurationSnapshot(String(channel.slug ?? '').toLowerCase());
      if (snap.status !== 'online') {
        const r = await recordExternalRewardEventTx({
          tx,
          provider: 'kick',
          providerEventId,
          channelId: channel.id,
          providerAccountId: parsed.providerAccountId!,
          eventType: 'kick_reward_redemption',
          currency: 'kick_channel_points',
          amount: parsed.amount || 0,
          coinsToGrant: 0,
          status: 'ignored',
          reason: 'offline',
          eventAt: parsed.eventAt,
          rawPayloadJson,
        });

        if (r.externalEventId) {
          await tx.externalWebhookDeliveryDedup.update({
            where: { provider_messageId: { provider: 'kick', messageId } },
            data: { externalEventId: r.externalEventId },
          });
        }

        return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
      }
    }

    // Check if this reward is configured for coins (optional rewardId match).
    const configuredRewardId = String(channel.kickRewardIdForCoins ?? '').trim();
    if (configuredRewardId && parsed.rewardId && configuredRewardId !== parsed.rewardId) {
      const r = await recordExternalRewardEventTx({
        tx,
        provider: 'kick',
        providerEventId,
        channelId: channel.id,
        providerAccountId: parsed.providerAccountId!,
        eventType: 'kick_reward_redemption',
        currency: 'kick_channel_points',
        amount: parsed.amount || 0,
        coinsToGrant: 0,
        status: 'ignored',
        reason: 'reward_id_mismatch',
        eventAt: parsed.eventAt,
        rawPayloadJson,
      });

      if (r.externalEventId) {
        await tx.externalWebhookDeliveryDedup.update({
          where: { provider_messageId: { provider: 'kick', messageId } },
          data: { externalEventId: r.externalEventId },
        });
      }

      return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'reward_id_mismatch' } };
    }

    const fixedCoins = channel.kickRewardCoins ?? null;
    const ratio = Number(channel.kickCoinPerPointRatio ?? 1.0);
    const coinsToGrant = fixedCoins
      ? Number(fixedCoins)
      : Math.floor((parsed.amount || 0) * (Number.isFinite(ratio) ? ratio : 1.0));

    const r = await recordExternalRewardEventTx({
      tx,
      provider: 'kick',
      providerEventId,
      channelId: channel.id,
      providerAccountId: parsed.providerAccountId!,
      eventType: 'kick_reward_redemption',
      currency: 'kick_channel_points',
      amount: parsed.amount || 0,
      coinsToGrant,
      status: coinsToGrant > 0 ? 'eligible' : 'ignored',
      reason: coinsToGrant > 0 ? null : 'zero_coins',
      eventAt: parsed.eventAt,
      rawPayloadJson,
    });

    if (r.externalEventId) {
      await tx.externalWebhookDeliveryDedup.update({
        where: { provider_messageId: { provider: 'kick', messageId } },
        data: { externalEventId: r.externalEventId },
      });
    }

    return { httpStatus: 200, body: { ok: true } };
  });

  return { httpStatus: outcome.httpStatus, body: outcome.body };
}
