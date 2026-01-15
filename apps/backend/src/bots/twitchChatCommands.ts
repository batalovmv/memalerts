import type { ChatUserstate, Client } from 'tmi.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';
import { logger } from '../utils/logger.js';
import {
  asRecord,
  getErrorCode,
  getErrorMessage,
  normalizeLogin,
  prismaAny,
} from './twitchChatbotShared.js';

export type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

export type TwitchStreamDurationCfg = {
  enabled: boolean;
  triggerNormalized: string;
  responseTemplate: string | null;
  breakCreditMinutes: number;
  onlyWhenLive: boolean;
};

export type TwitchChatCommandItem = {
  triggerNormalized: string;
  response: string;
  onlyWhenLive: boolean;
  allowedRoles: ChatCommandRole[];
  allowedUsers: string[];
};

export type TwitchChatCommandState = {
  loginToSlug: Map<string, string>;
  loginToChannelId: Map<string, string>;
  commandsByChannelId: Map<string, { ts: number; items: TwitchChatCommandItem[] }>;
  streamDurationByChannelId: Map<string, { ts: number; cfg: TwitchStreamDurationCfg | null }>;
};

type TwitchChatCommandsConfig = {
  backendBaseUrls: string[];
  commandsRefreshSeconds: number;
  stoppedRef: { value: boolean };
  sayForChannel: (params: { channelId: string | null; twitchLogin: string; message: string }) => Promise<void>;
};

function getSenderRolesFromTwitchIrcTags(tags: ChatUserstate | null | undefined): Set<ChatCommandRole> {
  const roles = new Set<ChatCommandRole>();

  const mod = String(tags?.mod ?? '').trim();
  if (mod === '1') roles.add('moderator');

  const subscriber = String(tags?.subscriber ?? '').trim();
  if (subscriber === '1') roles.add('subscriber');

  const badges = String(tags?.badges ?? '')
    .trim()
    .toLowerCase();
  if (badges.includes('vip/')) roles.add('vip');

  return roles;
}

function normalizeAllowedUsersList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    const login = String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/^@+/, '');
    if (!login) continue;
    if (!out.includes(login)) out.push(login);
  }
  return out;
}

function normalizeAllowedRolesList(raw: unknown): ChatCommandRole[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '')
      .trim()
      .toLowerCase() as ChatCommandRole;
    if (!role) continue;
    if (role !== 'vip' && role !== 'moderator' && role !== 'subscriber' && role !== 'follower') continue;
    if (!out.includes(role)) out.push(role);
  }
  return out;
}

function canTriggerCommand(opts: {
  senderLogin: string;
  senderRoles: Set<ChatCommandRole>;
  allowedUsers: string[];
  allowedRoles: ChatCommandRole[];
}): boolean {
  const { senderLogin, senderRoles, allowedUsers, allowedRoles } = opts;

  const users = allowedUsers || [];
  const roles = allowedRoles || [];
  if (users.length === 0 && roles.length === 0) return true;

  if (senderLogin && users.includes(senderLogin)) return true;
  for (const r of roles) {
    if (senderRoles.has(r)) return true;
  }
  return false;
}

function parseStreamDurationCfg(raw: string | null | undefined): TwitchStreamDurationCfg | null {
  try {
    const s = String(raw || '').trim();
    if (!s) return null;
    const parsed = JSON.parse(s) as unknown;
    const parsedRec = asRecord(parsed);
    const triggerNormalized = String(parsedRec.triggerNormalized ?? parsedRec.trigger ?? '')
      .trim()
      .toLowerCase();
    const enabled = Boolean(parsedRec.enabled);
    const breakCreditMinutes = Number.isFinite(Number(parsedRec.breakCreditMinutes))
      ? Math.max(0, Math.min(24 * 60, Math.floor(Number(parsedRec.breakCreditMinutes))))
      : 60;
    const responseTemplate =
      parsedRec.responseTemplate === null ? null : String(parsedRec.responseTemplate ?? '').trim() || null;
    const onlyWhenLive = Boolean(parsedRec.onlyWhenLive);
    if (!triggerNormalized) return null;
    return { enabled, triggerNormalized, responseTemplate, breakCreditMinutes, onlyWhenLive };
  } catch {
    return null;
  }
}

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
    const message = getErrorMessage(e);
    logger.warn('chatbot.internal_post_failed', { errorMessage: message });
  } finally {
    clearTimeout(t);
  }
}

export function createTwitchChatCommands(state: TwitchChatCommandState, config: TwitchChatCommandsConfig) {
  const { loginToSlug, loginToChannelId, commandsByChannelId, streamDurationByChannelId } = state;
  const { backendBaseUrls, commandsRefreshSeconds, stoppedRef, sayForChannel } = config;
  let commandsRefreshing = false;

  const refreshCommands = async () => {
    if (stoppedRef.value || commandsRefreshing) return;
    const channelIds = Array.from(new Set(Array.from(loginToChannelId.values()).filter(Boolean)));
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
            allowedRoles: true,
            allowedUsers: true,
          },
        });
      } catch (e: unknown) {
        if (getErrorCode(e) === 'P2022') {
          rows = await prismaAny.chatBotCommand.findMany({
            where: { channelId: { in: channelIds }, enabled: true },
            select: { channelId: true, triggerNormalized: true, response: true },
          });
        } else {
          throw e;
        }
      }

      const grouped = new Map<string, TwitchChatCommandItem[]>();
      for (const r of rows) {
        const row = asRecord(r);
        const channelId = String(row.channelId ?? '').trim();
        const triggerNormalized = String(row.triggerNormalized ?? '')
          .trim()
          .toLowerCase();
        const response = String(row.response ?? '').trim();
        const onlyWhenLive = Boolean(row.onlyWhenLive);
        const allowedRoles = normalizeAllowedRolesList(row.allowedRoles);
        const allowedUsers = normalizeAllowedUsersList(row.allowedUsers);
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response, onlyWhenLive, allowedRoles, allowedUsers });
        grouped.set(channelId, arr);
      }

      const now = Date.now();
      for (const id of channelIds) {
        commandsByChannelId.set(id, { ts: now, items: grouped.get(id) || [] });
      }

      try {
        const chRows = await prismaAny.channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, streamDurationCommandJson: true },
        });
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of chRows) {
          const row = asRecord(r);
          const id = String(row.id ?? '').trim();
          if (!id) continue;
          byId.set(id, row);
        }
        for (const id of channelIds) {
          const raw = String(byId.get(id)?.streamDurationCommandJson ?? '').trim();
          streamDurationByChannelId.set(id, { ts: now, cfg: raw ? parseStreamDurationCfg(raw) : null });
        }
      } catch (e: unknown) {
        if (getErrorCode(e) !== 'P2022') {
          logger.warn('chatbot.stream_duration_cfg_refresh_failed', { errorMessage: getErrorMessage(e) });
        }
      }
    } catch (e: unknown) {
      logger.warn('chatbot.commands_refresh_failed', { errorMessage: getErrorMessage(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const handleIncomingMessage = async (params: {
    channel: string;
    tags: ChatUserstate;
    message: string;
    client: Client;
  }) => {
    if (stoppedRef.value) return;
    const login = normalizeLogin(params.channel);
    const slug = loginToSlug.get(login);
    if (!slug) return;

    const msgNorm = String(params.message || '')
      .trim()
      .toLowerCase();
    const senderLogin = normalizeLogin(String(params.tags?.username || params.tags?.['display-name'] || ''));
    const senderRoles = getSenderRolesFromTwitchIrcTags(params.tags);

    const channelId = loginToChannelId.get(login);
    if (channelId) {
      const cached = commandsByChannelId.get(channelId);
      const now = Date.now();
      if (!cached || now - cached.ts > commandsRefreshSeconds * 1000) {
        void refreshCommands();
      }

      if (msgNorm) {
        const smartCached = streamDurationByChannelId.get(channelId);
        if (smartCached && now - smartCached.ts <= commandsRefreshSeconds * 1000) {
          const cfg = smartCached.cfg;
          if (cfg?.enabled && cfg.triggerNormalized === msgNorm) {
            try {
              const snap = await getStreamDurationSnapshot(slug);
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
                  const cid = loginToChannelId.get(login) || null;
                  await sayForChannel({ channelId: cid, twitchLogin: login, message: reply });
                  return;
                }
              }
            } catch (e: unknown) {
              logger.warn('chatbot.stream_duration_reply_failed', { login, errorMessage: getErrorMessage(e) });
            }
          }
        } else if (smartCached && now - smartCached.ts > commandsRefreshSeconds * 1000) {
          void refreshCommands();
        }
      }

      if (msgNorm) {
        const items = commandsByChannelId.get(channelId)?.items || [];
        const match = items.find((c) => c.triggerNormalized === msgNorm);
        if (match?.response) {
          try {
            if (
              !canTriggerCommand({
                senderLogin,
                senderRoles,
                allowedUsers: match.allowedUsers || [],
                allowedRoles: match.allowedRoles || [],
              })
            ) {
              return;
            }
            if (match.onlyWhenLive) {
              const snap = await getStreamDurationSnapshot(slug);
              if (snap.status !== 'online') return;
            }
            await params.client.say(login, match.response);
          } catch (e: unknown) {
            logger.warn('chatbot.command_reply_failed', { login, errorMessage: getErrorMessage(e) });
          }
        }
      }
    }

    const userId = String(params.tags?.['user-id'] || '').trim();
    const displayName = String(params.tags?.['display-name'] || params.tags?.username || '').trim();
    if (!userId || !displayName) return;

    for (const baseUrl of backendBaseUrls) {
      void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId, displayName });
    }
  };

  return { refreshCommands, handleIncomingMessage };
}
