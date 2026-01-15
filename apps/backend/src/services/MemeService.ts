import type { Response } from 'express';
import type { AuthRequest } from '../middleware/auth.js';
import { activateMeme } from './meme/activateMeme.js';
import { deleteMeme } from './meme/deleteMeme.js';
import { getMemes } from './meme/getMemes.js';
import { updateMeme } from './meme/updateMeme.js';

export { activateMeme, deleteMeme, getMemes, updateMeme };

export type MemeService = {
  activate: (req: AuthRequest, res: Response) => Promise<unknown>;
  getMemes: (req: AuthRequest, res: Response) => Promise<unknown>;
  updateMeme: (req: AuthRequest, res: Response) => Promise<unknown>;
  deleteMeme: (req: AuthRequest, res: Response) => Promise<unknown>;
};

export const createMemeService = (): MemeService => ({
  activate: (req, res) => activateMeme(req, res),
  getMemes: (req, res) => getMemes(req, res),
  updateMeme: (req, res) => updateMeme(req, res),
  deleteMeme: (req, res) => deleteMeme(req, res),
});
