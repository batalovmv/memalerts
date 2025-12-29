import express from 'express';
import request from 'supertest';
import { csrfProtection } from '../src/middleware/csrf.js';

function makeApp() {
  const app = express();
  // No body parsing needed for CSRF checks; but include json to mimic real app shape.
  app.use(express.json());
  app.use(csrfProtection);
  app.post('/protected', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/internal/test', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/webhooks/test', (_req, res) => res.status(200).json({ ok: true }));
  app.post('/public/test', (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe('csrfProtection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('blocks state-changing requests without Origin in production', async () => {
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';

    const res = await request(makeApp()).post('/protected').send({ a: 1 });
    expect(res.status).toBe(403);
    expect(res.body?.errorCode).toBe('CSRF_INVALID');
  });

  it('skips CSRF for /internal/* even in production (CSRF handled by localhost+header in routes)', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(makeApp()).post('/internal/test').send({ a: 1 });
    expect(res.status).toBe(200);
  });

  it('skips CSRF for /webhooks/* even in production (webhooks use HMAC)', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(makeApp()).post('/webhooks/test').send({ a: 1 });
    expect(res.status).toBe(200);
  });

  it('skips CSRF for /public/* even in production (public control endpoints)', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(makeApp()).post('/public/test').send({ a: 1 });
    expect(res.status).toBe(200);
  });

  it('enforces beta/prod origin isolation based on PORT/DOMAIN', async () => {
    process.env.NODE_ENV = 'production';

    // Beta instance: allow beta WEB_URL, block prod WEB_URL.
    process.env.PORT = '3002';
    process.env.DOMAIN = 'beta.example.com';
    process.env.WEB_URL = 'https://beta.example.com';
    let res = await request(makeApp())
      .post('/protected')
      .set('Origin', 'https://beta.example.com')
      .send({ a: 1 });
    expect(res.status).toBe(200);

    res = await request(makeApp())
      .post('/protected')
      .set('Origin', 'https://example.com')
      .send({ a: 1 });
    expect(res.status).toBe(403);

    // Production instance: allow prod WEB_URL, block beta WEB_URL.
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';

    res = await request(makeApp())
      .post('/protected')
      .set('Origin', 'https://example.com')
      .send({ a: 1 });
    expect(res.status).toBe(200);

    res = await request(makeApp())
      .post('/protected')
      .set('Origin', 'https://beta.example.com')
      .send({ a: 1 });
    expect(res.status).toBe(403);
  });

  it('normalizes WEB_URL (trailing slash / path) to origin for allowlist matching', async () => {
    process.env.NODE_ENV = 'production';

    // Beta instance: WEB_URL may accidentally include trailing slash or path.
    process.env.PORT = '3002';
    process.env.DOMAIN = 'beta.example.com';
    process.env.WEB_URL = 'https://beta.example.com/app/';

    const res = await request(makeApp())
      .post('/protected')
      .set('Origin', 'https://beta.example.com')
      .send({ a: 1 });

    expect(res.status).toBe(200);
  });
});


