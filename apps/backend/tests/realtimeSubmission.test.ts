import { emitSubmissionEvent } from '../src/realtime/submissionBridge.js';

type EmitFn = (event: string, payload: unknown) => void;
type IoLike = { to: (room: string) => { emit: EmitFn } };

describe('realtime submission events', () => {
  it('emits submission:created to a lowercased channel room', () => {
    const calls: Array<{ room: string; event: string; payload: unknown }> = [];
    const fakeIo: IoLike = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            calls.push({ room, event, payload });
          },
        };
      },
    };

    emitSubmissionEvent(fakeIo, {
      event: 'submission:created',
      submissionId: 's1',
      channelId: 'c1',
      channelSlug: 'MiXeD-Channel',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].room).toBe('channel:mixed-channel');
    expect(calls[0].event).toBe('submission:created');
    expect(calls[0].payload).toEqual({ submissionId: 's1', channelId: 'c1' });
  });

  it('emits status events to channel and user rooms', () => {
    const calls: Array<{ room: string; event: string; payload: unknown }> = [];
    const fakeIo: IoLike = {
      to(room: string) {
        return {
          emit(event: string, payload: unknown) {
            calls.push({ room, event, payload });
          },
        };
      },
    };

    emitSubmissionEvent(fakeIo, {
      event: 'submission:approved',
      submissionId: 's2',
      channelId: 'c2',
      channelSlug: 'Status-Channel',
      submitterId: 'u1',
      moderatorId: 'u2',
      userIds: ['u1', 'u2'],
    });

    expect(calls).toHaveLength(3);

    const expectedPayload = { submissionId: 's2', channelId: 'c2', submitterId: 'u1', moderatorId: 'u2' };

    const channelCall = calls.find((c) => c.room === 'channel:status-channel');
    expect(channelCall?.event).toBe('submission:approved');
    expect(channelCall?.payload).toEqual(expectedPayload);

    const userRooms = calls.filter((c) => c.room.startsWith('user:'));
    expect(userRooms).toHaveLength(2);
    for (const call of userRooms) {
      expect(call.event).toBe('submission:approved');
      expect(call.payload).toEqual(expectedPayload);
    }
  });
});
