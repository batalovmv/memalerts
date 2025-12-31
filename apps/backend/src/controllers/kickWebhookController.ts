import type { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { fetchKickPublicKeyPem } from '../utils/kickWebhookSecurity.js';

function parseTimestampMs(raw: any): number | null {
  const s = String(raw ?? '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

function getHeader(req: Request, name: string): string {
  const v = (req.headers as any)[name] ?? (req.headers as any)[name.toLowerCase()];
  return String(v ?? '').trim();
}

async function verifyKickSignature(params: { req: Request; rawBody: string }): Promise<{ ok: boolean; reason: string }> {
  const signatureB64 = getHeader(params.req, 'Kick-Event-Signature') || getHeader(params.req, 'kick-event-signature');
  const messageId = getHeader(params.req, 'Kick-Event-Message-Id') || getHeader(params.req, 'kick-event-message-id');
  const messageTimestamp =
    getHeader(params.req, 'Kick-Event-Message-Timestamp') ||
    getHeader(params.req, 'kick-event-message-timestamp') ||
    // Back-compat with older integrations:
    getHeader(params.req, 'Kick-Event-Timestamp') ||
    getHeader(params.req, 'kick-event-timestamp');

  if (!signatureB64) return { ok: false, reason: 'missing_signature' };
  if (!messageId || !messageTimestamp) return { ok: false, reason: 'missing_signature_headers' };

  const ts = parseTimestampMs(messageTimestamp);
  if (!ts) return { ok: false, reason: 'invalid_timestamp' };
  const windowMs = (() => {
    const raw = Number(process.env.KICK_WEBHOOK_REPLAY_WINDOW_MS ?? 10 * 60 * 1000);
    return Number.isFinite(raw) && raw > 0 ? raw : 10 * 60 * 1000;
  })();
  if (Math.abs(Date.now() - ts) > windowMs) return { ok: false, reason: 'request_too_old' };

  const pem = await fetchKickPublicKeyPem();
  if (!pem) return { ok: false, reason: 'public_key_unavailable' };

  const signatureBuf = (() => {
    try {
      return Buffer.from(signatureB64, 'base64');
    } catch {
      return null;
    }
  })();
  if (!signatureBuf || signatureBuf.length === 0) return { ok: false, reason: 'invalid_signature_encoding' };

  // Kick webhook signature (RSA-SHA256, PKCS#1 v1.5): messageId.timestamp.rawBody
  const message = `${messageId}.${messageTimestamp}.${params.rawBody}`;
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(message, 'utf8'),
    { key: pem, padding: crypto.constants.RSA_PKCS1_PADDING },
    signatureBuf
  );
  if (!ok) return { ok: false, reason: 'invalid_signature' };
  return { ok: true, reason: 'ok' };
}

function extractKickRewardRedemption(payload: any): {
  kickChannelId: string | null;
  providerAccountId: string | null;
  rewardId: string | null;
  amount: number;
  status: string | null;
  providerEventId: string | null;
  eventAt: Date | null;
} {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const redemption = event?.redemption ?? event ?? null;

  const kickChannelId =
    String(
      redemption?.channel?.id ??
        event?.channel?.id ??
        event?.broadcaster?.id ??
        redemption?.channel_id ??
        event?.channel_id ??
        root?.channel_id ??
        ''
    ).trim() || null;
  const providerAccountId =
    String(
      redemption?.redeemer?.id ??
        redemption?.user?.id ??
        event?.user?.id ??
        event?.viewer?.id ??
        event?.sender?.id ??
        redemption?.user_id ??
        event?.user_id ??
        ''
    ).trim() || null;

  const rewardId = String(redemption?.reward?.id ?? redemption?.reward_id ?? event?.reward?.id ?? event?.reward_id ?? event?.reward?.uuid ?? '').trim() || null;
  const amountRaw = redemption?.reward?.cost ?? redemption?.reward?.points ?? redemption?.cost ?? event?.reward?.cost ?? event?.cost ?? event?.amount ?? event?.points ?? null;
  const amount = Number.isFinite(Number(amountRaw)) ? Math.floor(Number(amountRaw)) : 0;

  const status = String(redemption?.status ?? event?.status ?? event?.state ?? root?.status ?? '').trim().toLowerCase() || null;
  const providerEventId = String(redemption?.id ?? event?.id ?? event?.redemption_id ?? root?.id ?? '').trim() || null;
  const eventAt = (() => {
    const ts = redemption?.redeemed_at ?? redemption?.created_at ?? event?.created_at ?? event?.createdAt ?? event?.timestamp ?? root?.timestamp ?? null;
    const ms = parseTimestampMs(ts);
    return ms ? new Date(ms) : null;
  })();

  return { kickChannelId, providerAccountId, rewardId, amount, status, providerEventId, eventAt };
}

export const kickWebhookController = {
  handleEvents: async (req: Request, res: Response) => {
    // Kick signs raw request body bytes. Prefer captured rawBody; fallback to JSON.stringify.
    const rawBody =
      (req as any)?.rawBody && Buffer.isBuffer((req as any).rawBody)
        ? ((req as any).rawBody as Buffer).toString('utf8')
        : JSON.stringify(req.body ?? {});

    const messageId = getHeader(req, 'Kick-Event-Message-Id') || getHeader(req, 'kick-event-message-id');
    if (!messageId) return res.status(400).json({ error: 'Missing Kick-Event-Message-Id' });

    const sig = await verifyKickSignature({ req, rawBody });
    if (!sig.ok) return res.status(403).json({ error: 'Invalid signature', reason: sig.reason });

    const payload = req.body;
    const kind = String(payload?.type ?? payload?.event ?? payload?.event_type ?? payload?.name ?? '').trim().toLowerCase();
    const parsed = extractKickRewardRedemption(payload);

    const outcome = await prisma.$transaction(async (tx) => {
      // 1) Delivery-level idempotency (dedup by Kick-Event-Message-Id).
      try {
        await (tx as any).externalWebhookDeliveryDedup.create({
          data: {
            provider: 'kick',
            messageId,
          },
          select: { id: true },
        });
      } catch (e: any) {
        if (e?.code === 'P2002') {
          return { httpStatus: 200, body: { ok: true, duplicate: true } };
        }
        throw e;
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
      const sub = await (tx as any).kickChatBotSubscription.findFirst({
        where: { kickChannelId: parsed.kickChannelId, enabled: true },
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
        } as any,
      });
      if (!channel) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'channel_missing' } };

      // If Kick sends status updates, grant only when accepted.
      if (parsed.status && parsed.status !== 'accepted') {
        const r = await recordExternalRewardEventTx({
          tx: tx as any,
          provider: 'kick',
          providerEventId,
          channelId: String((channel as any).id),
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
          await (tx as any).externalWebhookDeliveryDedup.update({
            where: { provider_messageId: { provider: 'kick', messageId } },
            data: { externalEventId: r.externalEventId },
          });
        }

        return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'not_accepted' } };
      }

      if (!(channel as any).kickRewardEnabled) {
        const r = await recordExternalRewardEventTx({
          tx: tx as any,
          provider: 'kick',
          providerEventId,
          channelId: String((channel as any).id),
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
          await (tx as any).externalWebhookDeliveryDedup.update({
            where: { provider_messageId: { provider: 'kick', messageId } },
            data: { externalEventId: r.externalEventId },
          });
        }

        return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'disabled' } };
      }

      // Optional restriction: grant only when stream is online (best-effort, keyed by MemAlerts channel slug).
      if ((channel as any).kickRewardOnlyWhenLive) {
        const snap = await getStreamDurationSnapshot(String((channel as any).slug || '').toLowerCase());
        if (snap.status !== 'online') {
          const r = await recordExternalRewardEventTx({
            tx: tx as any,
            provider: 'kick',
            providerEventId,
            channelId: String((channel as any).id),
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
            await (tx as any).externalWebhookDeliveryDedup.update({
              where: { provider_messageId: { provider: 'kick', messageId } },
              data: { externalEventId: r.externalEventId },
            });
          }

          return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' } };
        }
      }

      // Check if this reward is configured for coins (optional rewardId match).
      const configuredRewardId = String((channel as any).kickRewardIdForCoins || '').trim();
      if (configuredRewardId && parsed.rewardId && configuredRewardId !== parsed.rewardId) {
        const r = await recordExternalRewardEventTx({
          tx: tx as any,
          provider: 'kick',
          providerEventId,
          channelId: String((channel as any).id),
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
          await (tx as any).externalWebhookDeliveryDedup.update({
            where: { provider_messageId: { provider: 'kick', messageId } },
            data: { externalEventId: r.externalEventId },
          });
        }

        return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'reward_id_mismatch' } };
      }

      const fixedCoins = (channel as any).kickRewardCoins ?? null;
      const ratio = Number((channel as any).kickCoinPerPointRatio ?? 1.0);
      const coinsToGrant = fixedCoins
        ? Number(fixedCoins)
        : Math.floor((parsed.amount || 0) * (Number.isFinite(ratio) ? ratio : 1.0));

      const r = await recordExternalRewardEventTx({
        tx: tx as any,
        provider: 'kick',
        providerEventId,
        channelId: String((channel as any).id),
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
        await (tx as any).externalWebhookDeliveryDedup.update({
          where: { provider_messageId: { provider: 'kick', messageId } },
          data: { externalEventId: r.externalEventId },
        });
      }

      return { httpStatus: 200, body: { ok: true } };
    });

    return res.status(outcome.httpStatus).json(outcome.body);
  },
};


