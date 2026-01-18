import { describe, expect, it, vi } from 'vitest';

import {
  getCreditsState,
  getCreditsToken,
  getIgnoredChatters,
  getReconnectWindow,
  resetCreditsSession,
  rotateCreditsToken,
  saveCreditsSettings,
  setIgnoredChatters,
  setReconnectWindow,
} from './creditsOverlay';
import { server } from '@/test/msw/server';
import {
  mockStreamerCreditsIgnoredChatters,
  mockStreamerCreditsIgnoredChattersSetOk,
  mockStreamerCreditsReconnectWindow,
  mockStreamerCreditsReconnectWindowSetOk,
  mockStreamerCreditsResetOk,
  mockStreamerCreditsSettingsSaveOk,
  mockStreamerCreditsState,
  mockStreamerCreditsToken,
  mockStreamerCreditsTokenRotate,
} from '@/test/msw/handlers';
import { makeCreditsState, makeCreditsToken } from '@/test/fixtures/credits';

describe('creditsOverlay API', () => {
  it('loads credits token and rotates it', async () => {
    const rotateCalls = vi.fn();
    const tokenPayload = makeCreditsToken();
    const nextTokenPayload = makeCreditsToken({ token: 'tok2', url: 'https://example.com/overlay/credits/t/tok2' });
    server.use(
      mockStreamerCreditsToken(tokenPayload),
      mockStreamerCreditsTokenRotate(nextTokenPayload, rotateCalls),
    );

    const token = await getCreditsToken();
    expect(token.token).toBe(tokenPayload.token);

    const rotated = await rotateCreditsToken();
    expect(rotated.token).toBe(nextTokenPayload.token);
    expect(rotateCalls).toHaveBeenCalled();
  });

  it('fetches and resets credits state', async () => {
    const resetCalls = vi.fn();
    const statePayload = makeCreditsState();
    server.use(
      mockStreamerCreditsState(statePayload),
      mockStreamerCreditsResetOk(resetCalls),
    );

    const state = await getCreditsState();
    expect(state.donors[0]?.displayName).toBe(statePayload.donors[0]?.displayName);

    await resetCreditsSession();
    expect(resetCalls).toHaveBeenCalled();
  });

  it('reads and updates reconnect window', async () => {
    const setCalls = vi.fn();
    server.use(
      mockStreamerCreditsReconnectWindow({ seconds: 90 }),
      mockStreamerCreditsReconnectWindowSetOk(setCalls),
    );

    const windowResp = await getReconnectWindow();
    expect(windowResp.seconds).toBe(90);

    await setReconnectWindow(120);
    expect(setCalls).toHaveBeenCalledWith({ seconds: 120 });
  });

  it('reads and updates ignored chatters', async () => {
    const setCalls = vi.fn();
    server.use(
      mockStreamerCreditsIgnoredChatters({ chatters: ['alice'] }),
      mockStreamerCreditsIgnoredChattersSetOk(setCalls),
    );

    const ignored = await getIgnoredChatters();
    expect(ignored.chatters).toEqual(['alice']);

    await setIgnoredChatters(['alice', 'bob']);
    expect(setCalls).toHaveBeenCalledWith({ chatters: ['alice', 'bob'] });
  });

  it('saves credits settings payload', async () => {
    const saveCalls = vi.fn();
    server.use(mockStreamerCreditsSettingsSaveOk(saveCalls));

    await saveCreditsSettings({
      styleJson: '{"fontSize":24}',
      reconnectWindowSeconds: 60,
      ignoredChatters: ['sam'],
    });

    expect(saveCalls).toHaveBeenCalledWith({
      styleJson: '{"fontSize":24}',
      reconnectWindowSeconds: 60,
      ignoredChatters: ['sam'],
    });
  });
});
