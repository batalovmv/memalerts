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

dotenv.config();

const app = express();
const httpServer = createServer(app);
// Get allowed origins from env or use defaults
const getAllowedOrigins = () => {
  const origins: string[] = [];
  if (process.env.WEB_URL) origins.push(process.env.WEB_URL);
  if (process.env.OVERLAY_URL) origins.push(process.env.OVERLAY_URL);
  if (process.env.DOMAIN) {
    origins.push(`https://${process.env.DOMAIN}`);
    origins.push(`https://www.${process.env.DOMAIN}`);
  }
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
app.use(express.json());
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));

// Static files
const uploadDir = process.env.UPLOAD_DIR || './uploads';
app.use('/uploads', express.static(path.join(process.cwd(), uploadDir)));

// Attach io to app for use in routes
app.set('io', io);

// Routes
// #region agent log
app.use((req, res, next) => {
  fetch('http://127.0.0.1:7242/ingest/f52f537a-c023-4ae4-bc11-acead46bc13e', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'index.ts:beforeRoutes', message: 'Request received by Express', data: { method: req.method, path: req.path, url: req.url, originalUrl: req.originalUrl }, timestamp: Date.now(), sessionId: 'debug-session', runId: 'run2', hypothesisId: 'C' }) }).catch(() => {});
  next();
});
// #endregion
setupRoutes(app);

// Socket.IO
setupSocketIO(io);

// Error handler
app.use(errorHandler);

// Test database connection before starting server
import { prisma } from './lib/prisma.js';

async function startServer() {
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

