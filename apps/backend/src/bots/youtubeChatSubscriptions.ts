import { getEntitledChannelIds } from '../utils/entitlements.js';
import { logger } from '../utils/logger.js';
import {
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeSlug,
  prismaAny,
  type YouTubeChannelState,
} from './youtubeChatbotShared.js';

type SubRow = {
  channelId: string;
  userId: string;
  youtubeChannelId: string;
  slug: string;
};

async function fetchEnabledYouTubeSubscriptions(): Promise<SubRow[]> {
  const rows = await prismaAny.youTubeChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      youtubeChannelId: true,
      channel: { select: { slug: true } },
    },
  });

  let gate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(new Set(rows.map((r) => String(asRecord(r).channelId ?? '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await prismaAny.botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'youtube' },
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
    const userId = String(row.userId ?? '').trim();
    const youtubeChannelId = String(row.youtubeChannelId ?? '').trim();
    const slug = normalizeSlug(String(channel.slug ?? ''));
    if (!channelId || !userId || !youtubeChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, youtubeChannelId, slug });
  }
  return out;
}

async function fetchYouTubeBotOverrides(channelIds: string[]): Promise<Map<string, string>> {
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await prismaAny.youTubeBotIntegration.findMany({
      where: { channelId: { in: ids }, enabled: true },
      select: { channelId: true, externalAccountId: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      const row = asRecord(r);
      const channelId = String(row.channelId ?? '').trim();
      const externalAccountId = String(row.externalAccountId ?? '').trim();
      if (!channelId || !externalAccountId) continue;
      map.set(channelId, externalAccountId);
    }
    return map;
  } catch (e: unknown) {
    if (getErrorCode(e) === 'P2021') return new Map();
    logger.warn('youtube_chatbot.bot_overrides_fetch_failed', { errorMessage: getErrorMessage(e) });
    return new Map();
  }
}

export function createYouTubeChatSubscriptions(params: {
  states: Map<string, YouTubeChannelState>;
  stoppedRef: { value: boolean };
}) {
  const { states, stoppedRef } = params;
  let syncInFlight = false;

  const syncSubscriptions = async () => {
    if (stoppedRef.value) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const subs = await fetchEnabledYouTubeSubscriptions();
      const overrides = await fetchYouTubeBotOverrides(subs.map((s) => s.channelId));
      const entitled = await getEntitledChannelIds(
        subs.map((s) => s.channelId),
        'custom_bot'
      );
      const desired = new Set<string>(subs.map((s) => s.channelId));

      for (const s of subs) {
        const existing = states.get(s.channelId);
        if (!existing) {
          states.set(s.channelId, {
            channelId: s.channelId,
            userId: s.userId,
            youtubeChannelId: s.youtubeChannelId,
            slug: s.slug,
            liveChatId: null,
            isLive: false,
            lastLiveCheckAt: 0,
            botExternalAccountId: null,
          });
          states.get(s.channelId)!.botExternalAccountId = entitled.has(s.channelId)
            ? (overrides.get(s.channelId) ?? null)
            : null;
          logger.info('youtube_chatbot.sub.add', {
            channelId: s.channelId,
            youtubeChannelId: s.youtubeChannelId,
            slug: s.slug,
          });
        } else {
          existing.userId = s.userId;
          existing.youtubeChannelId = s.youtubeChannelId;
          existing.slug = s.slug;
          existing.botExternalAccountId = entitled.has(s.channelId) ? (overrides.get(s.channelId) ?? null) : null;
        }
      }

      for (const channelId of Array.from(states.keys())) {
        if (!desired.has(channelId)) {
          states.delete(channelId);
          logger.info('youtube_chatbot.sub.remove', { channelId });
        }
      }
    } catch (e: unknown) {
      logger.warn('youtube_chatbot.sync_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      syncInFlight = false;
    }
  };

  return { syncSubscriptions };
}
