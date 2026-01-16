import type { Request, Response } from 'express';
import type { Server } from 'socket.io';
import crypto from 'crypto';
import { prisma } from '../../lib/prisma.js';

function sha256Hex(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function resolveChannelByToken(token: string) {
  const t = String(token || '').trim();
  if (!t) return null;
  const hash = sha256Hex(t);
  return await prisma.channel.findUnique({
    where: { submissionsControlTokenHash: hash },
    select: { id: true, slug: true, submissionsEnabled: true, submissionsOnlyWhenLive: true },
  });
}

function emitStatus(io: Server, slug: string, enabled: boolean, onlyWhenLive: boolean) {
  const s = String(slug || '').toLowerCase();
  if (!s) return;
  io.to(`channel:${s}`).emit('submissions:status', { enabled, onlyWhenLive });
}

export const submissionsPublicControlController = {
  // GET /public/submissions/status?token=...
  status: async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const channel = await resolveChannelByToken(token);
    if (!channel) return res.status(404).json({ error: 'Not Found' });
    return res.json({
      ok: true,
      submissions: { enabled: !!channel.submissionsEnabled, onlyWhenLive: !!channel.submissionsOnlyWhenLive },
    });
  },

  // POST /public/submissions/enable?token=...
  enable: async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const channel = await resolveChannelByToken(token);
    if (!channel) return res.status(404).json({ error: 'Not Found' });

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { submissionsEnabled: true },
      select: { slug: true, submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });

    try {
      const io: Server = req.app.get('io');
      emitStatus(io, String(updated.slug), !!updated.submissionsEnabled, !!updated.submissionsOnlyWhenLive);
    } catch {
      // ignore
    }

    return res.json({
      ok: true,
      submissions: { enabled: !!updated.submissionsEnabled, onlyWhenLive: !!updated.submissionsOnlyWhenLive },
    });
  },

  // POST /public/submissions/disable?token=...
  disable: async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const channel = await resolveChannelByToken(token);
    if (!channel) return res.status(404).json({ error: 'Not Found' });

    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { submissionsEnabled: false },
      select: { slug: true, submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });

    try {
      const io: Server = req.app.get('io');
      emitStatus(io, String(updated.slug), !!updated.submissionsEnabled, !!updated.submissionsOnlyWhenLive);
    } catch {
      // ignore
    }

    return res.json({
      ok: true,
      submissions: { enabled: !!updated.submissionsEnabled, onlyWhenLive: !!updated.submissionsOnlyWhenLive },
    });
  },

  // POST /public/submissions/toggle?token=...
  toggle: async (req: Request, res: Response) => {
    const token = String(req.query.token || '');
    const channel = await resolveChannelByToken(token);
    if (!channel) return res.status(404).json({ error: 'Not Found' });

    const nextEnabled = !channel.submissionsEnabled;
    const updated = await prisma.channel.update({
      where: { id: channel.id },
      data: { submissionsEnabled: nextEnabled },
      select: { slug: true, submissionsEnabled: true, submissionsOnlyWhenLive: true },
    });

    try {
      const io: Server = req.app.get('io');
      emitStatus(io, String(updated.slug), !!updated.submissionsEnabled, !!updated.submissionsOnlyWhenLive);
    } catch {
      // ignore
    }

    return res.json({
      ok: true,
      submissions: { enabled: !!updated.submissionsEnabled, onlyWhenLive: !!updated.submissionsOnlyWhenLive },
    });
  },
};
