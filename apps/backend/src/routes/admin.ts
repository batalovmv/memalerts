import { Router } from 'express';
import { streamerRoutes } from './streamer.js';
import { ownerRoutes } from './owner.js';

// Back-compat alias router:
// Historically, many "streamer panel" endpoints lived under /admin.
// Keep /admin working, but new code should prefer:
// - /streamer/* for streamer/admin users
// - /owner/* for owner-only (admin) operations
export const adminRoutes = Router();

adminRoutes.use(streamerRoutes);
adminRoutes.use(ownerRoutes);


