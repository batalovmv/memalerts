import { Router } from 'express';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { getAiModerationDlq, getAiModerationQueue } from '../queues/aiModerationQueue.js';

export function createAdminQueuesRouter(): Router {
  const router = Router();
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');

  const queues = [];
  const aiQueue = getAiModerationQueue();
  if (aiQueue) queues.push(new BullMQAdapter(aiQueue));
  const aiDlq = getAiModerationDlq();
  if (aiDlq) queues.push(new BullMQAdapter(aiDlq));

  if (!queues.length) {
    router.get('*', (_req, res) => {
      res.status(503).send('BullMQ is disabled or Redis is not configured.');
    });
    return router;
  }

  createBullBoard({ queues, serverAdapter });
  router.use(serverAdapter.getRouter());
  return router;
}
