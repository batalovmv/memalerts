import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate, type AuthRequest } from '../src/middleware/auth.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/whoami', authenticate, (req, res) => {
    const r = req as AuthRequest;
    res.json({ userId: r.userId ?? null, role: r.userRole ?? null, channelId: r.channelId ?? null });
  });
  return app;
}

describe('authenticate: cookie selection + beta detection', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('on beta instance selects token_beta (fallback to token), on production selects token', async () => {
    const tokenUser = makeJwt({ userId: 'u_prod', role: 'viewer', channelId: 'c1' });
    const tokenBetaUser = makeJwt({ userId: 'u_beta', role: 'viewer', channelId: 'c1' });

    // Beta instance (PORT=3002 is treated as beta).
    process.env.PORT = '3002';
    process.env.DOMAIN = 'beta.example.com';
    let res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', [`token=${encodeURIComponent(tokenUser)}; token_beta=${encodeURIComponent(tokenBetaUser)}`]);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_beta');

    // Beta instance fallback: if token_beta missing, use token.
    res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', [`token=${encodeURIComponent(tokenUser)}`]);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_prod');

    // Production instance (PORT=3001).
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', [`token=${encodeURIComponent(tokenUser)}; token_beta=${encodeURIComponent(tokenBetaUser)}`]);
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_prod');
  });

  it('beta can be detected via proxy/origin hints (x-forwarded-host / origin / x-forwarded-port)', async () => {
    const tokenUser = makeJwt({ userId: 'u_prod', role: 'viewer', channelId: 'c1' });
    const tokenBetaUser = makeJwt({ userId: 'u_beta', role: 'viewer', channelId: 'c1' });
    const cookie = `token=${encodeURIComponent(tokenUser)}; token_beta=${encodeURIComponent(tokenBetaUser)}`;

    // Instance itself looks production-like...
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';

    // ...but request hints indicate beta => token_beta must be used.
    let res = await request(makeApp())
      .get('/whoami')
      .set('Cookie', [cookie])
      .set('x-forwarded-host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_beta');

    res = await request(makeApp()).get('/whoami').set('Cookie', [cookie]).set('Origin', 'https://beta.example.com');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_beta');

    res = await request(makeApp()).get('/whoami').set('Cookie', [cookie]).set('x-forwarded-port', '3002');
    expect(res.status).toBe(200);
    expect(res.body.userId).toBe('u_beta');
  });
});
