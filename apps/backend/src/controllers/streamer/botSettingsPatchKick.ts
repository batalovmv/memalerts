import { prisma } from '../../lib/prisma.js';
import { fetchKickUser } from '../../auth/providers/kick.js';
import {
  createKickEventSubscription,
  getKickExternalAccount,
  getValidKickAccessTokenByExternalAccountId,
  getValidKickBotAccessToken,
  listKickEventSubscriptions,
} from '../../utils/kickApi.js';
import { logger } from '../../utils/logger.js';
import type { KickEventSubscription } from '../../utils/kickApi.js';
import { isPrismaFeatureUnavailable } from './botIntegrationsShared.js';
import type { BotPatchApplyResult, BotPatchContext, BotPatchResult } from './botSettingsPatchTypes.js';

export async function prepareKickPatch(ctx: BotPatchContext): Promise<BotPatchResult> {
  if (!ctx.enabled) return { ok: true, data: {} };
  if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };

  const clientId = String(process.env.KICK_CLIENT_ID || '').trim();
  const userInfoUrl = String(process.env.KICK_USERINFO_URL || '').trim();
  if (!clientId || !userInfoUrl) {
    return {
      ok: false,
      status: 503,
      body: {
        errorCode: 'KICK_BOT_NOT_CONFIGURED',
        error: 'Kick bot is not configured (missing KICK_CLIENT_ID/KICK_USERINFO_URL).',
      },
    };
  }

  const acc = await getKickExternalAccount(ctx.req.userId);
  if (!acc?.accessToken) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Bad Request',
        code: 'KICK_NOT_LINKED',
        message: 'Kick account is not linked',
      },
    };
  }

  let kickChannelId: string | null = null;
  const bodyChannelId = String(ctx.body.kickChannelId ?? '').trim();
  if (bodyChannelId) {
    kickChannelId = bodyChannelId;
  } else {
    const u = await fetchKickUser({ userInfoUrl, accessToken: acc.accessToken });
    const id = String(u.user?.id ?? u.user?.user_id ?? '').trim();
    kickChannelId = id || null;
  }

  if (!kickChannelId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Bad Request',
        message: 'Failed to resolve kickChannelId. Please pass kickChannelId explicitly (or re-link Kick and retry).',
      },
    };
  }

  const botAccessToken = await getValidKickBotAccessToken();
  let hasOverride = false;
  try {
    const override = await prisma.kickBotIntegration.findUnique({
      where: { channelId: ctx.channelId },
      select: { enabled: true },
    });
    hasOverride = Boolean(override?.enabled);
  } catch (error) {
    if (!isPrismaFeatureUnavailable(error)) throw error;
    hasOverride = false;
  }
  if (hasOverride && !ctx.customBotEntitled) hasOverride = false;

  if (!botAccessToken && !hasOverride) {
    return {
      ok: false,
      status: 503,
      body: {
        errorCode: 'KICK_BOT_NOT_CONFIGURED',
        error: 'Kick bot is not configured (missing global bot credential and no per-channel bot override).',
      },
    };
  }

  return { ok: true, data: { kickChannelId } };
}

export async function applyKickPatch(
  ctx: BotPatchContext,
  data: { kickChannelId?: string | null }
): Promise<BotPatchApplyResult> {
  if (ctx.enabled) {
    if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };
    if (!data.kickChannelId)
      return { ok: false, status: 400, body: { error: 'Bad Request', message: 'Missing kickChannelId' } };

    // Ensure Kick Events subscription exists for chat.message.sent (event-driven chat ingest).
    const acc = await getKickExternalAccount(ctx.req.userId);
    if (!acc?.id) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Kick account is not linked. Please link Kick in integrations first.',
          errorCode: 'KICK_NOT_LINKED',
        },
      };
    }
    const scopes = String(acc.scopes ?? '')
      .split(/\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (!scopes.includes('events:subscribe')) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Kick scope missing: events:subscribe. Please re-link Kick with the required permissions.',
          errorCode: 'KICK_SCOPE_MISSING_EVENTS_SUBSCRIBE',
        },
      };
    }
    const accessToken = await getValidKickAccessTokenByExternalAccountId(acc.id);
    if (!accessToken) {
      return {
        ok: false,
        status: 401,
        body: {
          error: 'Kick access token not found/expired. Please log out and log in again to refresh your authorization.',
          requiresReauth: true,
          errorCode: 'KICK_ACCESS_TOKEN_MISSING',
        },
      };
    }

    const callbackUrl = (() => {
      const envUrl = String(process.env.KICK_WEBHOOK_CALLBACK_URL || '').trim();
      if (envUrl) return envUrl;
      const domain = process.env.DOMAIN || 'twitchmemes.ru';
      const reqHost = ctx.req.get('host') || '';
      const allowedHosts = new Set([domain, `www.${domain}`, `beta.${domain}`]);
      const apiBaseUrl = allowedHosts.has(reqHost) ? `https://${reqHost}` : `https://${domain}`;
      return `${apiBaseUrl}/webhooks/kick/events`;
    })();

    const eventName = 'chat.message.sent';
    const listed = await listKickEventSubscriptions({ accessToken });
    const hasSub =
      listed.ok &&
      listed.subscriptions.some((s: KickEventSubscription) => {
        const e = String(s?.event ?? s?.type ?? s?.name ?? '')
          .trim()
          .toLowerCase();
        const cb = String(s?.callback_url ?? s?.callback ?? s?.transport?.callback ?? '').trim();
        return e === eventName && cb === callbackUrl;
      });
    if (!hasSub) {
      const created = await createKickEventSubscription({
        accessToken,
        callbackUrl,
        event: eventName,
        version: 'v1',
      });
      if (!created.ok) {
        logger.warn('kick.bot_subscription_create_failed', { status: created.status, channelId: ctx.channelId });
        return {
          ok: false,
          status: 502,
          body: {
            error: 'Failed to create Kick event subscription. Please try again.',
            errorCode: 'KICK_SUBSCRIPTION_CREATE_FAILED',
          },
        };
      }
    }

    await prisma.kickChatBotSubscription.upsert({
      where: { channelId: ctx.channelId },
      create: { channelId: ctx.channelId, userId: ctx.req.userId, kickChannelId: data.kickChannelId, enabled: true },
      update: { userId: ctx.req.userId, kickChannelId: data.kickChannelId, enabled: true },
      select: { id: true },
    });
    return { ok: true };
  }

  await prisma.kickChatBotSubscription.updateMany({
    where: { channelId: ctx.channelId },
    data: { enabled: false },
  });
  return { ok: true };
}
