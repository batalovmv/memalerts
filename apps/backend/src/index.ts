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

dotenv.config();

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
app.set('trust proxy', true);

// Middleware
// Configure helmet to allow cookies
app.use(
  helmet({
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false, // Disable CSP for now to avoid cookie issues
  })
);
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
    exposedHeaders: ['Set-Cookie'],
  })
);
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
  });
}

startServer();

