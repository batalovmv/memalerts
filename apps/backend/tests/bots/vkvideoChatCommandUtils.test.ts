import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMock = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/utils/logger.js', () => ({ logger: loggerMock }));

import {
  canTriggerCommand,
  normalizeAllowedRolesList,
  normalizeAllowedUsersList,
  normalizeVkVideoAllowedRoleIdsList,
  parseStreamDurationCfg,
  postInternalCreditsChatter,
} from '../../src/bots/vkvideoChatCommandUtils.js';

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('vkvideo chat command utils', () => {
  it('normalizes allowed user logins and roles', () => {
    expect(normalizeAllowedUsersList([' @Foo ', 'foo', '', null])).toEqual(['foo']);
    expect(normalizeAllowedRolesList(['VIP', 'moderator', 'invalid', 'vip'])).toEqual(['vip', 'moderator']);
  });

  it('normalizes allowed role ids', () => {
    expect(normalizeVkVideoAllowedRoleIdsList([' r1 ', '', 'r1', 'r2'])).toEqual(['r1', 'r2']);
  });

  it('checks command permissions', () => {
    expect(
      canTriggerCommand({
        senderLogin: 'viewer',
        allowedUsers: [],
        allowedRoles: [],
        vkvideoAllowedRoleIds: [],
        senderVkVideoRoleIds: null,
      })
    ).toBe(true);

    expect(
      canTriggerCommand({
        senderLogin: 'viewer',
        allowedUsers: ['viewer'],
        allowedRoles: [],
        vkvideoAllowedRoleIds: [],
        senderVkVideoRoleIds: null,
      })
    ).toBe(true);

    expect(
      canTriggerCommand({
        senderLogin: 'viewer',
        allowedUsers: [],
        allowedRoles: [],
        vkvideoAllowedRoleIds: ['role-1'],
        senderVkVideoRoleIds: ['role-2', 'role-1'],
      })
    ).toBe(true);

    expect(
      canTriggerCommand({
        senderLogin: 'viewer',
        allowedUsers: ['other'],
        allowedRoles: ['vip'],
        vkvideoAllowedRoleIds: ['role-1'],
        senderVkVideoRoleIds: ['role-2'],
      })
    ).toBe(false);
  });

  it('parses stream duration config', () => {
    const parsed = parseStreamDurationCfg(
      JSON.stringify({
        trigger: '!uptime',
        enabled: true,
        onlyWhenLive: false,
        breakCreditMinutes: 90,
        responseTemplate: 'hi',
      })
    );

    expect(parsed).toEqual({
      enabled: true,
      triggerNormalized: '!uptime',
      responseTemplate: 'hi',
      breakCreditMinutes: 90,
      onlyWhenLive: false,
    });
    expect(parseStreamDurationCfg('{bad json')).toBeNull();
    expect(parseStreamDurationCfg(JSON.stringify({ enabled: true }))).toBeNull();
  });

  it('logs when chatter post fails', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('boom'));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await postInternalCreditsChatter('https://api.example.com', {
      channelSlug: 'slug',
      userId: 'user-1',
      displayName: 'Viewer',
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      'vkvideo_chatbot.internal_post_failed',
      expect.objectContaining({ errorMessage: 'boom' })
    );
  });
});
