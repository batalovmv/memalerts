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

describe('creditsOverlay API', () => {
  it('loads credits token and rotates it', async () => {
    const rotateCalls = vi.fn();
    server.use(
      mockStreamerCreditsToken({ token: 'tok1', url: 'https://example.com/overlay/credits/t/tok1' }),
      mockStreamerCreditsTokenRotate({ token: 'tok2', url: 'https://example.com/overlay/credits/t/tok2' }, rotateCalls),
    );

    const token = await getCreditsToken();
    expect(token.token).toBe('tok1');

    const rotated = await rotateCreditsToken();
    expect(rotated.token).toBe('tok2');
    expect(rotateCalls).toHaveBeenCalled();
  });

  it('fetches and resets credits state', async () => {
    const resetCalls = vi.fn();
    server.use(
      mockStreamerCreditsState({ donors: [{ displayName: 'Donor' }], chatters: [] }),
      mockStreamerCreditsResetOk(resetCalls),
    );

    const state = await getCreditsState();
    expect(state.donors[0]?.displayName).toBe('Donor');

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
