import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { sanitizeFilename, getSafeExtension } from '../utils/pathSecurity.js';

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
    try {
      // Sanitize original filename to prevent path traversal
      const sanitizedOriginal = sanitizeFilename(file.originalname || 'file');
      const ext = getSafeExtension(sanitizedOriginal) || getSafeExtension(file.originalname || '');
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      const safeFilename = `${file.fieldname}-${uniqueSuffix}${ext ? '.' + ext : ''}`;
      cb(null, safeFilename);
    } catch (error: any) {
      // If sanitization fails, use a safe default
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${file.fieldname}-${uniqueSuffix}.bin`);
    }
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

    next();
  });
};

// Re-export rate limiter for uploads
export { uploadLimiter } from './rateLimit.js';


