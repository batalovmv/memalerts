import tmi from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import {
  getValidTwitchAccessTokenByExternalAccountId,
  refreshTwitchAccessTokenByExternalAccountId,
} from '../utils/twitchApi.js';
import { logger } from '../utils/logger.js';
import { getErrorMessage, isTwitchAuthError, normalizeLogin, type BotClient } from './twitchChatbotShared.js';

export async function resolveBotUserId(): Promise<string | null> {
  const explicit = String(process.env.CHAT_BOT_USER_ID || '').trim();
  if (explicit) return explicit;

  const twitchUserId = String(process.env.CHAT_BOT_TWITCH_USER_ID || '').trim();
  if (twitchUserId) {
    const u = await prisma.user.findUnique({ where: { twitchUserId }, select: { id: true } });
    return u?.id || null;
  }

  const login = String(process.env.CHAT_BOT_LOGIN || 'lotas_bot').trim();
  if (login) {
    const u = await prisma.user.findFirst({
      where: { displayName: { equals: login, mode: 'insensitive' } },
      select: { id: true },
    });
    return u?.id || null;
  }

  return null;
}

export async function ensureOverrideClient(params: {
  overrideClients: Map<string, BotClient>;
  externalAccountId: string;
}): Promise<BotClient | null> {
  const extId = String(params.externalAccountId || '').trim();
  if (!extId) return null;
  const existing = params.overrideClients.get(extId) || null;
  if (existing) return existing;

  const ext = await prisma.externalAccount.findUnique({
    where: { id: extId },
    select: { id: true, provider: true, login: true },
  });
  const login = normalizeLogin(String(ext?.login || ''));
  if (!ext || ext.provider !== 'twitch' || !login) return null;

  let accessToken = await getValidTwitchAccessTokenByExternalAccountId(extId);
  if (!accessToken) {
    accessToken = await refreshTwitchAccessTokenByExternalAccountId(extId);
  }
  if (!accessToken) return null;

  const buildClient = (token: string) =>
    new tmi.Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: { username: login, password: `oauth:${token}` },
      channels: [],
    });

  let client = buildClient(accessToken);
  let entry: BotClient = { kind: 'override', login, client, joined: new Set(), externalAccountId: extId };
  params.overrideClients.set(extId, entry);

  const attachListeners = (activeClient: tmi.Client) => {
    activeClient.on('connected', () => {
      logger.info('chatbot.override.connected', { botLogin: login, externalAccountId: extId });
    });
    activeClient.on('disconnected', (reason: unknown) => {
      logger.warn('chatbot.override.disconnected', {
        botLogin: login,
        externalAccountId: extId,
        reason: String(reason || ''),
      });
    });
  };

  attachListeners(client);

  try {
    await client.connect();
    return entry;
  } catch (e: unknown) {
    const authError = isTwitchAuthError(e);
    logger.warn('chatbot.override.connect_failed', {
      botLogin: login,
      externalAccountId: extId,
      errorMessage: getErrorMessage(e),
      authError,
    });
    if (authError) {
      const refreshed = await refreshTwitchAccessTokenByExternalAccountId(extId);
      if (refreshed) {
        client = buildClient(refreshed);
        entry = { ...entry, client };
        params.overrideClients.set(extId, entry);
        attachListeners(client);
        try {
          await client.connect();
          return entry;
        } catch (err: unknown) {
          logger.warn('chatbot.override.connect_failed', {
            botLogin: login,
            externalAccountId: extId,
            errorMessage: getErrorMessage(err),
            authError: isTwitchAuthError(err),
          });
        }
      }
    }
    params.overrideClients.delete(extId);
    return null;
  }
}

export async function sayForChannel(params: {
  defaultClientRef: { value: BotClient | null };
  overrideClients: Map<string, BotClient>;
  channelIdToOverrideExtId: Map<string, string>;
  channelId: string | null;
  twitchLogin: string;
  message: string;
}): Promise<void> {
  const login = normalizeLogin(params.twitchLogin);
  if (!login) throw new Error('invalid_login');

  const channelId = params.channelId ? String(params.channelId).trim() : null;
  const overrideExtId = channelId ? params.channelIdToOverrideExtId.get(channelId) || null : null;
  logger.info('chatbot.say.sender', {
    channelId,
    login,
    sender: overrideExtId ? 'override' : 'global',
    overrideExternalAccountId: overrideExtId,
  });
  if (overrideExtId) {
    const override = await ensureOverrideClient({
      overrideClients: params.overrideClients,
      externalAccountId: overrideExtId,
    });
    if (override) {
      if (!override.joined.has(login)) {
        try {
          await override.client.join(login);
          override.joined.add(login);
        } catch (e: unknown) {
          logger.warn('chatbot.override.join_failed', {
            botLogin: override.login,
            login,
            errorMessage: getErrorMessage(e),
          });
        }
      }
      if (override.joined.has(login)) {
        await override.client.say(login, params.message);
        return;
      }
    }
  }

  if (!params.defaultClientRef.value) throw new Error('no_default_client');
  await params.defaultClientRef.value.client.say(login, params.message);
}
