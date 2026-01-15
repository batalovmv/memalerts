import {
  getValidYouTubeAccessTokenByExternalAccountId,
  getValidYouTubeBotAccessToken,
  sendLiveChatMessage,
} from '../utils/youtubeApi.js';
import { type YouTubeChannelState } from './youtubeChatbotShared.js';

export async function sendToYouTubeChat(params: { st: YouTubeChannelState; messageText: string }): Promise<void> {
  if (!params.st.liveChatId) throw new Error('No active live chat');
  const token = params.st.botExternalAccountId
    ? await getValidYouTubeAccessTokenByExternalAccountId(params.st.botExternalAccountId)
    : await getValidYouTubeBotAccessToken();
  if (!token) throw new Error('YouTube bot token is not configured');

  await sendLiveChatMessage({
    accessToken: token,
    liveChatId: params.st.liveChatId,
    messageText: params.messageText,
  });
}
