import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

const MAX_STYLE_JSON_LEN = 50_000;

function safeString(v: any): string {
  return typeof v === 'string' ? v : '';
}

export const getCreditsToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: {
        slug: true,
        creditsStyleJson: true,
        creditsTokenVersion: true,
      },
    });

    if (!channel?.slug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Long-lived token intended to be pasted into OBS. It is opaque and unguessable (signed).
    const token = jwt.sign(
      {
        kind: 'credits',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.creditsTokenVersion ?? 1,
      },
      process.env.JWT_SECRET!,
      // IMPORTANT: keep token stable across page reloads; rotation happens via tv increment.
      { noTimestamp: true }
    );

    return res.json({
      token,
      creditsStyleJson: (channel as any).creditsStyleJson ?? null,
    });
  } catch (e: any) {
    console.error('Error generating credits token:', e);
    return res.status(500).json({ error: 'Failed to generate credits token' });
  }
};

export const rotateCreditsToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  try {
    const channel = await prisma.channel.update({
      where: { id: channelId },
      data: {
        creditsTokenVersion: { increment: 1 },
      },
      select: {
        slug: true,
        creditsTokenVersion: true,
      },
    });

    if (!channel?.slug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    const token = jwt.sign(
      {
        kind: 'credits',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.creditsTokenVersion ?? 1,
      },
      process.env.JWT_SECRET!,
      { noTimestamp: true }
    );

    // Best-effort: disconnect existing credits overlay sockets so old leaked links stop working immediately.
    try {
      const io: Server = req.app.get('io');
      const slug = String(channel.slug).toLowerCase();
      const room = `channel:${slug}`;
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        if ((s.data as any)?.isCreditsOverlay) {
          s.disconnect(true);
        }
      }
    } catch (kickErr) {
      console.error('Error disconnecting credits overlay sockets after token rotation:', kickErr);
    }

    return res.json({ token });
  } catch (e: any) {
    console.error('Error rotating credits token:', e);
    return res.status(500).json({ error: 'Failed to rotate credits token' });
  }
};

export const saveCreditsSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const creditsStyleJsonRaw = safeString((req.body as any)?.creditsStyleJson);
  const creditsStyleJson = creditsStyleJsonRaw.trim();
  if (!creditsStyleJson) {
    // Allow clearing by sending empty string? MVP: treat empty as null.
    try {
      const updated = await prisma.channel.update({
        where: { id: channelId },
        data: { creditsStyleJson: null },
        select: { slug: true, creditsStyleJson: true },
      });

      // Push config to connected credits overlay clients.
      try {
        const io: Server = req.app.get('io');
        const slug = String(updated.slug || '').toLowerCase();
        if (slug) {
          io.to(`channel:${slug}`).emit('credits:config', {
            creditsStyleJson: (updated as any).creditsStyleJson ?? null,
          });
        }
      } catch (emitErr) {
        console.error('Error emitting credits:config after settings update:', emitErr);
      }

      return res.json({ ok: true, creditsStyleJson: null });
    } catch (e: any) {
      console.error('Error saving credits settings:', e);
      return res.status(500).json({ error: 'Failed to save credits settings' });
    }
  }

  if (creditsStyleJson.length > MAX_STYLE_JSON_LEN) {
    return res.status(400).json({ error: `creditsStyleJson is too large (max ${MAX_STYLE_JSON_LEN})` });
  }

  // Optional parse (minimal validation) — do not reject if JSON is invalid, just store as-is (MVP).
  try {
    JSON.parse(creditsStyleJson);
  } catch {
    // ignore
  }

  try {
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { creditsStyleJson },
      select: { slug: true, creditsStyleJson: true },
    });

    // Push config to connected credits overlay clients.
    try {
      const io: Server = req.app.get('io');
      const slug = String(updated.slug || '').toLowerCase();
      if (slug) {
        io.to(`channel:${slug}`).emit('credits:config', {
          creditsStyleJson: (updated as any).creditsStyleJson ?? null,
        });
      }
    } catch (emitErr) {
      console.error('Error emitting credits:config after settings update:', emitErr);
    }

    return res.json({ ok: true, creditsStyleJson: (updated as any).creditsStyleJson ?? null });
  } catch (e: any) {
    console.error('Error saving credits settings:', e);
    return res.status(500).json({ error: 'Failed to save credits settings' });
  }
};


