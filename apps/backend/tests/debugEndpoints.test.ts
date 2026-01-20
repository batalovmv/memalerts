import express from 'express';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('debug endpoints are opt-in via env', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('/debug-ip is 404 by default, 200 when DEBUG_LOGS=1', async () => {
    let res = await request(makeApp()).get('/debug-ip').set('Host', 'beta.example.com');
    // On beta, unknown routes may be intercepted by beta-gate middleware and return 401 for guests.
    // The invariant is: debug endpoint must NOT be accessible unless DEBUG_LOGS=1.
    expect([401, 404]).toContain(res.status);

    process.env.DEBUG_LOGS = '1';
    res = await request(makeApp()).get('/debug-ip').set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(res.body).toBeTruthy();
    expect(res.body).toHaveProperty('socket.remoteAddress');
  });
});
