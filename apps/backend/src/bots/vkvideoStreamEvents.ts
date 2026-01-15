import { VkVideoPubSubClient } from './vkvideoPubsubClient.js';
import { handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import {
  extractVkVideoChannelIdFromUrl,
  fetchVkVideoChannel,
  fetchVkVideoCurrentUser,
  fetchVkVideoWebsocketSubscriptionTokens,
  fetchVkVideoWebsocketToken,
  getVkVideoExternalAccount,
} from '../utils/vkvideoApi.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorCode, getErrorMessage, normalizeLogin, normalizeSlug, prismaAny } from './vkvideoChatbotShared.js';
import { handleVkvideoRewardPush } from './vkvideoRewardProcessor.js';
import type { VkvideoChatCommandState } from './vkvideoChatCommands.js';

type SubRow = {
  channelId: string;
  userId: string | null;
  vkvideoChannelId: string;
  vkvideoChannelUrl: string | null;
  slug: string;
  creditsReconnectWindowMinutes: number;
  streamDurationCommandJson: string | null;
};

type IncomingChat = {
  text: string;
  userId: string;
  displayName: string;
  senderLogin: string | null;
};

type VkvideoPubsubState = {
  pubsubByChannelId: Map<string, VkVideoPubSubClient>;
  pubsubCtxByChannelId: Map<string, { tokenFetchedAt: number; wsChannelsKey: string }>;
  wsChannelToVkvideoId: Map<string, string>;
};

type VkvideoStreamEventsConfig = {
  pubsubWsUrl: string;
  pubsubRefreshSeconds: number;
  stoppedRef: { value: boolean };
};

type VkvideoStreamEventHandlers = {
  handleIncoming: (vkvideoChannelId: string, incoming: IncomingChat) => Promise<void>;
};

async function fetchEnabledVkVideoSubscriptions(): Promise<SubRow[]> {
  let rows: unknown[] = [];
  try {
    rows = await prismaAny.vkVideoChatBotSubscription.findMany({
      where: { enabled: true },
      select: {
        channelId: true,
        userId: true,
        vkvideoChannelId: true,
        vkvideoChannelUrl: true,
        channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
      },
    });
  } catch (e: unknown) {
    // Older DB without vkvideoChannelUrl column.
    if (getErrorCode(e) === 'P2022') {
      rows = await prismaAny.vkVideoChatBotSubscription.findMany({
        where: { enabled: true },
        select: {
          channelId: true,
          userId: true,
          vkvideoChannelId: true,
          channel: { select: { slug: true, creditsReconnectWindowMinutes: true, streamDurationCommandJson: true } },
        },
      });
    } else {
      throw e;
    }
  }

  // Optional gating by BotIntegrationSettings(provider=vkvideo).
  let gate: Map<string, boolean> | null = null; // channelId -> enabled
  try {
    const channelIds = Array.from(
      new Set(rows.map((r) => String(asRecord(r).channelId ?? '').trim()).filter(Boolean))
    );
    if (channelIds.length > 0) {
      const gateRows = await prismaAny.botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'vkvideo' },
        select: { channelId: true, enabled: true },
      });
      gate = new Map<string, boolean>();
      for (const gr of gateRows) {
        const channelId = String(asRecord(gr).channelId ?? '').trim();
        if (!channelId) continue;
        gate.set(channelId, Boolean(asRecord(gr).enabled));
      }
    }
  } catch (e: unknown) {
    if (getErrorCode(e) !== 'P2021') throw e;
    gate = null;
  }

  const out: SubRow[] = [];
  for (const r of rows) {
    const row = asRecord(r);
    const channel = asRecord(row.channel);
    const channelId = String(row.channelId ?? '').trim();
    const userId = String(row.userId ?? '').trim() || null;
    const vkvideoChannelId = String(row.vkvideoChannelId ?? '').trim();
    const vkvideoChannelUrl = String(row.vkvideoChannelUrl ?? '').trim() || null;
    const slug = normalizeSlug(String(channel.slug ?? ''));
    const creditsReconnectWindowMinutes = Number.isFinite(Number(channel.creditsReconnectWindowMinutes))
      ? Number(channel.creditsReconnectWindowMinutes)
      : 60;
    const streamDurationCommandJson =
      typeof channel.streamDurationCommandJson === 'string' ? channel.streamDurationCommandJson : null;
    if (!channelId || !vkvideoChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({
      channelId,
      userId,
      vkvideoChannelId,
      vkvideoChannelUrl,
      slug,
      creditsReconnectWindowMinutes,
      streamDurationCommandJson,
    });
  }
  return out;
}

function extractTextFromParts(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const chunks: string[] = [];
  for (const p of parts) {
    const rec = asRecord(p);
    const textRec = asRecord(rec.text);
    const t = String(textRec.content ?? '').trim();
    if (t) chunks.push(t);
  }
  return chunks.join(' ').trim();
}

function extractIncomingMessage(pubData: unknown): IncomingChat | null {
  // pubData may be either {type,data} or directly some message-like object.
  const root = asRecord(pubData);
  const rootData = asRecord(root.data);
  const maybe = asRecord(rootData.message ?? rootData.chat_message ?? root);

  const author = asRecord(maybe.author ?? maybe.user ?? rootData.user ?? root.user);
  const userId = String(author.id ?? maybe.user_id ?? rootData.user_id ?? root.user_id ?? '').trim();
  const displayName = String(author.nick ?? author.name ?? maybe.display_name ?? rootData.display_name ?? '').trim();

  const parts = maybe.parts ?? rootData.parts ?? asRecord(maybe.data).parts ?? null;
  const text = extractTextFromParts(parts) || String(maybe.text ?? rootData.text ?? '').trim();

  if (!userId || !displayName || !text) return null;

  const senderLogin = author.nick ? normalizeLogin(author.nick) : null;
  return { text, userId, displayName, senderLogin: senderLogin || null };
}

export function createVkvideoStreamEvents(
  state: VkvideoChatCommandState,
  pubsubState: VkvideoPubsubState,
  config: VkvideoStreamEventsConfig,
  handlers: VkvideoStreamEventHandlers
) {
  const {
    vkvideoIdToSlug,
    vkvideoIdToChannelId,
    vkvideoIdToOwnerUserId,
    vkvideoIdToChannelUrl,
    vkvideoIdToLastLiveStreamId,
    streamDurationCfgByChannelId,
    autoRewardsByChannelId,
  } = state;
  const { pubsubByChannelId, pubsubCtxByChannelId, wsChannelToVkvideoId } = pubsubState;
  const { pubsubWsUrl, pubsubRefreshSeconds, stoppedRef } = config;
  const { handleIncoming } = handlers;

  let subscriptionsSyncing = false;

  const syncSubscriptions = async () => {
    if (stoppedRef.value) return;
    if (subscriptionsSyncing) return;
    subscriptionsSyncing = true;
    try {
      const subs = await fetchEnabledVkVideoSubscriptions();

      const wantedChannelIds = new Set(subs.map((s) => s.channelId));

      // Stop clients for removed channels
      for (const existingChannelId of Array.from(pubsubByChannelId.keys())) {
        if (!wantedChannelIds.has(existingChannelId)) {
          pubsubByChannelId.get(existingChannelId)?.stop();
          pubsubByChannelId.delete(existingChannelId);
          pubsubCtxByChannelId.delete(existingChannelId);
        }
      }

      // Rebuild mapping from pubsub channel -> vkvideoChannelId
      wsChannelToVkvideoId.clear();

      // Start/restart pubsub clients for current subscriptions.
      for (const s of subs) {
        vkvideoIdToSlug.set(s.vkvideoChannelId, s.slug);
        vkvideoIdToChannelId.set(s.vkvideoChannelId, s.channelId);
        if (s.userId) vkvideoIdToOwnerUserId.set(s.vkvideoChannelId, s.userId);
        if (s.vkvideoChannelUrl) vkvideoIdToChannelUrl.set(s.vkvideoChannelId, String(s.vkvideoChannelUrl));

        // Require owner userId + channelUrl to access DevAPI and send messages.
        if (!s.userId) {
          logger.warn('vkvideo_chatbot.subscription_missing_user', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
          });
          continue;
        }
        const account = await getVkVideoExternalAccount(s.userId);
        if (!account?.accessToken) {
          logger.warn('vkvideo_chatbot.subscription_missing_access_token', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
          });
          continue;
        }

        // Back-compat: older subscriptions may not have vkvideoChannelUrl persisted yet.
        // Try to auto-resolve it from VKVideo current_user, so outbox/commands can work without requiring a manual "disable -> enable".
        let channelUrl = String(s.vkvideoChannelUrl || '').trim();
        if (!channelUrl) {
          try {
            const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
            if (currentUser.ok) {
              const dataRec = asRecord(currentUser.data);
              const root = asRecord(dataRec.data ?? dataRec);
              const channelRec = asRecord(root.channel);
              const urlPrimary = String(channelRec.url ?? '').trim();
              const urls = Array.isArray(root.channels)
                ? root.channels.map((c) => String(asRecord(c).url ?? '').trim()).filter(Boolean)
                : [];
              const unique = Array.from(new Set([urlPrimary, ...urls].filter(Boolean)));

              const matched = unique.filter((u) => extractVkVideoChannelIdFromUrl(u) === s.vkvideoChannelId);
              const resolved = matched[0] || (unique.length === 1 ? unique[0] : null);
              if (resolved) {
                channelUrl = resolved;
                vkvideoIdToChannelUrl.set(s.vkvideoChannelId, channelUrl);
                try {
                  await prismaAny.vkVideoChatBotSubscription.update({
                    where: { channelId: s.channelId },
                    data: { vkvideoChannelUrl: channelUrl },
                  });
                } catch (e: unknown) {
                  // Ignore if DB schema is older (no column yet) or update fails transiently.
                  if (getErrorCode(e) !== 'P2022') {
                    logger.warn('vkvideo_chatbot.subscription_autofill_persist_failed', {
                      channelId: s.channelId,
                      vkvideoChannelId: s.vkvideoChannelId,
                      errorMessage: getErrorMessage(e),
                    });
                  }
                }
                logger.info('vkvideo_chatbot.subscription_autofilled_channel_url', {
                  channelId: s.channelId,
                  vkvideoChannelId: s.vkvideoChannelId,
                });
              }
            } else {
              logger.warn('vkvideo_chatbot.current_user_failed', {
                channelId: s.channelId,
                vkvideoChannelId: s.vkvideoChannelId,
                errorMessage: currentUser.error,
              });
            }
          } catch (e: unknown) {
            logger.warn('vkvideo_chatbot.subscription_autofill_failed', {
              channelId: s.channelId,
              vkvideoChannelId: s.vkvideoChannelId,
              errorMessage: getErrorMessage(e),
            });
          }
        }

        if (!channelUrl) {
          logger.warn('vkvideo_chatbot.subscription_missing_channel_url', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
          });
          continue;
        }

        const chInfo = await fetchVkVideoChannel({ accessToken: account.accessToken, channelUrl });
        if (!chInfo.ok) {
          logger.warn('vkvideo_chatbot.channel_info_failed', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
            error: chInfo.error,
          });
          continue;
        }

        // Track VKVideo live status into streamDurationStore, so the "stream duration" smart command works for VKVideo too.
        // We treat presence of streamId as "online".
        try {
          const prevStreamId = vkvideoIdToLastLiveStreamId.get(s.vkvideoChannelId) ?? null;
          const nextStreamId = chInfo.streamId ?? null;
          vkvideoIdToLastLiveStreamId.set(s.vkvideoChannelId, nextStreamId);

          const wasOnline = Boolean(prevStreamId);
          const isOnline = Boolean(nextStreamId);

          if (!wasOnline && isOnline) {
            const cfg = streamDurationCfgByChannelId.get(s.channelId)?.cfg;
            const breakCreditMinutes = cfg?.breakCreditMinutes ?? 60;
            await handleStreamOnline(s.slug, breakCreditMinutes);
          } else if (wasOnline && !isOnline) {
            await handleStreamOffline(s.slug);
          }
        } catch (e: unknown) {
          logger.warn('vkvideo_chatbot.stream_duration_update_failed', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
            errorMessage: getErrorMessage(e),
          });
        }

        const wsChannels: string[] = [];
        const wsChannelsRec = asRecord(chInfo.webSocketChannels);
        const chatCh = String(wsChannelsRec.chat || '').trim();
        const limitedChatCh = String(wsChannelsRec.limited_chat || '').trim();
        const infoCh = String(wsChannelsRec.info || '').trim();
        const pointsCh = String(wsChannelsRec.channel_points || '').trim();
        if (chatCh) wsChannels.push(chatCh);
        if (limitedChatCh && limitedChatCh !== chatCh) wsChannels.push(limitedChatCh);
        if (infoCh && infoCh !== chatCh && infoCh !== limitedChatCh) wsChannels.push(infoCh);
        if (pointsCh && pointsCh !== chatCh && pointsCh !== limitedChatCh && pointsCh !== infoCh)
          wsChannels.push(pointsCh);

        if (wsChannels.length === 0) {
          logger.warn('vkvideo_chatbot.no_chat_ws_channels', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
          });
          continue;
        }

        for (const ch of wsChannels) wsChannelToVkvideoId.set(ch, s.vkvideoChannelId);

        const wsChannelsKey = wsChannels.slice().sort().join('|');
        const existingClient = pubsubByChannelId.get(s.channelId) || null;
        const existingCtx = pubsubCtxByChannelId.get(s.channelId) || null;
        const now = Date.now();
        const shouldRefreshTokens =
          !existingClient ||
          !existingCtx ||
          !existingClient.isOpen() ||
          now - existingCtx.tokenFetchedAt >= pubsubRefreshSeconds * 1000 ||
          existingCtx.wsChannelsKey !== wsChannelsKey;

        if (!shouldRefreshTokens) continue;

        const wsTokenResp = await fetchVkVideoWebsocketToken({ accessToken: account.accessToken });
        if (!wsTokenResp.ok || !wsTokenResp.token) {
          logger.warn('vkvideo_chatbot.websocket_token_failed', {
            channelId: s.channelId,
            vkvideoChannelId: s.vkvideoChannelId,
            error: wsTokenResp.error,
          });
          continue;
        }

        const subTokens = await fetchVkVideoWebsocketSubscriptionTokens({
          accessToken: account.accessToken,
          channels: wsChannels,
        });
        const specs = wsChannels.map((ch) => ({ channel: ch, token: subTokens.tokensByChannel.get(ch) || null }));

        // (Re)start client on demand (periodic resync handles reconnection).
        existingClient?.stop();
        const client = new VkVideoPubSubClient({
          url: pubsubWsUrl,
          token: wsTokenResp.token,
          subscriptions: specs,
          logContext: { channelId: s.channelId, vkvideoChannelId: s.vkvideoChannelId },
          onPush: (push) => {
            const vkId = wsChannelToVkvideoId.get(push.channel) || null;
            if (!vkId) return;

            const channelId = vkvideoIdToChannelId.get(vkId) || null;
            const slug = vkvideoIdToSlug.get(vkId) || '';
            const autoRewardsCfg = channelId ? autoRewardsByChannelId.get(channelId)?.cfg ?? null : null;
            const handledReward = handleVkvideoRewardPush({
              vkvideoChannelId: vkId,
              channelId,
              channelSlug: slug,
              pushData: push.data,
              autoRewardsCfg,
            });
            if (handledReward) return;

            const incoming = extractIncomingMessage(push.data);
            if (!incoming) return;
            void handleIncoming(vkId, incoming);
          },
        });
        pubsubByChannelId.set(s.channelId, client);
        pubsubCtxByChannelId.set(s.channelId, { tokenFetchedAt: now, wsChannelsKey });
        client.start();
      }
    } finally {
      subscriptionsSyncing = false;
    }
  };

  return { syncSubscriptions };
}
