import type { Response } from 'express';
import type { AuthRequest } from '../../../middleware/auth.js';
import { prisma } from '../../../lib/prisma.js';
import { QueueService } from '../../../services/queue/QueueService.js';
import { getQueueState } from '../../../services/queue/getQueueState.js';
import { broadcastQueueState } from '../../../socket/queueBroadcast.js';
import { signJwt } from '../../../utils/jwt.js';

const DOCK_TOKEN_EXPIRY = '30d'; // Short-lived for security.

export async function getDockToken(req: AuthRequest, res: Response) {
  if (!req.channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  const channel = await prisma.channel.findUnique({
    where: { id: req.channelId },
    select: { id: true, slug: true, dockTokenVersion: true },
  });

  if (!channel) {
    return res.status(404).json({ error: 'Channel not found' });
  }

  // Generate a JWT with dock metadata.
  const token = signJwt(
    {
      kind: 'dock',
      channelId: channel.id,
      channelSlug: channel.slug,
      userId: req.userId,
      role: 'streamer',
      tv: channel.dockTokenVersion, // token version for rotation
    },
    { expiresIn: DOCK_TOKEN_EXPIRY }
  );

  const webUrl = process.env.WEB_URL || 'http://localhost:5173';
  const dockUrl = `${webUrl}/dock?token=${token}`;

  return res.json({
    success: true,
    data: {
      token,
      dockUrl,
      expiresIn: DOCK_TOKEN_EXPIRY,
    },
  });
}

export async function rotateDockToken(req: AuthRequest, res: Response) {
  if (!req.channelId) {
    return res.status(400).json({ error: 'Channel ID required' });
  }

  // Incrementing the version invalidates all old tokens.
  const channel = await prisma.channel.update({
    where: { id: req.channelId },
    data: { dockTokenVersion: { increment: 1 } },
    select: { id: true, slug: true, dockTokenVersion: true },
  });

  // Immediately return a new token.
  const token = signJwt(
    {
      kind: 'dock',
      channelId: channel.id,
      channelSlug: channel.slug,
      userId: req.userId,
      role: 'streamer',
      tv: channel.dockTokenVersion,
    },
    { expiresIn: DOCK_TOKEN_EXPIRY }
  );

  const webUrl = process.env.WEB_URL || 'http://localhost:5173';
  const dockUrl = `${webUrl}/dock?token=${token}`;

  return res.json({
    success: true,
    data: {
      token,
      dockUrl,
      expiresIn: DOCK_TOKEN_EXPIRY,
      message: 'Token rotated. Old dock connections will be disconnected.',
    },
  });
}

export async function skipCurrent(req: AuthRequest, res: Response) {
  const result = await QueueService.skip(req.channelId!, {
    userId: req.userId!,
    role: 'streamer',
  });

  if (result.ok) {
    broadcastQueueState(req.channelId!);

    if (result.next) {
      const io = req.app.get('io');
      io.to(`channel:${req.channelId}:overlay`).emit('activation:play', result.next);
    }
  }

  res.json({ success: result.ok, data: result });
}

export async function clearQueue(req: AuthRequest, res: Response) {
  const result = await QueueService.clear(req.channelId!, {
    userId: req.userId!,
    role: 'streamer',
  });

  if (result.ok) {
    broadcastQueueState(req.channelId!);
  }

  res.json({ success: result.ok, data: result });
}

export async function pauseIntake(req: AuthRequest, res: Response) {
  const result = await QueueService.setIntakePaused(req.channelId!, true);
  broadcastQueueState(req.channelId!);
  res.json({ success: true, data: result });
}

export async function resumeIntake(req: AuthRequest, res: Response) {
  const result = await QueueService.setIntakePaused(req.channelId!, false);
  broadcastQueueState(req.channelId!);
  res.json({ success: true, data: result });
}

export async function pausePlayback(req: AuthRequest, res: Response) {
  const result = await QueueService.setPlaybackPaused(req.channelId!, true);
  broadcastQueueState(req.channelId!);
  res.json({ success: true, data: result });
}

export async function resumePlayback(req: AuthRequest, res: Response) {
  const result = await QueueService.resumePlayback(req.channelId!);
  broadcastQueueState(req.channelId!);

  if (result.ok && 'next' in result && result.next) {
    const io = req.app.get('io');
    io.to(`channel:${req.channelId}:overlay`).emit('activation:play', result.next);
  }

  res.json({ success: true, data: result });
}

export async function getQueueStateHandler(req: AuthRequest, res: Response) {
  const state = await getQueueState(req.channelId!);
  res.json({ success: true, data: state });
}
