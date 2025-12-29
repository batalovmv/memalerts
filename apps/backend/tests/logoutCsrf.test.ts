import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';
import { csrfProtection } from '../src/middleware/csrf.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('POST /auth/logout: CSRF + beta-gate invariants', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('production: blocks logout from disallowed Origin; allows from allowed Origin', async () => {
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';

    // Disallowed origin
    let res = await request(makeApp()).post('/auth/logout').set('Origin', 'https://evil.com').send({});
    expect(res.status).toBe(403);
    expect(res.body?.errorCode).toBe('CSRF_INVALID');

    // Allowed origin
    res = await request(makeApp()).post('/auth/logout').set('Origin', 'https://example.com').send({});
    expect(res.status).toBe(200);
    expect(res.body?.message).toBeTruthy();

    // Should attempt to clear both cookies (token + token_beta).
    const setCookie = res.headers['set-cookie'];
    expect(Array.isArray(setCookie)).toBe(true);
    const joined = Array.isArray(setCookie) ? setCookie.join('\n') : String(setCookie || '');
    expect(joined).toContain('token=');
    expect(joined).toContain('token_beta=');
  });

  it('production: allows logout without Origin when Sec-Fetch-Site indicates same-origin/same-site', async () => {
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';

    const res = await request(makeApp())
      .post('/auth/logout')
      .set('Sec-Fetch-Site', 'same-origin')
      .send({});

    expect(res.status).toBe(200);
  });

  it('beta: logout is not blocked by beta-gate itself (still CSRF-protected)', async () => {
    process.env.PORT = '3002';
    process.env.DOMAIN = 'beta.example.com';
    process.env.WEB_URL = 'https://beta.example.com';

    const res = await request(makeApp()).post('/auth/logout').set('Origin', 'https://beta.example.com').send({});
    expect(res.status).toBe(200);
  });
});


