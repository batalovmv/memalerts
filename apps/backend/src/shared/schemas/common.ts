import { z } from 'zod';

export const activationStatusSchema = z.enum(['queued', 'playing', 'done', 'failed']);
