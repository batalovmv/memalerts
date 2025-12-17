import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter, uploadWithLogging } from '../middleware/upload.js';
import { submissionController } from '../controllers/submissionController.js';

export const submissionRoutes = Router();

// Logging middleware for debugging
const logRequest = (req: Request, res: Response, next: NextFunction) => {
  next();
};

submissionRoutes.use(authenticate);
submissionRoutes.use(logRequest);

submissionRoutes.post('/', uploadLimiter, uploadWithLogging, submissionController.createSubmission);
submissionRoutes.post('/import', submissionController.importMeme);
submissionRoutes.get('/mine', submissionController.getMySubmissions);


