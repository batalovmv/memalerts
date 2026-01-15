import { logger } from '../utils/logger.js';
import { asRecord, getErrorCode, getErrorMessage, normalizeSlug, prismaAny, type KickChannelState } from './kickChatbotShared.js';

type SubRow = {
  channelId: string;
  userId: string;
  kickChannelId: string;
  slug: string;
};

async function fetchEnabledKickSubscriptions(): Promise<SubRow[]> {
  const rows = await prismaAny.kickChatBotSubscription.findMany({
    where: { enabled: true },
    select: {
      channelId: true,
      userId: true,
      kickChannelId: true,
      channel: { select: { slug: true } },
    },
  });

  let gate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(
      new Set(rows.map((r) => String(asRecord(r).channelId ?? '').trim()).filter(Boolean))
    );
    if (channelIds.length > 0) {
      const gateRows = await prismaAny.botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'kick' },
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
    const channelId = String(row.channelId ?? '').trim();
    const userId = String(row.userId ?? '').trim();
    const kickChannelId = String(row.kickChannelId ?? '').trim();
    const channel = asRecord(row.channel);
    const slug = normalizeSlug(String(channel.slug ?? ''));
    if (!channelId || !userId || !kickChannelId || !slug) continue;

    if (gate) {
      const gated = gate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, userId, kickChannelId, slug });
  }
  return out;
}

async function fetchKickBotOverrides(channelIds: string[]): Promise<Map<string, string>> {
  try {
    const ids = Array.from(new Set(channelIds.map((c) => String(c || '').trim()).filter(Boolean)));
    if (ids.length === 0) return new Map();
    const rows = await prismaAny.kickBotIntegration.findMany({
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
    logger.warn('kick_chatbot.bot_overrides_fetch_failed', { errorMessage: getErrorMessage(e) });
    return new Map();
  }
}

export function createKickChatSubscriptions(params: {
  states: Map<string, KickChannelState>;
  stoppedRef: { value: boolean };
}) {
  const { states, stoppedRef } = params;
  let syncInFlight = false;

  const syncSubscriptions = async () => {
    if (stoppedRef.value) return;
    if (syncInFlight) return;
    syncInFlight = true;
    try {
      const subs = await fetchEnabledKickSubscriptions();
      const nextChannelIds = new Set(subs.map((s) => s.channelId));

      for (const channelId of Array.from(states.keys())) {
        if (!nextChannelIds.has(channelId)) {
          states.delete(channelId);
        }
      }

      const overrides = await fetchKickBotOverrides(subs.map((s) => s.channelId));
      for (const s of subs) {
        const prev = states.get(s.channelId);
        if (prev) {
          prev.userId = s.userId;
          prev.kickChannelId = s.kickChannelId;
          prev.slug = s.slug;
          prev.botExternalAccountId = overrides.get(s.channelId) || null;
        } else {
          states.set(s.channelId, {
            channelId: s.channelId,
            userId: s.userId,
            kickChannelId: s.kickChannelId,
            slug: s.slug,
            botExternalAccountId: overrides.get(s.channelId) || null,
            commandsTs: 0,
            commands: [],
            chatCursor: null,
          });
        }
      }
    } catch (e: unknown) {
      logger.warn('kick_chatbot.sync_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      syncInFlight = false;
    }
  };

  return { syncSubscriptions };
}
