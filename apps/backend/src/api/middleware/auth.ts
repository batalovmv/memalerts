import type { AuthRequest } from '../../middleware/auth.js';
import { authenticate, optionalAuthenticate } from '../../middleware/auth.js';

export type { AuthRequest };

export const requireAuth = authenticate;
export const optionalAuth = optionalAuthenticate;
