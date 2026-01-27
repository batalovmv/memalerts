import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { setupRoutes } from '../src/routes/index.js';
import { createChannel } from './factories/index.js';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('beta gating: public endpoints remain public; read-only endpoints stay public on beta', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DOMAIN = 'beta.example.com';
    process.env.PORT = '3002';
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('on beta, guest can access /public/channels/* endpoints', async () => {
    const slug = `pub_${Date.now()}`;
    await createChannel({ slug, name: 'Public Channel' });

    let res = await request(makeApp()).get(`/public/channels/${slug}`).set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(res.body?.slug).toBe(slug);

    res = await request(makeApp()).get(`/public/channels/${slug}/memes`).set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    res = await request(makeApp()).get(`/public/channels/${slug}/memes/search?q=`).set('Host', 'beta.example.com');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('on beta, guest can access read-only endpoints used by public pages', async () => {
    const host = 'beta.example.com';

    let res = await request(makeApp()).get('/memes/stats').set('Host', host);
    expect(res.status).toBe(200);

    res = await request(makeApp()).get('/memes/pool').set('Host', host);
    expect(res.status).toBe(200);

    res = await request(makeApp()).get('/channels/memes/search?q=x').set('Host', host);
    expect(res.status).toBe(200);
  });
});
