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

describe('GET /overlay/credits/t/:token', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('is accessible to guests on beta and returns no-cache HTML that loads socket.io and emits join:overlay', async () => {
    const token = 'dummy-token';
    const res = await request(makeApp()).get(`/overlay/credits/t/${token}`).set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(String(res.headers['content-type'] || '')).toContain('text/html');

    // Must not be cached (OBS should always get latest HTML).
    expect(String(res.headers['cache-control'] || '')).toContain('no-store');

    const html = String(res.text || '');
    expect(html).toContain('/socket.io/socket.io.js');
    expect(html).toContain('join:overlay');
    expect(html).toContain(token);
  });
});
