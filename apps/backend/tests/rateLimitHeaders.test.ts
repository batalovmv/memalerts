import express from 'express';
import request from 'supertest';
import { describe, it, expect } from 'vitest';
import { activateMemeLimiter } from '../src/middleware/rateLimit.js';

describe('rate limit headers', () => {
  it('returns RateLimit headers and Retry-After on 429', async () => {
    const app = express();
    app.use(activateMemeLimiter);
    app.get('/limited', (_req, res) => res.status(200).json({ ok: true }));

    const first = await request(app).get('/limited');
    expect(first.status).toBe(200);

    const second = await request(app).get('/limited');
    expect(second.status).toBe(429);
    expect(second.headers['ratelimit-limit']).toBeDefined();
    expect(second.headers['ratelimit-remaining']).toBeDefined();
    expect(second.headers['ratelimit-reset']).toBeDefined();
    expect(second.headers['x-ratelimit-limit']).toBeDefined();
    expect(second.headers['x-ratelimit-remaining']).toBeDefined();
    expect(second.headers['x-ratelimit-reset']).toBeDefined();
    const retryAfter = Number(second.headers['retry-after']);
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
  });
});
