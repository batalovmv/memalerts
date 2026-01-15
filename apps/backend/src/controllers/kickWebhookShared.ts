import type { Request } from 'express';

export type KickWebhookRequest = Request & { rawBody?: Buffer };

export type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getKickEventRec(payload: unknown): Record<string, unknown> {
  const rootRec = asRecord(payload);
  const dataRec = asRecord(rootRec.data ?? {});
  return asRecord(dataRec.event ?? rootRec.event ?? rootRec);
}

export function safeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseTimestampMs(raw: unknown): number | null {
  const s = safeString(raw);
  if (!s) return null;
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? ms : null;
}

export function getHeader(req: Request, name: string): string {
  const headers = asRecord(req.headers);
  const v = headers[name] ?? headers[name.toLowerCase()];
  return String(v ?? '').trim();
}

export function normalizeMessage(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .trim();
}

export function normalizeLogin(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '');
}

export function safeNum(value: unknown): number {
  const x = Number(value);
  return Number.isFinite(x) ? x : 0;
}

export function readTierCoins(map: unknown, tier: string): number {
  if (!map || typeof map !== 'object') return 0;
  const key = String(tier || '').trim();
  const v = asRecord(map)[key];
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function utcDayKey(d: Date): string {
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function utcDayKeyYesterday(d: Date): string {
  const prev = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - 24 * 60 * 60 * 1000);
  return utcDayKey(prev);
}

export function normalizeAllowedUsersList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const login = normalizeLogin(v);
    if (!login) continue;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

export function normalizeAllowedRolesList(raw: unknown): ChatCommandRole[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '')
      .trim()
      .toLowerCase() as ChatCommandRole;
    if (!role) continue;
    if (role !== 'vip' && role !== 'moderator' && role !== 'subscriber' && role !== 'follower') continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

export type ChatAutoRewardsCfg = {
  dailyStreak?: {
    enabled?: boolean;
    coinsByStreak?: Record<string, number>;
    coinsPerDay?: number;
  };
  firstMessage?: {
    enabled?: boolean;
    coins?: number;
    onlyWhenLive?: boolean;
  };
  messageThresholds?: {
    enabled?: boolean;
    onlyWhenLive?: boolean;
    thresholds?: number[];
    coinsByThreshold?: Record<string, number>;
  };
};

export type AutoRewardsCfg = {
  chat?: ChatAutoRewardsCfg;
  follow?: {
    enabled?: boolean;
    coins?: number;
    onceEver?: boolean;
    onlyWhenLive?: boolean;
  };
  subscribe?: {
    enabled?: boolean;
    tierCoins?: Record<string, number>;
    onlyWhenLive?: boolean;
  };
  resubMessage?: {
    enabled?: boolean;
    tierCoins?: Record<string, number>;
    bonusCoins?: number;
    onlyWhenLive?: boolean;
  };
  giftSub?: {
    enabled?: boolean;
    giverTierCoins?: Record<string, number>;
    recipientCoins?: number;
    onlyWhenLive?: boolean;
  };
  cheer?: {
    enabled?: boolean;
    minBits?: number;
    bitsPerCoin?: number;
    onlyWhenLive?: boolean;
  };
};

export function errCode(e: unknown): string | undefined {
  const rec = asRecord(e);
  const candidate = rec.code ?? asRecord(rec.error).code;
  return typeof candidate === 'string' ? candidate : undefined;
}

export function safeErrorMessage(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  const rec = asRecord(e);
  const nested = asRecord(rec.error);
  const message = rec.message ?? nested.message ?? '';
  const normalized = safeString(message);
  return normalized || String(e ?? '');
}

export function parseAutoRewardsCfg(value: unknown): AutoRewardsCfg | null {
  if (!value) return null;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === 'object' && parsed !== null ? (parsed as AutoRewardsCfg) : null;
    } catch {
      return null;
    }
  }
  if (typeof value === 'object') return value as AutoRewardsCfg;
  return null;
}

export function emptyWalletEvents<T>(): T[] {
  return [];
}

export function canTriggerCommand(opts: {
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

export function extractKickRewardRedemption(payload: unknown): {
  kickChannelId: string | null;
  providerAccountId: string | null;
  rewardId: string | null;
  amount: number;
  status: string | null;
  providerEventId: string | null;
  eventAt: Date | null;
} {
  const rootRec = asRecord(payload);
  const eventRec = getKickEventRec(payload);
  const redemptionRec = asRecord(eventRec.redemption ?? eventRec);

  const redemptionChannel = asRecord(redemptionRec.channel);
  const eventChannel = asRecord(eventRec.channel);
  const eventBroadcaster = asRecord(eventRec.broadcaster);
  const redeemerRec = asRecord(redemptionRec.redeemer);
  const redemptionUserRec = asRecord(redemptionRec.user);
  const eventUserRec = asRecord(eventRec.user);
  const eventViewerRec = asRecord(eventRec.viewer);
  const eventSenderRec = asRecord(eventRec.sender);

  const kickChannelId =
    safeString(
      redemptionChannel.id ??
        eventChannel.id ??
        eventBroadcaster.id ??
        redemptionRec.channel_id ??
        eventRec.channel_id ??
        rootRec.channel_id
    ) || null;
  const providerAccountId =
    safeString(
      redeemerRec.id ??
        redemptionUserRec.id ??
        eventUserRec.id ??
        eventViewerRec.id ??
        eventSenderRec.id ??
        redemptionRec.user_id ??
        eventRec.user_id
    ) || null;

  const rewardRec = asRecord(redemptionRec.reward ?? eventRec.reward ?? {});
  const rewardId = safeString(rewardRec.id ?? rewardRec.reward_id ?? redemptionRec.reward_id ?? null) || null;
  const amount = Math.floor(safeNum(redemptionRec.amount ?? rewardRec.cost ?? rewardRec.points ?? rewardRec.value ?? 0));
  const status = safeString(redemptionRec.status ?? redemptionRec.state ?? eventRec.status ?? null) || null;

  const providerEventId =
    safeString(redemptionRec.id ?? redemptionRec.redemption_id ?? eventRec.id ?? eventRec.redemption_id ?? null) || null;

  const eventAt = (() => {
    const ts =
      redemptionRec.created_at ?? redemptionRec.createdAt ?? redemptionRec.timestamp ?? redemptionRec.time ?? rootRec.timestamp ?? null;
    const ms = parseTimestampMs(ts);
    return ms ? new Date(ms) : null;
  })();

  return { kickChannelId, providerAccountId, rewardId, amount, status, providerEventId, eventAt };
}

export function extractKickChannelId(payload: unknown): string | null {
  const rootRec = asRecord(payload);
  const eventRec = getKickEventRec(payload);
  const channelRec = asRecord(eventRec.channel ?? eventRec.broadcaster ?? {});
  const kickChannelId =
    safeString(
      channelRec.id ??
        channelRec.user_id ??
        channelRec.channel_id ??
        eventRec.channel_id ??
        eventRec.broadcaster_user_id ??
        rootRec.channel_id ??
        rootRec.broadcaster_user_id
    ) || null;
  return kickChannelId;
}

export function extractKickActorUserId(payload: unknown): string | null {
  const rootRec = asRecord(payload);
  const eventRec = getKickEventRec(payload);
  const actorRec = asRecord(
    eventRec.user ??
      eventRec.sender ??
      eventRec.viewer ??
      eventRec.actor ??
      eventRec.follower ??
      eventRec.gifter ??
      eventRec.subscriber ??
      eventRec.member ??
      {}
  );
  const actorId =
    safeString(
      actorRec.id ??
        actorRec.user_id ??
        actorRec.userId ??
        eventRec.user_id ??
        eventRec.viewer_id ??
        eventRec.sender_id ??
        eventRec.follower_id ??
        eventRec.gifter_id ??
        rootRec.user_id ??
        rootRec.sender_id
    ) || null;
  return actorId;
}

export function extractKickRecipientsUserIds(payload: unknown): string[] {
  const eventRec = getKickEventRec(payload);
  const recipients = asRecord(eventRec.recipients ?? eventRec.gifted ?? eventRec.recipient ?? {});
  const listRaw = Array.isArray(recipients) ? recipients : Array.isArray(recipients.users) ? recipients.users : [];
  const out: string[] = [];
  for (const item of listRaw) {
    const rec = asRecord(item);
    const id = safeString(rec.id ?? rec.user_id ?? rec.userId ?? rec.viewer_id ?? '');
    if (id && !out.includes(id)) out.push(id);
  }
  return out;
}

export function extractKickCount(payload: unknown): number {
  const eventRec = getKickEventRec(payload);
  const count =
    eventRec.count ?? eventRec.total ?? eventRec.quantity ?? eventRec.gifts ?? eventRec.gift_count ?? null;
  const n = Math.floor(safeNum(count));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function extractKickKicksAmount(payload: unknown): number {
  const eventRec = getKickEventRec(payload);
  const value = eventRec.kicks ?? eventRec.amount ?? eventRec.value ?? eventRec.total ?? null;
  const n = Math.floor(safeNum(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function extractKickTier(payload: unknown): string {
  const eventRec = getKickEventRec(payload);
  const tier =
    eventRec.tier ?? eventRec.sub_tier ?? eventRec.subTier ?? eventRec.subscription_tier ?? eventRec.subscriptionTier ?? null;
  const normalized = safeString(tier);
  return normalized || '1000';
}

export function extractKickEventAt(payload: unknown): Date | null {
  const rootRec = asRecord(payload);
  const eventRec = getKickEventRec(payload);
  const ts =
    eventRec.created_at ?? eventRec.createdAt ?? eventRec.timestamp ?? eventRec.time ?? rootRec.timestamp ?? null;
  const ms = parseTimestampMs(ts);
  return ms ? new Date(ms) : null;
}
