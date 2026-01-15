import { prisma } from '../lib/prisma.js';
import { getEntitledChannelIds } from '../utils/entitlements.js';
import { logger } from '../utils/logger.js';
import { asRecord, getErrorCode, getErrorMessage, normalizeLogin, prismaAny, type BotClient } from './twitchChatbotShared.js';

type SubscriptionRow = { channelId: string; login: string; slug: string };

type TwitchChatSubscriptionsConfig = {
  defaultClientRef: { value: BotClient | null };
  joinedDefault: Set<string>;
  loginToSlug: Map<string, string>;
  loginToChannelId: Map<string, string>;
  channelIdToOverrideExtId: Map<string, string>;
  stoppedRef: { value: boolean };
  refreshCommands: () => Promise<void>;
};

async function fetchEnabledSubscriptions(): Promise<SubscriptionRow[]> {
  const rows = await prisma.chatBotSubscription.findMany({
    where: { enabled: true },
    select: { channelId: true, twitchLogin: true, channel: { select: { slug: true } } },
  });

  let twitchGate: Map<string, boolean> | null = null;
  try {
    const channelIds = Array.from(
      new Set(rows.map((r) => String(asRecord(r).channelId ?? '').trim()).filter(Boolean))
    );
    if (channelIds.length > 0) {
      const gateRows = await prismaAny.botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'twitch' },
        select: { channelId: true, enabled: true },
      });
      twitchGate = new Map<string, boolean>();
      for (const gr of gateRows) {
        const channelId = String(asRecord(gr).channelId ?? '').trim();
        if (!channelId) continue;
        twitchGate.set(channelId, Boolean(asRecord(gr).enabled));
      }
    }
  } catch (e: unknown) {
    if (getErrorCode(e) !== 'P2021') throw e;
    twitchGate = null;
  }

  const out: SubscriptionRow[] = [];
  for (const r of rows) {
    const login = normalizeLogin(String(r.twitchLogin ?? ''));
    const slug = String(r.channel?.slug || '')
      .trim()
      .toLowerCase();
    const channelId = String(asRecord(r).channelId ?? '').trim();
    if (!channelId || !login || !slug) continue;

    if (twitchGate) {
      const gated = twitchGate.get(channelId);
      if (gated === false) continue;
    }

    out.push({ channelId, login, slug });
  }
  return out;
}

export function createTwitchChatSubscriptions(config: TwitchChatSubscriptionsConfig) {
  const {
    defaultClientRef,
    joinedDefault,
    loginToSlug,
    loginToChannelId,
    channelIdToOverrideExtId,
    stoppedRef,
    refreshCommands,
  } = config;
  let subscriptionsSyncing = false;

  const syncSubscriptions = async () => {
    if (stoppedRef.value || !defaultClientRef.value) return;
    if (subscriptionsSyncing) return;
    subscriptionsSyncing = true;
    try {
      const subs = await fetchEnabledSubscriptions();
      const desired = new Set<string>();
      loginToSlug.clear();
      loginToChannelId.clear();
      channelIdToOverrideExtId.clear();
      for (const s of subs) {
        desired.add(s.login);
        loginToSlug.set(s.login, s.slug);
        loginToChannelId.set(s.login, s.channelId);
      }

      try {
        const channelIds = subs.map((s) => s.channelId);
        const overrides = await prismaAny.twitchBotIntegration.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: { channelId: true, externalAccountId: true },
        });
        const entitled = await getEntitledChannelIds(channelIds, 'custom_bot');
        for (const o of overrides) {
          const row = asRecord(o);
          const cid = String(row.channelId ?? '').trim();
          const extId = String(row.externalAccountId ?? '').trim();
          if (cid && extId && entitled.has(cid)) channelIdToOverrideExtId.set(cid, extId);
        }
      } catch (e: unknown) {
        if (getErrorCode(e) !== 'P2021') throw e;
      }

      void refreshCommands();

      const toJoin = Array.from(desired).filter((l) => !joinedDefault.has(l));
      const toPart = Array.from(joinedDefault).filter((l) => !desired.has(l));

      for (const l of toJoin) {
        try {
          await defaultClientRef.value.client.join(l);
          joinedDefault.add(l);
          logger.info('chatbot.join', { login: l });
        } catch (e: unknown) {
          logger.warn('chatbot.join_failed', { login: l, errorMessage: getErrorMessage(e) });
        }
      }

      for (const l of toPart) {
        try {
          await defaultClientRef.value.client.part(l);
          joinedDefault.delete(l);
          logger.info('chatbot.part', { login: l });
        } catch (e: unknown) {
          logger.warn('chatbot.part_failed', { login: l, errorMessage: getErrorMessage(e) });
        }
      }
    } catch (e: unknown) {
      logger.warn('chatbot.sync_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      subscriptionsSyncing = false;
    }
  };

  return { syncSubscriptions };
}
