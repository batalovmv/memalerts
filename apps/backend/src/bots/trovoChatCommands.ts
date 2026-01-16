import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import {
  getValidTrovoAccessTokenByExternalAccountId,
  getValidTrovoBotAccessToken,
  sendTrovoChatMessage,
} from '../utils/trovoApi.js';
import { logger } from '../utils/logger.js';
import {
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  normalizeMessage,
  prismaAny,
  type TrovoChannelState,
  type TrovoCommandItem,
} from './trovoChatbotShared.js';

type TrovoChatCommandsConfig = {
  backendBaseUrls: string[];
  commandsRefreshSeconds: number;
  stoppedRef: { value: boolean };
};

type IncomingChat = {
  userId: string;
  displayName: string;
  login: string | null;
  text: string;
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
    logger.warn('trovo_chatbot.internal_post_failed', { errorMessage: getErrorMessage(e) });
  } finally {
    clearTimeout(t);
  }
}

export async function sendToTrovoChat(params: { st: TrovoChannelState; text: string }): Promise<void> {
  const messageText = normalizeMessage(params.text);
  if (!messageText) return;

  const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('TROVO_CLIENT_ID is not configured');

  const token = params.st.botExternalAccountId
    ? await getValidTrovoAccessTokenByExternalAccountId(params.st.botExternalAccountId)
    : await getValidTrovoBotAccessToken();
  if (!token) throw new Error('Trovo bot token is not configured');

  const resp = await sendTrovoChatMessage({
    accessToken: token,
    clientId,
    trovoChannelId: params.st.trovoChannelId,
    content: messageText,
    sendChatUrl: process.env.TROVO_SEND_CHAT_URL || undefined,
  });
  if (!resp.ok) {
    const hint =
      resp.status === 401 || resp.status === 403
        ? ' Trovo selected-channel send requires scopes: bot=chat_send_self AND target channel=send_to_my_channel.'
        : '';
    const rawMsg = (() => {
      const rawRec = asRecord(resp.raw);
      const rawData = asRecord(rawRec.data);
      const msg = rawRec.message ?? rawRec.error ?? rawRec.status_message ?? rawData.message ?? null;
      return msg ? ` raw=${String(msg)}` : '';
    })();
    throw new Error(`Trovo send chat failed (${resp.status}).${hint}${rawMsg}`);
  }
}

export function createTrovoChatCommands(states: Map<string, TrovoChannelState>, config: TrovoChatCommandsConfig) {
  const { backendBaseUrls, commandsRefreshSeconds, stoppedRef } = config;
  let commandsRefreshing = false;

  const refreshCommands = async () => {
    if (stoppedRef.value) return;
    if (commandsRefreshing) return;
    const channelIds = Array.from(states.keys());
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
            allowedUsers: true,
            allowedRoles: true,
          },
        });
      } catch (e: unknown) {
        if (getErrorCode(e) === 'P2022') {
          rows = await prismaAny.chatBotCommand.findMany({
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
        } else {
          throw e;
        }
      }

      const byChannel = new Map<string, TrovoCommandItem[]>();
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
      logger.warn('trovo_chatbot.commands_refresh_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const handleIncomingChat = async (st: TrovoChannelState, incoming: IncomingChat) => {
    const msgNorm = normalizeMessage(incoming.text).toLowerCase();
    if (msgNorm) {
      const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
      if (match?.response) {
        const allowedUsers = match.allowedUsers || [];
        if (allowedUsers.length > 0) {
          const senderLogin = incoming.login || '';
          if (senderLogin && allowedUsers.includes(senderLogin)) {
            if (match.onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(st.slug);
              if (snap.status === 'online') {
                try {
                  await sendToTrovoChat({ st, text: match.response });
                } catch (e: unknown) {
                  logger.warn('trovo_chatbot.command_reply_failed', {
                    channelId: st.channelId,
                    errorMessage: getErrorMessage(e),
                  });
                }
              }
            } else {
              try {
                await sendToTrovoChat({ st, text: match.response });
              } catch (e: unknown) {
                logger.warn('trovo_chatbot.command_reply_failed', {
                  channelId: st.channelId,
                  errorMessage: getErrorMessage(e),
                });
              }
            }
          }
        } else {
          if (match.onlyWhenLive) {
            const snap = await getStreamDurationSnapshot(st.slug);
            if (snap.status === 'online') {
              try {
                await sendToTrovoChat({ st, text: match.response });
              } catch (e: unknown) {
                logger.warn('trovo_chatbot.command_reply_failed', {
                  channelId: st.channelId,
                  errorMessage: getErrorMessage(e),
                });
              }
            }
          } else {
            try {
              await sendToTrovoChat({ st, text: match.response });
            } catch (e: unknown) {
              logger.warn('trovo_chatbot.command_reply_failed', {
                channelId: st.channelId,
                errorMessage: getErrorMessage(e),
              });
            }
          }
        }
      }
    }

    const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
      provider: 'trovo',
      platformUserId: incoming.userId,
    });
    const creditsUserId = memalertsUserId || `trovo:${incoming.userId}`;
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, {
        channelSlug: st.slug,
        userId: creditsUserId,
        displayName: incoming.displayName,
      });
    }
  };

  return { refreshCommands, handleIncomingChat };
}
