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

function connectClient(url: string, token: string): ClientSocket {
  // Handshake auth is derived from cookies in `setupSocketIO`.
  const cookie = `token=${encodeURIComponent(token)}`;
  return ioClient(url, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: {
      cookie,
      host: 'example.com',
    },
  });
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

describe('Socket.IO join:user', () => {
  it('only allows joining own user room; wallet updates do not leak to other users', async () => {
    const httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
    setupSocketIO(io);

    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const tokenA = makeJwt({ userId: 'userA', role: 'viewer', channelId: 'ch1' });
    const tokenB = makeJwt({ userId: 'userB', role: 'viewer', channelId: 'ch1' });

    const a = connectClient(url, tokenA);
    const b = connectClient(url, tokenB);

    try {
      await Promise.all([
        waitForEvent(a, 'connect', 4000),
        waitForEvent(b, 'connect', 4000),
      ]);

      a.emit('join:user', 'userA');
      b.emit('join:user', 'userB');

      // Attempt to join чужую комнату (должно быть проигнорировано).
      a.emit('join:user', 'userB');

      emitWalletUpdated(io, { userId: 'userA', channelId: 'ch1', balance: 1 });
      const payloadA = await waitForEvent<any>(a, 'wallet:updated');
      expect(payloadA.userId).toBe('userA');

      // UserB не должен получить апдейт userA.
      await expectNoEvent(b, 'wallet:updated', 600);

      emitWalletUpdated(io, { userId: 'userB', channelId: 'ch1', balance: 2 });
      const payloadB = await waitForEvent<any>(b, 'wallet:updated');
      expect(payloadB.userId).toBe('userB');

      // UserA не должен получить апдейт userB (даже после попытки join:user('userB')).
      await expectNoEvent(a, 'wallet:updated', 600);
    } finally {
      a.disconnect();
      b.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});


