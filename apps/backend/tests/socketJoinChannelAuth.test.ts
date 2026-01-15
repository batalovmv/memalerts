import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';

import { setupSocketIO } from '../src/socket/index.js';
import { createChannel, createUser } from './factories/index.js';

type TestEventPayload = { ok: boolean };

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function connectWithCookie(url: string, cookie: string): ClientSocket {
  return ioClient(url, {
    forceNew: true,
    transportOptions: {
      polling: { extraHeaders: { cookie } },
      websocket: { extraHeaders: { cookie } },
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

async function waitForRoomJoin(io: Server, room: string, minCount = 1, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const sockets = await io.in(room).allSockets();
    if (sockets.size >= minCount) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timeout waiting for server room join: ${room}`);
}

describe('Socket.IO join:channel (authenticated dashboard room)', () => {
  it('allows streamer to join own channel slug; denies viewer and slug mismatch', async () => {
    const channelId = randomUUID();
    const slug = 'MySlug';
    await createChannel({ id: channelId, slug, name: 'Test Channel' });

    const streamer = await createUser({ displayName: 'Streamer', role: 'streamer', channelId });
    const viewer = await createUser({ displayName: 'Viewer', role: 'viewer', channelId });

    const streamerToken = makeJwt({ userId: streamer.id, role: streamer.role, channelId: streamer.channelId });
    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: viewer.channelId });

    const httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
    setupSocketIO(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const s = connectWithCookie(url, `token=${encodeURIComponent(streamerToken)}`);
    const v = connectWithCookie(url, `token=${encodeURIComponent(viewerToken)}`);

    try {
      await Promise.all([waitForEvent(s, 'connect', 4000), waitForEvent(v, 'connect', 4000)]);

      // Viewer should not be able to join.
      v.emit('join:channel', slug);

      // Streamer can join correct slug (case-insensitive; room uses lowercased slug).
      s.emit('join:channel', 'mYsLuG');
      await waitForRoomJoin(io, `channel:${slug.toLowerCase()}`, 1, 2500);

      // Slug mismatch should not join a different room.
      s.emit('join:channel', 'other-slug');

      // Emit to the channel room, streamer should receive, viewer should not.
      io.to(`channel:${slug.toLowerCase()}`).emit('test:event', { ok: true });
      const got = await waitForEvent<TestEventPayload>(s, 'test:event', 2000);
      expect(got.ok).toBe(true);
      await expectNoEvent(v, 'test:event', 700);
    } finally {
      s.disconnect();
      v.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });
});
