import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

export const getOverlayToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        slug: true,
        overlayMode: true,
        overlayShowSender: true,
        overlayMaxConcurrent: true,
        overlayStyleJson: true,
        overlayTokenVersion: true,
      },
    });

    if (!channel?.slug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Long-lived token intended to be pasted into OBS. It is opaque and unguessable (signed).
    // Environment separation is preserved because JWT_SECRET differs between beta and production.
    const token = jwt.sign(
      {
        kind: 'overlay',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.overlayTokenVersion ?? 1,
      },
      process.env.JWT_SECRET!,
      // IMPORTANT: keep token stable across page reloads.
      // We avoid iat/exp so the string doesn't change unless streamer explicitly rotates it.
      { noTimestamp: true }
    );

    return res.json({
      token,
      overlayMode: channel.overlayMode ?? 'queue',
      overlayShowSender: channel.overlayShowSender ?? false,
      overlayMaxConcurrent: channel.overlayMaxConcurrent ?? 3,
      overlayStyleJson: (channel as any).overlayStyleJson ?? null,
    });
  } catch (e: any) {
    console.error('Error generating overlay token:', e);
    return res.status(500).json({ error: 'Failed to generate overlay token' });
  }
};

export const rotateOverlayToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        overlayTokenVersion: { increment: 1 },
      },
      select: {
        slug: true,
        overlayMode: true,
        overlayShowSender: true,
        overlayMaxConcurrent: true,
        overlayTokenVersion: true,
      },
    });

    if (!channel?.slug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const token = jwt.sign(
      {
        kind: 'overlay',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.overlayTokenVersion ?? 1,
        // NOTE: keep payload deterministic (no jti/iat/exp). Rotation is done via tv increment.
      },
      process.env.JWT_SECRET!,
      // No iat/exp: keep the token deterministic (stable for this tv).
      { noTimestamp: true }
    );

    // Best-effort: disconnect existing overlay sockets so old leaked links stop "working" immediately.
    // Otherwise, an already-connected OBS Browser Source would keep receiving activations until reloaded.
    try {
      const io: Server = req.app.get('io');
      const slug = String(channel.slug).toLowerCase();
      const room = `channel:${slug}`;
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        if ((s.data as any)?.isOverlay) {
          s.disconnect(true);
        }
      }
    } catch (kickErr) {
      console.error('Error disconnecting overlay sockets after token rotation:', kickErr);
    }

    return res.json({
      token,
      overlayMode: channel.overlayMode ?? 'queue',
      overlayShowSender: channel.overlayShowSender ?? false,
      overlayMaxConcurrent: channel.overlayMaxConcurrent ?? 3,
    });
  } catch (e: any) {
    console.error('Error rotating overlay token:', e);
    return res.status(500).json({ error: 'Failed to rotate overlay token' });
  }
};

// OBS overlay preview: return a "familiar" random meme for live preview in Admin UI.
// Priority:
// 1) Random approved meme from the streamer's channel pool
// 2) Random approved meme created by current user (any channel)
// 3) Random approved meme globally
export const getOverlayPreviewMeme = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const pick = async (whereSql: string, params: any[]) => {
    const rows = await prisma.$queryRawUnsafe<Array<{ id: string; type: string; fileUrl: string; title: string; channelId: string }>>(
      `
        SELECT "id", "type", "fileUrl", "title", "channelId"
        FROM "Meme"
        WHERE "status" = 'approved' ${whereSql}
        ORDER BY RANDOM()
        LIMIT 1
      `,
      ...params
    );
    return rows?.[0] || null;
  };

  try {
    let meme = channelId ? await pick(`AND "channelId" = $1`, [channelId]) : null;

    if (!meme) {
      meme = await pick(`AND "createdByUserId" = $1`, [userId]);
    }

    if (!meme) {
      meme = await pick(``, []);
    }

    if (!meme) {
      return res.json({ meme: null });
    }

    return res.json({
      meme: {
        id: meme.id,
        type: meme.type,
        fileUrl: meme.fileUrl,
        title: meme.title,
        channelId: meme.channelId,
      },
    });
  } catch (e: any) {
    console.error('Error getting overlay preview meme:', e);
    return res.status(500).json({ error: 'Failed to get preview meme' });
  }
};


