import type { Router } from 'express';
import { memesRouter } from '../../api/v1/memes/router.js';

export function registerApiV1Routes(app: Router) {
  app.use(memesRouter);
}
