import type { Request, Response } from 'express';
import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { getStreamDurationSnapshot, getStreamSessionSnapshot, handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { recordExternalRewardEventTx, stableProviderEventId } from '../rewards/externalRewardEvents.js';
import { claimPendingCoinGrantsTx } from '../rewards/pendingCoinGrants.js';
import { ingestCreditsChatter } from './internal/creditsInternal.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { logger } from '../utils/logger.js';
import { fetchKickPublicKeyPem } from '../utils/kickWebhookSecurity.js';
import { emitWalletUpdated, relayWalletUpdatedToPeer } from '../realtime/walletBridge.js';
import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';

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

function normalizeMessage(v: any): string {
  return String(v ?? '').replace(/\r\n/g, '\n').trim();
}

function normalizeLogin(v: any): string {
  return String(v ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

function safeNum(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function readTierCoins(map: any, tier: string): number {
  if (!map || typeof map !== 'object') return 0;
  const key = String(tier || '').trim();
  const v = (map as any)[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function utcDayKey(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function utcDayKeyYesterday(d: Date): string {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 24 * 60 * 60 * 1000);
  return utcDayKey(prev);
}

function normalizeAllowedUsersList(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const login = normalizeLogin(v);
    if (!login) continue;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

function normalizeAllowedRolesList(raw: any): ChatCommandRole[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '').trim().toLowerCase() as ChatCommandRole;
    if (!role) continue;
    if (role !== 'vip' && role !== 'moderator' && role !== 'subscriber' && role !== 'follower') continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

function canTriggerCommand(opts: {
  senderLogin: string;
  senderRoles: Set<ChatCommandRole>;
  allowedUsers: string[];
  allowedRoles: ChatCommandRole[];
}): boolean {
  const users = opts.allowedUsers || [];
  const roles = opts.allowedRoles || [];
  if (users.length === 0 && roles.length === 0) return true;
  if (opts.senderLogin && users.includes(opts.senderLogin)) return true;
  for (const r of roles) {
    if (opts.senderRoles.has(r)) return true;
  }
  return false;
}

function getKickEventType(req: Request, payload: any): string {
  const headerType = getHeader(req, 'Kick-Event-Type') || getHeader(req, 'kick-event-type');
  const kind = String(payload?.type ?? payload?.event ?? payload?.event_type ?? payload?.name ?? '').trim();
  return String(headerType || kind || '').trim().toLowerCase();
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

function extractKickChatMessageSent(payload: any): {
  kickChannelId: string | null;
  platformUserId: string | null;
  login: string | null;
  displayName: string | null;
  text: string | null;
  avatarUrl: string | null;
  roles: Set<ChatCommandRole>;
} {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;

  const kickChannelId =
    String(
      event?.broadcaster?.user_id ??
        event?.broadcaster?.id ??
        event?.broadcaster_user_id ??
        event?.channel?.id ??
        event?.channel_id ??
        root?.broadcaster_user_id ??
        root?.channel_id ??
        ''
    ).trim() || null;

  const sender = event?.sender ?? event?.user ?? event?.chatter ?? event?.author ?? null;
  const platformUserId = String(sender?.user_id ?? sender?.id ?? sender?.userId ?? event?.user_id ?? event?.userId ?? '').trim() || null;
  const loginRaw = String(sender?.username ?? sender?.user_name ?? sender?.login ?? sender?.name ?? '').trim() || null;
  const displayName = String(sender?.display_name ?? sender?.displayName ?? sender?.username ?? sender?.name ?? '').trim() || null;
  const avatarUrl = String(sender?.profile_image_url ?? sender?.avatar_url ?? sender?.avatarUrl ?? '').trim() || null;

  const msg = event?.message ?? event?.chat_message ?? event?.chatMessage ?? event?.data ?? null;
  const text = normalizeMessage(msg?.content ?? msg?.message ?? msg?.text ?? event?.content ?? event?.message ?? '');

  const roles = new Set<ChatCommandRole>();
  const badgesRaw = sender?.identity?.badges ?? sender?.badges ?? sender?.identity?.roles ?? [];
  const badges = Array.isArray(badgesRaw) ? badgesRaw : [];
  for (const b of badges) {
    const name = String((b as any)?.name ?? (b as any)?.type ?? (b as any)?.id ?? b ?? '').trim().toLowerCase();
    if (!name) continue;
    if (name.includes('mod') || name.includes('moderator') || name.includes('broadcaster') || name.includes('streamer')) roles.add('moderator');
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

function extractKickChannelId(payload: any): string | null {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const v =
    event?.broadcaster?.user_id ??
    event?.broadcaster?.id ??
    event?.broadcaster_user_id ??
    event?.channel?.id ??
    event?.channel_id ??
    root?.broadcaster_user_id ??
    root?.channel_id ??
    null;
  return String(v ?? '').trim() || null;
}

function extractKickActorUserId(payload: any): string | null {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const user = event?.user ?? event?.sender ?? event?.viewer ?? event?.follower ?? event?.subscriber ?? event?.gifter ?? null;
  const v = user?.id ?? user?.user_id ?? user?.userId ?? event?.user_id ?? event?.userId ?? null;
  return String(v ?? '').trim() || null;
}

function extractKickRecipientsUserIds(payload: any): string[] {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const list = (event?.recipients ?? event?.gift_recipients ?? event?.gifted_to ?? event?.users ?? []) as any;
  const arr = Array.isArray(list) ? list : [];
  const out: string[] = [];
  for (const it of arr) {
    const v = (it as any)?.id ?? (it as any)?.user_id ?? (it as any)?.userId ?? it ?? null;
    const id = String(v ?? '').trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

function extractKickCount(payload: any): number {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const v = event?.count ?? event?.total ?? event?.quantity ?? event?.gifts ?? event?.gift_count ?? null;
  const n = Math.floor(safeNum(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extractKickKicksAmount(payload: any): number {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const v = event?.kicks ?? event?.amount ?? event?.value ?? event?.total ?? null;
  const n = Math.floor(safeNum(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function extractKickTier(payload: any): string {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const v = event?.tier ?? event?.sub_tier ?? event?.subTier ?? event?.subscription_tier ?? event?.subscriptionTier ?? null;
  const s = String(v ?? '').trim();
  return s || '1000';
}

function extractKickEventAt(payload: any): Date | null {
  const root = payload?.data ?? payload ?? null;
  const event = root?.event ?? root ?? null;
  const ts = event?.created_at ?? event?.createdAt ?? event?.timestamp ?? event?.time ?? root?.timestamp ?? null;
  const ms = parseTimestampMs(ts);
  return ms ? new Date(ms) : null;
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
    const eventType = getKickEventType(req, payload);

    // chat.message.sent
    if (eventType === 'chat.message.sent') {
      const chat = extractKickChatMessageSent(payload);
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
            return {
              httpStatus: 200,
              body: { ok: true, duplicate: true } as any,
              channelId: null as string | null,
              channelSlug: null as string | null,
              credits: null as any,
              claimedWalletEvents: [] as any[],
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
            claimedWalletEvents: [] as any[],
          };
        }

        // Map Kick channel -> MemAlerts Channel via KickChatBotSubscription (already configured by streamer).
        const sub = await (tx as any).kickChatBotSubscription.findFirst({
          where: { kickChannelId: chat.kickChannelId, enabled: true },
          select: { channelId: true, channel: { select: { slug: true } } },
        });
        const channelId = String((sub as any)?.channelId || '').trim() || null;
        const channelSlug = String((sub as any)?.channel?.slug || '').trim().toLowerCase() || null;
        if (!channelId || !channelSlug) {
          return {
            httpStatus: 200,
            body: { ok: true, ignored: true, reason: 'channel_not_mapped' },
            channelId: null,
            channelSlug: null,
            credits: null,
            claimedWalletEvents: [] as any[],
          };
        }

        const msgNorm = normalizeMessage(chat.text).toLowerCase();
        if (msgNorm) {
          const cmd = await (tx as any).chatBotCommand.findFirst({
            where: { channelId, enabled: true, triggerNormalized: msgNorm },
            select: { response: true, onlyWhenLive: true, allowedUsers: true, allowedRoles: true },
          });
          const response = String((cmd as any)?.response || '').trim();
          if (response) {
            const allowedUsers = normalizeAllowedUsersList((cmd as any)?.allowedUsers);
            const allowedRoles = normalizeAllowedRolesList((cmd as any)?.allowedRoles);
            const senderLogin = chat.login || '';

            if (
              canTriggerCommand({
                senderLogin,
                senderRoles: chat.roles,
                allowedUsers,
                allowedRoles,
              })
            ) {
              if ((cmd as any)?.onlyWhenLive) {
                const snap = await getStreamDurationSnapshot(channelSlug);
                if (snap.status === 'online') {
                  await (tx as any).kickChatBotOutboxMessage.create({
                    data: {
                      channelId,
                      kickChannelId: chat.kickChannelId,
                      message: response,
                      status: 'pending',
                    },
                    select: { id: true },
                  });
                }
              } else {
                await (tx as any).kickChatBotOutboxMessage.create({
                  data: {
                    channelId,
                    kickChannelId: chat.kickChannelId,
                    message: response,
                    status: 'pending',
                  },
                  select: { id: true },
                });
              }
            }
          }
        }

        const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'kick', platformUserId: chat.platformUserId });
        const creditsUserId = memalertsUserId || `kick:${chat.platformUserId}`;

        // Auto rewards: chat activity (reuses Channel.twitchAutoRewardsJson.chat config).
        const claimedWalletEvents: any[] = [];
        try {
          const ch = await tx.channel.findUnique({
            where: { id: channelId },
            select: { id: true, twitchAutoRewardsJson: true } as any,
          });
          const cfg = (ch as any)?.twitchAutoRewardsJson ?? null;
          const chatCfg = (cfg as any)?.chat ?? null;
          if (chatCfg && typeof chatCfg === 'object') {
            const redis = await getRedisClient();
            if (redis) {
              const now = new Date();
              const day = utcDayKey(now);
              const yesterday = utcDayKeyYesterday(now);
              const session = await getStreamSessionSnapshot(channelSlug);
              const isOnline = session.status === 'online' && !!session.sessionId;

              const award = async (params: {
                providerEventId: string;
                eventType: 'twitch_chat_first_message' | 'twitch_chat_messages_threshold' | 'twitch_chat_daily_streak';
                amount: number;
                coins: number;
                rawMeta: any;
              }) => {
                const coins = Number.isFinite(params.coins) ? Math.floor(params.coins) : 0;
                if (coins <= 0) return;
                await recordExternalRewardEventTx({
                  tx: tx as any,
                  provider: 'kick',
                  providerEventId: params.providerEventId,
                  channelId,
                  providerAccountId: chat.platformUserId!,
                  eventType: params.eventType,
                  currency: 'twitch_units',
                  amount: params.amount,
                  coinsToGrant: coins,
                  status: 'eligible',
                  reason: null,
                  eventAt: now,
                  rawPayloadJson: JSON.stringify(params.rawMeta ?? {}),
                });

                if (memalertsUserId) {
                  const events = await claimPendingCoinGrantsTx({
                    tx: tx as any,
                    userId: memalertsUserId,
                    provider: 'kick',
                    providerAccountId: chat.platformUserId!,
                  });
                  if (events.length) claimedWalletEvents.push(...events);
                }
              };

              // Daily streak: award once per day on first chat message.
              const streakCfg = (chatCfg as any)?.dailyStreak ?? null;
              if (streakCfg?.enabled) {
                const k = nsKey('kick_auto_rewards', `streak:${channelId}:${chat.platformUserId}`);
                const raw = await redis.get(k);
                let lastDate: string | null = null;
                let streak = 0;
                try {
                  if (raw) {
                    const parsed = JSON.parse(raw);
                    lastDate = typeof (parsed as any)?.lastDate === 'string' ? (parsed as any).lastDate : null;
                    streak = Number.isFinite(Number((parsed as any)?.streak)) ? Math.floor(Number((parsed as any).streak)) : 0;
                  }
                } catch {
                  lastDate = null;
                  streak = 0;
                }

                if (lastDate !== day) {
                  const nextStreak = lastDate === yesterday ? Math.max(1, streak + 1) : 1;
                  await redis.set(k, JSON.stringify({ lastDate: day, streak: nextStreak }), { EX: 90 * 24 * 60 * 60 });

                  const coinsByStreak = (streakCfg as any)?.coinsByStreak ?? null;
                  const coins =
                    coinsByStreak && typeof coinsByStreak === 'object'
                      ? Number((coinsByStreak as any)[String(nextStreak)] ?? 0)
                      : Number((streakCfg as any)?.coinsPerDay ?? 0);

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
                    rawMeta: { kind: 'kick_chat_daily_streak', channelSlug, kickUserId: chat.platformUserId, day, streak: nextStreak },
                  });
                }
              }

              // First message per stream: award once per user per stream session.
              const firstCfg = (chatCfg as any)?.firstMessage ?? null;
              if (firstCfg?.enabled) {
                const onlyWhenLive = (firstCfg as any)?.onlyWhenLive === undefined ? true : Boolean((firstCfg as any).onlyWhenLive);
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
                        coins: Number((firstCfg as any)?.coins ?? 0),
                        rawMeta: { kind: 'kick_chat_first_message', channelSlug, kickUserId: chat.platformUserId, sessionId: sid },
                      });
                    }
                  }
                }
              }

              // Message count thresholds per stream.
              const thrCfg = (chatCfg as any)?.messageThresholds ?? null;
              if (thrCfg?.enabled) {
                const onlyWhenLive = (thrCfg as any)?.onlyWhenLive === undefined ? true : Boolean((thrCfg as any).onlyWhenLive);
                if (!onlyWhenLive || isOnline) {
                  const sid = String(session.sessionId || '').trim();
                  if (sid) {
                    const kCount = nsKey('kick_auto_rewards', `msgcount:${channelId}:${sid}:${chat.platformUserId}`);
                    const n = await redis.incr(kCount);
                    if (n === 1) await redis.expire(kCount, 48 * 60 * 60);

                    const thresholds = Array.isArray((thrCfg as any)?.thresholds) ? (thrCfg as any).thresholds : [];
                    const hit = thresholds.some((t: any) => Number.isFinite(Number(t)) && Math.floor(Number(t)) === n);
                    if (hit) {
                      const coinsByThreshold = (thrCfg as any)?.coinsByThreshold ?? null;
                      const coins =
                        coinsByThreshold && typeof coinsByThreshold === 'object' ? Number((coinsByThreshold as any)[String(n)] ?? 0) : 0;
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
                        rawMeta: { kind: 'kick_chat_messages_threshold', channelSlug, kickUserId: chat.platformUserId, sessionId: sid, count: n },
                      });
                    }
                  }
                }
              }
            }
          }
        } catch (e: any) {
          // Never fail chat commands / credits because of auto rewards.
          logger.warn('kick.webhook.auto_rewards_failed', { errorMessage: e?.message || String(e) });
        }

        return {
          httpStatus: 200,
          body: { ok: true },
          channelId,
          channelSlug,
          credits: { userId: creditsUserId, displayName: chat.displayName || creditsUserId, avatarUrl: chat.avatarUrl },
          claimedWalletEvents,
        };
      });

      // Credits chatter ingest (best-effort, after idempotency gate).
      if (outcome.channelSlug && outcome.credits) {
        try {
          const io = (req.app as any)?.get?.('io');
          await ingestCreditsChatter({
            io,
            channelSlug: outcome.channelSlug,
            userId: outcome.credits.userId,
            displayName: outcome.credits.displayName,
            avatarUrl: outcome.credits.avatarUrl ?? null,
          });
        } catch (e: any) {
          logger.warn('kick.webhook.credits_ingest_failed', { errorMessage: e?.message || String(e) });
        }
      }

      // Wallet updates (if any) AFTER commit.
      if (outcome.claimedWalletEvents?.length) {
        try {
          const io = (req.app as any)?.get?.('io');
          for (const ev of outcome.claimedWalletEvents) {
            emitWalletUpdated(io, ev);
            void relayWalletUpdatedToPeer(ev);
          }
        } catch {
          // ignore
        }
      }

      return res.status(outcome.httpStatus).json(outcome.body);
    }

    // Kick auto rewards via webhooks (follow/subs/gifts/kicks gifted) + stream status boundaries.
    if (
      eventType === 'channel.followed' ||
      eventType === 'channel.subscription.new' ||
      eventType === 'channel.subscription.renewal' ||
      eventType === 'channel.subscription.gifts' ||
      eventType === 'kicks.gifted' ||
      eventType === 'livestream.status.updated'
    ) {
      const kickChannelId = extractKickChannelId(payload);
      const actorId = extractKickActorUserId(payload);
      const recipients = extractKickRecipientsUserIds(payload);
      const total = extractKickCount(payload);
      const kicks = extractKickKicksAmount(payload);
      const tier = extractKickTier(payload);
      const eventAt = extractKickEventAt(payload);
      const rawPayloadJson = JSON.stringify(payload ?? {});

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
            return { httpStatus: 200, body: { ok: true, duplicate: true }, claimedWalletEvents: [] as any[] };
          }
          throw e;
        }

        if (!kickChannelId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_channel_id' }, claimedWalletEvents: [] as any[] };

        // Map Kick channel -> MemAlerts Channel via KickChatBotSubscription (already configured by streamer).
        const sub = await (tx as any).kickChatBotSubscription.findFirst({
          where: { kickChannelId, enabled: true },
          select: { channelId: true, channel: { select: { slug: true, twitchAutoRewardsJson: true, streamDurationCommandJson: true } } },
        });
        const channelId = String((sub as any)?.channelId || '').trim();
        const slug = String((sub as any)?.channel?.slug || '').trim().toLowerCase();
        const cfg = (sub as any)?.channel?.twitchAutoRewardsJson ?? null;
        if (!channelId || !slug) {
          return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'channel_not_mapped' }, claimedWalletEvents: [] as any[] };
        }

        // livestream.status.updated: update streamDurationStore boundaries (best-effort).
        if (eventType === 'livestream.status.updated') {
          const statusRaw = String(payload?.data?.event?.status ?? payload?.data?.event?.state ?? payload?.event?.status ?? payload?.status ?? '').trim().toLowerCase();
          const isOnline = statusRaw.includes('online') || statusRaw.includes('live') || statusRaw.includes('started') || statusRaw.includes('start');
          const isOffline = statusRaw.includes('offline') || statusRaw.includes('ended') || statusRaw.includes('stopped') || statusRaw.includes('end');

          if (isOnline || isOffline) {
            let breakCreditMinutes = 60;
            try {
              const raw = String((sub as any)?.channel?.streamDurationCommandJson || '').trim();
              if (raw) {
                const parsed = JSON.parse(raw);
                const v = Number((parsed as any)?.breakCreditMinutes);
                if (Number.isFinite(v)) breakCreditMinutes = v;
              }
            } catch {
              // ignore invalid JSON
            }

            if (isOnline) await handleStreamOnline(slug, breakCreditMinutes);
            if (isOffline) await handleStreamOffline(slug);
          }

          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents: [] as any[] };
        }

        const claimedWalletEvents: any[] = [];

        const recordAndMaybeClaimKick = async (params: {
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
        }) => {
          const linkedUserId = await resolveMemalertsUserIdFromChatIdentity({ provider: 'kick', platformUserId: params.providerAccountId });
          await recordExternalRewardEventTx({
            tx: tx as any,
            provider: 'kick',
            providerEventId: params.providerEventId,
            channelId,
            providerAccountId: params.providerAccountId,
            eventType: params.eventType,
            currency: params.currency,
            amount: params.amount,
            coinsToGrant: params.coinsToGrant,
            status: params.status,
            reason: params.reason ?? null,
            eventAt,
            rawPayloadJson,
          });

          if (linkedUserId && params.status === 'eligible' && params.coinsToGrant > 0) {
            const events = await claimPendingCoinGrantsTx({
              tx: tx as any,
              userId: linkedUserId,
              provider: 'kick',
              providerAccountId: params.providerAccountId,
            });
            if (events.length) claimedWalletEvents.push(...events);
          }
        };

        // Follow
        if (eventType === 'channel.followed') {
          const rule = (cfg as any)?.follow ?? null;
          const enabled = Boolean(rule?.enabled);
          const coins = Math.floor(safeNum(rule?.coins ?? 0));
          const onceEver = rule?.onceEver === undefined ? true : Boolean(rule?.onceEver);
          const onlyWhenLive = Boolean(rule?.onlyWhenLive);

          if (!actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' }, claimedWalletEvents: [] as any[] };

          if (!enabled || coins <= 0) {
            await recordAndMaybeClaimKick({
              providerEventId: onceEver ? stableProviderEventId({ provider: 'kick', rawPayloadJson: '{}', fallbackParts: ['follow', channelId, actorId] }) : `${messageId}:follow`,
              providerAccountId: actorId,
              eventType: 'twitch_follow',
              currency: 'twitch_units',
              amount: 1,
              coinsToGrant: 0,
              status: 'ignored',
              reason: enabled ? 'zero_coins' : 'auto_rewards_disabled',
            });
            return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
          }

          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') {
              await recordAndMaybeClaimKick({
                providerEventId: onceEver ? stableProviderEventId({ provider: 'kick', rawPayloadJson: '{}', fallbackParts: ['follow', channelId, actorId] }) : `${messageId}:follow`,
                providerAccountId: actorId,
                eventType: 'twitch_follow',
                currency: 'twitch_units',
                amount: 1,
                coinsToGrant: 0,
                status: 'ignored',
                reason: 'offline',
              });
              return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' }, claimedWalletEvents };
            }
          }

          await recordAndMaybeClaimKick({
            providerEventId: onceEver ? stableProviderEventId({ provider: 'kick', rawPayloadJson: '{}', fallbackParts: ['follow', channelId, actorId] }) : `${messageId}:follow`,
            providerAccountId: actorId,
            eventType: 'twitch_follow',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
          });
          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
        }

        // New subscription
        if (eventType === 'channel.subscription.new') {
          const rule = (cfg as any)?.subscribe ?? null;
          if (!actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' }, claimedWalletEvents: [] as any[] };
          if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' }, claimedWalletEvents: [] as any[] };

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' }, claimedWalletEvents: [] as any[] };
          }

          const coins = readTierCoins((rule as any)?.tierCoins, tier);
          if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' }, claimedWalletEvents: [] as any[] };

          await recordAndMaybeClaimKick({
            providerEventId: `${messageId}:sub`,
            providerAccountId: actorId,
            eventType: 'twitch_subscribe',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
          });
          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
        }

        // Subscription renewal
        if (eventType === 'channel.subscription.renewal') {
          const rule = (cfg as any)?.resubMessage ?? null;
          if (!actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' }, claimedWalletEvents: [] as any[] };
          if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' }, claimedWalletEvents: [] as any[] };

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' }, claimedWalletEvents: [] as any[] };
          }

          const tierCoins = readTierCoins((rule as any)?.tierCoins, tier);
          const bonus = Math.floor(safeNum((rule as any)?.bonusCoins ?? 0));
          const coins = tierCoins + (bonus > 0 ? bonus : 0);
          if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' }, claimedWalletEvents: [] as any[] };

          await recordAndMaybeClaimKick({
            providerEventId: `${messageId}:renewal`,
            providerAccountId: actorId,
            eventType: 'twitch_resub_message',
            currency: 'twitch_units',
            amount: 1,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
          });
          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
        }

        // Subscription gifts
        if (eventType === 'channel.subscription.gifts') {
          const rule = (cfg as any)?.giftSub ?? null;
          if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' }, claimedWalletEvents: [] as any[] };

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' }, claimedWalletEvents: [] as any[] };
          }

          const giverId = actorId;
          const giftsCount = total > 0 ? total : 1;
          const giverCoinsPerOne = readTierCoins((rule as any)?.giverTierCoins, tier);
          const giverCoins = giverCoinsPerOne > 0 ? giverCoinsPerOne * giftsCount : 0;
          const recipientCoins = Math.floor(safeNum((rule as any)?.recipientCoins ?? 0));

          if (giverId && giverCoins > 0) {
            await recordAndMaybeClaimKick({
              providerEventId: `${messageId}:gift_giver`,
              providerAccountId: giverId,
              eventType: 'twitch_gift_sub',
              currency: 'twitch_units',
              amount: giftsCount,
              coinsToGrant: giverCoins,
              status: 'eligible',
              reason: null,
            });
          }

          if (recipientCoins > 0 && recipients.length) {
            for (const rid of recipients) {
              await recordAndMaybeClaimKick({
                providerEventId: `${messageId}:gift_recipient:${rid}`,
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

          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
        }

        // Kicks gifted (donation-like)
        if (eventType === 'kicks.gifted') {
          const rule = (cfg as any)?.cheer ?? null;
          if (!actorId) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'missing_actor_id' }, claimedWalletEvents: [] as any[] };
          if (!rule?.enabled) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'auto_rewards_disabled' }, claimedWalletEvents: [] as any[] };

          const onlyWhenLive = Boolean(rule?.onlyWhenLive);
          if (onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'offline' }, claimedWalletEvents: [] as any[] };
          }

          const minKicks = Math.max(1, Math.floor(safeNum((rule as any)?.minBits ?? 1)));
          if (kicks <= 0 || kicks < minKicks) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'below_min' }, claimedWalletEvents: [] as any[] };

          const kicksPerCoin = Math.max(1, Math.floor(safeNum((rule as any)?.bitsPerCoin ?? 1)));
          const coins = Math.floor(kicks / kicksPerCoin);
          if (coins <= 0) return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'zero_coins' }, claimedWalletEvents: [] as any[] };

          await recordAndMaybeClaimKick({
            providerEventId: `${messageId}:kicks_gifted`,
            providerAccountId: actorId,
            eventType: 'twitch_cheer',
            currency: 'twitch_units',
            amount: kicks,
            coinsToGrant: coins,
            status: 'eligible',
            reason: null,
          });
          return { httpStatus: 200, body: { ok: true }, claimedWalletEvents };
        }

        return { httpStatus: 200, body: { ok: true, ignored: true, reason: 'unhandled' }, claimedWalletEvents: [] as any[] };
      });

      // Wallet updates (if any) AFTER commit.
      if (outcome.claimedWalletEvents?.length) {
        try {
          const io = (req.app as any)?.get?.('io');
          for (const ev of outcome.claimedWalletEvents) {
            emitWalletUpdated(io, ev);
            void relayWalletUpdatedToPeer(ev);
          }
        } catch {
          // ignore
        }
      }

      return res.status(outcome.httpStatus).json(outcome.body);
    }

    // channel.reward.*
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


