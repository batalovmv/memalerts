import type { Request, Response } from 'express';
import { prisma } from '../../lib/prisma.js';
import { addCreditsChatter, addCreditsDonor } from '../../realtime/creditsSessionStore.js';
import type { Server } from 'socket.io';
import { emitCreditsState } from '../../realtime/creditsState.js';

// Reuse the same internal header name pattern as other relays.
const INTERNAL_HEADER = 'x-memalerts-internal';
const INTERNAL_HEADER_VALUE = 'credits-event';

function isLocalRequest(req: Request): boolean {
  const remote = req.socket.remoteAddress || '';
  return remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1');
}

function isInternal(req: Request): boolean {
  const v = (req.headers as any)[INTERNAL_HEADER] || (req.headers as any)[INTERNAL_HEADER.toLowerCase()];
  return v === INTERNAL_HEADER_VALUE;
}

function toSlug(v: any): string {
  return String(v || '').trim().toLowerCase();
}

export const creditsInternalController = {
  chatter: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const slug = toSlug((req.body as any)?.channelSlug);
    const userId = String((req.body as any)?.userId || '').trim();
    const displayName = String((req.body as any)?.displayName || '').trim();
    if (!slug || !userId || !displayName) return res.status(400).json({ error: 'Bad Request' });

    const channel = await prisma.channel.findUnique({
      where: { slug },
      select: { creditsReconnectWindowMinutes: true },
    });
    const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
      ? Number((channel as any).creditsReconnectWindowMinutes)
      : 60;

    await addCreditsChatter(slug, userId, displayName, windowMin);

    // Best-effort: push fresh state to connected overlays immediately.
    try {
      const io: Server | undefined = (req.app as any)?.get?.('io');
      if (io) {
        await emitCreditsState(io, slug);
      }
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  },

  donor: async (req: Request, res: Response) => {
    if (!isLocalRequest(req) || !isInternal(req)) return res.status(404).json({ error: 'Not Found' });

    const slug = toSlug((req.body as any)?.channelSlug);
    const name = String((req.body as any)?.name || '').trim();
    const amount = Number((req.body as any)?.amount);
    const currency = String((req.body as any)?.currency || 'RUB').trim();
    if (!slug || !name || !Number.isFinite(amount)) return res.status(400).json({ error: 'Bad Request' });

    const channel = await prisma.channel.findUnique({
      where: { slug },
      select: { creditsReconnectWindowMinutes: true },
    });
    const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
      ? Number((channel as any).creditsReconnectWindowMinutes)
      : 60;

    await addCreditsDonor(slug, name, amount, currency, windowMin);

    // Best-effort: push fresh state to connected overlays immediately.
    try {
      const io: Server | undefined = (req.app as any)?.get?.('io');
      if (io) {
        await emitCreditsState(io, slug);
      }
    } catch {
      // ignore
    }
    return res.json({ ok: true });
  },
};


