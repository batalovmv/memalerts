import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate, type AuthRequest } from '../src/middleware/auth.js';
import { requireBetaAccess } from '../src/middleware/betaAccess.js';
import { createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/me', authenticate, requireBetaAccess, (req, res) => {
    const r = req as AuthRequest;
    res.json({ ok: true, userId: r.userId ?? null });
  });
  return app;
}

describe('beta: /me remains accessible for authenticated users (even without beta access)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('guest gets 401; authenticated without beta access gets 200; authenticated with beta access also gets 200', async () => {
    // Guest -> 401 (authenticate)
    let res = await request(makeApp()).get('/me').set('Host', 'beta.example.com');
    expect(res.status).toBe(401);

    const uNo = await createUser({ displayName: 'No', role: 'viewer', hasBetaAccess: false });
    const tNo = makeJwt({ userId: uNo.id, role: uNo.role });
    res = await request(makeApp())
      .get('/me')
      .set('Host', 'beta.example.com')
      .set('Cookie', [`token_beta=${encodeURIComponent(tNo)}`]);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(uNo.id);

    const uYes = await createUser({ displayName: 'Yes', role: 'viewer', hasBetaAccess: true });
    const tYes = makeJwt({ userId: uYes.id, role: uYes.role });
    res = await request(makeApp())
      .get('/me')
      .set('Host', 'beta.example.com')
      .set('Cookie', [`token_beta=${encodeURIComponent(tYes)}`]);
    expect(res.status).toBe(200);
    expect(res.body?.userId).toBe(uYes.id);
  });
});
