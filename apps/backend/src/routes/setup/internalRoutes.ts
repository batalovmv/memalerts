import type { Router } from 'express';
import type { Server } from 'socket.io';
import type { WalletUpdatedEvent } from '../../realtime/walletBridge.js';
import { emitWalletUpdated, isInternalWalletRelayRequest } from '../../realtime/walletBridge.js';
import type { SubmissionEvent } from '../../realtime/submissionBridge.js';
import { emitSubmissionEvent, isInternalSubmissionRelayRequest } from '../../realtime/submissionBridge.js';
import { creditsInternalController } from '../../controllers/internal/creditsInternal.js';
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

  app.post('/internal/credits/chatter', creditsInternalController.chatter);
  app.post('/internal/credits/donor', creditsInternalController.donor);
}
