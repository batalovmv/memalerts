import type { Response } from 'express';
import type { Request } from 'express';

import { prisma } from '../../lib/prisma.js';

function safeParseTheme(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return undefined;
  }
  return undefined;
}

export const getActiveEvents = async (_req: Request, res: Response) => {
  const now = new Date();
  const events = await prisma.seasonalEvent.findMany({
    where: {
      startsAt: { lte: now },
      endsAt: { gte: now },
    },
    orderBy: { startsAt: 'desc' },
  });

  return res.json({
    events: events.map((event) => ({
      id: event.id,
      key: event.key,
      title: event.title,
      description: event.description ?? null,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      theme: safeParseTheme(event.themeJson),
    })),
  });
};
