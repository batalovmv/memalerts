import dotenv from 'dotenv';
import tmi from 'tmi.js';
import { prisma } from '../lib/prisma.js';
import { getValidAccessToken, getValidTwitchAccessTokenByExternalAccountId, getValidTwitchBotAccessToken, refreshAccessToken } from '../utils/twitchApi.js';
import { logger } from '../utils/logger.js';
import { getEntitledChannelIds } from '../utils/entitlements.js';
import { getStreamDurationSnapshot } from '../realtime/streamDurationStore.js';

dotenv.config();

function parseIntSafe(v: any, def: number): number {
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? n : def;
}

function normalizeLogin(v: string): string {
  return String(v || '').trim().toLowerCase().replace(/^#/, '');
}

type ChatCommandRole = 'vip' | 'moderator' | 'subscriber' | 'follower';

function getSenderRolesFromTwitchIrcTags(tags: any): Set<ChatCommandRole> {
  // Twitch IRC tags reference:
  // - mod: '1' for moderators
  // - subscriber: '1' for subscribers
  // - badges: includes 'vip/1' for VIPs
  // NOTE: "follower" is NOT available in IRC tags. Supporting it requires Helix follow-check + caching.
  const roles = new Set<ChatCommandRole>();

  const mod = String(tags?.mod ?? '').trim();
  if (mod === '1') roles.add('moderator');

  const subscriber = String(tags?.subscriber ?? '').trim();
  if (subscriber === '1') roles.add('subscriber');

  const badges = String(tags?.badges ?? '').trim().toLowerCase();
  if (badges.includes('vip/')) roles.add('vip');

  return roles;
}

function normalizeAllowedUsersList(raw: any): string[] {
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

function normalizeAllowedRolesList(raw: any): ChatCommandRole[] {
  if (!Array.isArray(raw)) return [];
  const out: ChatCommandRole[] = [];
  for (const v of raw) {
    const role = String(v ?? '').trim().toLowerCase() as ChatCommandRole;
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
  if (users.length === 0 && roles.length === 0) return true; // default: allow everyone

  if (senderLogin && users.includes(senderLogin)) return true;
  for (const r of roles) {
    if (senderRoles.has(r)) return true;
  }
  return false;
}

async function resolveBotUserId(): Promise<string | null> {
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

type BotClient = {
  kind: 'default' | 'override';
  login: string;
  client: any;
  joined: Set<string>;
  // For override clients, we key them by externalAccountId.
  externalAccountId?: string;
};

async function postInternalCreditsChatter(baseUrl: string, payload: { channelSlug: string; userId: string; displayName: string }) {
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
  } catch (e: any) {
    logger.warn('chatbot.internal_post_failed', { errorMessage: e?.message || String(e) });
  } finally {
    clearTimeout(t);
  }
}

function parseBaseUrls(): string[] {
  const raw = String(process.env.CHATBOT_BACKEND_BASE_URLS || '').trim();
  if (raw) {
    const urls = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return Array.from(new Set(urls));
  }
  const single = String(process.env.CHATBOT_BACKEND_BASE_URL || '').trim();
  return single ? [single] : [];
}

async function fetchEnabledSubscriptions(): Promise<Array<{ channelId: string; login: string; slug: string }>> {
  const rows = await prisma.chatBotSubscription.findMany({
    where: { enabled: true },
    select: { channelId: true, twitchLogin: true, channel: { select: { slug: true } } },
  });

  // Optional gating by BotIntegrationSettings(provider=twitch).
  // Back-compat rules:
  // - If the table doesn't exist yet (partial deploy), ignore gating.
  // - If a channel has no settings row yet, treat it as enabled (so legacy /bot/enable keeps working).
  let twitchGate: Map<string, boolean> | null = null; // channelId -> enabled
  try {
    const channelIds = Array.from(new Set(rows.map((r) => String((r as any)?.channelId || '').trim()).filter(Boolean)));
    if (channelIds.length > 0) {
      const gateRows = await (prisma as any).botIntegrationSettings.findMany({
        where: { channelId: { in: channelIds }, provider: 'twitch' },
        select: { channelId: true, enabled: true },
      });
      twitchGate = new Map<string, boolean>();
      for (const gr of gateRows) {
        const channelId = String((gr as any)?.channelId || '').trim();
        if (!channelId) continue;
        twitchGate.set(channelId, Boolean((gr as any)?.enabled));
      }
    }
  } catch (e: any) {
    // Prisma "table does not exist" (feature not deployed / migrations not applied)
    if (e?.code !== 'P2021') throw e;
    twitchGate = null;
  }

  const out: Array<{ channelId: string; login: string; slug: string }> = [];
  for (const r of rows) {
    const login = normalizeLogin(r.twitchLogin);
    const slug = String(r.channel?.slug || '').trim().toLowerCase();
    const channelId = String((r as any)?.channelId || '').trim();
    if (!channelId || !login || !slug) continue;

    if (twitchGate) {
      const gated = twitchGate.get(channelId);
      // If row exists and is false => disabled.
      if (gated === false) continue;
      // If row missing => legacy mode => allow.
    }

    out.push({ channelId, login, slug });
  }
  return out;
}

async function start() {
  // Default bot identity:
  // Prefer DB-linked global Twitch bot credential; fall back to legacy env user-based bot.
  let defaultBotLogin = normalizeLogin(String(process.env.CHAT_BOT_LOGIN || ''));
  let defaultBotUserId: string | null = null;
  let defaultBotExternalAccountId: string | null = null;
  const dbDefault = await getValidTwitchBotAccessToken();
  if (dbDefault?.login && dbDefault.accessToken) {
    defaultBotLogin = normalizeLogin(dbDefault.login);
    // We keep token separately below.
    defaultBotExternalAccountId = null; // not needed; token is already fetched
  } else {
    defaultBotUserId = await resolveBotUserId();
  }

  const syncSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_SYNC_SECONDS, 30));
  const outboxPollMs = Math.max(250, parseIntSafe(process.env.CHATBOT_OUTBOX_POLL_MS, 1_000));
  const commandsRefreshSeconds = Math.max(5, parseIntSafe(process.env.CHATBOT_COMMANDS_REFRESH_SECONDS, 30));
  const backendBaseUrls = parseBaseUrls();

  // Hard requirements: avoid silently connecting to the wrong instance (prod vs beta)
  // and make misconfig obvious in deploy logs.
  if (!defaultBotLogin) {
    logger.error('chatbot.missing_env', { key: 'CHAT_BOT_LOGIN' });
    process.exit(1);
  }
  if (backendBaseUrls.length === 0) {
    logger.error('chatbot.missing_env', { key: 'CHATBOT_BACKEND_BASE_URLS' });
    process.exit(1);
  }

  let stopped = false;
  let defaultClient: BotClient | null = null;
  const overrideClients = new Map<string, BotClient>(); // externalAccountId -> client
  let subscriptionsTimer: NodeJS.Timeout | null = null;
  let outboxTimer: NodeJS.Timeout | null = null;
  let commandsTimer: NodeJS.Timeout | null = null;
  let reconnectTimer: NodeJS.Timeout | null = null;

  let subscriptionsSyncing = false;
  let outboxProcessing = false;

  // For DEFAULT client, these track which channels it's currently in (to receive messages).
  const joinedDefault = new Set<string>(); // login
  const loginToSlug = new Map<string, string>();
  const loginToChannelId = new Map<string, string>();
  const channelIdToOverrideExtId = new Map<string, string>(); // channelId -> externalAccountId
  const commandsByChannelId = new Map<
    string,
    {
      ts: number;
      items: Array<{
        triggerNormalized: string;
        response: string;
        onlyWhenLive: boolean;
        allowedRoles: ChatCommandRole[];
        allowedUsers: string[];
      }>;
    }
  >();
  const streamDurationByChannelId = new Map<
    string,
    {
      ts: number;
      cfg: {
        enabled: boolean;
        triggerNormalized: string;
        responseTemplate: string | null;
        breakCreditMinutes: number;
        onlyWhenLive: boolean;
      } | null;
    }
  >();
  let commandsRefreshing = false;

  const refreshCommands = async () => {
    if (stopped || commandsRefreshing) return;
    const channelIds = Array.from(new Set(Array.from(loginToChannelId.values()).filter(Boolean)));
    if (channelIds.length === 0) return;

    commandsRefreshing = true;
    try {
      let rows: any[] = [];
      try {
        rows = await (prisma as any).chatBotCommand.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: { channelId: true, triggerNormalized: true, response: true, onlyWhenLive: true, allowedRoles: true, allowedUsers: true },
        });
      } catch (e: any) {
        // Back-compat for partial deploys: column might not exist yet.
        if (e?.code === 'P2022') {
          rows = await (prisma as any).chatBotCommand.findMany({
            where: { channelId: { in: channelIds }, enabled: true },
            select: { channelId: true, triggerNormalized: true, response: true },
          });
        } else {
          throw e;
        }
      }
      const grouped = new Map<
        string,
        Array<{ triggerNormalized: string; response: string; onlyWhenLive: boolean; allowedRoles: ChatCommandRole[]; allowedUsers: string[] }>
      >();
      for (const r of rows) {
        const channelId = String((r as any)?.channelId || '').trim();
        const triggerNormalized = String((r as any)?.triggerNormalized || '').trim().toLowerCase();
        const response = String((r as any)?.response || '').trim();
        const onlyWhenLive = Boolean((r as any)?.onlyWhenLive);
        const allowedRoles = normalizeAllowedRolesList((r as any)?.allowedRoles);
        const allowedUsers = normalizeAllowedUsersList((r as any)?.allowedUsers);
        if (!channelId || !triggerNormalized || !response) continue;
        const arr = grouped.get(channelId) || [];
        arr.push({ triggerNormalized, response, onlyWhenLive, allowedRoles, allowedUsers });
        grouped.set(channelId, arr);
      }

      const now = Date.now();
      for (const id of channelIds) {
        commandsByChannelId.set(id, { ts: now, items: grouped.get(id) || [] });
      }

      // Smart command config is stored on Channel (per-channel JSON).
      try {
        const chRows = await (prisma as any).channel.findMany({
          where: { id: { in: channelIds } },
          select: { id: true, streamDurationCommandJson: true },
        });
        const byId = new Map<string, any>();
        for (const r of chRows) {
          const id = String((r as any)?.id || '').trim();
          if (!id) continue;
          byId.set(id, r);
        }
        for (const id of channelIds) {
          const raw = String(byId.get(id)?.streamDurationCommandJson || '').trim();
          if (!raw) {
            streamDurationByChannelId.set(id, { ts: now, cfg: null });
            continue;
          }
          try {
            const parsed = JSON.parse(raw);
            const triggerNormalized = String((parsed as any)?.triggerNormalized || (parsed as any)?.trigger || '').trim().toLowerCase();
            const enabled = Boolean((parsed as any)?.enabled);
            const breakCreditMinutes = Number.isFinite(Number((parsed as any)?.breakCreditMinutes))
              ? Math.max(0, Math.min(24 * 60, Math.floor(Number((parsed as any)?.breakCreditMinutes))))
              : 60;
            const responseTemplate = (parsed as any)?.responseTemplate === null ? null : String((parsed as any)?.responseTemplate || '').trim() || null;
            const onlyWhenLive = Boolean((parsed as any)?.onlyWhenLive);
            if (!triggerNormalized) {
              streamDurationByChannelId.set(id, { ts: now, cfg: null });
              continue;
            }
            streamDurationByChannelId.set(id, {
              ts: now,
              cfg: { enabled, triggerNormalized, responseTemplate, breakCreditMinutes, onlyWhenLive },
            });
          } catch {
            streamDurationByChannelId.set(id, { ts: now, cfg: null });
          }
        }
      } catch (e: any) {
        // Feature might not be deployed on this instance DB (missing column).
        if (e?.code !== 'P2022') {
          logger.warn('chatbot.stream_duration_cfg_refresh_failed', { errorMessage: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      logger.warn('chatbot.commands_refresh_failed', { errorMessage: e?.message || String(e) });
    } finally {
      commandsRefreshing = false;
    }
  };

  const MAX_OUTBOX_BATCH = 25;
  const MAX_SEND_ATTEMPTS = 3;
  const PROCESSING_STALE_MS = 60_000;

  const processOutboxOnce = async () => {
    if (stopped || !defaultClient) return;
    if (outboxProcessing) return;
    if (joinedDefault.size === 0) return;

    // Only dispatch messages for currently-enabled subscriptions (avoid sending after disable).
    const channelIds = Array.from(loginToChannelId.values()).filter(Boolean);
    if (channelIds.length === 0) return;

    outboxProcessing = true;
    try {
      const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);

      const rows = await (prisma as any).chatBotOutboxMessage.findMany({
        where: {
          channelId: { in: channelIds },
          OR: [{ status: 'pending' }, { status: 'processing', processingAt: { lt: staleBefore } }],
        },
        orderBy: { createdAt: 'asc' },
        take: MAX_OUTBOX_BATCH,
        select: { id: true, twitchLogin: true, message: true, status: true, attempts: true },
      });
      if (rows.length === 0) return;

      for (const r of rows) {
        if (stopped || !defaultClient) return;

        const login = normalizeLogin(r.twitchLogin);
        if (!login) continue;
        if (!joinedDefault.has(login)) continue; // wait until join completes (default listener)

        // Claim (best-effort safe if multiple runner processes ever happen).
        const claim = await (prisma as any).chatBotOutboxMessage.updateMany({
          where: { id: r.id, status: r.status },
          data: { status: 'processing', processingAt: new Date(), lastError: null },
        });
        if (claim.count !== 1) continue;

        try {
          const channelId = loginToChannelId.get(login) || null;
          await sayForChannel({ channelId, twitchLogin: login, message: r.message });
          await (prisma as any).chatBotOutboxMessage.update({
            where: { id: r.id },
            data: { status: 'sent', sentAt: new Date(), attempts: (r.attempts || 0) + 1 },
          });
        } catch (e: any) {
          const nextAttempts = (r.attempts || 0) + 1;
          const lastError = e?.message || String(e);
          const shouldFail = nextAttempts >= MAX_SEND_ATTEMPTS;
          await (prisma as any).chatBotOutboxMessage.update({
            where: { id: r.id },
            data: shouldFail
              ? { status: 'failed', failedAt: new Date(), attempts: nextAttempts, lastError }
              : { status: 'pending', processingAt: null, attempts: nextAttempts, lastError },
          });
          logger.warn('chatbot.outbox_send_failed', { login, outboxId: r.id, attempts: nextAttempts, errorMessage: lastError });
        }
      }
    } finally {
      outboxProcessing = false;
    }
  };

  async function ensureOverrideClient(externalAccountId: string): Promise<BotClient | null> {
    const extId = String(externalAccountId || '').trim();
    if (!extId) return null;
    const existing = overrideClients.get(extId) || null;
    if (existing) return existing;

    // Load bot login for this external account
    const ext = await prisma.externalAccount.findUnique({
      where: { id: extId },
      select: { id: true, provider: true, login: true },
    });
    const login = normalizeLogin(String(ext?.login || ''));
    if (!ext || ext.provider !== 'twitch' || !login) return null;

    const accessToken = await getValidTwitchAccessTokenByExternalAccountId(extId);
    if (!accessToken) return null;

    const client = new (tmi as any).Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: { username: login, password: `oauth:${accessToken}` },
      channels: [],
    });

    const entry: BotClient = { kind: 'override', login, client, joined: new Set(), externalAccountId: extId };
    overrideClients.set(extId, entry);

    client.on('connected', () => {
      logger.info('chatbot.override.connected', { botLogin: login, externalAccountId: extId });
    });
    client.on('disconnected', (reason: any) => {
      logger.warn('chatbot.override.disconnected', { botLogin: login, externalAccountId: extId, reason: String(reason || '') });
    });

    try {
      await client.connect();
      return entry;
    } catch (e: any) {
      logger.warn('chatbot.override.connect_failed', { botLogin: login, externalAccountId: extId, errorMessage: e?.message || String(e) });
      overrideClients.delete(extId);
      return null;
    }
  }

  async function sayForChannel(params: { channelId: string | null; twitchLogin: string; message: string }) {
    const login = normalizeLogin(params.twitchLogin);
    if (!login) throw new Error('invalid_login');

    const channelId = params.channelId ? String(params.channelId).trim() : null;
    const overrideExtId = channelId ? channelIdToOverrideExtId.get(channelId) || null : null;
    logger.info('chatbot.say.sender', {
      channelId,
      login,
      sender: overrideExtId ? 'override' : 'global',
      overrideExternalAccountId: overrideExtId,
    });
    if (overrideExtId) {
      const override = await ensureOverrideClient(overrideExtId);
      if (override) {
        // Ensure override client joined channel to be able to say
        if (!override.joined.has(login)) {
          try {
            await override.client.join(login);
            override.joined.add(login);
          } catch (e: any) {
            logger.warn('chatbot.override.join_failed', { botLogin: override.login, login, errorMessage: e?.message || String(e) });
          }
        }
        if (override.joined.has(login)) {
          return await override.client.say(login, params.message);
        }
      }
    }

    if (!defaultClient) throw new Error('no_default_client');
    return await defaultClient.client.say(login, params.message);
  }

  const syncSubscriptions = async () => {
    if (stopped || !defaultClient) return;
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

      // Load per-channel override mapping (best-effort; feature might not exist yet on some DBs).
      try {
        const channelIds = subs.map((s) => s.channelId);
        const overrides = await (prisma as any).twitchBotIntegration.findMany({
          where: { channelId: { in: channelIds }, enabled: true },
          select: { channelId: true, externalAccountId: true },
        });
        const entitled = await getEntitledChannelIds(channelIds, 'custom_bot');
        for (const o of overrides) {
          const cid = String((o as any)?.channelId || '').trim();
          const extId = String((o as any)?.externalAccountId || '').trim();
          if (cid && extId && entitled.has(cid)) channelIdToOverrideExtId.set(cid, extId);
        }
      } catch (e: any) {
        if (e?.code !== 'P2021') throw e;
      }

      // Keep commands cache in sync with current subscriptions (no DB writes here).
      void refreshCommands();

      const toJoin = Array.from(desired).filter((l) => !joinedDefault.has(l));
      const toPart = Array.from(joinedDefault).filter((l) => !desired.has(l));

      for (const l of toJoin) {
        try {
          await defaultClient.client.join(l);
          joinedDefault.add(l);
          logger.info('chatbot.join', { login: l });
        } catch (e: any) {
          logger.warn('chatbot.join_failed', { login: l, errorMessage: e?.message || String(e) });
        }
      }

      for (const l of toPart) {
        try {
          await defaultClient.client.part(l);
          joinedDefault.delete(l);
          logger.info('chatbot.part', { login: l });
        } catch (e: any) {
          logger.warn('chatbot.part_failed', { login: l, errorMessage: e?.message || String(e) });
        }
      }
    } catch (e: any) {
      logger.warn('chatbot.sync_failed', { errorMessage: e?.message || String(e) });
    } finally {
      subscriptionsSyncing = false;
    }
  };

  const connect = async () => {
    if (stopped) return;

    let accessToken: string | null = null;
    let botLogin = defaultBotLogin;

    const dbDefault = await getValidTwitchBotAccessToken();
    if (dbDefault?.accessToken && dbDefault.login) {
      accessToken = dbDefault.accessToken;
      botLogin = normalizeLogin(dbDefault.login);
    } else {
      const botUserId = defaultBotUserId || (await resolveBotUserId());
      if (!botUserId) {
        logger.warn('chatbot.no_bot_user', { botLogin });
        reconnectTimer = setTimeout(connect, 30_000);
        return;
      }

      accessToken = await getValidAccessToken(botUserId);
      if (!accessToken) {
        accessToken = await refreshAccessToken(botUserId);
      }
      if (!accessToken) {
        logger.warn('chatbot.no_access_token', { botLogin, botUserId });
        reconnectTimer = setTimeout(connect, 30_000);
        return;
      }
    }

    const client = new (tmi as any).Client({
      options: { debug: false },
      connection: { secure: true, reconnect: true },
      identity: { username: botLogin, password: `oauth:${accessToken}` },
      channels: [],
    });
    defaultClient = { kind: 'default', login: botLogin, client, joined: joinedDefault };

    client.on('connected', () => {
      logger.info('chatbot.connected', { botLogin });
    });
    client.on('disconnected', (reason: any) => {
      logger.warn('chatbot.disconnected', { botLogin, reason: String(reason || '') });
    });
    client.on('message', async (channel: string, tags: any, _message: string, self: boolean) => {
      if (self) return;
      const login = normalizeLogin(channel);
      const slug = loginToSlug.get(login);
      if (!slug) return;

      const msgNorm = String(_message || '').trim().toLowerCase();
      const senderLogin = normalizeLogin(String(tags?.username || tags?.['display-name'] || ''));
      const senderRoles = getSenderRolesFromTwitchIrcTags(tags);

      // Bot commands (trigger -> response) are per-channel.
      const channelId = loginToChannelId.get(login);
      if (channelId) {
        const cached = commandsByChannelId.get(channelId);
        const now = Date.now();
        if (!cached || now - cached.ts > commandsRefreshSeconds * 1000) {
          void refreshCommands();
        }

        // Smart command: stream duration
        if (msgNorm) {
          const smartCached = streamDurationByChannelId.get(channelId);
          if (smartCached && now - smartCached.ts <= commandsRefreshSeconds * 1000) {
            const cfg = smartCached.cfg;
            if (cfg?.enabled && cfg.triggerNormalized === msgNorm) {
              try {
                const snap = await getStreamDurationSnapshot(slug);
                if (cfg.onlyWhenLive && snap.status !== 'online') {
                  // ignore (future flag)
                } else {
                  const totalMinutes = snap.totalMinutes;
                  const hours = Math.floor(totalMinutes / 60);
                  const minutes = totalMinutes % 60;
                  const template = cfg.responseTemplate ?? 'Время стрима: {hours}ч {minutes}м ({totalMinutes}м)';
                  const msg = template
                    .replace(/\{hours\}/g, String(hours))
                    .replace(/\{minutes\}/g, String(minutes))
                    .replace(/\{totalMinutes\}/g, String(totalMinutes))
                    .trim();
                  if (msg) {
                    const channelId = loginToChannelId.get(login) || null;
                    await sayForChannel({ channelId, twitchLogin: login, message: msg });
                    return;
                  }
                }
              } catch (e: any) {
                logger.warn('chatbot.stream_duration_reply_failed', { login, errorMessage: e?.message || String(e) });
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
              await client.say(login, match.response);
            } catch (e: any) {
              logger.warn('chatbot.command_reply_failed', { login, errorMessage: e?.message || String(e) });
            }
          }
        }
      }

      const userId = String(tags?.['user-id'] || '').trim();
      const displayName = String(tags?.['display-name'] || tags?.username || '').trim();
      if (!userId || !displayName) return;

      for (const baseUrl of backendBaseUrls) {
        void postInternalCreditsChatter(baseUrl, { channelSlug: slug, userId, displayName });
      }
    });

    try {
      await client.connect();
      // Initial sync + periodic sync
      await syncSubscriptions();
      subscriptionsTimer = setInterval(syncSubscriptions, syncSeconds * 1000);
      outboxTimer = setInterval(() => void processOutboxOnce(), outboxPollMs);
      // Commands refresh loop (read-only, safe)
      if (commandsTimer) clearInterval(commandsTimer);
      commandsTimer = setInterval(() => void refreshCommands(), commandsRefreshSeconds * 1000);
    } catch (e: any) {
      logger.warn('chatbot.connect_failed', { botLogin, errorMessage: e?.message || String(e) });
      reconnectTimer = setTimeout(connect, 30_000);
    }
  };

  const shutdown = async () => {
    stopped = true;
    if (subscriptionsTimer) clearInterval(subscriptionsTimer);
    if (outboxTimer) clearInterval(outboxTimer);
    if (commandsTimer) clearInterval(commandsTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    try {
      if (defaultClient?.client) await defaultClient.client.disconnect();
    } catch {
      // ignore
    }
    for (const oc of Array.from(overrideClients.values())) {
      try {
        await oc.client.disconnect();
      } catch {
        // ignore
      }
    }
    overrideClients.clear();
  };

  process.on('SIGINT', () => void shutdown().then(() => process.exit(0)));
  process.on('SIGTERM', () => void shutdown().then(() => process.exit(0)));

  await prisma.$connect();
  await connect();
}

void start().catch((e: any) => {
  logger.error('chatbot.fatal', { errorMessage: e?.message || String(e) });
  process.exit(1);
});










