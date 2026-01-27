import type { Server } from 'socket.io';
import { debugLog, debugError } from '../utils/debug.js';
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
          select: { slug: true },
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
        channelSlug?: string;
      };
      socketData.isOverlay = false;
      socketData.channelSlug = allowedSlug;
      debugLog(`Client ${socket.id} joined channel:${allowedSlug} (auth)`);
    });

    socket.on('join:overlay', async (data: { token?: string }) => {
      const token = String(data?.token || '').trim();
      if (!token) return;
      try {
        const decoded = verifyJwtWithRotation<JwtPayload>(token, 'socket_auth');
        if (!decoded?.kind || !decoded.channelId) return;
        const isMemeOverlay = decoded.kind === 'overlay';
        if (!isMemeOverlay) return;

        // Resolve current channel slug + config from DB so tokens survive slug changes.
        const { prisma } = await import('../lib/prisma.js');
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
          channelSlug?: string;
        };
        socketData.isOverlay = true;
        socketData.channelSlug = slug;
        debugLog(`Client ${socket.id} joined channel:${slug} (overlay token)`);

        // Private config (sent only to the overlay client socket).
        socket.emit('overlay:config', {
          overlayMode: channel?.overlayMode ?? 'queue',
          overlayShowSender: channel?.overlayShowSender ?? false,
          overlayMaxConcurrent: channel?.overlayMaxConcurrent ?? 3,
          overlayStyleJson: channel?.overlayStyleJson ?? null,
        });
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

    socket.on('join:public', (channelSlug: string) => {
      const raw = String(channelSlug || '').trim();
      if (!raw) return;
      const slug = raw.toLowerCase();
      void socket.join(`public:${slug}`);
      debugLog(`Client ${socket.id} joined public:${slug}`);
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
          channelSlug?: string;
        };
      } catch {
        // ignore
      }
      // Explicitly drop per-socket listeners to keep the disconnect path lean.
      socket.removeAllListeners();
      debugLog('Client disconnected:', socket.id);
    });
  });
}

export function shutdownSocketIO(io: Server) {
  io.sockets.sockets.forEach((socket) => {
    socket.emit('server_shutdown');
    socket.disconnect(true);
  });
}
