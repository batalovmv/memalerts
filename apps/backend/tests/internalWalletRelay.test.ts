import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../src/routes/index.js';

describe('internal relay: /internal/wallet-updated', () => {
  it('requires localhost + internal header and emits only to user room', async () => {
    const emitted: Array<{ room: string; event: string; payload: unknown }> = [];
    const fakeIo = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            emitted.push({ room, event, payload });
          },
        };
      },
    };

    const app = express();
    app.use(express.json());
    app.set('io', fakeIo);
    setupRoutes(app);

    // Missing internal header => 404 (must not expose internal endpoints)
    let res = await request(app).post('/internal/wallet-updated').send({ userId: 'u1', channelId: 'c1', balance: 10 });
    expect(res.status).toBe(404);

    // With header but invalid payload => 400
    res = await request(app)
      .post('/internal/wallet-updated')
      .set('x-memalerts-internal', 'wallet-updated')
      .send({ userId: 'u1', channelId: 'c1' });
    expect(res.status).toBe(400);

    // Valid request => ok + wallet event emitted
    res = await request(app)
      .post('/internal/wallet-updated')
      .set('x-memalerts-internal', 'wallet-updated')
      .send({ userId: 'u1', channelId: 'c1', balance: 10 });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    expect(emitted).toHaveLength(1);
    expect(emitted[0].room).toBe('user:u1');
    expect(emitted[0].event).toBe('wallet:updated');
    expect(emitted[0].payload?.balance).toBe(10);
  });
});
