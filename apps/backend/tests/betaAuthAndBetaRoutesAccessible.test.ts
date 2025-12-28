import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('beta domain: /auth/* and /beta/* remain accessible to guests', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
    // Minimal env so /auth/twitch can build authorize URL (no network).
    process.env.TWITCH_CLIENT_ID = process.env.TWITCH_CLIENT_ID || 'test_client_id';
    process.env.TWITCH_CALLBACK_URL = process.env.TWITCH_CALLBACK_URL || 'https://beta.example.com/auth/twitch/callback';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('guest can start OAuth on beta (not blocked by beta access gate)', async () => {
    const res = await request(makeApp()).get('/auth/twitch').set('Host', 'beta.example.com');
    // We expect a redirect (302) to Twitch authorize URL (or to frontend error page if env missing).
    // The invariant is: NOT 403 BETA_ACCESS_REQUIRED.
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
  });

  it('guest can access beta request/status endpoints on beta', async () => {
    let res = await request(makeApp()).get('/beta/status').set('Host', 'beta.example.com');
    // Status may be 200/400 depending on implementation, but must not be beta-gated.
    expect(res.status).not.toBe(403);

    res = await request(makeApp()).post('/beta/request').set('Host', 'beta.example.com').send({});
    // This endpoint may require auth or fields, but must not be blocked by beta gate itself.
    expect(res.status).not.toBe(403);
  });
});


