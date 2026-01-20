import type { Server } from 'socket.io';
import { getCreditsStateFromStore, type CreditsState } from './creditsSessionStore.js';

// Per-channel ticker to periodically push credits:state (MVP: no incremental events).
const channelTickers = new Map<string, { timer: NodeJS.Timeout; refs: number }>();

function normalizeSlug(slug: string): string {
  return String(slug || '')
    .trim()
    .toLowerCase();
}

export async function emitCreditsState(io: Server, channelSlug: string): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  const state: CreditsState = await getCreditsStateFromStore(slug);
  io.to(`channel:${slug}`).emit('credits:state', state);
}

export function startCreditsTicker(io: Server, channelSlug: string, intervalMs = 5000): void {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;

  const existing = channelTickers.get(slug);
  if (existing) {
    existing.refs += 1;
    return;
  }

  const timer = setInterval(
    () => {
      void emitCreditsState(io, slug);
    },
    Math.max(1000, intervalMs)
  );
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
