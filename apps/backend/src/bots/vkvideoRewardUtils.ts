type MentionPart = { mention?: { id?: unknown } };

export function extractFirstMentionIdFromParts(parts: MentionPart[] | null | undefined): string | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const id = (part && part.mention && part.mention.id) ?? null;
    if (id === null || id === undefined) continue;
    const value = String(id).trim();
    if (value) return value;
  }
  return null;
}

export function extractVkVideoFollowOrSubscriptionAlert(payload: {
  type?: string;
  data?: { event?: { user?: { id?: unknown }; id?: unknown; created_at?: unknown } };
}): { kind: 'follow' | 'subscription'; providerAccountId: string; providerEventId: string; occurredAt: string } | null {
  const type = String(payload.type || '').trim();
  if (type !== 'follow' && type !== 'subscription') return null;

  const event = payload.data?.event;
  const providerAccountId = String(event?.user?.id ?? '').trim();
  const providerEventId = String(event?.id ?? '').trim();
  const occurredAt = String(event?.created_at ?? '').trim();

  if (!providerAccountId || !providerEventId) return null;

  return {
    kind: type,
    providerAccountId,
    providerEventId,
    occurredAt: occurredAt || new Date().toISOString(),
  };
}

export function extractVkVideoChannelPointsRedemption(payload: {
  type?: string;
  data?: {
    redemption?: {
      user?: { id?: unknown };
      amount?: unknown;
      reward?: { id?: unknown };
      id?: unknown;
      created_at?: unknown;
    };
  };
}): {
  providerAccountId: string;
  amount: number;
  rewardId: string;
  providerEventId: string;
  occurredAt: string;
} | null {
  if (String(payload.type || '').trim() !== 'channel_points') return null;
  const redemption = payload.data?.redemption;
  const providerAccountId = String(redemption?.user?.id ?? '').trim();
  const rewardId = String(redemption?.reward?.id ?? '').trim();
  const providerEventId = String(redemption?.id ?? '').trim();
  const amount = Number(redemption?.amount ?? 0);
  const occurredAt = String(redemption?.created_at ?? '').trim();

  if (!providerAccountId || !rewardId || !providerEventId) return null;

  return {
    providerAccountId,
    amount: Number.isFinite(amount) ? amount : 0,
    rewardId,
    providerEventId,
    occurredAt: occurredAt || new Date().toISOString(),
  };
}
