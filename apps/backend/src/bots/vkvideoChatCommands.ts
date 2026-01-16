import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { hasChannelEntitlement } from '../utils/entitlements.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import {
  fetchVkVideoChannel,
  fetchVkVideoUserRolesOnChannel,
  getVkVideoExternalAccount,
  getValidVkVideoAccessTokenByExternalAccountId,
  sendVkVideoChatMessage,
} from '../utils/vkvideoApi.js';
import { logger } from '../utils/logger.js';
import { handleVkvideoChatAutoRewards } from './vkvideoRewardProcessor.js';
import {
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  parseVkVideoRoleStubs,
  prismaAny,
} from './vkvideoChatbotShared.js';
import {
  canTriggerCommand,
  normalizeAllowedRolesList,
  normalizeAllowedUsersList,
  normalizeVkVideoAllowedRoleIdsList,
  parseStreamDurationCfg,
  postInternalCreditsChatter,
  type ChatCommandRole,
  type StreamDurationCfg,
} from './vkvideoChatCommandUtils.js';

export type { ChatCommandRole, StreamDurationCfg };

export type VkvideoCommandItem = {
  triggerNormalized: string;
  response: string;
  onlyWhenLive: boolean;
  allowedRoles: ChatCommandRole[];
  allowedUsers: string[];
  vkvideoAllowedRoleIds: string[];
};

export type VkvideoChatCommandState = {
  vkvideoIdToSlug: Map<string, string>;
  vkvideoIdToChannelId: Map<string, string>;
  vkvideoIdToOwnerUserId: Map<string, string>;
  vkvideoIdToChannelUrl: Map<string, string>;
  vkvideoIdToLastLiveStreamId: Map<string, string | null>;
  streamDurationCfgByChannelId: Map<string, { ts: number; cfg: StreamDurationCfg | null }>;
  commandsByChannelId: Map<string, { ts: number; items: VkvideoCommandItem[] }>;
  autoRewardsByChannelId: Map<string, { ts: number; cfg: unknown | null }>;
  userRolesCache: Map<string, { ts: number; roleIds: string[] }>;
};

type VkvideoChatCommandsConfig = {
  backendBaseUrls: string[];
  commandsRefreshSeconds: number;
  userRolesCacheTtlMs: number;
  stoppedRef: { value: boolean };
};

type IncomingChat = {
  text: string;
  userId: string;
  displayName: string;
  senderLogin: string | null;
};

export function createVkvideoChatCommands(state: VkvideoChatCommandState, config: VkvideoChatCommandsConfig) {
  const {
    vkvideoIdToSlug,
    vkvideoIdToChannelId,
    vkvideoIdToOwnerUserId,
    vkvideoIdToChannelUrl,
    vkvideoIdToLastLiveStreamId,
    streamDurationCfgByChannelId,
    commandsByChannelId,
    autoRewardsByChannelId,
    userRolesCache,
  } = state;
  const { backendBaseUrls, commandsRefreshSeconds, userRolesCacheTtlMs, stoppedRef } = config;
  const roleStubs = parseVkVideoRoleStubs();
  let commandsRefreshing = false;

  const sendToVkVideoChat = async (params: { vkvideoChannelId: string; text: string }): Promise<void> => {
    const vkvideoChannelId = params.vkvideoChannelId;
    const channelUrl = vkvideoIdToChannelUrl.get(vkvideoChannelId) || null;
    const ownerUserId = vkvideoIdToOwnerUserId.get(vkvideoChannelId) || null;
    const channelId = vkvideoIdToChannelId.get(vkvideoChannelId) || null;
    if (!channelUrl || !ownerUserId) throw new Error('missing_channel_context');

    // Prefer sender identity:
    // 1) per-channel override bot (VkVideoBotIntegration)
    // 2) global default bot (GlobalVkVideoBotCredential)
    // 3) fallback to owner's linked VKVideo token (back-compat; will be removed later)
    let accessToken: string | null = null;

    if (channelId) {
      const canUseOverride = await hasChannelEntitlement(channelId, 'custom_bot');
      if (canUseOverride) {
        try {
          const override = await prismaAny.vkVideoBotIntegration.findUnique({
            where: { channelId },
            select: { enabled: true, externalAccountId: true },
          });
          const overrideRec = asRecord(override);
          const extId = overrideRec.enabled ? String(overrideRec.externalAccountId ?? '').trim() : '';
          if (extId) accessToken = await getValidVkVideoAccessTokenByExternalAccountId(extId);
        } catch (e: unknown) {
          if (getErrorCode(e) !== 'P2021') throw e;
        }
      }

      if (!accessToken) {
        try {
          const global = await prismaAny.globalVkVideoBotCredential.findFirst({
            where: { enabled: true },
            orderBy: { updatedAt: 'desc' },
            select: { externalAccountId: true },
          });
          const globalRec = asRecord(global);
          const extId = String(globalRec.externalAccountId ?? '').trim();
          if (extId) accessToken = await getValidVkVideoAccessTokenByExternalAccountId(extId);
        } catch (e: unknown) {
          if (getErrorCode(e) !== 'P2021') throw e;
        }
      }
    }

    if (!accessToken) {
      const account = await getVkVideoExternalAccount(ownerUserId);
      accessToken = account?.accessToken || null;
    }

    if (!accessToken) throw new Error('missing_sender_access_token');

    const ch = await fetchVkVideoChannel({ accessToken, channelUrl });
    if (!ch.ok) throw new Error(ch.error || 'channel_fetch_failed');
    if (!ch.streamId) throw new Error('no_active_stream');

    const resp = await sendVkVideoChatMessage({ accessToken, channelUrl, streamId: ch.streamId, text: params.text });
    if (!resp.ok) throw new Error(resp.error || 'send_failed');
  };

  const handleIncoming = async (vkvideoChannelId: string, incoming: IncomingChat) => {
    if (stoppedRef.value) return;
    const slug = vkvideoIdToSlug.get(vkvideoChannelId);
    const channelId = vkvideoIdToChannelId.get(vkvideoChannelId);
    const ownerUserId = vkvideoIdToOwnerUserId.get(vkvideoChannelId) || null;
    if (!slug || !channelId) return;

    const msgNorm = normalizeMessage(incoming.text).toLowerCase();
    const senderLogin = normalizeLogin(incoming.senderLogin || incoming.displayName);

    // Refresh commands if cache is stale
    const now = Date.now();
    const cached = commandsByChannelId.get(channelId);
    if (!cached || now - cached.ts > commandsRefreshSeconds * 1000) {
      void refreshCommands();
    }

    // Smart command: stream duration
    const smart = streamDurationCfgByChannelId.get(channelId);
    if (msgNorm && smart) {
      if (now - smart.ts > commandsRefreshSeconds * 1000) {
        void refreshCommands();
      } else if (smart.cfg?.enabled && smart.cfg.triggerNormalized === msgNorm) {
        try {
          const snap = await getStreamDurationSnapshot(slug);
          if (!(smart.cfg.onlyWhenLive && snap.status !== 'online')) {
            const totalMinutes = snap.totalMinutes;
            const hours = Math.floor(totalMinutes / 60);
            const minutes = totalMinutes % 60;
            const template = smart.cfg.responseTemplate ?? 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
            const reply = template
              .replace(/\{hours\}/g, String(hours))
              .replace(/\{minutes\}/g, String(minutes))
              .replace(/\{totalMinutes\}/g, String(totalMinutes))
              .trim();
            if (reply) {
              await sendToVkVideoChat({ vkvideoChannelId, text: reply });
              return;
            }
          }
        } catch (e: unknown) {
          logger.warn('vkvideo_chatbot.stream_duration_reply_failed', {
            vkvideoChannelId,
            errorMessage: getErrorMessage(e),
          });
        }
      }
    }

    // Static commands
    if (msgNorm) {
      const items = commandsByChannelId.get(channelId)?.items || [];
      const match = items.find((c) => c.triggerNormalized === msgNorm);
      if (match?.response) {
        try {
          let senderRoleIds: string[] = [];
          if (match.vkvideoAllowedRoleIds?.length) {
            // Try role stubs first (dev/beta), then fallback to API role lookup (if configured).
            const stubKeyByUser = `user:${String(incoming.userId || '').trim()}`.toLowerCase();
            const stubKeyByLogin = `login:${String(senderLogin || '')
              .trim()
              .toLowerCase()}`.toLowerCase();
            const stubUser = roleStubs.get(`${vkvideoChannelId}:${stubKeyByUser}`);
            const stubLogin = senderLogin ? roleStubs.get(`${vkvideoChannelId}:${stubKeyByLogin}`) : undefined;
            if (stubUser?.length) {
              senderRoleIds = stubUser;
            } else if (stubLogin?.length) {
              senderRoleIds = stubLogin;
            } else if (ownerUserId) {
              const cacheKey = `${vkvideoChannelId}:${incoming.userId}`;
              const cachedRoles = userRolesCache.get(cacheKey);
              const now = Date.now();
              if (cachedRoles && now - cachedRoles.ts <= userRolesCacheTtlMs) {
                senderRoleIds = cachedRoles.roleIds;
              } else {
                // Prefer querying roles with the same sender token used for writes; fallback to owner's token.
                let tokenForRoles: string | null = null;
                const channelId = vkvideoIdToChannelId.get(vkvideoChannelId) || null;

                if (channelId) {
                  const canUseOverride = await hasChannelEntitlement(channelId, 'custom_bot');
                  if (canUseOverride) {
                    try {
                      const override = await prismaAny.vkVideoBotIntegration.findUnique({
                        where: { channelId },
                        select: { enabled: true, externalAccountId: true },
                      });
                      const overrideRec = asRecord(override);
                      const extId = overrideRec.enabled ? String(overrideRec.externalAccountId ?? '').trim() : '';
                      if (extId) tokenForRoles = await getValidVkVideoAccessTokenByExternalAccountId(extId);
                    } catch (e: unknown) {
                      if (getErrorCode(e) !== 'P2021') throw e;
                    }
                  }

                  if (!tokenForRoles) {
                    try {
                      const global = await prismaAny.globalVkVideoBotCredential.findFirst({
                        where: { enabled: true },
                        orderBy: { updatedAt: 'desc' },
                        select: { externalAccountId: true },
                      });
                      const globalRec = asRecord(global);
                      const extId = String(globalRec.externalAccountId ?? '').trim();
                      if (extId) tokenForRoles = await getValidVkVideoAccessTokenByExternalAccountId(extId);
                    } catch (e: unknown) {
                      if (getErrorCode(e) !== 'P2021') throw e;
                    }
                  }
                }

                if (!tokenForRoles) {
                  const account = await getVkVideoExternalAccount(ownerUserId);
                  tokenForRoles = account?.accessToken || null;
                }

                if (tokenForRoles) {
                  const rolesResp = await fetchVkVideoUserRolesOnChannel({
                    accessToken: tokenForRoles,
                    vkvideoChannelId,
                    vkvideoUserId: incoming.userId,
                  });
                  if (rolesResp.ok) {
                    senderRoleIds = rolesResp.roleIds;
                    userRolesCache.set(cacheKey, { ts: now, roleIds: senderRoleIds });
                  } else {
                    // If we can't resolve roles, be conservative: do not allow role-gated commands.
                    senderRoleIds = [];
                  }
                }
              }
            }
          }

          if (
            !canTriggerCommand({
              senderLogin,
              allowedUsers: match.allowedUsers || [],
              allowedRoles: match.allowedRoles || [],
              vkvideoAllowedRoleIds: match.vkvideoAllowedRoleIds || [],
              senderVkVideoRoleIds: senderRoleIds,
            })
          ) {
            return;
          }
          if (match.onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(slug);
            if (snap.status !== 'online') return;
          }
          await sendToVkVideoChat({ vkvideoChannelId, text: match.response });
        } catch (e: unknown) {
          logger.warn('vkvideo_chatbot.command_reply_failed', {
            vkvideoChannelId,
            errorMessage: getErrorMessage(e),
          });
        }
      }
    }

    // Credits: chatter event
    const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
      provider: 'vkvideo',
      platformUserId: incoming.userId,
    });
    const creditsUserId = memalertsUserId || `vkvideo:${incoming.userId}`;
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, {
        channelSlug: slug,
        userId: creditsUserId,
        displayName: incoming.displayName,
      });
    }

    // Auto rewards: chat activity (reuses Channel.twitchAutoRewardsJson.chat config).
    const autoRewardsCfg = autoRewardsByChannelId.get(channelId)?.cfg ?? null;
    const streamId = vkvideoIdToLastLiveStreamId.get(vkvideoChannelId) || null;
    await handleVkvideoChatAutoRewards({
      channelId,
      channelSlug: slug,
      vkvideoChannelId,
      streamId,
      incoming,
      memalertsUserId,
      autoRewardsCfg,
    });
  };

  const refreshCommands = async () => {
    if (stoppedRef.value) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(new Set(Array.from(vkvideoIdToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      let rows: unknown[] = [];
      try {
        rows = await prismaAny.chatBotCommand.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: {
            channelId: true,
            triggerNormalized: true,
            response: true,
            onlyWhenLive: true,
            allowedRoles: true,
            allowedUsers: true,
            vkvideoAllowedRoleIds: true,
          },
        });
      } catch (e: unknown) {
        if (getErrorCode(e) === 'P2022') {
          rows = await prismaAny.chatBotCommand.findMany({
            where: { channelId: { in: channelIds }, enabled: true },
            select: { channelId: true, triggerNormalized: true, response: true },
          });
        } else {
          throw e;
        }
      }

      const grouped = new Map<string, VkvideoCommandItem[]>();
      for (const r of rows) {
        const row = asRecord(r);
        const channelId = String(row.channelId ?? '').trim();
        const triggerNormalized = String(row.triggerNormalized ?? '')
          .trim()
          .toLowerCase();
        const response = String(row.response ?? '').trim();
        const onlyWhenLive = Boolean(row.onlyWhenLive);
        const allowedRoles = normalizeAllowedRolesList(row.allowedRoles);
        const allowedUsers = normalizeAllowedUsersList(row.allowedUsers);
        const vkvideoAllowedRoleIds = normalizeVkVideoAllowedRoleIdsList(row.vkvideoAllowedRoleIds);
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response, onlyWhenLive, allowedRoles, allowedUsers, vkvideoAllowedRoleIds });
        grouped.set(channelId, arr);
      }

      const now = Date.now();
      for (const id of channelIds) {
        commandsByChannelId.set(id, { ts: now, items: grouped.get(id) || [] });
      }

      // Stream duration JSON config is stored on Channel
      try {
        const chRows = await prismaAny.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, streamDurationCommandJson: true, twitchAutoRewardsJson: true },
        });
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of chRows) {
          const row = asRecord(r);
          const id = String(row.id ?? '').trim();
          if (!id) continue;
          byId.set(id, row);
        }
        for (const id of channelIds) {
          const raw = String(byId.get(id)?.streamDurationCommandJson ?? '').trim();
          streamDurationCfgByChannelId.set(id, { ts: now, cfg: raw ? parseStreamDurationCfg(raw) : null });
          autoRewardsByChannelId.set(id, { ts: now, cfg: byId.get(id)?.twitchAutoRewardsJson ?? null });
        }
      } catch (e: unknown) {
        if (getErrorCode(e) !== 'P2022') {
          logger.warn('vkvideo_chatbot.stream_duration_cfg_refresh_failed', { errorMessage: getErrorMessage(e) });
        }
      }
    } catch (e: unknown) {
      logger.warn('vkvideo_chatbot.commands_refresh_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  return {
    handleIncoming,
    refreshCommands,
    sendToVkVideoChat,
  };
}
