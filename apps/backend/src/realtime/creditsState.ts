import type { Server } from 'socket.io';

export type CreditsState = {
  chatters: Array<{ name: string }>;
  donors: Array<{ name: string; amount: number; currency: string }>;
};

type Donor = { name: string; amount: number; currency: string; ts: number };
type Chatter = { name: string; ts: number };

const chattersByChannel = new Map<string, Map<string, Chatter>>(); // slug -> key -> chatter
const donorsByChannel = new Map<string, Map<string, Donor>>(); // slug -> key -> donor

// Per-channel ticker to periodically push credits:state (MVP: no incremental events).
const channelTickers = new Map<string, { timer: NodeJS.Timeout; refs: number }>();

function normalizeSlug(slug: string): string {
  return String(slug || '').trim().toLowerCase();
}

function normalizeName(name: string): string {
  // MVP: basic normalization. Twitch displayName can differ in casing.
  return String(name || '').trim();
}

function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}

export function getCreditsState(channelSlug: string): CreditsState {
  const slug = normalizeSlug(channelSlug);

  const chattersMap = chattersByChannel.get(slug);
  const donorsMap = donorsByChannel.get(slug);

  const chatters = chattersMap
    ? Array.from(chattersMap.values())
        .sort((a, b) => a.ts - b.ts)
        .map((c) => ({ name: c.name }))
    : [];

  const donors = donorsMap
    ? Array.from(donorsMap.values())
        .sort((a, b) => a.ts - b.ts)
        .map((d) => ({ name: d.name, amount: d.amount, currency: d.currency }))
    : [];

  return { chatters, donors };
}

export function touchChatter(channelSlug: string, displayName: string): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  const name = normalizeName(displayName);
  if (!name) return;

  const key = nameKey(name);
  const now = Date.now();
  const map = chattersByChannel.get(slug) ?? new Map<string, Chatter>();
  if (!chattersByChannel.has(slug)) chattersByChannel.set(slug, map);

  if (!map.has(key)) {
    map.set(key, { name, ts: now });
  }
}

export function recordDonor(channelSlug: string, donorName: string, amount: number, currency: string): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  const name = normalizeName(donorName);
  if (!name) return;
  if (!Number.isFinite(amount)) return;
  const cur = String(currency || '').trim().toUpperCase() || 'RUB';

  const key = nameKey(name);
  const now = Date.now();
  const map = donorsByChannel.get(slug) ?? new Map<string, Donor>();
  if (!donorsByChannel.has(slug)) donorsByChannel.set(slug, map);

  // MVP: unique donors, keep last amount/currency.
  map.set(key, { name, amount: Math.max(0, Number(amount)), currency: cur, ts: now });
}

export function emitCreditsState(io: Server, channelSlug: string): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  io.to(`channel:${slug}`).emit('credits:state', getCreditsState(slug));
}

export function startCreditsTicker(io: Server, channelSlug: string, intervalMs = 5000): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const existing = channelTickers.get(slug);
  if (existing) {
    existing.refs += 1;
    return;
  }

  const timer = setInterval(() => emitCreditsState(io, slug), Math.max(1000, intervalMs));
  channelTickers.set(slug, { timer, refs: 1 });
}

export function stopCreditsTicker(channelSlug: string): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const existing = channelTickers.get(slug);
  if (!existing) return;
  existing.refs -= 1;
  if (existing.refs > 0) return;
  clearInterval(existing.timer);
  channelTickers.delete(slug);
}


