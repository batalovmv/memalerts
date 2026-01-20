import {
  getValidKickAccessTokenByExternalAccountId,
  getValidKickBotAccessToken,
  sendKickChatMessage,
} from '../utils/kickApi.js';
import { asRecord, getErrorMessage, normalizeMessage, type KickChannelState } from './kickChatbotShared.js';

export async function sendToKickChat(params: { st: KickChannelState; text: string }) {
  const messageText = normalizeMessage(params.text);
  if (!messageText) return;

  const sendUrl = String(process.env.KICK_SEND_CHAT_URL || '').trim();
  if (!sendUrl) throw new Error('KICK_SEND_CHAT_URL is not configured');

  const token = params.st.botExternalAccountId
    ? await getValidKickAccessTokenByExternalAccountId(params.st.botExternalAccountId)
    : await getValidKickBotAccessToken();
  if (!token) throw new Error('Kick bot token is not configured');

  const resp = await sendKickChatMessage({
    accessToken: token,
    kickChannelId: params.st.kickChannelId,
    content: messageText,
    sendChatUrl: sendUrl,
  });
  if (!resp.ok) {
    const err = new Error(`Kick send chat failed (${resp.status})`) as Error & {
      kickStatus?: number;
      retryAfterSeconds?: number;
      raw?: unknown;
    };
    err.kickStatus = resp.status;
    err.retryAfterSeconds = resp.retryAfterSeconds ?? undefined;
    err.raw = resp.raw ?? null;
    const rec = asRecord(resp.raw);
    if (Object.keys(rec).length) {
      err.message = `${err.message}: ${getErrorMessage(resp.raw)}`;
    }
    throw err;
  }
}
