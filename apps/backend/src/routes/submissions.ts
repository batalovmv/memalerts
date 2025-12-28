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
submissionRoutes.post('/import', uploadLimiter, submissionController.importMeme);
submissionRoutes.post('/pool', submissionController.createPoolSubmission);
submissionRoutes.get('/mine', submissionController.getMySubmissions);
submissionRoutes.post('/:id/resubmit', submissionController.resubmitSubmission);
// Add GET /submissions endpoint to prevent hanging requests
// This endpoint returns user's own submissions (same as /mine)
submissionRoutes.get('/', submissionController.getMySubmissions);


