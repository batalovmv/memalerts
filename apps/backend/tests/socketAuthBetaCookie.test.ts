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

async function waitForRoomJoin(io: Server, room: string, minCount = 1, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sockets = await io.in(room).allSockets();
    if (sockets.size >= minCount) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timeout waiting for server room join: ${room}`);
}

describe('Socket.IO cookie selection: token_beta vs token', () => {
  it('uses token_beta on beta host; uses token on non-beta host', async () => {
    const tokenUser = makeJwt({ userId: 'user_from_token', role: 'viewer', channelId: 'ch1' });
    const tokenBetaUser = makeJwt({ userId: 'user_from_token_beta', role: 'viewer', channelId: 'ch1' });
    const cookie = `token=${encodeURIComponent(tokenUser)}; token_beta=${encodeURIComponent(tokenBetaUser)}`;

    const originalDomain = process.env.DOMAIN;

    // Beta server
    process.env.DOMAIN = 'beta.example.com';
    const betaHttp = createServer();
    const betaIo = new Server(betaHttp, { cors: { origin: '*', credentials: true } });
    setupSocketIO(betaIo);
    await new Promise<void>((resolve) => betaHttp.listen(0, resolve));
    const betaPort = (betaHttp.address() as AddressInfo).port;
    const betaUrl = `http://127.0.0.1:${betaPort}`;

    const betaSocket = ioClient(betaUrl, {
      forceNew: true,
      transportOptions: {
        polling: { extraHeaders: { cookie } },
        websocket: { extraHeaders: { cookie } },
      },
    });

    // Production server
    process.env.DOMAIN = 'example.com';
    const prodHttp = createServer();
    const prodIo = new Server(prodHttp, { cors: { origin: '*', credentials: true } });
    setupSocketIO(prodIo);
    await new Promise<void>((resolve) => prodHttp.listen(0, resolve));
    const prodPort = (prodHttp.address() as AddressInfo).port;
    const prodUrl = `http://127.0.0.1:${prodPort}`;

    const prodSocket = ioClient(prodUrl, {
      forceNew: true,
      transportOptions: {
        polling: { extraHeaders: { cookie } },
        websocket: { extraHeaders: { cookie } },
      },
    });

    try {
      await Promise.all([waitForEvent(betaSocket, 'connect', 4000), waitForEvent(prodSocket, 'connect', 4000)]);

      // Attempt joining both ids on each socket. Only the correct cookie-derived userId should succeed.
      betaSocket.emit('join:user', 'user_from_token');
      betaSocket.emit('join:user', 'user_from_token_beta');
      prodSocket.emit('join:user', 'user_from_token');
      prodSocket.emit('join:user', 'user_from_token_beta');

      // Wait until the expected rooms are actually joined on the server.
      await waitForRoomJoin(betaIo, 'user:user_from_token_beta', 1, 2000);
      await waitForRoomJoin(prodIo, 'user:user_from_token', 1, 2000);

      emitWalletUpdated(betaIo, { userId: 'user_from_token_beta', channelId: 'ch1', balance: 1 });
      const betaGot = await waitForEvent<any>(betaSocket, 'wallet:updated', 2000);
      expect(betaGot.userId).toBe('user_from_token_beta');
      await expectNoEvent(prodSocket, 'wallet:updated', 700);

      emitWalletUpdated(prodIo, { userId: 'user_from_token', channelId: 'ch1', balance: 2 });
      const prodGot = await waitForEvent<any>(prodSocket, 'wallet:updated', 2000);
      expect(prodGot.userId).toBe('user_from_token');
      await expectNoEvent(betaSocket, 'wallet:updated', 700);
    } finally {
      process.env.DOMAIN = originalDomain;
      betaSocket.disconnect();
      prodSocket.disconnect();
      await new Promise<void>((resolve) => betaIo.close(() => resolve()));
      await new Promise<void>((resolve) => betaHttp.close(() => resolve()));
      await new Promise<void>((resolve) => prodIo.close(() => resolve()));
      await new Promise<void>((resolve) => prodHttp.close(() => resolve()));
    }
  });
});


