import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import { signJwt } from '../../utils/jwt.js';
import {
  createStreamOfflineEventSubSubscription,
  createStreamOnlineEventSubSubscription,
  deleteEventSubSubscription,
  getEventSubSubscriptions,
} from '../../utils/twitchApi.js';
import { resetCreditsSession } from '../../realtime/creditsSessionStore.js';
import { getCreditsStateFromStore } from '../../realtime/creditsSessionStore.js';
import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';
import { logger } from '../../utils/logger.js';

const MAX_STYLE_JSON_LEN = 50_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function safeString(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export const getCreditsToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
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
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });
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
        const relevant = subs
          .map((s) => asRecord(s))
          .filter(
            (s) =>
              wantTypes.has(String(s.type)) &&
              (s.status === 'enabled' ||
                s.status === 'webhook_callback_verification_pending' ||
                s.status === 'authorization_revoked')
          );

        // Delete mismatched callbacks so we can re-register deterministically.
        const mismatched = relevant.filter((s) => asRecord(s.transport).callback !== webhookUrl);
        for (const s of mismatched) {
          try {
            await deleteEventSubSubscription(String(s.id));
          } catch {
            // ignore
          }
        }

        const hasOnline = relevant.some(
          (s) => s.type === 'stream.online' && asRecord(s.transport).callback === webhookUrl
        );
        const hasOffline = relevant.some(
          (s) => s.type === 'stream.offline' && asRecord(s.transport).callback === webhookUrl
        );

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
    } catch (e: unknown) {
      logger.warn('credits_overlay.eventsub_ensure_failed', {
        userId: userId || null,
        channelId,
        errorMessage: getErrorMessage(e),
      });
    }

    // Long-lived token intended to be pasted into OBS. It is opaque and unguessable (signed).
    const token = signJwt(
      {
        kind: 'credits',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.creditsTokenVersion ?? 1,
      },
      // IMPORTANT: keep token stable across page reloads; rotation happens via tv increment.
      { noTimestamp: true }
    );

    return res.json({
      token,
      creditsStyleJson: channel.creditsStyleJson ?? null,
    });
  } catch (e: unknown) {
    logger.error('credits_overlay.token_generate_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const rotateCreditsToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
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
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });
    }

    const token = signJwt(
      {
        kind: 'credits',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.creditsTokenVersion ?? 1,
      },
      { noTimestamp: true }
    );

    // Best-effort: disconnect existing credits overlay sockets so old leaked links stop working immediately.
    try {
      const io: Server = req.app.get('io');
      const slug = String(channel.slug).toLowerCase();
      const room = `channel:${slug}`;
      const sockets = await io.in(room).fetchSockets();
      for (const s of sockets) {
        const dataRec = asRecord(s.data);
        if (dataRec.isCreditsOverlay) {
          s.disconnect(true);
        }
      }
    } catch (kickErr) {
      logger.error('credits_overlay.socket_disconnect_failed', { errorMessage: getErrorMessage(kickErr) });
    }

    return res.json({ token });
  } catch (e: unknown) {
    logger.error('credits_overlay.token_rotate_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const saveCreditsSettings = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });
  }

  const bodyRec = asRecord(req.body);
  const creditsStyleJsonRaw = safeString(bodyRec.creditsStyleJson);
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
            creditsStyleJson: updated.creditsStyleJson ?? null,
          });
        }
      } catch (emitErr) {
        logger.error('credits_overlay.emit_config_failed', { errorMessage: getErrorMessage(emitErr) });
      }

      return res.json({ ok: true, creditsStyleJson: null });
    } catch (e: unknown) {
      logger.error('credits_overlay.save_settings_failed', { errorMessage: getErrorMessage(e) });
      return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
    }
  }

  if (creditsStyleJson.length > MAX_STYLE_JSON_LEN) {
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.BAD_REQUEST, error: `creditsStyleJson is too large (max ${MAX_STYLE_JSON_LEN})` });
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
          creditsStyleJson: updated.creditsStyleJson ?? null,
        });
      }
    } catch (emitErr) {
      logger.error('credits_overlay.emit_config_failed', { errorMessage: getErrorMessage(emitErr) });
    }

    return res.json({ ok: true, creditsStyleJson: updated.creditsStyleJson ?? null });
  } catch (e: unknown) {
    logger.error('credits_overlay.save_settings_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const setCreditsReconnectWindow = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  const raw = Number(asRecord(req.body).minutes);
  const minutes = Number.isFinite(raw) ? Math.max(1, Math.min(24 * 60, Math.floor(raw))) : 60;

  try {
    const updated = await prisma.channel.update({
      where: { id: channelId },
      data: { creditsReconnectWindowMinutes: minutes },
      select: { creditsReconnectWindowMinutes: true },
    });
    return res.json({ creditsReconnectWindowMinutes: updated.creditsReconnectWindowMinutes ?? minutes });
  } catch (e: unknown) {
    logger.error('credits_overlay.update_reconnect_window_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const resetCredits = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, creditsReconnectWindowMinutes: true },
    });
    const slug = String(channel?.slug || '').toLowerCase();
    if (!slug)
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });

    const windowMin = Number.isFinite(channel?.creditsReconnectWindowMinutes)
      ? Number(channel?.creditsReconnectWindowMinutes)
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
  } catch (e: unknown) {
    logger.error('credits_overlay.reset_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const getCreditsState = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { slug: true, creditsReconnectWindowMinutes: true },
    });
    const slug = String(channel?.slug || '').toLowerCase();
    if (!slug)
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });

    const state = await getCreditsStateFromStore(slug);
    const windowMin = Number.isFinite(channel?.creditsReconnectWindowMinutes)
      ? Number(channel?.creditsReconnectWindowMinutes)
      : 60;
    return res.json({
      channelSlug: slug,
      creditsReconnectWindowMinutes: windowMin,
      chatters: state.chatters || [],
      donors: state.donors || [],
    });
  } catch (e: unknown) {
    logger.error('credits_overlay.state_fetch_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const getCreditsReconnectWindow = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  try {
    const channel = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { creditsReconnectWindowMinutes: true },
    });
    const minutes = Number.isFinite(channel?.creditsReconnectWindowMinutes)
      ? Number(channel?.creditsReconnectWindowMinutes)
      : 60;
    return res.json({ creditsReconnectWindowMinutes: minutes });
  } catch (e: unknown) {
    logger.error('credits_overlay.reconnect_window_fetch_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const getCreditsIgnoredChatters = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  try {
    const ch = await prisma.channel.findUnique({
      where: { id: channelId },
      select: { creditsIgnoredChattersJson: true },
    });
    const list = Array.isArray(ch?.creditsIgnoredChattersJson) ? ch?.creditsIgnoredChattersJson : [];
    return res.json({ creditsIgnoredChatters: list });
  } catch (e: unknown) {
    logger.error('credits_overlay.ignored_chatters_fetch_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const setCreditsIgnoredChatters = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  if (!channelId)
    return res
      .status(400)
      .json({ errorCode: ERROR_CODES.MISSING_CHANNEL_ID, error: ERROR_MESSAGES.MISSING_CHANNEL_ID });

  const raw = asRecord(req.body).creditsIgnoredChatters;
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
      data: { creditsIgnoredChattersJson: capped },
      select: { creditsIgnoredChattersJson: true },
    });
    return res.json({ creditsIgnoredChatters: updated?.creditsIgnoredChattersJson ?? capped });
  } catch (e: unknown) {
    logger.error('credits_overlay.ignored_chatters_set_failed', { errorMessage: getErrorMessage(e) });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};
