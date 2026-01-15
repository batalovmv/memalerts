import express from 'express';
import request from 'supertest';
import { setupRoutes } from '../src/routes/index.js';

describe('internal relay: /internal/submission-event', () => {
  it('requires internal header and validates body; emits to channel:{slugLower} and optional user rooms', async () => {
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

    // Missing internal header => 404
    let res = await request(app).post('/internal/submission-event').send({
      event: 'submission:created',
      submissionId: 's1',
      channelId: 'c1',
      channelSlug: 'MyChan',
    });
    expect(res.status).toBe(404);

    // With header but invalid payload => 400
    res = await request(app)
      .post('/internal/submission-event')
      .set('x-memalerts-internal', 'submission-event')
      .send({ event: 'submission:created', submissionId: 's1' });
    expect(res.status).toBe(400);

    // Valid request => ok + emits
    res = await request(app)
      .post('/internal/submission-event')
      .set('x-memalerts-internal', 'submission-event')
      .send({
        event: 'submission:created',
        submissionId: 's1',
        channelId: 'c1',
        channelSlug: 'MyChan',
        userIds: ['u1', 'u2'],
        submitterId: 'sub',
        moderatorId: 'mod',
      });
    expect(res.status).toBe(200);
    expect(res.body?.ok).toBe(true);

    // One emit to channel + one per user.
    expect(emitted).toHaveLength(3);
    expect(emitted[0]).toMatchObject({
      room: 'channel:mychan',
      event: 'submission:created',
      payload: { submissionId: 's1', channelId: 'c1', submitterId: 'sub', moderatorId: 'mod' },
    });
    expect(emitted[1].room).toBe('user:u1');
    expect(emitted[2].room).toBe('user:u2');
  });
});
