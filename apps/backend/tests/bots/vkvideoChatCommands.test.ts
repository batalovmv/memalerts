import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  vkVideoBotIntegration: { findUnique: vi.fn() },
  globalVkVideoBotCredential: { findFirst: vi.fn() },
}));

const hasChannelEntitlement = vi.hoisted(() => vi.fn());
const resolveMemalertsUserIdFromChatIdentity = vi.hoisted(() => vi.fn());
const getStreamDurationSnapshot = vi.hoisted(() => vi.fn());
const fetchVkVideoChannel = vi.hoisted(() => vi.fn());
const sendVkVideoChatMessage = vi.hoisted(() => vi.fn());
const getVkVideoExternalAccount = vi.hoisted(() => vi.fn());
const getValidVkVideoAccessTokenByExternalAccountId = vi.hoisted(() => vi.fn());
const postInternalCreditsChatter = vi.hoisted(() => vi.fn());
const handleVkvideoChatAutoRewards = vi.hoisted(() => vi.fn());

vi.mock('../../src/lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../../src/utils/entitlements.js', () => ({ hasChannelEntitlement }));
vi.mock('../../src/utils/chatIdentity.js', () => ({ resolveMemalertsUserIdFromChatIdentity }));
vi.mock('../../src/realtime/streamDurationStore.js', () => ({ getStreamDurationSnapshot }));
vi.mock('../../src/utils/vkvideoApi.js', () => ({
  fetchVkVideoChannel,
  fetchVkVideoUserRolesOnChannel: vi.fn(),
  getVkVideoExternalAccount,
  getValidVkVideoAccessTokenByExternalAccountId,
  sendVkVideoChatMessage,
}));
vi.mock('../../src/bots/vkvideoRewardProcessor.js', () => ({ handleVkvideoChatAutoRewards }));
vi.mock('../../src/bots/vkvideoChatCommandUtils.js', async () => {
  const actual = await vi.importActual('../../src/bots/vkvideoChatCommandUtils.js');
  return { ...(actual as object), postInternalCreditsChatter };
});

import { createVkvideoChatCommands, type VkvideoChatCommandState } from '../../src/bots/vkvideoChatCommands.js';

describe('vkvideo chat commands', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    vi.clearAllMocks();
    hasChannelEntitlement.mockResolvedValue(false);
    resolveMemalertsUserIdFromChatIdentity.mockResolvedValue(null);
    getStreamDurationSnapshot.mockResolvedValue({ status: 'online', totalMinutes: 125 });
    fetchVkVideoChannel.mockResolvedValue({ ok: true, streamId: 'stream-1' });
    sendVkVideoChatMessage.mockResolvedValue({ ok: true });
    getVkVideoExternalAccount.mockResolvedValue({ accessToken: 'vk-access' });
    getValidVkVideoAccessTokenByExternalAccountId.mockResolvedValue(null);
    prismaMock.vkVideoBotIntegration.findUnique.mockResolvedValue(null);
    prismaMock.globalVkVideoBotCredential.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('replies to stream duration smart command', async () => {
    const vkvideoIdToSlug = new Map<string, string>([['vk1', 'slug-one']]);
    const vkvideoIdToChannelId = new Map<string, string>([['vk1', 'channel-1']]);
    const vkvideoIdToOwnerUserId = new Map<string, string>([['vk1', 'owner-1']]);
    const vkvideoIdToChannelUrl = new Map<string, string>([['vk1', 'https://vkvideo.example/channel/1']]);
    const vkvideoIdToLastLiveStreamId = new Map<string, string | null>();
    const streamDurationCfgByChannelId = new Map<
      string,
      { ts: number; cfg: { enabled: boolean; triggerNormalized: string; responseTemplate: string | null; onlyWhenLive: boolean } }
    >([
      [
        'channel-1',
        {
          ts: Date.now(),
          cfg: {
            enabled: true,
            triggerNormalized: '!time',
            responseTemplate: 'Stream {hours}h {minutes}m ({totalMinutes}m)',
            onlyWhenLive: false,
          },
        },
      ],
    ]);
    const commandsByChannelId = new Map<string, { ts: number; items: [] }>([['channel-1', { ts: Date.now(), items: [] }]]);
    const autoRewardsByChannelId = new Map<string, { ts: number; cfg: unknown | null }>([
      ['channel-1', { ts: Date.now(), cfg: null }],
    ]);
    const userRolesCache = new Map<string, { ts: number; roleIds: string[] }>();

    const state: VkvideoChatCommandState = {
      vkvideoIdToSlug,
      vkvideoIdToChannelId,
      vkvideoIdToOwnerUserId,
      vkvideoIdToChannelUrl,
      vkvideoIdToLastLiveStreamId,
      streamDurationCfgByChannelId,
      commandsByChannelId,
      autoRewardsByChannelId,
      userRolesCache,
    };

    const bot = createVkvideoChatCommands(state, {
      backendBaseUrls: ['https://backend.example'],
      commandsRefreshSeconds: 30,
      userRolesCacheTtlMs: 10_000,
      stoppedRef: { value: false },
    });

    await bot.handleIncoming('vk1', {
      text: '!time',
      userId: 'user-1',
      displayName: 'Viewer',
      senderLogin: 'viewer',
    });

    expect(sendVkVideoChatMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Stream 2h 5m (125m)' })
    );
  });

  it('replies to configured static commands', async () => {
    const vkvideoIdToSlug = new Map<string, string>([['vk2', 'slug-two']]);
    const vkvideoIdToChannelId = new Map<string, string>([['vk2', 'channel-2']]);
    const vkvideoIdToOwnerUserId = new Map<string, string>([['vk2', 'owner-2']]);
    const vkvideoIdToChannelUrl = new Map<string, string>([['vk2', 'https://vkvideo.example/channel/2']]);
    const vkvideoIdToLastLiveStreamId = new Map<string, string | null>();
    const streamDurationCfgByChannelId = new Map<string, { ts: number; cfg: null }>([['channel-2', { ts: Date.now(), cfg: null }]]);
    const commandsByChannelId = new Map<string, { ts: number; items: Array<{ triggerNormalized: string; response: string; onlyWhenLive: boolean; allowedRoles: string[]; allowedUsers: string[]; vkvideoAllowedRoleIds: string[] }> }>([
      [
        'channel-2',
        {
          ts: Date.now(),
          items: [
            {
              triggerNormalized: 'hello',
              response: 'hi there',
              onlyWhenLive: false,
              allowedRoles: [],
              allowedUsers: [],
              vkvideoAllowedRoleIds: [],
            },
          ],
        },
      ],
    ]);
    const autoRewardsByChannelId = new Map<string, { ts: number; cfg: unknown | null }>([
      ['channel-2', { ts: Date.now(), cfg: null }],
    ]);
    const userRolesCache = new Map<string, { ts: number; roleIds: string[] }>();

    const state: VkvideoChatCommandState = {
      vkvideoIdToSlug,
      vkvideoIdToChannelId,
      vkvideoIdToOwnerUserId,
      vkvideoIdToChannelUrl,
      vkvideoIdToLastLiveStreamId,
      streamDurationCfgByChannelId,
      commandsByChannelId,
      autoRewardsByChannelId,
      userRolesCache,
    };

    const bot = createVkvideoChatCommands(state, {
      backendBaseUrls: ['https://backend.example'],
      commandsRefreshSeconds: 30,
      userRolesCacheTtlMs: 10_000,
      stoppedRef: { value: false },
    });

    await bot.handleIncoming('vk2', {
      text: 'HELLO',
      userId: 'user-2',
      displayName: 'Viewer',
      senderLogin: 'viewer',
    });

    expect(sendVkVideoChatMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'hi there' }));
    expect(postInternalCreditsChatter).toHaveBeenCalledWith('https://backend.example', {
      channelSlug: 'slug-two',
      userId: 'vkvideo:user-2',
      displayName: 'Viewer',
    });
  });
});
