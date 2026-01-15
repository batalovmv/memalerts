import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../src/routes/index.js';

function makeAppWithRemote(remoteAddress: string) {
  const app = express();
  app.use(express.json());
  // Override remoteAddress for deterministic localhost-only tests.
  app.use((req, _res, next) => {
    try {
      Object.defineProperty(req.socket, 'remoteAddress', { value: remoteAddress, configurable: true });
    } catch {
      // ignore
    }
    next();
  });
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

describe('internal endpoints are localhost-only (remoteAddress gating)', () => {
  it('blocks /internal/wallet-updated from non-local addresses even with correct header', async () => {
    const app = makeAppWithRemote('8.8.8.8');
    const res = await request(app)
      .post('/internal/wallet-updated')
      .set('x-memalerts-internal', 'wallet-updated')
      .send({ userId: 'u1', channelId: 'c1', balance: 10 });
    expect(res.status).toBe(404);
  });

  it('blocks /internal/submission-event from non-local addresses even with correct header', async () => {
    const app = makeAppWithRemote('8.8.8.8');
    const res = await request(app)
      .post('/internal/submission-event')
      .set('x-memalerts-internal', 'submission-event')
      .send({ event: 'submission:created', submissionId: 's1', channelId: 'c1', channelSlug: 'chan' });
    expect(res.status).toBe(404);
  });

  it('blocks /internal/credits/* from non-local addresses even with correct header', async () => {
    const app = makeAppWithRemote('8.8.8.8');

    let res = await request(app)
      .post('/internal/credits/chatter')
      .set('x-memalerts-internal', 'credits-event')
      .send({ channelSlug: 'chan', userId: 'u1', displayName: 'User' });
    expect(res.status).toBe(404);

    res = await request(app)
      .post('/internal/credits/donor')
      .set('x-memalerts-internal', 'credits-event')
      .send({ channelSlug: 'chan', name: 'Donor', amount: 10, currency: 'RUB' });
    expect(res.status).toBe(404);
  });
});
