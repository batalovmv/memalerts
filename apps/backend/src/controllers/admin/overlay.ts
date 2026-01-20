import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { prisma } from '../../lib/prisma.js';
import type { Server } from 'socket.io';
import { signJwt } from '../../utils/jwt.js';
import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';
import { logger } from '../../utils/logger.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export const getOverlayToken = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
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
        overlayMode: true,
        overlayShowSender: true,
        overlayMaxConcurrent: true,
        overlayStyleJson: true,
        overlayTokenVersion: true,
      },
    });

    if (!channel?.slug) {
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });
    }

    // Long-lived token intended to be pasted into OBS. It is opaque and unguessable (signed).
    // Environment separation is preserved because JWT_SECRET differs between beta and production.
    const token = signJwt(
      {
        kind: 'overlay',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.overlayTokenVersion ?? 1,
      },
      // IMPORTANT: keep token stable across page reloads.
      // We avoid iat/exp so the string doesn't change unless streamer explicitly rotates it.
      { noTimestamp: true }
    );

    return res.json({
      token,
      overlayMode: channel.overlayMode ?? 'queue',
      overlayShowSender: channel.overlayShowSender ?? false,
      overlayMaxConcurrent: channel.overlayMaxConcurrent ?? 3,
      overlayStyleJson: channel.overlayStyleJson ?? null,
    });
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('overlay.token_generate_failed', { errorMessage: err.message });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

export const rotateOverlayToken = async (req: AuthRequest, res: Response) => {
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
      return res
        .status(404)
        .json({ errorCode: ERROR_CODES.CHANNEL_NOT_FOUND, error: ERROR_MESSAGES.CHANNEL_NOT_FOUND });
    }

    const token = signJwt(
      {
        kind: 'overlay',
        v: 1,
        channelId,
        channelSlug: String(channel.slug).toLowerCase(),
        tv: channel.overlayTokenVersion ?? 1,
        // NOTE: keep payload deterministic (no jti/iat/exp). Rotation is done via tv increment.
      },
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
        const dataRec = asRecord(s.data);
        if (dataRec.isOverlay) {
          s.disconnect(true);
        }
      }
    } catch (kickErr) {
      const err = kickErr as Error;
      logger.error('overlay.socket_disconnect_failed', { errorMessage: err.message });
    }

    return res.json({
      token,
      overlayMode: channel.overlayMode ?? 'queue',
      overlayShowSender: channel.overlayShowSender ?? false,
      overlayMaxConcurrent: channel.overlayMaxConcurrent ?? 3,
    });
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('overlay.token_rotate_failed', { errorMessage: err.message });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
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
  if (!userId) return res.status(401).json({ errorCode: ERROR_CODES.UNAUTHORIZED, error: ERROR_MESSAGES.UNAUTHORIZED });

  const pick = async (whereSql: string, params: unknown[]) => {
    const rows = await prisma.$queryRawUnsafe<
      Array<{ id: string; type: string; fileUrl: string; title: string; channelId: string }>
    >(
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
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('overlay.preview_meme_failed', { errorMessage: err.message });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};

// OBS overlay preview (batch): return up to N preview memes in one request (stable ordering by seed).
// This is used by the Admin UI to avoid N separate requests and to avoid race conditions on initial render.
export const getOverlayPreviewMemes = async (req: AuthRequest, res: Response) => {
  const channelId = req.channelId;
  const userId = req.userId;
  if (!userId) return res.status(401).json({ errorCode: ERROR_CODES.UNAUTHORIZED, error: ERROR_MESSAGES.UNAUTHORIZED });

  const rawCount = Number(req.query.count);
  const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(5, Math.floor(rawCount))) : 1;
  const seed = String(req.query.seed ?? '1').trim() || '1';

  // Ensure this endpoint is never cached by browser/proxy/CDN.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');

  type Row = { id: string; type: string; fileUrl: string; title: string; channelId: string };

  const pickMany = async (whereSql: string, params: unknown[]): Promise<Row[]> => {
    // Deterministic pseudo-random ordering based on seed.
    // md5(uuid::text || seed) is stable and cheap enough for small LIMITs.
    return await prisma.$queryRawUnsafe<Row[]>(
      `
        SELECT "id", "type", "fileUrl", "title", "channelId"
        FROM "Meme"
        WHERE "status" = 'approved' ${whereSql}
        ORDER BY md5(("id"::text) || $${params.length + 1})
        LIMIT $${params.length + 2}
      `,
      ...params,
      seed,
      count
    );
  };

  try {
    const uniq: Row[] = [];
    const seen = new Set<string>();

    // 1) Channel pool first (if streamer has a channel)
    if (channelId) {
      const rows = await pickMany(`AND "channelId" = $1`, [channelId]);
      for (const r of rows) {
        if (!r?.fileUrl || seen.has(r.fileUrl)) continue;
        seen.add(r.fileUrl);
        uniq.push(r);
        if (uniq.length >= count) break;
      }
    }

    // 2) User-created (any channel)
    if (uniq.length < count) {
      const rows = await pickMany(`AND "createdByUserId" = $1`, [userId]);
      for (const r of rows) {
        if (!r?.fileUrl || seen.has(r.fileUrl)) continue;
        seen.add(r.fileUrl);
        uniq.push(r);
        if (uniq.length >= count) break;
      }
    }

    // 3) Global fallback
    if (uniq.length < count) {
      const rows = await pickMany(``, []);
      for (const r of rows) {
        if (!r?.fileUrl || seen.has(r.fileUrl)) continue;
        seen.add(r.fileUrl);
        uniq.push(r);
        if (uniq.length >= count) break;
      }
    }

    return res.json({
      memes: uniq.map((m) => ({
        id: m.id,
        type: m.type,
        fileUrl: m.fileUrl,
        title: m.title,
        channelId: m.channelId,
      })),
    });
  } catch (e: unknown) {
    const err = e as Error;
    logger.error('overlay.preview_memes_failed', { errorMessage: err.message });
    return res.status(500).json({ errorCode: ERROR_CODES.INTERNAL_ERROR, error: ERROR_MESSAGES.INTERNAL_ERROR });
  }
};
