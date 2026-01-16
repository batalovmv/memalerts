import { resolveMemalertsUserIdFromChatIdentity } from '../utils/chatIdentity.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { logger } from '../utils/logger.js';
import { getYouTubeRoleTags, hasRoles, sanitizeRoleTags, type RoleMode } from './youtubeRoles.js';
import {
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeMessage,
  prismaAny,
  type YouTubeChannelState,
  type YouTubeCommandItem,
} from './youtubeChatbotShared.js';
import { sendToYouTubeChat } from './youtubeChatSender.js';

type YouTubeChatCommandsConfig = {
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
    logger.warn('youtube_chatbot.internal_post_failed', { errorMessage: getErrorMessage(e) });
  } finally {
    clearTimeout(t);
  }
}

export function createYouTubeChatCommands(states: Map<string, YouTubeChannelState>, config: YouTubeChatCommandsConfig) {
  const { backendBaseUrls, commandsRefreshSeconds, stoppedRef } = config;

  const refreshCommandsForChannel = async (channelId: string): Promise<YouTubeCommandItem[]> => {
    try {
      let rows: unknown[] = [];
      try {
        rows = await prismaAny.chatBotCommand.findMany({
          where: { channelId, enabled: true },
          select: {
            triggerNormalized: true,
            response: true,
            onlyWhenLive: true,
            requiredRoleTags: true,
            roleMode: true,
          },
        });
      } catch (e: unknown) {
        if (getErrorCode(e) === 'P2022') {
          rows = await prismaAny.chatBotCommand.findMany({
            where: { channelId, enabled: true },
            select: { triggerNormalized: true, response: true },
          });
        } else {
          throw e;
        }
      }

      const out: YouTubeCommandItem[] = [];
      for (const r of rows) {
        const row = asRecord(r);
        const triggerNormalized = String(row.triggerNormalized ?? '')
          .trim()
          .toLowerCase();
        const response = String(row.response ?? '').trim();
        const onlyWhenLive = Boolean(row.onlyWhenLive);
        if (!triggerNormalized || !response) continue;
        const requiredRoleTags = sanitizeRoleTags(row.requiredRoleTags);
        const roleMode: RoleMode = row.roleMode === 'ALL' ? 'ALL' : 'ANY';
        out.push({ triggerNormalized, response, onlyWhenLive, requiredRoleTags, roleMode });
      }
      return out;
    } catch (e: unknown) {
      logger.warn('youtube_chatbot.commands_refresh_failed', { channelId, errorMessage: getErrorMessage(e) });
      return [];
    }
  };

  const handleIncomingMessage = async (st: YouTubeChannelState, msg: unknown) => {
    if (stoppedRef.value) return;

    const msgRec = asRecord(msg);
    const authorRec = asRecord(msgRec.authorDetails);
    const authorName = String(authorRec.displayName || '').trim();
    const authorChannelId = String(authorRec.channelId || '').trim();
    if (!authorName || !authorChannelId) return;

    const roles = getYouTubeRoleTags({
      authorDetails: {
        isChatOwner: Boolean(authorRec.isChatOwner),
        isChatModerator: Boolean(authorRec.isChatModerator),
        isChatSponsor: Boolean(authorRec.isChatSponsor),
        isVerified: Boolean(authorRec.isVerified),
      },
    });

    const memalertsUserId = await resolveMemalertsUserIdFromChatIdentity({
      provider: 'youtube',
      platformUserId: authorChannelId,
    });
    const creditsUserId = memalertsUserId || `youtube:${authorChannelId}`;
    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, {
        channelSlug: st.slug,
        userId: creditsUserId,
        displayName: authorName,
      });
    }

    const snippetRec = asRecord(msgRec.snippet);
    const msgText = normalizeMessage(String(snippetRec.displayMessage || ''));
    const msgNorm = msgText.toLowerCase();
    if (!msgNorm) return;

    const now = Date.now();
    if (!st.commandsTs || now - st.commandsTs > commandsRefreshSeconds * 1000) {
      st.commands = await refreshCommandsForChannel(st.channelId);
      st.commandsTs = Date.now();
    }

    const cfg = st.streamDurationCfg;
    if (cfg?.enabled && cfg.triggerNormalized === msgNorm) {
      try {
        const snap = await getStreamDurationSnapshot(st.slug);
        if (cfg.onlyWhenLive && snap.status !== 'online') {
          // ignore
        } else {
          const totalMinutes = snap.totalMinutes;
          const hours = Math.floor(totalMinutes / 60);
          const minutes = totalMinutes % 60;
          const template = cfg.responseTemplate ?? 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
          const reply = template
            .replace(/\{hours\}/g, String(hours))
            .replace(/\{minutes\}/g, String(minutes))
            .replace(/\{totalMinutes\}/g, String(totalMinutes))
            .trim();
          if (reply) {
            await sendToYouTubeChat({ st, messageText: reply });
            return;
          }
        }
      } catch (e: unknown) {
        logger.warn('youtube_chatbot.stream_duration_reply_failed', {
          channelId: st.channelId,
          errorMessage: getErrorMessage(e),
        });
      }
    }

    const match = st.commands.find((c) => c.triggerNormalized === msgNorm);
    if (!match?.response) return;
    if (match.onlyWhenLive && !st.isLive) return;
    if (!hasRoles(roles, match.requiredRoleTags, match.roleMode)) return;

    try {
      await sendToYouTubeChat({ st, messageText: match.response });
    } catch (e: unknown) {
      logger.warn('youtube_chatbot.command_reply_failed', {
        channelId: st.channelId,
        errorMessage: getErrorMessage(e),
      });
    }
  };

  return { refreshCommandsForChannel, handleIncomingMessage };
}
