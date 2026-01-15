import type { Server } from 'socket.io';
import { debugLog, debugError } from '../utils/debug.js';
import { startCreditsTicker, stopCreditsTicker } from '../realtime/creditsState.js';
import { getCreditsStateFromStore } from '../realtime/creditsSessionStore.js';
import { isShuttingDown } from '../utils/shutdownState.js';
import { verifyJwtWithRotation } from '../utils/jwt.js';

type JwtPayload = {
  userId?: string;
  role?: string;
  channelId?: string;
  // Overlay token fields
  kind?: string;
  channelSlug?: string;
  v?: number;
  tv?: number; // overlay token version (rotation)
};

function parseCookies(cookieHeader: string | undefined): Record<string, string> {
  const raw = String(cookieHeader || '').trim();
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (!key) continue;
    out[key] = decodeURIComponent(val);
  }
  return out;
}

function isBetaHost(host: string | undefined): boolean {
  const h = String(host || '').toLowerCase();
  const domain = String(process.env.DOMAIN || '').toLowerCase();
  return h.includes('beta.') || domain.includes('beta.');
}

export function setupSocketIO(io: Server) {
  io.use((socket, next) => {
    if (isShuttingDown()) {
      return next(new Error('server_shutting_down'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    debugLog('Client connected:', socket.id);

    // Best-effort auth context extracted from cookies for permissioned room joins (dashboard/settings).
    // Overlay (OBS) is anonymous and must join via a signed overlay token instead.
    let auth: { userId?: string; role?: string; channelId?: string } = {};
    try {
      const cookies = parseCookies(socket.handshake.headers.cookie);
      const host = socket.handshake.headers.host;
      const beta = isBetaHost(host);
      const token = beta ? (cookies.token_beta ?? cookies.token) : cookies.token;
      if (token) {
        const decoded = verifyJwtWithRotation<JwtPayload>(token, 'overlay_token');
        auth = { userId: decoded.userId, role: decoded.role, channelId: decoded.channelId };
      }
    } catch {
      // ignore (unauthenticated socket)
    }

    // Cache the allowed slug per socket to avoid repeated DB lookups if the client emits join events multiple times.
    let allowedChannelSlugCache: { slug: string; ts: number } | null = null;
    const ALLOWED_SLUG_CACHE_MS = 60_000;

    socket.on('join:channel', async (channelSlug: string) => {
      const raw = String(channelSlug || '').trim();
      if (!raw) return;
      // Only authenticated streamers/admins can join channel rooms.
      if (!auth.userId || !auth.channelId || !(auth.role === 'streamer' || auth.role === 'admin')) {
        debugLog('[socket] join:channel denied (unauthenticated or wrong role)', { socketId: socket.id });
        return;
      }

      const requested = raw.toLowerCase();
      // Fast path: already joined this room on this socket.
      if (socket.data.channelSlug && String(socket.data.channelSlug).toLowerCase() === requested) {
        return;
      }

      // Verify slug matches the authenticated user's channel to prevent joining arbitrary channels.
      let allowedSlug = '';
      const now = Date.now();
      if (allowedChannelSlugCache && now - allowedChannelSlugCache.ts < ALLOWED_SLUG_CACHE_MS) {
        allowedSlug = allowedChannelSlugCache.slug;
      } else {
        const { prisma } = await import('../lib/prisma.js');
        const channel = await prisma.channel.findUnique({
          where: { id: auth.channelId },
          select: { slug: true, creditsStyleJson: true },
        });
        allowedSlug = String(channel?.slug || '').toLowerCase();
        allowedChannelSlugCache = allowedSlug ? { slug: allowedSlug, ts: now } : null;
      }
      if (!allowedSlug) return;
      if (requested !== allowedSlug) {
        debugLog('[socket] join:channel denied (slug mismatch)', {
          socketId: socket.id,
          requested: raw,
          allowed: allowedSlug,
        });
        return;
      }

      void socket.join(`channel:${allowedSlug}`);
      const socketData = socket.data as {
        isOverlay?: boolean;
        isCreditsSubscriber?: boolean;
        channelSlug?: string;
        isCreditsOverlay?: boolean;
      };
      socketData.isOverlay = false;
      // Allow streamer dashboard to subscribe to credits updates without requiring OBS overlay to be open.
      // We keep this separate from "isCreditsOverlay" to avoid affecting token-rotation kick logic.
      socketData.isCreditsSubscriber = true;
      socketData.channelSlug = allowedSlug;
      debugLog(`Client ${socket.id} joined channel:${allowedSlug} (auth)`);

      // Best-effort: also send credits config/state and start ticker for this channel.
      try {
        // Reuse cached lookup if present; otherwise, fetch fresh (we may not have config in cache).
        const { prisma } = await import('../lib/prisma.js');
        const ch = await prisma.channel.findUnique({
          where: { id: auth.channelId },
          select: { slug: true, creditsStyleJson: true },
        });
        const slug = String(ch?.slug || '').toLowerCase();
        if (slug) {
          socket.emit('credits:config', { creditsStyleJson: ch?.creditsStyleJson ?? null });
          socket.emit('credits:state', await getCreditsStateFromStore(slug));
          startCreditsTicker(io, slug, 5000);
        }
      } catch {
        // ignore
      }
    });

    socket.on('join:overlay', async (data: { token?: string }) => {
      const token = String(data?.token || '').trim();
      if (!token) return;
      try {
        const decoded = verifyJwtWithRotation<JwtPayload>(token, 'socket_auth');
        if (!decoded?.kind || !decoded.channelId) return;
        const isMemeOverlay = decoded.kind === 'overlay';
        const isCreditsOverlay = decoded.kind === 'credits';
        if (!isMemeOverlay && !isCreditsOverlay) return;

        // Resolve current channel slug + config from DB so tokens survive slug changes.
        const { prisma } = await import('../lib/prisma.js');
        if (isMemeOverlay) {
          const channel = await prisma.channel.findUnique({
            where: { id: decoded.channelId },
            select: {
              slug: true,
              overlayMode: true,
              overlayShowSender: true,
              overlayMaxConcurrent: true,
              overlayStyleJson: true,
              overlayTokenVersion: true,
            },
          });

          // Token rotation: deny old links after streamer regenerates overlay URL.
          const tokenVersion = Number.isFinite(decoded.tv) ? Number(decoded.tv) : 1;
          const currentVersion = Number.isFinite(channel?.overlayTokenVersion)
            ? Number(channel?.overlayTokenVersion)
            : 1;
          if (tokenVersion !== currentVersion) {
            debugLog('[socket] join:overlay denied (token rotated)', {
              socketId: socket.id,
              channelId: decoded.channelId,
              tokenVersion,
              currentVersion,
            });
            return;
          }

          const slug = String(channel?.slug || decoded.channelSlug || '').toLowerCase();
          if (!slug) return;

          // Join the normalized channel room only.
          void socket.join(`channel:${slug}`);
          const socketData = socket.data as {
            isOverlay?: boolean;
            isCreditsOverlay?: boolean;
            channelSlug?: string;
          };
          socketData.isOverlay = true;
          socketData.isCreditsOverlay = false;
          socketData.channelSlug = slug;
          debugLog(`Client ${socket.id} joined channel:${slug} (overlay token)`);

          // Private config (sent only to the overlay client socket).
          socket.emit('overlay:config', {
            overlayMode: channel?.overlayMode ?? 'queue',
            overlayShowSender: channel?.overlayShowSender ?? false,
            overlayMaxConcurrent: channel?.overlayMaxConcurrent ?? 3,
            overlayStyleJson: channel?.overlayStyleJson ?? null,
          });
          return;
        }

        const channel = await prisma.channel.findUnique({
          where: { id: decoded.channelId },
          select: {
            slug: true,
            creditsStyleJson: true,
            creditsTokenVersion: true,
          },
        });

        // Token rotation: deny old links after streamer regenerates overlay URL.
        const tokenVersion = Number.isFinite(decoded.tv) ? Number(decoded.tv) : 1;
        const currentVersion = Number.isFinite(channel?.creditsTokenVersion)
          ? Number(channel?.creditsTokenVersion)
          : 1;
        if (tokenVersion !== currentVersion) {
          debugLog('[socket] join:overlay denied (token rotated)', {
            socketId: socket.id,
            channelId: decoded.channelId,
            tokenVersion,
            currentVersion,
          });
          return;
        }

        const slug = String(channel?.slug || decoded.channelSlug || '').toLowerCase();
        if (!slug) return;

        // Join the normalized channel room only.
        void socket.join(`channel:${slug}`);
        const socketData = socket.data as {
          isOverlay?: boolean;
          isCreditsOverlay?: boolean;
          channelSlug?: string;
        };
        socketData.isOverlay = false;
        socketData.isCreditsOverlay = true;
        socketData.channelSlug = slug;
        debugLog(`Client ${socket.id} joined channel:${slug} (overlay token)`);

        socket.emit('credits:config', {
          creditsStyleJson: channel?.creditsStyleJson ?? null,
        });
        socket.emit('credits:state', await getCreditsStateFromStore(slug));
        startCreditsTicker(io, slug, 5000);
      } catch {
        debugLog('[socket] join:overlay denied (invalid token)', { socketId: socket.id });
      }
    });

    socket.on('join:user', (userId: string) => {
      // User rooms must be authenticated; do not allow joining arbitrary users.
      if (!auth.userId) return;
      if (String(userId) !== auth.userId) return;
      void socket.join(`user:${auth.userId}`);
      debugLog(`Client ${socket.id} joined user:${auth.userId}`);
    });

    socket.on('activation:ackDone', async (data: { activationId: string }) => {
      // Update activation status
      const { prisma } = await import('../lib/prisma.js');
      try {
        await prisma.memeActivation.update({
          where: { id: data.activationId },
          data: { status: 'done' },
        });
      } catch (error) {
        debugError('Error updating activation:', error);
      }
    });

    socket.on('disconnect', () => {
      try {
        const socketData = socket.data as {
          isCreditsOverlay?: boolean;
          isCreditsSubscriber?: boolean;
          channelSlug?: string;
        };
        if ((socketData.isCreditsOverlay || socketData.isCreditsSubscriber) && socketData.channelSlug) {
          stopCreditsTicker(String(socketData.channelSlug));
        }
      } catch {
        // ignore
      }
      debugLog('Client disconnected:', socket.id);
    });
  });
}
