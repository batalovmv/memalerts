import rateLimit from 'express-rate-limit';

export const activateMemeLimiter = rateLimit({
  windowMs: 3 * 1000, // 3 seconds
  max: 1,
  message: 'Too many activation requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

export const uploadLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  message: 'Too many upload requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});


