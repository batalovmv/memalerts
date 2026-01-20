import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../src/routes/index.js';

describe('internal relay: /internal/credits/*', () => {
  it('requires internal header credits-event; validates payload', async () => {
    const app = express();
    app.use(express.json());
    // credits controller may emit to io if present; not required for this test.
    app.set('io', { to: () => ({ emit: () => {} }) });
    setupRoutes(app);

    // Missing header => 404
    let res = await request(app).post('/internal/credits/chatter').send({
      channelSlug: 'nope',
      userId: 'u1',
      displayName: 'User',
    });
    expect(res.status).toBe(404);

    // With header but missing required fields => 400
    res = await request(app)
      .post('/internal/credits/chatter')
      .set('x-memalerts-internal', 'credits-event')
      .send({ channelSlug: 'nope', userId: 'u1' });
    expect(res.status).toBe(400);

    // Valid chatter => ok
    res = await request(app)
      .post('/internal/credits/chatter')
      .set('x-memalerts-internal', 'credits-event')
      .send({ channelSlug: 'nope', userId: 'u1', displayName: 'User', avatarUrl: null });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    // Donor: missing header => 404
    res = await request(app).post('/internal/credits/donor').send({
      channelSlug: 'nope',
      name: 'Donor',
      amount: 10,
      currency: 'RUB',
    });
    expect(res.status).toBe(404);

    // Donor: valid => ok
    res = await request(app)
      .post('/internal/credits/donor')
      .set('x-memalerts-internal', 'credits-event')
      .send({ channelSlug: 'nope', name: 'Donor', amount: 10, currency: 'RUB', avatarUrl: null });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);
  });
});
