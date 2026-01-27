import type { Router } from 'express';
import type { Server } from 'socket.io';
import type { WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { emitWalletUpdated, isInternalWalletRelayRequest } from '../../realtime/walletBridge.js';
import type { SubmissionEvent } from '../../realtime/submissionBridge.js';
import { emitSubmissionEvent, isInternalSubmissionRelayRequest } from '../../realtime/submissionBridge.js';
import { isInternalVoteChatRequest } from '../../realtime/voteBridge.js';
import { castVoteFromChat } from '../../services/vote/voteService.js';
import { prisma } from '../../lib/prisma.js';
import { isLocalhostAddress } from '../../utils/isLocalhostAddress.js';

export function registerInternalRoutes(app: Router) {
  app.post('/internal/wallet-updated', (req, res) => {
    const isLocal = isLocalhostAddress(req.socket.remoteAddress);
    if (!isLocal || !isInternalWalletRelayRequest(req.headers)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const body = req.body as Partial<WalletUpdatedEvent>;
    if (!body.userId || !body.channelId || typeof body.balance !== 'number') {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const io = req.app.get('io') as Server;
    emitWalletUpdated(io, body as WalletUpdatedEvent);
    return res.json({ ok: true });
  });

  app.post('/internal/submission-event', (req, res) => {
    const isLocal = isLocalhostAddress(req.socket.remoteAddress);
    if (!isLocal || !isInternalSubmissionRelayRequest(req.headers)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const body = req.body as Partial<SubmissionEvent>;
    if (!body.event || !body.submissionId || !body.channelId || !body.channelSlug) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const io = req.app.get('io') as Server;
    emitSubmissionEvent(io, body as SubmissionEvent);
    return res.json({ ok: true });
  });

  app.post('/internal/votes/chat', async (req, res) => {
    const isLocal = isLocalhostAddress(req.socket.remoteAddress);
    if (!isLocal || !isInternalVoteChatRequest(req.headers)) {
      return res.status(404).json({ error: 'Not Found' });
    }

    const body = req.body as Partial<{
      channelId: string;
      channelSlug?: string | null;
      provider?: 'twitch' | 'youtube' | 'vkvideo';
      platformUserId: string;
      optionIndex: number;
    }>;

    const channelId = String(body.channelId || '').trim();
    const platformUserId = String(body.platformUserId || '').trim();
    const optionIndex = Number(body.optionIndex ?? 0);
    const provider = body.provider === 'youtube' || body.provider === 'vkvideo' ? body.provider : 'twitch';

    if (!channelId || !platformUserId || !Number.isFinite(optionIndex)) {
      return res.status(400).json({ error: 'Bad Request' });
    }

    const result = await castVoteFromChat({
      channelId,
      provider,
      platformUserId,
      optionIndex: Math.floor(optionIndex),
    });

    if (!result?.session) {
      return res.json({ ok: false });
    }

    const io = req.app.get('io') as Server;
    let slug = String(body.channelSlug || '').trim().toLowerCase();
    if (!slug) {
      const channel = await prisma.channel.findUnique({ where: { id: channelId }, select: { slug: true } });
      slug = String(channel?.slug || '').trim().toLowerCase();
    }
    if (slug) {
      io.to(`channel:${slug}`).emit('vote:updated', { session: result.session });
      io.to(`public:${slug}`).emit('vote:updated', { session: result.session });
    }

    return res.json({ ok: true });
  });

}
