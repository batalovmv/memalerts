import { asRecord } from './vkvideoChatbotShared.js';

export function extractFirstMentionIdFromParts(parts: unknown): string | null {
  if (!Array.isArray(parts)) return null;
  for (const p of parts) {
    const rec = asRecord(p);
    const mentionRec = asRecord(rec.mention);
    const id = mentionRec.id ?? null;
    const s = String(id ?? '').trim();
    if (s) return s;
  }
  return null;
}

export function extractVkVideoFollowOrSubscriptionAlert(pubData: unknown): {
  kind: 'follow' | 'subscribe';
  providerAccountId: string;
  providerEventId: string | null;
  eventAt: Date | null;
} | null {
  const root = asRecord(pubData);
  const type = String(root.type ?? root.event ?? root.name ?? '')
    .trim()
    .toLowerCase();
  if (!type) return null;

  const isFollow = type.includes('follow');
  const isSub = type.includes('subscription') || type.includes('subscribe') || type.includes('sub');
  if (!isFollow && !isSub) return null;

  const rootData = asRecord(root.data);
  const ev = asRecord(rootData.event ?? rootData.data ?? rootData);

  const maybeMsg = asRecord(ev.message ?? ev.chat_message ?? ev);
  const parts = maybeMsg.parts ?? ev.parts ?? rootData.parts ?? asRecord(rootData.message).parts ?? null;

  const providerAccountId = String(
    asRecord(ev.user).id ??
      asRecord(ev.viewer).id ??
      asRecord(ev.from).id ??
      ev.user_id ??
      extractFirstMentionIdFromParts(parts) ??
      ''
  ).trim();
  if (!providerAccountId) return null;

  const providerEventId = String(ev.id ?? ev.event_id ?? ev.message_id ?? rootData.id ?? '').trim() || null;

  const eventAt = (() => {
    const ts = ev.created_at ?? ev.createdAt ?? ev.timestamp ?? rootData.timestamp ?? null;
    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts || ''));
    return Number.isFinite(ms) ? new Date(ms) : null;
  })();

  return { kind: isFollow ? 'follow' : 'subscribe', providerAccountId, providerEventId, eventAt };
}

export function extractVkVideoChannelPointsRedemption(pubData: unknown): {
  providerAccountId: string;
  amount: number;
  rewardId: string | null;
  providerEventId: string | null;
  eventAt: Date | null;
} | null {
  const root = asRecord(pubData);
  const type = String(root.type ?? root.event ?? root.name ?? '')
    .trim()
    .toLowerCase();
  if (type && !type.includes('channel_points') && !type.includes('channelpoints') && !type.includes('points'))
    return null;

  const rootData = asRecord(root.data);
  const ev = asRecord(rootData.event ?? rootData.redemption ?? rootData);

  const providerAccountId = String(
    asRecord(ev.user).id ?? asRecord(ev.viewer).id ?? asRecord(ev.from).id ?? ev.user_id ?? ''
  ).trim();
  if (!providerAccountId) return null;

  const reward = asRecord(ev.reward);
  const amountRaw = ev.cost ?? ev.amount ?? ev.points ?? ev.value ?? reward.cost ?? null;
  const amount = Number.isFinite(Number(amountRaw)) ? Math.floor(Number(amountRaw)) : 0;
  if (amount <= 0) return null;

  const rewardId = String(reward.id ?? ev.reward_id ?? reward.uuid ?? '').trim() || null;
  const providerEventId = String(ev.id ?? ev.redemption_id ?? ev.event_id ?? '').trim() || null;

  const eventAt = (() => {
    const ts = ev.created_at ?? ev.createdAt ?? ev.timestamp ?? rootData.timestamp ?? null;
    const ms = typeof ts === 'number' ? ts : Date.parse(String(ts || ''));
    return Number.isFinite(ms) ? new Date(ms) : null;
  })();

  return { providerAccountId, amount, rewardId, providerEventId, eventAt };
}
