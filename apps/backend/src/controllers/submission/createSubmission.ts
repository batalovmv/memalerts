import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { services } from '../../services/index.js';

export const createSubmission = async (req: AuthRequest, res: Response) => services.submissions.create(req, res);
