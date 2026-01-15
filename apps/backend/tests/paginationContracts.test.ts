import { describe, it, expect, beforeEach } from 'vitest';
import type { Request, Response } from 'express';
import type { AuthRequest } from '../src/middleware/auth.js';
import { prisma } from '../src/lib/prisma.js';
import { getMySubmissions } from '../src/controllers/submission/getMySubmissions.js';
import { getChannelMemesPublic } from '../src/controllers/viewer/channel.js';
import { getPublicChannelMemes, searchPublicChannelMemes } from '../src/controllers/public/channelPublicController.js';
import { createChannel, createChannelMeme, createMemeAsset, createSubmission, createUser } from './factories/index.js';

function rand(): string {
  return Math.random().toString(16).slice(2);
}

type MockResponse = {
  statusCode: number;
  headersSent: boolean;
  headers: Record<string, unknown>;
  body?: unknown;
  status: (code: number) => MockResponse;
  setHeader: (key: string, value: unknown) => MockResponse;
  getHeader: (key: string) => unknown;
  type: (value?: string) => MockResponse;
  send: (body: unknown) => MockResponse;
  json: (body: unknown) => MockResponse;
};

function createMockRes(): MockResponse {
  const headers: Record<string, unknown> = {};
  const res: MockResponse = {
    statusCode: 200,
    headersSent: false,
    headers,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(key: string, value: unknown) {
      headers[key.toLowerCase()] = value;
      return this;
    },
    getHeader(key: string) {
      return headers[key.toLowerCase()];
    },
    type() {
      return this;
    },
    send(body: unknown) {
      try {
        this.body = typeof body === 'string' ? JSON.parse(body) : body;
      } catch {
        this.body = body;
      }
      this.headersSent = true;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      this.headersSent = true;
      return this;
    },
  };
  return res;
}

describe('cursor pagination contracts', () => {
  beforeEach(async () => {
    await prisma.memeSubmissionTag.deleteMany({});
    await prisma.memeSubmission.deleteMany({});
    await prisma.channelMeme.deleteMany({});
    await prisma.memeAsset.deleteMany({});
    await prisma.channel.deleteMany({});
    await prisma.user.deleteMany({});
  });

  it('paginates viewer submissions with stable cursor', async () => {
    const channel = await createChannel({ slug: `ch_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    const user = await createUser({ displayName: 'Viewer', role: 'viewer', hasBetaAccess: true });

    for (let i = 0; i < 3; i += 1) {
      await createSubmission({
        channelId: channel.id,
        submitterUserId: user.id,
        title: `Submission ${i}`,
        type: 'video',
        fileUrlTemp: `/uploads/${rand()}.mp4`,
        sourceKind: 'upload',
        status: 'pending',
        createdAt: new Date(Date.now() - i * 1_000),
      });
    }

    const req = { userId: user.id, query: { limit: '2' } } as unknown as AuthRequest;
    const res = createMockRes();
    await getMySubmissions(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(typeof res.body.nextCursor).toBe('string');

    const nextReq = { userId: user.id, query: { cursor: (res.body as { nextCursor?: string }).nextCursor } } as unknown as AuthRequest;
    const nextRes = createMockRes();
    await getMySubmissions(nextReq, nextRes as unknown as Response);
    expect(nextRes.statusCode).toBe(200);
    expect(nextRes.body.items).toHaveLength(1);
    expect(nextRes.body.nextCursor).toBeNull();
    const firstItems = (res.body as { items?: Array<{ id: string }> }).items ?? [];
    const firstIds = firstItems.map((i) => i.id);
    const nextItems = (nextRes.body as { items?: Array<{ id: string }> }).items ?? [];
    expect(firstIds).not.toContain(nextItems[0]?.id);
  });

  it('rejects viewer submissions limit above 100', async () => {
    const user = await createUser({ displayName: 'Viewer', role: 'viewer', hasBetaAccess: true });
    const req = { userId: user.id, query: { limit: '500' } } as unknown as AuthRequest;
    const res = createMockRes();
    await getMySubmissions(req, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_LIMIT');
  });

  it('paginates channel memes with cursor and cache headers', async () => {
    const channel = await createChannel({ slug: `slug_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    for (let i = 0; i < 2; i += 1) {
      const asset = await createMemeAsset({
        type: 'video',
        fileUrl: `/uploads/meme-${i}.mp4`,
        durationMs: 1_000,
        poolVisibility: 'hidden',
      });
      await createChannelMeme({
        channelId: channel.id,
        memeAssetId: asset.id,
        title: `Meme ${i}`,
        priceCoins: 100 + i,
      });
    }

    const req = { params: { slug: channel.slug }, query: { limit: '1' }, headers: {} } as unknown as Request;
    const res = createMockRes();
    await getChannelMemesPublic(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body?.items).toHaveLength(1);
    expect(typeof res.body?.nextCursor).toBe('string');
    expect(res.headers['cache-control']).toBeDefined();

    const reqNext = {
      params: { slug: channel.slug },
      query: { cursor: res.body.nextCursor },
      headers: {},
    } as unknown as Request;
    const resNext = createMockRes();
    await getChannelMemesPublic(reqNext, resNext as unknown as Response);
    expect(resNext.statusCode).toBe(200);
    expect(resNext.body?.items).toHaveLength(1);
    expect(resNext.body?.nextCursor).toBeNull();
    const firstChannelMemeId = res.body.items[0].channelMemeId;
    expect(resNext.body.items[0].channelMemeId).not.toBe(firstChannelMemeId);
  });

  it('rejects channel memes limit above 100', async () => {
    const channel = await createChannel({ slug: `slug_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    const req = { params: { slug: channel.slug }, query: { limit: '500' }, headers: {} } as unknown as Request;
    const res = createMockRes();
    await getChannelMemesPublic(req, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_LIMIT');
  });

  it('paginates public channel memes with cursor opt-in', async () => {
    const channel = await createChannel({ slug: `pub_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    for (let i = 0; i < 3; i += 1) {
      const asset = await createMemeAsset({
        type: 'video',
        fileUrl: `/uploads/public-${i}.mp4`,
        durationMs: 1_000,
      });
      await createChannelMeme({
        channelId: channel.id,
        memeAssetId: asset.id,
        title: `Public Meme ${i}`,
        priceCoins: 100 + i,
      });
    }

    const req = { params: { slug: channel.slug }, query: { limit: '2', cursor: '' }, headers: {} } as unknown as Request;
    const res = createMockRes();
    await getPublicChannelMemes(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body?.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);
    expect(typeof res.body.nextCursor).toBe('string');
    expect(res.body.total).toBeNull();

    const nextReq = {
      params: { slug: channel.slug },
      query: { cursor: res.body.nextCursor },
      headers: {},
    } as unknown as Request;
    const nextRes = createMockRes();
    await getPublicChannelMemes(nextReq, nextRes as unknown as Response);
    expect(nextRes.statusCode).toBe(200);
    expect(nextRes.body.items).toHaveLength(1);
    expect(nextRes.body.nextCursor).toBeNull();
  });

  it('paginates public channel memes search with cursor opt-in', async () => {
    const channel = await createChannel({ slug: `pub_search_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    for (let i = 0; i < 2; i += 1) {
      const asset = await createMemeAsset({
        type: 'video',
        fileUrl: `/uploads/public-search-${i}.mp4`,
        durationMs: 1_000,
      });
      await createChannelMeme({
        channelId: channel.id,
        memeAssetId: asset.id,
        title: `Perf Meme ${i}`,
        priceCoins: 50,
      });
    }

    const req = {
      params: { slug: channel.slug },
      query: { q: 'Perf', limit: '1', cursor: '' },
      headers: {},
    } as unknown as Request;
    const res = createMockRes();
    await searchPublicChannelMemes(req, res as unknown as Response);
    expect(res.statusCode).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(typeof res.body.nextCursor).toBe('string');

    const nextReq = {
      params: { slug: channel.slug },
      query: { q: 'Perf', cursor: res.body.nextCursor },
      headers: {},
    } as unknown as Request;
    const nextRes = createMockRes();
    await searchPublicChannelMemes(nextReq, nextRes as unknown as Response);
    expect(nextRes.statusCode).toBe(200);
    expect(nextRes.body.items).toHaveLength(1);
    expect(nextRes.body.nextCursor).toBeNull();
  });

  it('rejects public channel memes limit above 100', async () => {
    const channel = await createChannel({ slug: `pub_limit_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    const req = { params: { slug: channel.slug }, query: { limit: '500' }, headers: {} } as unknown as Request;
    const res = createMockRes();
    await getPublicChannelMemes(req, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_LIMIT');
  });

  it('rejects public channel memes search limit above 100', async () => {
    const channel = await createChannel({ slug: `pub_limit_search_${rand()}`, name: 'Channel', coinPerPointRatio: 1 });
    const req = {
      params: { slug: channel.slug },
      query: { q: 'perf', limit: '500' },
      headers: {},
    } as unknown as Request;
    const res = createMockRes();
    await searchPublicChannelMemes(req, res as unknown as Response);
    expect(res.statusCode).toBe(400);
    expect(res.body?.errorCode).toBe('INVALID_LIMIT');
  });
});
