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
app.use(helmet());
app.use(
  cors({
    origin: getAllowedOrigins(),
    credentials: true,
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
setupRoutes(app);

// Socket.IO
setupSocketIO(io);

// Error handler
app.use(errorHandler);

httpServer.listen(PORT, () => {
  console.log(`🚀 API server running on http://localhost:${PORT}`);
});

