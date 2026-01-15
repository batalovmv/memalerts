import multer from 'multer';
import fs from 'fs';
import type { NextFunction, Request, Response } from 'express';
import { sanitizeFilename, getSafeExtension } from '../utils/pathSecurity.js';
import { ApiError } from '../shared/apiError.js';
import { logger } from '../utils/logger.js';

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
    } catch {
      // If sanitization fails, use a safe default
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
      cb(null, `${file.fieldname}-${uniqueSuffix}.bin`);
    }
  },
});

const fileFilter = (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
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
    return;
  }

  const reqWithValidation = _req as Request & { fileValidationError?: ApiError };
  reqWithValidation.fileValidationError = new ApiError({
    status: 400,
    errorCode: 'INVALID_FILE_TYPE',
    message: 'Invalid file type. Only video files are allowed.',
    details: { declaredMimeType: file.mimetype },
  });
  cb(null, true);
};

function drainRequest(req: Request) {
  try {
    req.unpipe?.();
  } catch {
    // ignore
  }
  try {
    req.resume?.();
  } catch {
    // ignore
  }
}

export const upload = multer({
  storage,
  limits: {
    // NOTE: This is a default; uploadWithLogging creates a per-request uploader that reads env dynamically.
    fileSize: parseInt(process.env.MAX_FILE_SIZE || '52428800', 10),
  },
  fileFilter,
});

// Wrap multer middleware to add error logging and timeout protection
export const uploadWithLogging = (req: Request, res: Response, next: NextFunction) => {
  const maxFileSize = parseInt(process.env.MAX_FILE_SIZE || '52428800', 10); // 50MB default (50 * 1024 * 1024)
  const MULTER_TIMEOUT = 120000; // 2 minutes timeout for multer processing
  let timeoutId: NodeJS.Timeout | null = null;
  let isCompleted = false;

  // Set up timeout to prevent multer from hanging
  timeoutId = setTimeout(() => {
    if (!isCompleted) {
      isCompleted = true;
      logger.error('upload.multer.timeout', {
        message: 'Multer processing timeout - file upload took too long',
      });

      // If response hasn't been sent, send error
      if (!res.headersSent) {
        return res.status(408).json({
          errorCode: 'UPLOAD_TIMEOUT',
          error: 'Upload timed out',
          message: 'File upload processing timed out. Please try again with a smaller file.',
        });
      }
    }
  }, MULTER_TIMEOUT);

  // Call multer middleware
  // Create uploader per request so env-driven limits (MAX_FILE_SIZE) are deterministic in tests and runtime.
  const uploader = multer({
    storage,
    limits: { fileSize: maxFileSize },
    fileFilter,
  });

  uploader.single('file')(req, res, (err: unknown) => {
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
      const error = err as { message?: string; code?: string };
      logger.error('upload.multer.error', {
        errorMessage: error.message,
        errorCode: error.code,
      });
      drainRequest(req);

      // Handle specific multer errors
      if (error.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          errorCode: 'FILE_TOO_LARGE',
          error: 'File too large',
          message: `File size exceeds maximum allowed size (${maxFileSize / 1024 / 1024}MB)`,
        });
      }
      if (error.code === 'LIMIT_UNEXPECTED_FILE') {
        return res.status(400).json({
          errorCode: 'BAD_REQUEST',
          error: 'Unexpected file field',
          message: 'Unexpected file field name. Expected field name: "file"',
        });
      }

      if (err instanceof ApiError) {
        return res.status(err.status).json({
          errorCode: err.errorCode,
          error: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        });
      }

      return next(err);
    }

    next();
  });
};

// Re-export rate limiter for uploads
export { uploadLimiter } from './rateLimit.js';
