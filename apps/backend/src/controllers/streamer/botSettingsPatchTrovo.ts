import { prisma } from '../../lib/prisma.js';
import { fetchTrovoUserInfo } from '../../auth/providers/trovo.js';
import { getTrovoExternalAccount, getValidTrovoBotAccessToken } from '../../utils/trovoApi.js';
import { isPrismaFeatureUnavailable } from './botIntegrationsShared.js';
import type { BotPatchApplyResult, BotPatchContext, BotPatchResult } from './botSettingsPatchTypes.js';

export async function prepareTrovoPatch(ctx: BotPatchContext): Promise<BotPatchResult> {
  if (!ctx.enabled) return { ok: true, data: {} };
  if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };

  const clientId = String(process.env.TROVO_CLIENT_ID || '').trim();
  if (!clientId) {
    return {
      ok: false,
      status: 503,
      body: {
        errorCode: 'TROVO_BOT_NOT_CONFIGURED',
        error: 'Trovo bot is not configured (missing TROVO_CLIENT_ID).',
      },
    };
  }

  const acc = await getTrovoExternalAccount(ctx.req.userId);
  if (!acc?.accessToken) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Bad Request',
        code: 'TROVO_NOT_LINKED',
        message: 'Trovo account is not linked',
      },
    };
  }

  let trovoChannelId: string | null = null;
  const bodyChannelId = String(ctx.body.trovoChannelId ?? '').trim();
  if (bodyChannelId) {
    trovoChannelId = bodyChannelId;
  } else {
    const u = await fetchTrovoUserInfo({
      clientId,
      accessToken: acc.accessToken,
      userInfoUrl: process.env.TROVO_USERINFO_URL || undefined,
    });
    const chId = String(u.user?.channel_id || '').trim();
    trovoChannelId = chId || null;
  }

  if (!trovoChannelId) {
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Bad Request',
        message:
          'Failed to resolve trovoChannelId. Please pass trovoChannelId explicitly (or re-link Trovo and retry).',
      },
    };
  }

  // Ensure we have SOME sender identity configured for chat writes:
  // - either global shared bot credential
  // - or per-channel bot override (TrovoBotIntegration row)
  const botAccessToken = await getValidTrovoBotAccessToken();
  let hasOverride = false;
  try {
    const override = await prisma.trovoBotIntegration.findUnique({
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
        errorCode: 'TROVO_BOT_NOT_CONFIGURED',
        error: 'Trovo bot is not configured (missing global bot credential and no per-channel bot override).',
      },
    };
  }

  return { ok: true, data: { trovoChannelId } };
}

export async function applyTrovoPatch(
  ctx: BotPatchContext,
  data: { trovoChannelId?: string | null }
): Promise<BotPatchApplyResult> {
  if (ctx.enabled) {
    if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };
    if (!data.trovoChannelId) {
      return { ok: false, status: 400, body: { error: 'Bad Request', message: 'Missing trovoChannelId' } };
    }
    await prisma.trovoChatBotSubscription.upsert({
      where: { channelId: ctx.channelId },
      create: { channelId: ctx.channelId, userId: ctx.req.userId, trovoChannelId: data.trovoChannelId, enabled: true },
      update: { userId: ctx.req.userId, trovoChannelId: data.trovoChannelId, enabled: true },
      select: { id: true },
    });
    return { ok: true };
  }

  await prisma.trovoChatBotSubscription.updateMany({
    where: { channelId: ctx.channelId },
    data: { enabled: false },
  });
  return { ok: true };
}
