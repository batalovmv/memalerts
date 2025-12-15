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
const io = new Server(httpServer, {
  cors: {
    origin: [process.env.WEB_URL || 'http://localhost:5173', process.env.OVERLAY_URL || 'http://localhost:5174'],
    credentials: true,
  },
});

const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(
  cors({
    origin: [process.env.WEB_URL || 'http://localhost:5173', process.env.OVERLAY_URL || 'http://localhost:5174'],
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

