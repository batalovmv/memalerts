import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { uploadLimiter, upload } from '../middleware/upload';
import { submissionController } from '../controllers/submissionController';

export const submissionRoutes = Router();

submissionRoutes.use(authenticate);

submissionRoutes.post('/', uploadLimiter, upload.single('file'), submissionController.createSubmission);
submissionRoutes.get('/mine', submissionController.getMySubmissions);


