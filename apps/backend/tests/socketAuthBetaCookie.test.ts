import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';

import { setupSocketIO } from '../src/socket/index.js';
import { emitWalletUpdated } from '../src/realtime/walletBridge.js';

function makeJwt(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 2000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

async function expectNoEvent(socket: ClientSocket, event: string, ms = 600): Promise<void> {
  let seen = false;
  const handler = () => {
    seen = true;
  };
  socket.on(event, handler);
  await new Promise((r) => setTimeout(r, ms));
  socket.off(event, handler);
  if (seen) throw new Error(`Expected no ${event} but received one`);
}

describe('Socket.IO cookie selection: token_beta vs token', () => {
  it('uses token_beta on beta host; uses token on non-beta host', async () => {
    const httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
    setupSocketIO(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const tokenUser = makeJwt({ userId: 'user_from_token', role: 'viewer', channelId: 'ch1' });
    const tokenBetaUser = makeJwt({ userId: 'user_from_token_beta', role: 'viewer', channelId: 'ch1' });
    const cookie = `token=${encodeURIComponent(tokenUser)}; token_beta=${encodeURIComponent(tokenBetaUser)}`;

    const betaSocket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { cookie, host: 'beta.example.com' },
    });
    const prodSocket = ioClient(url, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { cookie, host: 'example.com' },
    });

    try {
      await Promise.all([waitForEvent(betaSocket, 'connect', 4000), waitForEvent(prodSocket, 'connect', 4000)]);

      // Attempt joining both ids on each socket. Only the correct cookie-derived userId should succeed.
      betaSocket.emit('join:user', 'user_from_token');
      betaSocket.emit('join:user', 'user_from_token_beta');
      prodSocket.emit('join:user', 'user_from_token');
      prodSocket.emit('join:user', 'user_from_token_beta');

      emitWalletUpdated(io, { userId: 'user_from_token_beta', channelId: 'ch1', balance: 1 });
      const betaGot = await waitForEvent<any>(betaSocket, 'wallet:updated', 2000);
      expect(betaGot.userId).toBe('user_from_token_beta');
      await expectNoEvent(prodSocket, 'wallet:updated', 700);

      emitWalletUpdated(io, { userId: 'user_from_token', channelId: 'ch1', balance: 2 });
      const prodGot = await waitForEvent<any>(prodSocket, 'wallet:updated', 2000);
      expect(prodGot.userId).toBe('user_from_token');
      await expectNoEvent(betaSocket, 'wallet:updated', 700);
    } finally {
      betaSocket.disconnect();
      prodSocket.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});


