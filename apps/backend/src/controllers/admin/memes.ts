import type { Response } from 'express';
import type { AuthRequest } from '../../middleware/auth.js';
import { services } from '../../services/index.js';

export const getMemes = async (req: AuthRequest, res: Response) => services.memes.getMemes(req, res);

export const updateMeme = async (req: AuthRequest, res: Response) => services.memes.updateMeme(req, res);

export const deleteMeme = async (req: AuthRequest, res: Response) => services.memes.deleteMeme(req, res);
