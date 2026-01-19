import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { logger } from '../utils/logger.js';
import {
  asRecord,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  prismaAny,
  type KickChannelState,
} from './kickChatbotShared.js';
import { sendToKickChat } from './kickChatSender.js';
import { handleUnifiedChatReward } from './unifiedChatRewards.js';

type IncomingChat = {
  userId: string;
  displayName: string;
  login: string | null;
  text: string;
};

type KickChatCommandsConfig = {
  backendBaseUrls: string[];
  commandsRefreshSeconds: number;
  stoppedRef: { value: boolean };
};

async function postInternalCreditsChatter(
  baseUrl: string,
  payload: { channelSlug: string; userId: string; displayName: string }
) {
  const url = new URL('/internal/credits/chatter', baseUrl);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2_000);
  try {
    await fetch(url.toString(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-memalerts-internal': 'credits-event',
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
  } catch (e: unknown) {
    logger.warn('kick_chatbot.internal_post_failed', { errorMessage: getErrorMessage(e) });
  } finally {
    clearTimeout(t);
  }
}

export function createKickChatCommands(states: Map<string, KickChannelState>, config: KickChatCommandsConfig) {
  const { backendBaseUrls, stoppedRef } = config;
  let commandsRefreshing = false;

  const refreshCommands = async () => {
    if (stoppedRef.value) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(states.keys());
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      const rows = await prismaAny.chatBotCommand.findMany({
        where: { channelId: { in: channelIds }, enabled: true },
        select: {
          channelId: true,
          triggerNormalized: true,
          response: true,
          onlyWhenLive: true,
          allowedUsers: true,
          allowedRoles: true,
        },
      });

      const byChannel = new Map<string, KickChannelState['commands']>();
      for (const r of rows) {
        const row = asRecord(r);
        const channelId = String(row.channelId ?? '').trim();
        const triggerNormalized = String(row.triggerNormalized ?? '')
          .trim()
          .toLowerCase();
        const response = String(row.response ?? '').trim();
        const onlyWhenLive = Boolean(row.onlyWhenLive);
        if (!channelId || !triggerNormalized || !response) continue;

        const allowedUsers = Array.isArray(row.allowedUsers)
          ? row.allowedUsers.map(normalizeLogin).filter(Boolean)
          : [];
        const allowedRoles = Array.isArray(row.allowedRoles) ? row.allowedRoles.map((x) => String(x ?? '').trim()) : [];

        const list = byChannel.get(channelId) || [];
        list.push({ triggerNormalized, response, onlyWhenLive, allowedUsers, allowedRoles });
        byChannel.set(channelId, list);
      }

      for (const [channelId, st] of states.entries()) {
        st.commands = byChannel.get(channelId) || [];
        st.commandsTs = Date.now();
      }
    } catch (e: unknown) {
      logger.warn('kick_chatbot.commands_refresh_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const handleIncomingChat = async (st: KickChannelState, incoming: IncomingChat) => {
    const msgNorm = normalizeMessage(incoming.text).toLowerCase();
    if (msgNorm) {
      const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
      if (match?.response) {
        const allowedUsers = match.allowedUsers || [];
        const senderLogin = incoming.login || '';
        if (!allowedUsers.length || (senderLogin && allowedUsers.includes(senderLogin))) {
          if (match.onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(st.slug);
            if (snap.status === 'online') {
              try {
                await sendToKickChat({ st, text: match.response });
              } catch (e: unknown) {
                logger.warn('kick_chatbot.command_reply_failed', {
                  channelId: st.channelId,
                  errorMessage: getErrorMessage(e),
                });
              }
            }
          } else {
            try {
              await sendToKickChat({ st, text: match.response });
            } catch (e: unknown) {
              logger.warn('kick_chatbot.command_reply_failed', {
                channelId: st.channelId,
                errorMessage: getErrorMessage(e),
              });
            }
          }
        }
      }
    }

    const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
      provider: 'kick',
      platformUserId: incoming.userId,
    });
    const creditsUserId = memalertsUserId || `kick:${incoming.userId}`;
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, {
        channelSlug: st.slug,
        userId: creditsUserId,
        displayName: incoming.displayName,
      });
    }

    // Unified chat rewards (all platforms, only logged-in users)
    void handleUnifiedChatReward(null, {
      platform: 'kick',
      channelSlug: st.slug,
      platformUserId: incoming.userId,
      displayName: incoming.displayName,
    });
  };

  return { refreshCommands, handleIncomingChat };
}
