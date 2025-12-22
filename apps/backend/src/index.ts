import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import dotenv from 'dotenv';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupSocketIO } from './socket/index.js';
import { setupRoutes } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { globalLimiter } from './middleware/rateLimit.js';
import { startRejectedSubmissionsCleanupScheduler } from './jobs/cleanupRejectedSubmissions.js';

dotenv.config();

// In production, remove console noise (keep console.error for real issues).
if (process.env.NODE_ENV === 'production') {
  // eslint-disable-next-line no-console
  console.log = () => {};
  // eslint-disable-next-line no-console
  console.info = () => {};
  // eslint-disable-next-line no-console
  console.debug = () => {};
  // eslint-disable-next-line no-console
  console.warn = () => {};
}

const app = express();
const httpServer = createServer(app);
// Get allowed origins from env or use defaults
// IMPORTANT: Beta and production must be isolated
// - Beta backend should only allow beta frontend
// - Production backend should only allow production frontend
const getAllowedOrigins = () => {
  const origins: string[] = [];
  
  // Check if this is a beta instance (by checking DOMAIN or PORT)
  const isBetaInstance = process.env.DOMAIN?.includes('beta.') || process.env.PORT === '3002';
  
  if (process.env.WEB_URL) {
    // Only add WEB_URL if it matches the instance type (beta or production)
    const webUrlIsBeta = process.env.WEB_URL.includes('beta.');
    if ((isBetaInstance && webUrlIsBeta) || (!isBetaInstance && !webUrlIsBeta)) {
      origins.push(process.env.WEB_URL);
    }
  }
  
  if (process.env.OVERLAY_URL) {
    origins.push(process.env.OVERLAY_URL);
  }
  
  if (process.env.DOMAIN) {
    // Only add domain if it matches instance type
    const domainIsBeta = process.env.DOMAIN.includes('beta.');
    if ((isBetaInstance && domainIsBeta) || (!isBetaInstance && !domainIsBeta)) {
      origins.push(`https://${process.env.DOMAIN}`);
      origins.push(`https://www.${process.env.DOMAIN}`);
    }
  }
  
  // Development fallback
  if (origins.length === 0) {
    origins.push('http://localhost:5173', 'http://localhost:5174');
  }
  
  // Log origins for debugging (always log in production for troubleshooting)
  console.log('[Socket.IO] Allowed origins:', origins);
  console.log('[Socket.IO] Instance type:', isBetaInstance ? 'beta' : 'production');
  console.log('[Socket.IO] DOMAIN:', process.env.DOMAIN);
  console.log('[Socket.IO] WEB_URL:', process.env.WEB_URL);
  console.log('[Socket.IO] PORT:', process.env.PORT);
  
  return origins;
};

const io = new Server(httpServer, {
  cors: {
    origin: getAllowedOrigins(),
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;

// Configure HTTP server timeouts to prevent hanging requests
// Timeout for inactive connections (5 minutes for file uploads)
httpServer.timeout = 300000; // 5 minutes
httpServer.keepAliveTimeout = 65000; // 65 seconds
httpServer.headersTimeout = 66000; // 66 seconds (must be > keepAliveTimeout)
httpServer.on('timeout', (socket) => {
  console.error('HTTP server timeout - closing socket');
  socket.destroy();
});

// Trust proxy for rate limiting behind reverse proxy (nginx/cloudflare)
// Set to 1 to trust first proxy (nginx), or 2 if behind Cloudflare + nginx
// This prevents express-rate-limit validation error while still allowing IP detection
app.set('trust proxy', 1);

// Middleware
// Configure helmet with proper CSP
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"], // 'unsafe-inline' needed for Vite HMR in dev, but should be removed in production
        styleSrc: ["'self'", "'unsafe-inline'"], // 'unsafe-inline' needed for Tailwind CSS and inline styles
        imgSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://static-cdn.jtvnw.net', // Twitch avatars and images
          'https://*.twitch.tv', // Twitch CDN
        ],
        mediaSrc: [
          "'self'",
          'data:',
          'blob:',
          'https://static-cdn.jtvnw.net', // Twitch media
        ],
        connectSrc: [
          "'self'",
          'wss:', // WebSocket for Socket.IO
          'ws:', // WebSocket for Socket.IO (dev)
          'https://id.twitch.tv', // Twitch OAuth
          'https://api.twitch.tv', // Twitch API (if used)
          'https://static-cdn.jtvnw.net', // Twitch CDN
        ],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'", 'https://id.twitch.tv'], // Twitch OAuth redirect
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null, // Only in production
      },
    },
  })
);
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    exposedHeaders: ['Set-Cookie'],
  })
);

// CSRF protection for state-changing operations (must be after CORS)
import { csrfProtection } from './middleware/csrf.js';
app.use(csrfProtection);
// Increase body size limit for file uploads (100MB)
app.use(express.json({ limit: '100mb' }));
app.use(cookieParser());
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Request timeout middleware for long-running requests (like file uploads)
app.use((req, res, next) => {
  // Set timeout for requests (5 minutes for file uploads)
  const REQUEST_TIMEOUT = 300000; // 5 minutes
  req.setTimeout(REQUEST_TIMEOUT, () => {
    if (!res.headersSent) {
      console.error(`Request timeout: ${req.method} ${req.path}`);
      res.status(408).json({ 
        error: 'Request timeout', 
        message: 'Request timed out. Please try again.' 
      });
    }
  });
  next();
});


// Static files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.join(process.cwd(), uploadDir)));

// Attach io to app for use in routes
app.set('io', io);

// Global rate limiting (applied to all routes)
app.use(globalLimiter);

// Routes
setupRoutes(app);

// 404 handler for unmatched routes
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} not found` });
});

// Socket.IO
setupSocketIO(io);

// Error handler
app.use(errorHandler);

// Test database connection before starting server
import { prisma } from './lib/prisma.js';

async function startServer() {
  // Validate required environment variables
  const requiredEnvVars = [
    'DATABASE_URL',
    'JWT_SECRET',
    'TWITCH_CLIENT_ID',
    'TWITCH_CLIENT_SECRET',
    'TWITCH_EVENTSUB_SECRET',
  ];
  
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
  
  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => {
      console.error(`   - ${varName}`);
    });
    console.error('');
    console.error('Please set these variables in your .env file or environment.');
    process.exit(1);
  }

  // Validate optional but recommended environment variables
  const recommendedEnvVars = [
    'DOMAIN',
    'WEB_URL',
    'TWITCH_CALLBACK_URL',
  ];
  
  const missingRecommended = recommendedEnvVars.filter(varName => !process.env[varName]);
  
  if (missingRecommended.length > 0 && process.env.NODE_ENV === 'production') {
    console.warn('⚠️  Missing recommended environment variables (may cause issues in production):');
    missingRecommended.forEach(varName => {
      console.warn(`   - ${varName}`);
    });
    console.warn('');
  }

  // Validate URL format for WEB_URL and TWITCH_CALLBACK_URL if provided
  if (process.env.WEB_URL) {
    try {
      new URL(process.env.WEB_URL);
    } catch (urlError: any) {
      console.error('❌ Invalid WEB_URL format:', process.env.WEB_URL);
      console.error('   WEB_URL must be a valid URL (e.g., https://example.com)');
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }
  }

  if (process.env.TWITCH_CALLBACK_URL) {
    try {
      const callbackUrl = new URL(process.env.TWITCH_CALLBACK_URL);
      if (!callbackUrl.protocol.startsWith('https')) {
        console.warn('⚠️  TWITCH_CALLBACK_URL should use HTTPS in production');
      }
    } catch (urlError: any) {
      console.error('❌ Invalid TWITCH_CALLBACK_URL format:', process.env.TWITCH_CALLBACK_URL);
      console.error('   TWITCH_CALLBACK_URL must be a valid URL');
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }
  }

  // Validate DOMAIN format if provided
  if (process.env.DOMAIN) {
    const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
    if (!domainRegex.test(process.env.DOMAIN)) {
      console.error('❌ Invalid DOMAIN format:', process.env.DOMAIN);
      console.error('   DOMAIN must be a valid domain name (e.g., example.com or beta.example.com)');
      if (process.env.NODE_ENV === 'production') {
        process.exit(1);
      }
    }
  }
  
  // Validate DATABASE_URL format before attempting connection
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    try {
      const url = new URL(dbUrl);
      
      // Validate port
      if (url.port && isNaN(parseInt(url.port))) {
        console.error('❌ Invalid port in DATABASE_URL:', url.port);
        console.error('   Full URL (first 100 chars):', dbUrl.substring(0, 100));
        process.exit(1);
      }
      
      // Check for common typos in schema parameter
      const schemaMatch = dbUrl.match(/schema=([^&]+)/);
      if (schemaMatch) {
        const schemaValue = schemaMatch[1];
        
        if (schemaValue !== 'public') {
          console.error('❌ Invalid schema value in DATABASE_URL:', schemaValue);
          console.error('   Expected: schema=public');
          console.error('   Found: schema=' + schemaValue);
          if (schemaValue === 'publi') {
            console.error('   ⚠️  Common typo detected: "publi" should be "public"');
          }
          process.exit(1);
        }
      }
    } catch (urlError: any) {
      console.error('❌ Invalid DATABASE_URL format:', urlError.message);
      console.error('   URL (first 100 chars):', dbUrl.substring(0, 100));
      console.error('   Check for:');
      console.error('   - Special characters that need escaping (use % encoding)');
      console.error('   - Spaces or newlines');
      console.error('   - Correct format: postgresql://user:password@host:port/database?schema=public');
      process.exit(1);
    }
  }
  
  try {
    // Test database connection
    console.log('Testing database connection...');
    await prisma.$connect();
    console.log('✅ Database connection successful');
    
    // Test a simple query
    await prisma.$queryRaw`SELECT 1`;
    console.log('✅ Database query test successful');

  } catch (error) {
    console.error('❌ Database connection failed:', error);
    if (error instanceof Error) {
      console.error('Error message:', error.message);
    }
    console.error('');
    console.error('Please check:');
    console.error('1. DATABASE_URL is correctly set in .env');
    console.error('2. PostgreSQL is running: sudo systemctl status postgresql');
    console.error('3. Database and user exist');
    console.error('4. Password in DATABASE_URL is correct');
    process.exit(1);
  }

  // Check if port is already in use
  httpServer.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`❌ Port ${PORT} is already in use`);
      console.error('Please stop the process using this port or use a different port');
      console.error(`Find process: lsof -ti:${PORT}`);
      process.exit(1);
    } else {
      throw err;
    }
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 API server running on http://localhost:${PORT}`);
    console.log(`📊 Database connection: ${process.env.DATABASE_URL ? 'configured' : 'not configured'}`);
    // Economical storage: cleanup rejected submissions after TTL (default 30 days).
    startRejectedSubmissionsCleanupScheduler();
  });
}

startServer();

