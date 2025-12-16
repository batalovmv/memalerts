import multer from 'multer';
import path from 'path';
import fs from 'fs';

const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10); // 50MB default (50 * 1024 * 1024)
const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  },
});

const fileFilter = (req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  // Only allow video files
  const allowedMimes = [
    'video/mp4',
    'video/webm',
    'video/quicktime',
    'video/x-msvideo', // .avi
    'video/x-matroska', // .mkv
  ];

  if (allowedMimes.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only video files are allowed.'));
  }
};

export const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE,
  },
  fileFilter,
});

// Wrap multer middleware to add error logging and timeout protection
export const uploadWithLogging = (req: any, res: any, next: any) => {
  const MULTER_TIMEOUT = 120000; // 2 minutes timeout for multer processing
  let timeoutId: NodeJS.Timeout | null = null;
  let isCompleted = false;

  // Set up timeout to prevent multer from hanging
  timeoutId = setTimeout(() => {
    if (!isCompleted) {
      isCompleted = true;
      console.error('Multer processing timeout - file upload took too long');
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'upload.ts:timeout',message:'Multer timeout',data:{timeout:MULTER_TIMEOUT},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // If response hasn't been sent, send error
      if (!res.headersSent) {
        return res.status(408).json({ 
          error: 'Upload timeout', 
          message: 'File upload processing timed out. Please try again with a smaller file.' 
        });
      }
    }
  }, MULTER_TIMEOUT);

  // Call multer middleware
  upload.single('file')(req, res, (err: any) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }

    if (isCompleted) {
      // Timeout already occurred, don't process further
      return;
    }

    isCompleted = true;

    if (err) {
      console.error('Multer error:', err.message, err.code);
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'upload.ts:error',message:'Multer error',data:{error:err.message,code:err.code,field:err.field},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      
      // Handle specific multer errors
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ 
          error: 'File too large', 
          message: `File size exceeds maximum allowed size (${MAX_FILE_SIZE / 1024 / 1024}MB)` 
        });
      }
      if (err.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({ 
          error: 'Unexpected file field', 
          message: 'Unexpected file field name. Expected field name: "file"' 
        });
      }
      
      return next(err);
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'upload.ts:success',message:'Multer file processed',data:{filename:req.file?.filename,size:req.file?.size,mimetype:req.file?.mimetype},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'C'})}).catch(()=>{});
    // #endregion
    next();
  });
};

// Re-export rate limiter for uploads
export { uploadLimiter } from './rateLimit.js';


