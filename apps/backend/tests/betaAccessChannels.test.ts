import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel, createUser } from './factories/index.js';

function makeJwt(payload: Record<string, unknown>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('beta/prod routing: GET /channels/:slug', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('production is public; beta allows public reads (guest + any user -> 200)', async () => {
    const slug = `chan_${Date.now()}`;
    await createChannel({ slug, name: 'Test Channel' });

    // Production: guest can read
    process.env.DOMAIN = 'example.com';
    let res = await request(makeApp()).get(`/channels/${slug}?includeMemes=false`).set('Host', 'example.com');
    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(slug);

    // Beta: guest can read (public channel page must work)
    process.env.DOMAIN = 'beta.example.com';
    res = await request(makeApp()).get(`/channels/${slug}?includeMemes=false`).set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(slug);

    // Beta: authenticated but no beta access -> still 200 for public reads
    const userNo = await createUser({ displayName: 'NoAccess', role: 'viewer', hasBetaAccess: false });
    const tokenNo = makeJwt({ userId: userNo.id, role: userNo.role });
    res = await request(makeApp())
      .get(`/channels/${slug}?includeMemes=false`)
      .set('Host', 'beta.example.com')
      .set('Cookie', [`token_beta=${encodeURIComponent(tokenNo)}`]);
    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(slug);

    // Beta: authenticated with beta access -> 200
    const userYes = await createUser({ displayName: 'HasAccess', role: 'viewer', hasBetaAccess: true });
    const tokenYes = makeJwt({ userId: userYes.id, role: userYes.role });
    res = await request(makeApp())
      .get(`/channels/${slug}?includeMemes=false`)
      .set('Host', 'beta.example.com')
      .set('Cookie', [`token_beta=${encodeURIComponent(tokenYes)}`]);
    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(slug);
  });
});
