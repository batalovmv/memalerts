import { fetchActiveLiveChatIdByVideoId, fetchLiveVideoIdByChannelId, getValidYouTubeAccessToken, listLiveChatMessages } from '../utils/youtubeApi.js';
import { handleStreamOffline, handleStreamOnline } from '../realtime/streamDurationStore.js';
import { markCreditsSessionOffline } from '../realtime/creditsSessionStore.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorMessage, type YouTubeChannelState } from './youtubeChatbotShared.js';

type YouTubeChatPollingConfig = {
  liveCheckSeconds: number;
  stoppedRef: { value: boolean };
};

export function createYouTubeChatPolling(
  states: Map<string, YouTubeChannelState>,
  commands: { handleIncomingMessage: (st: YouTubeChannelState, msg: unknown) => Promise<void> },
  config: YouTubeChatPollingConfig
) {
  const { liveCheckSeconds, stoppedRef } = config;
  let pollLoopInFlight = false;

  const ensureLiveChatId = async (st: YouTubeChannelState) => {
    const now = Date.now();
    if (now - st.lastLiveCheckAt < liveCheckSeconds * 1000) return;
    st.lastLiveCheckAt = now;

    const accessToken = await getValidYouTubeAccessToken(st.userId);
    if (!accessToken) return;

    let nextLiveChatId: string | null = null;
    try {
      const videoId = await fetchLiveVideoIdByChannelId({ accessToken, youtubeChannelId: st.youtubeChannelId });
      if (videoId) {
        nextLiveChatId = await fetchActiveLiveChatIdByVideoId({ accessToken, videoId });
      }
    } catch (e: unknown) {
      logger.warn('youtube_chatbot.live_check_failed', {
        channelId: st.channelId,
        errorMessage: getErrorMessage(e),
      });
      return;
    }

    const wasLive = st.isLive;
    const nowLive = Boolean(nextLiveChatId);

    if (nowLive && (!wasLive || st.liveChatId !== nextLiveChatId)) {
      st.liveChatId = nextLiveChatId;
      st.isLive = true;
      st.firstPollAfterLive = true;
      st.pageToken = null;
      try {
        await handleStreamOnline(st.slug, st.streamDurationCfg?.breakCreditMinutes ?? 60);
      } catch (e: unknown) {
        logger.warn('youtube_chatbot.stream_online_store_failed', {
          slug: st.slug,
          errorMessage: getErrorMessage(e),
        });
      }
      logger.info('youtube_chatbot.live', { channelId: st.channelId, liveChatId: st.liveChatId });
    }

    if (!nowLive && wasLive) {
      st.liveChatId = null;
      st.isLive = false;
      st.firstPollAfterLive = true;
      st.pageToken = null;
      try {
        await handleStreamOffline(st.slug);
        await markCreditsSessionOffline(st.slug, st.creditsReconnectWindowMinutes);
      } catch (e: unknown) {
        logger.warn('youtube_chatbot.stream_offline_store_failed', {
          slug: st.slug,
          errorMessage: getErrorMessage(e),
        });
      }
      logger.info('youtube_chatbot.offline', { channelId: st.channelId });
    }
  };

  const pollChatsOnce = async () => {
    if (stoppedRef.value) return;
    if (pollLoopInFlight) return;
    pollLoopInFlight = true;

    try {
      for (const st of states.values()) {
        if (stoppedRef.value) return;
        if (st.pollInFlight) continue;
        const now = Date.now();

        if (st.nextPollAtMs && now < st.nextPollAtMs) continue;

        await ensureLiveChatId(st);
        if (!st.liveChatId) continue;

        if (now - st.lastPollAt < 1_000) continue;
        st.lastPollAt = now;

        st.pollInFlight = true;
        try {
          const accessToken = await getValidYouTubeAccessToken(st.userId);
          if (!accessToken) continue;

          const resp = await listLiveChatMessages({
            accessToken,
            liveChatId: st.liveChatId,
            pageToken: st.pageToken,
            maxResults: 200,
          });

          const respRec = asRecord(resp);
          const intervalRaw = Number(respRec.pollingIntervalMillis);
          const intervalMs = Number.isFinite(intervalRaw)
            ? Math.max(250, Math.min(30_000, Math.floor(intervalRaw)))
            : 1_000;
          st.nextPollAtMs = Date.now() + intervalMs;

          if (st.firstPollAfterLive) {
            st.firstPollAfterLive = false;
            st.pageToken = resp.nextPageToken;
            continue;
          }

          st.pageToken = resp.nextPageToken;
          const items = resp.items || [];
          if (items.length === 0) continue;

          for (const m of items) {
            await commands.handleIncomingMessage(st, m);
          }
        } catch (e: unknown) {
          logger.warn('youtube_chatbot.poll_failed', {
            channelId: st.channelId,
            errorMessage: getErrorMessage(e),
          });
        } finally {
          st.pollInFlight = false;
        }
      }
    } finally {
      pollLoopInFlight = false;
    }
  };

  return { pollChatsOnce };
}
