import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { csrfProtection } from '../src/middleware/csrf.js';

function makeJwt(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use(csrfProtection);
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('POST /auth/boosty/link', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('requires auth (CSRF allowlisted origin still passes)', async () => {
    const res = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Origin', 'https://example.com')
      .send({ accessToken: 'x' });
    expect(res.status).toBe(401);
  });

  it('400 if no credentials provided', async () => {
    const token = makeJwt({ userId: 'u1', role: 'viewer', channelId: 'c1' });
    const res = await request(makeApp())
      .post('/auth/boosty/link')
      .set('Origin', 'https://example.com')
      .set('Cookie', [`token=${encodeURIComponent(token)}`])
      .send({});

    expect(res.status).toBe(400);
    expect(res.body?.errorCode).toBe('BOOSTY_LINK_MISSING_CREDENTIALS');
  });
});


