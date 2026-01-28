import type { Server, Socket } from 'socket.io';
import { QueueService } from '../services/queue/QueueService.js';
import { debugLog, debugError } from '../utils/debug.js';
import { verifyJwtWithRotation } from '../utils/jwt.js';
import { logger } from '../utils/logger.js';
import { isShuttingDown } from '../utils/shutdownState.js';
import { addOverlay, removeOverlay, updatePing } from './overlayPresence.js';
import { broadcastQueueState, broadcastQueueStateImmediate } from './queueBroadcast.js';

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

type ClientType = 'overlay' | 'dock' | 'public';

type SocketData = {
  clientType?: ClientType;
  isOverlay?: boolean;
  channelSlug?: string;
  channelId?: string;
  userId?: string;
  role?: string;
};

type JoinResult = { ok: true } | { ok: false; code: string };

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

function setClientType(socket: Socket, type: ClientType): boolean {
  const socketData = socket.data as SocketData;
  if (socketData.clientType && socketData.clientType !== type) {
    return false;
  }
  socketData.clientType = type;
  return true;
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
      const socketData = socket.data as SocketData;
      socketData.isOverlay = false;
      socketData.channelSlug = allowedSlug;
      debugLog(`Client ${socket.id} joined channel:${allowedSlug} (auth)`);
    });

    socket.on('join:overlay', async (data: { token?: string }, callback?: (payload: JoinResult) => void) => {
      if (!setClientType(socket, 'overlay')) {
        return callback?.({ ok: false, code: 'ALREADY_JOINED_AS_OTHER_TYPE' });
      }

      const token = String(data?.token || '').trim();
      if (!token) {
        return callback?.({ ok: false, code: 'MISSING_TOKEN' });
      }

      try {
        const decoded = verifyJwtWithRotation<JwtPayload>(token, 'socket_auth');
        if (!decoded?.kind || !decoded.channelId) {
          return callback?.({ ok: false, code: 'INVALID_TOKEN' });
        }
        const isMemeOverlay = decoded.kind === 'overlay';
        if (!isMemeOverlay) {
          return callback?.({ ok: false, code: 'INVALID_TOKEN' });
        }

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
        if (!channel) {
          return callback?.({ ok: false, code: 'CHANNEL_NOT_FOUND' });
        }

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
          return callback?.({ ok: false, code: 'TOKEN_ROTATED' });
        }

        const slug = String(channel?.slug || decoded.channelSlug || '').toLowerCase();
        if (!slug) {
          return callback?.({ ok: false, code: 'CHANNEL_NOT_FOUND' });
        }

        const channelId = decoded.channelId;

        // Join channelId rooms for queue/dock, plus legacy slug room for existing overlay events.
        void socket.join(`channel:${channelId}`);
        void socket.join(`channel:${channelId}:overlay`);
        void socket.join(`channel:${slug}`);

        const socketData = socket.data as SocketData;
        socketData.isOverlay = true;
        socketData.channelSlug = slug;
        socketData.channelId = channelId;
        socketData.userId = decoded.userId;
        socketData.role = decoded.role;

        addOverlay(channelId, socket.id);
        broadcastQueueState(channelId);

        debugLog(`Client ${socket.id} joined channel:${channelId} (overlay token)`);

        // Private config (sent only to the overlay client socket).
        socket.emit('overlay:config', {
          overlayMode: channel?.overlayMode ?? 'queue',
          overlayShowSender: channel?.overlayShowSender ?? false,
          overlayMaxConcurrent: channel?.overlayMaxConcurrent ?? 3,
          overlayStyleJson: channel?.overlayStyleJson ?? null,
        });

        callback?.({ ok: true });
      } catch {
        debugLog('[socket] join:overlay denied (invalid token)', { socketId: socket.id });
        return callback?.({ ok: false, code: 'INVALID_TOKEN' });
      }
    });

    socket.on('join:dock', async (data: { token?: string }, callback?: (payload: JoinResult) => void) => {
      if (!setClientType(socket, 'dock')) {
        return callback?.({ ok: false, code: 'ALREADY_JOINED_AS_OTHER_TYPE' });
      }

      const token = String(data?.token || '').trim();
      if (!token) {
        return callback?.({ ok: false, code: 'MISSING_TOKEN' });
      }

      try {
        const decoded = verifyJwtWithRotation<JwtPayload>(token, 'socket_auth');
        if (decoded?.kind !== 'dock' || !decoded.channelId) {
          return callback?.({ ok: false, code: 'INVALID_TOKEN' });
        }

        const userId = typeof decoded.userId === 'string' ? decoded.userId : '';
        const role = typeof decoded.role === 'string' ? decoded.role : '';
        if (!userId || !role) {
          return callback?.({ ok: false, code: 'INVALID_TOKEN' });
        }

        const { prisma } = await import('../lib/prisma.js');
        const channel = await prisma.channel.findUnique({
          where: { id: decoded.channelId },
          select: { dockTokenVersion: true },
        });
        if (!channel) {
          return callback?.({ ok: false, code: 'CHANNEL_NOT_FOUND' });
        }

        const tokenVersion = typeof decoded.tv === 'number' ? decoded.tv : null;
        const currentVersion = typeof channel.dockTokenVersion === 'number' ? channel.dockTokenVersion : null;
        if (tokenVersion === null || currentVersion === null || tokenVersion !== currentVersion) {
          debugLog('[socket] join:dock denied (token rotated)', {
            socketId: socket.id,
            channelId: decoded.channelId,
            tokenVersion,
            currentVersion,
          });
          return callback?.({ ok: false, code: 'TOKEN_ROTATED' });
        }

        const channelId = decoded.channelId;
        void socket.join(`channel:${channelId}`);
        void socket.join(`channel:${channelId}:dock`);

        const socketData = socket.data as SocketData;
        socketData.channelId = channelId;
        socketData.userId = userId;
        socketData.role = role;

        await broadcastQueueStateImmediate(channelId);
        callback?.({ ok: true });
      } catch {
        debugLog('[socket] join:dock denied (invalid token)', { socketId: socket.id });
        return callback?.({ ok: false, code: 'INVALID_TOKEN' });
      }
    });

    socket.on('join:user', (userId: string) => {
      // User rooms must be authenticated; do not allow joining arbitrary users.
      if (!auth.userId) return;
      if (String(userId) !== auth.userId) return;
      void socket.join(`user:${auth.userId}`);
      debugLog(`Client ${socket.id} joined user:${auth.userId}`);
    });

    socket.on('join:public', (channelSlug: string, callback?: (payload: JoinResult) => void) => {
      const raw = String(channelSlug || '').trim();
      if (!raw) return;
      if (!setClientType(socket, 'public')) {
        return callback?.({ ok: false, code: 'ALREADY_JOINED_AS_OTHER_TYPE' });
      }
      const slug = raw.toLowerCase();
      void socket.join(`public:${slug}`);
      debugLog(`Client ${socket.id} joined public:${slug}`);
      return callback?.({ ok: true });
    });

    socket.on('overlay:ping', () => {
      const socketData = socket.data as SocketData;
      const channelId = socketData.channelId;
      if (channelId && socketData.clientType === 'overlay') {
        updatePing(channelId, socket.id);
      }
      socket.emit('overlay:pong');
    });

    socket.on('activation:started', async (data: { activationId: string }, callback?: (payload: JoinResult) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'overlay') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const activationId = String(data?.activationId || '').trim();
      const channelId = socketData.channelId;
      if (!activationId || !channelId) {
        return callback?.({ ok: false, code: 'NOT_CURRENT' });
      }

      const { prisma } = await import('../lib/prisma.js');
      const channel = await prisma.channel.findFirst({
        where: {
          id: channelId,
          currentActivationId: activationId,
        },
        select: { id: true },
      });

      if (!channel) {
        return callback?.({ ok: false, code: 'NOT_CURRENT' });
      }

      logger.info('activation.overlay_started', {
        activationId,
        channelId: channel.id,
      });

      return callback?.({ ok: true });
    });

    socket.on(
      'activation:ended',
      async (
        data: { activationId: string; reason: 'done' | 'error' },
        callback?: (payload: unknown) => void
      ) => {
        const socketData = socket.data as SocketData;
        if (socketData.clientType !== 'overlay') {
          return callback?.({ ok: false, code: 'FORBIDDEN' });
        }

        const activationId = String(data?.activationId || '').trim();
        const channelId = socketData.channelId;
        if (!activationId || !channelId) {
          return callback?.({ ok: false, code: 'NOT_CURRENT' });
        }

        const { prisma } = await import('../lib/prisma.js');
        const channel = await prisma.channel.findFirst({
          where: {
            id: channelId,
            currentActivationId: activationId,
          },
          select: { id: true },
        });

        if (!channel) {
          return callback?.({ ok: false, code: 'NOT_CURRENT' });
        }

        const reason = data?.reason === 'error' ? 'error' : 'natural';
        const result = await QueueService.finishCurrent(channel.id, reason);

        callback?.(result);

        if (result.ok) {
          broadcastQueueState(channel.id);

          if (result.next) {
            io.to(`channel:${channel.id}:overlay`).emit('activation:play', result.next);
          }
        }
      }
    );

    socket.on('dock:queue.skip', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId || !socketData.userId || !socketData.role) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.skip(socketData.channelId, {
        userId: socketData.userId,
        role: socketData.role,
      });

      callback?.(result);

      if (result.ok) {
        broadcastQueueState(socketData.channelId);
        if (result.next) {
          io.to(`channel:${socketData.channelId}:overlay`).emit('activation:play', result.next);
        }
      }
    });

    socket.on('dock:queue.clear', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId || !socketData.userId || !socketData.role) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.clear(socketData.channelId, {
        userId: socketData.userId,
        role: socketData.role,
      });

      callback?.(result);

      if (result.ok) {
        broadcastQueueState(socketData.channelId);
      }
    });

    socket.on('dock:intake.pause', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.setIntakePaused(socketData.channelId, true);
      callback?.(result);
      if (result.ok) {
        broadcastQueueState(socketData.channelId);
      }
    });

    socket.on('dock:intake.resume', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.setIntakePaused(socketData.channelId, false);
      callback?.(result);
      if (result.ok) {
        broadcastQueueState(socketData.channelId);
      }
    });

    socket.on('dock:playback.pause', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.setPlaybackPaused(socketData.channelId, true);
      callback?.(result);
      if (result.ok) {
        broadcastQueueState(socketData.channelId);
      }
    });

    socket.on('dock:playback.resume', async (_data, callback?: (payload: unknown) => void) => {
      const socketData = socket.data as SocketData;
      if (socketData.clientType !== 'dock') {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }
      if (!socketData.channelId) {
        return callback?.({ ok: false, code: 'FORBIDDEN' });
      }

      const result = await QueueService.resumePlayback(socketData.channelId);
      callback?.(result);
      if (result.ok) {
        broadcastQueueState(socketData.channelId);
        if (result.next) {
          io.to(`channel:${socketData.channelId}:overlay`).emit('activation:play', result.next);
        }
      }
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
        const socketData = socket.data as SocketData;
        const channelId = socketData.channelId;
        if (channelId && socketData.clientType === 'overlay') {
          removeOverlay(channelId, socket.id);
          broadcastQueueState(channelId);
        }
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

export * from './overlayPresence.js';
