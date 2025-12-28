import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { authenticate, requireRole } from '../src/middleware/auth.js';

function makeJwt(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.get('/admin-only', authenticate, requireRole('admin'), (_req, res) => res.json({ ok: true }));
  return app;
}

describe('requireRole (with authenticate)', () => {
  it('401 without token; 403 with wrong role; 200 with admin role', async () => {
    // No cookie => authenticate must block.
    let res = await request(makeApp()).get('/admin-only');
    expect(res.status).toBe(401);

    const viewerToken = makeJwt({ userId: 'u1', role: 'viewer', channelId: 'c1' });
    res = await request(makeApp()).get('/admin-only').set('Cookie', [`token=${encodeURIComponent(viewerToken)}`]);
    expect(res.status).toBe(403);

    const adminToken = makeJwt({ userId: 'u2', role: 'admin', channelId: 'c1' });
    res = await request(makeApp()).get('/admin-only').set('Cookie', [`token=${encodeURIComponent(adminToken)}`]);
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});


