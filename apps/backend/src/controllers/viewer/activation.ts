import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { services } from '../../services/index.js';

export const activateMeme = async (req: AuthRequest, res: Response) => services.memes.activate(req, res);
