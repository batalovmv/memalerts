import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import { createStreamOfflineEventSubSubscription, createStreamOnlineEventSubSubscription, deleteEventSubSubscription, getEventSubSubscriptions } from '../../utils/twitchApi.js';
import { resetCreditsSession } from '../../realtime/creditsSessionStore.js';
import { getCreditsStateFromStore } from '../../realtime/creditsSessionStore.js';

const MAX_STYLE_JSON_LEN = 50_000;

function safeString(v: any): string {
  return typeof v === 'string' ? v : '';
}

export const getCreditsToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;
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
        creditsReconnectWindowMinutes: true,
        twitchChannelId: true,
      },
    });

    if (!channel?.slug) {
      return res.status(404).json({ error: 'Channel not found' });
    }

    // Best-effort: ensure EventSub stream.online/offline exists for reconnect window handling.
    // Do not fail token issuance if Twitch/permissions are missing.
    try {
      if (channel.twitchChannelId && process.env.TWITCH_EVENTSUB_SECRET) {
        const domain = process.env.DOMAIN || 'twitchmemes.ru';
        const reqHost = req.get('host') || '';
        const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
        const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
        const webhookUrl = `${apiBaseUrl}/webhooks/twitch/eventsub`;

        const existing = await getEventSubSubscriptions(channel.twitchChannelId);
        const subs = Array.isArray(existing?.data) ? existing.data : [];
        const wantTypes = new Set(['stream.online', 'stream.offline']);
        const relevant = subs.filter(
          (s: any) =>
            wantTypes.has(s?.type) && (s.status === 'enabled' || s.status === 'webhook_callback_verification_pending' || s.status === 'authorization_revoked')
        );

        // Delete mismatched callbacks so we can re-register deterministically.
        const mismatched = relevant.filter((s: any) => s?.transport?.callback !== webhookUrl);
        for (const s of mismatched) {
          try {
            await deleteEventSubSubscription(s.id);
          } catch (e) {
            // ignore
          }
        }

        const hasOnline = relevant.some((s: any) => s.type === 'stream.online' && s?.transport?.callback === webhookUrl);
        const hasOffline = relevant.some((s: any) => s.type === 'stream.offline' && s?.transport?.callback === webhookUrl);

        if (!hasOnline) {
          await createStreamOnlineEventSubSubscription({
            broadcasterId: channel.twitchChannelId,
            webhookUrl,
            secret: process.env.TWITCH_EVENTSUB_SECRET!,
          });
        }
        if (!hasOffline) {
          await createStreamOfflineEventSubSubscription({
            broadcasterId: channel.twitchChannelId,
            webhookUrl,
            secret: process.env.TWITCH_EVENTSUB_SECRET!,
          });
        }
      }
    } catch (e: any) {
      console.warn('[credits] ensure stream online/offline EventSub failed (continuing):', {
        userId: userId || null,
        channelId,
        errorMessage: e?.message || String(e),
      });
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

export const setCreditsReconnectWindow = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  const raw = Number((req.body as any)?.minutes);
  const minutes = Number.isFinite(raw) ? Math.max(1, Math.min(24 * 60, Math.floor(raw))) : 60;

  try {
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { creditsReconnectWindowMinutes: minutes },
      select: { creditsReconnectWindowMinutes: true },
    });
    return res.json({ creditsReconnectWindowMinutes: (updated as any).creditsReconnectWindowMinutes ?? minutes });
  } catch (e: any) {
    console.error('Error updating creditsReconnectWindowMinutes:', e);
    return res.status(500).json({ error: 'Failed to update reconnect window' });
  }
};

export const resetCredits = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, creditsReconnectWindowMinutes: true },
    });
    const slug = String((channel as any)?.slug || '').toLowerCase();
    if (!slug) return res.status(404).json({ error: 'Channel not found' });

    const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
      ? Number((channel as any).creditsReconnectWindowMinutes)
      : 60;

    await resetCreditsSession(slug, windowMin);

    // Notify overlays immediately (they'll re-render on next state push too).
    try {
      const io: Server = req.app.get('io');
      io.to(`channel:${slug}`).emit('credits:state', { chatters: [], donors: [] });
    } catch {
      // ignore
    }

    return res.json({ ok: true });
  } catch (e: any) {
    console.error('Error resetting credits:', e);
    return res.status(500).json({ error: 'Failed to reset credits' });
  }
};

export const getCreditsState = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, creditsReconnectWindowMinutes: true },
    });
    const slug = String((channel as any)?.slug || '').toLowerCase();
    if (!slug) return res.status(404).json({ error: 'Channel not found' });

    const state = await getCreditsStateFromStore(slug);
    const windowMin = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
      ? Number((channel as any).creditsReconnectWindowMinutes)
      : 60;
    return res.json({
      channelSlug: slug,
      creditsReconnectWindowMinutes: windowMin,
      chatters: state.chatters || [],
      donors: state.donors || [],
    });
  } catch (e: any) {
    console.error('Error getting credits state:', e);
    return res.status(500).json({ error: 'Failed to get credits state' });
  }
};

export const getCreditsReconnectWindow = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { creditsReconnectWindowMinutes: true },
    });
    const minutes = Number.isFinite((channel as any)?.creditsReconnectWindowMinutes)
      ? Number((channel as any).creditsReconnectWindowMinutes)
      : 60;
    return res.json({ creditsReconnectWindowMinutes: minutes });
  } catch (e: any) {
    console.error('Error getting creditsReconnectWindowMinutes:', e);
    return res.status(500).json({ error: 'Failed to get reconnect window' });
  }
};

export const getCreditsIgnoredChatters = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  try {
    const ch = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { creditsIgnoredChattersJson: true },
    });
    const list = Array.isArray((ch as any)?.creditsIgnoredChattersJson) ? (ch as any).creditsIgnoredChattersJson : [];
    return res.json({ creditsIgnoredChatters: list });
  } catch (e: any) {
    console.error('Error getting credits ignored chatters:', e);
    return res.status(500).json({ error: 'Failed to get ignored chatters' });
  }
};

export const setCreditsIgnoredChatters = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) return res.status(400).json({ error: 'Channel ID required' });

  const raw = (req.body as any)?.creditsIgnoredChatters;
  const arr = Array.isArray(raw) ? raw : [];
  const cleaned: string[] = [];
  for (const v of arr) {
    const s = String(v ?? '').trim();
    if (!s) continue;
    if (s.length > 64) continue;
    if (!cleaned.includes(s)) cleaned.push(s);
  }
  // cap to keep payload small
  const capped = cleaned.slice(0, 200);

  try {
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { creditsIgnoredChattersJson: capped as any },
      select: { creditsIgnoredChattersJson: true },
    });
    return res.json({ creditsIgnoredChatters: (updated as any)?.creditsIgnoredChattersJson ?? capped });
  } catch (e: any) {
    console.error('Error setting credits ignored chatters:', e);
    return res.status(500).json({ error: 'Failed to set ignored chatters' });
  }
};


