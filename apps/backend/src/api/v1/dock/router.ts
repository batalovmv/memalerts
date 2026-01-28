import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth, requireStreamer } from '../../middleware/auth.js';
import * as handlers from './handlers.js';

const router = Router();

const queueCommandsLimiter = rateLimit({
  windowMs: 60_000,
  max: 30,
  message: { error: 'Too many requests', code: 'RATE_LIMITED' },
});

// All endpoints require streamer auth.
router.use(requireAuth, requireStreamer);

// GET /api/v1/streamer/dock/token - get/create dock URL.
router.get('/token', handlers.getDockToken);

// POST /api/v1/streamer/dock/token/rotate - rotate token (invalidates old ones).
router.post('/token/rotate', handlers.rotateDockToken);

// Queue management
router.post('/queue/skip', queueCommandsLimiter, handlers.skipCurrent);
router.post('/queue/clear', queueCommandsLimiter, handlers.clearQueue);
router.post('/intake/pause', queueCommandsLimiter, handlers.pauseIntake);
router.post('/intake/resume', queueCommandsLimiter, handlers.resumeIntake);
router.post('/playback/pause', queueCommandsLimiter, handlers.pausePlayback);
router.post('/playback/resume', queueCommandsLimiter, handlers.resumePlayback);

// Queue state (polling fallback)
router.get('/queue/state', handlers.getQueueStateHandler);

export default router;
