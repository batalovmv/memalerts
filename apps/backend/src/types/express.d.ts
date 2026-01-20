import type { Server as SocketIOServer } from 'socket.io';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      traceId?: string | null;
    }
    interface Application {
      get(name: 'io'): SocketIOServer;
      set(name: 'io', value: SocketIOServer): void;
    }
  }
}

export {};
