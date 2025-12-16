import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter, uploadWithLogging } from '../middleware/upload.js';
import { submissionController } from '../controllers/submissionController.js';

export const submissionRoutes = Router();

// Logging middleware for debugging
const logRequest = (req: Request, res: Response, next: NextFunction) => {
  // #region agent log
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'submissions.ts:10',message:'POST /submissions request received',data:{method:req.method,path:req.path,hasBody:!!req.body,contentType:req.headers['content-type']},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
  // #endregion
  next();
};

submissionRoutes.use(authenticate);
submissionRoutes.use(logRequest);

submissionRoutes.post('/', uploadLimiter, uploadWithLogging, submissionController.createSubmission);
submissionRoutes.post('/import', submissionController.importMeme);
submissionRoutes.get('/mine', submissionController.getMySubmissions);


