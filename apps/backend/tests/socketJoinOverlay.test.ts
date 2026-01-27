import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';
import jwt from 'jsonwebtoken';

import { setupSocketIO } from '../src/socket/index.js';
import { createChannel } from './factories/index.js';

type TestEventPayload = { ok: boolean };

function makeOverlayJwt(payload: Record<string, unknown>): string {
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

describe('Socket.IO join:overlay', () => {
  it('accepts current tv and denies rotated tv; joins channel:{slugLower}', async () => {
    const channelId = randomUUID();
    const slug = 'MyChan';
    await createChannel({
      id: channelId,
      slug,
      name: 'Test channel',
      overlayTokenVersion: 2,
    });

    const httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
    setupSocketIO(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    const goodToken = makeOverlayJwt({ kind: 'overlay', channelId, tv: 2 });
    const rotatedToken = makeOverlayJwt({ kind: 'overlay', channelId, tv: 1 });
    const badKindToken = makeOverlayJwt({ kind: 'nope', channelId, tv: 2 });

    const good = ioClient(url, { transports: ['websocket'], forceNew: true });
    const rotated = ioClient(url, { transports: ['websocket'], forceNew: true });
    const badKind = ioClient(url, { transports: ['websocket'], forceNew: true });

    try {
      await Promise.all([
        waitForEvent(good, 'connect', 4000),
        waitForEvent(rotated, 'connect', 4000),
        waitForEvent(badKind, 'connect', 4000),
      ]);

      const goodCfgP = waitForEvent<unknown>(good, 'overlay:config', 2000);
      good.emit('join:overlay', { token: goodToken });
      rotated.emit('join:overlay', { token: rotatedToken });
      badKind.emit('join:overlay', { token: badKindToken });

      // Good overlay must receive private overlay config.
      const cfg = await goodCfgP;
      expect(cfg).toBeTruthy();

      // Rotated token / bad kind must not receive overlay:config.
      await expectNoEvent(rotated, 'overlay:config', 700);
      await expectNoEvent(badKind, 'overlay:config', 700);

      // Only good socket should be joined to the channel room.
      io.to(`channel:${slug.toLowerCase()}`).emit('test:event', { ok: true });
      const got = await waitForEvent<TestEventPayload>(good, 'test:event', 2000);
      expect(got.ok).toBe(true);
      await expectNoEvent(rotated, 'test:event', 700);
      await expectNoEvent(badKind, 'test:event', 700);
    } finally {
      good.disconnect();
      rotated.disconnect();
      badKind.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

  it('uses DB slug even if token has stale channelSlug; tv defaults to 1 if missing', async () => {
    const channelId = randomUUID();
    const dbSlug = 'NewSlug';
    await createChannel({
      id: channelId,
      slug: dbSlug,
      name: 'Slug change channel',
      overlayTokenVersion: 2,
    });

    const httpServer = createServer();
    const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
    setupSocketIO(io);
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as AddressInfo).port;
    const url = `http://127.0.0.1:${port}`;

    // Missing tv => defaults to 1 => must be denied because current version is 2.
    const missingTvToken = makeOverlayJwt({ kind: 'overlay', channelId, channelSlug: 'oldslug' });
    // Correct tv + stale channelSlug => should still join DB slug.
    const goodToken = makeOverlayJwt({ kind: 'overlay', channelId, channelSlug: 'oldslug', tv: 2 });

    const missingTv = ioClient(url, { transports: ['websocket'], forceNew: true });
    const good = ioClient(url, { transports: ['websocket'], forceNew: true });

    try {
      await Promise.all([waitForEvent(missingTv, 'connect', 4000), waitForEvent(good, 'connect', 4000)]);
      const goodCfgP = waitForEvent<unknown>(good, 'overlay:config', 2000);
      missingTv.emit('join:overlay', { token: missingTvToken });
      good.emit('join:overlay', { token: goodToken });

      // Missing tv must not get overlay config.
      await expectNoEvent(missingTv, 'overlay:config', 700);

      // Good token must get overlay config...
      const cfg = await goodCfgP;
      expect(cfg).toBeTruthy();

      // ...and must be in the DB slug room (not in "oldslug").
      io.to(`channel:${dbSlug.toLowerCase()}`).emit('test:event', { ok: true });
      const got = await waitForEvent<TestEventPayload>(good, 'test:event', 2000);
      expect(got.ok).toBe(true);
    } finally {
      missingTv.disconnect();
      good.disconnect();
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  });

});
