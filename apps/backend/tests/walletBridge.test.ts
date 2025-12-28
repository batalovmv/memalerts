import { emitWalletUpdated } from '../src/realtime/walletBridge.js';

describe('walletBridge', () => {
  it('emits wallet:updated only to user:{id} room (privacy invariant)', () => {
    const calls: Array<{ room: string; event: string; payload: any }> = [];
    const fakeIo = {
      to(room: string) {
        return {
          emit(event: string, payload: any) {
            calls.push({ room, event, payload });
          },
        };
      },
    } as any;

    emitWalletUpdated(fakeIo, { userId: 'u1', channelId: 'c1', balance: 123 });
    expect(calls).toHaveLength(1);
    expect(calls[0].room).toBe('user:u1');
    expect(calls[0].event).toBe('wallet:updated');
  });
});


