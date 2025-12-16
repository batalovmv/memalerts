import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { uploadLimiter, upload } from '../middleware/upload.js';
import { submissionController } from '../controllers/submissionController.js';

export const submissionRoutes = Router();

submissionRoutes.use(authenticate);

submissionRoutes.post('/', uploadLimiter, upload.single('file'), submissionController.createSubmission);
submissionRoutes.post('/import', submissionController.importMeme);
submissionRoutes.get('/mine', submissionController.getMySubmissions);


