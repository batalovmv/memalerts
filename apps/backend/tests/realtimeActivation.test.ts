import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as ioClient, type Socket as ClientSocket } from 'socket.io-client';

import { prisma } from '../src/lib/prisma.js';
import { setupRoutes } from '../src/routes/index.js';
import { setupSocketIO } from '../src/socket/index.js';
import { createChannel, createMeme, createUser, createWallet } from './factories/index.js';

type ActivationNewPayload = {
  id: string;
  memeId: string;
  type: string;
  fileUrl: string;
  durationMs: number;
  title: string;
  senderDisplayName: string | null;
};

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function connectClient(url: string, token: string): ClientSocket {
  const cookie = `token=${encodeURIComponent(token)}`;
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

async function waitForActivationStatus(activationId: string, status: string, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const activation = await prisma.memeActivation.findUnique({
      where: { id: activationId },
      select: { status: true },
    });
    if (activation?.status === status) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Timeout waiting for activation ${activationId} status ${status}`);
}

async function makeServer() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  const httpServer = createServer(app);
  const io = new Server(httpServer, { cors: { origin: '*', credentials: true } });
  setupSocketIO(io);
  app.set('io', io);
  setupRoutes(app);

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const port = (httpServer.address() as AddressInfo).port;

  return {
    app,
    io,
    port,
    close: async () => {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

describe('realtime activation events', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'development';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
    process.env.REDIS_URL = '';
    process.env.RATE_LIMIT_WHITELIST_IPS = '127.0.0.1,::1';
    process.env.AI_BULLMQ_ENABLED = '0';
    process.env.CHAT_OUTBOX_BULLMQ_ENABLED = '0';
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '',
    })) as typeof fetch;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('emits activation:new only to subscribed channel sockets', async () => {
    const server = await makeServer();
    const url = `http://127.0.0.1:${server.port}`;

    const channel = await createChannel({ slug: 'activation-live', name: 'Activation Live' });
    const otherChannel = await createChannel({ slug: 'activation-other', name: 'Activation Other' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const otherStreamer = await createUser({ role: 'streamer', channelId: otherChannel.id });
    const viewer = await createUser({ role: 'viewer', channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 300 });
    const meme = await createMeme({
      channelId: channel.id,
      title: 'Realtime Meme',
      type: 'video',
      priceCoins: 100,
      status: 'approved',
    });

    const streamerToken = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const otherToken = makeJwt({ userId: otherStreamer.id, role: otherStreamer.role, channelId: otherChannel.id });
    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });

    const socketA = connectClient(url, streamerToken);
    const socketB = connectClient(url, otherToken);

    try {
      await Promise.all([waitForEvent(socketA, 'connect', 4000), waitForEvent(socketB, 'connect', 4000)]);
      socketA.emit('join:channel', channel.slug);
      socketB.emit('join:channel', otherChannel.slug);

      await Promise.all([
        waitForRoomJoin(server.io, `channel:${channel.slug.toLowerCase()}`),
        waitForRoomJoin(server.io, `channel:${otherChannel.slug.toLowerCase()}`),
      ]);

      const eventPromise = waitForEvent<ActivationNewPayload>(socketA, 'activation:new', 4000);

      const res = await request(server.app)
        .post(`/memes/${meme.id}/activate`)
        .set('Cookie', [`token=${encodeURIComponent(viewerToken)}`])
        .set('Host', 'example.com')
        .send({ channelId: channel.id });
      expect(res.status).toBe(200);

      const payload = await eventPromise;
      expect(payload.memeId).toBe(meme.id);
      expect(payload.type).toBe('video');
      expect(payload.title).toBe('Realtime Meme');
      expect(payload.senderDisplayName).toBe(viewer.displayName);

      await expectNoEvent(socketB, 'activation:new', 600);
    } finally {
      socketA.disconnect();
      socketB.disconnect();
      await server.close();
    }
  });

  it('updates activation status to done via activation:ackDone', async () => {
    const server = await makeServer();
    const url = `http://127.0.0.1:${server.port}`;

    const channel = await createChannel({ slug: 'activation-ack', name: 'Activation Ack' });
    const streamer = await createUser({ role: 'streamer', channelId: channel.id });
    const viewer = await createUser({ role: 'viewer', channelId: null });
    await createWallet({ userId: viewer.id, channelId: channel.id, balance: 300 });
    const meme = await createMeme({
      channelId: channel.id,
      title: 'Ack Meme',
      type: 'video',
      priceCoins: 100,
      status: 'approved',
    });

    const streamerToken = makeJwt({ userId: streamer.id, role: streamer.role, channelId: channel.id });
    const viewerToken = makeJwt({ userId: viewer.id, role: viewer.role, channelId: null });

    const socket = connectClient(url, streamerToken);

    try {
      await waitForEvent(socket, 'connect', 4000);

      const res = await request(server.app)
        .post(`/memes/${meme.id}/activate`)
        .set('Cookie', [`token=${encodeURIComponent(viewerToken)}`])
        .set('Host', 'example.com')
        .send({ channelId: channel.id });
      expect(res.status).toBe(200);
      const activationId = String(res.body?.activation?.id || '');
      expect(activationId).toBeTruthy();

      socket.emit('activation:ackDone', { activationId });
      await waitForActivationStatus(activationId, 'done', 2000);
    } finally {
      socket.disconnect();
      await server.close();
    }
  });
});
