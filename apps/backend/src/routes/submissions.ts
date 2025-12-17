import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, AuthRequest } from '../middleware/auth.js';
import { requireBetaAccess } from '../middleware/betaAccess.js';
import { uploadLimiter, uploadWithLogging } from '../middleware/upload.js';
import { submissionController } from '../controllers/submissionController.js';

export const submissionRoutes = Router();

// Logging middleware for debugging
const logRequest = (req: Request, res: Response, next: NextFunction) => {
  next();
};

// Apply authenticate first to set req.userId, then requireBetaAccess for beta domain
submissionRoutes.use(authenticate);
submissionRoutes.use(requireBetaAccess);
submissionRoutes.use(logRequest);

submissionRoutes.post('/', uploadLimiter, uploadWithLogging, submissionController.createSubmission);
submissionRoutes.post('/import', submissionController.importMeme);
submissionRoutes.get('/mine', submissionController.getMySubmissions);


