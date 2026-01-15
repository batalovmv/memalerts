import { prisma } from '../../lib/prisma.js';
import { getTwitchLoginByUserId } from '../../utils/twitchApi.js';
import { isPrismaFeatureUnavailable } from './botIntegrationsShared.js';
import type { BotPatchApplyResult, BotPatchContext, BotPatchResult } from './botSettingsPatchTypes.js';

export async function prepareTwitchPatch(ctx: BotPatchContext): Promise<BotPatchResult> {
  if (!ctx.enabled) return { ok: true, data: {} };

  // Ensure we have SOME sender identity configured for chat writes/replies:
  // - either global shared bot credential (admin-linked)
  // - or per-channel bot override (TwitchBotIntegration row)
  // NOTE: legacy env-based bot may still exist, but we enforce the new contract for "bots" feature.
  let hasGlobal = false;
  let hasOverride = false;
  try {
    const global = await prisma.globalTwitchBotCredential.findFirst({
      where: { enabled: true },
      select: { id: true },
    });
    hasGlobal = Boolean(global?.id);
  } catch (error) {
    if (!isPrismaFeatureUnavailable(error)) throw error;
    hasGlobal = false;
  }
  try {
    const override = await prisma.twitchBotIntegration.findUnique({
      where: { channelId: ctx.channelId },
      select: { enabled: true },
    });
    hasOverride = Boolean(override?.enabled);
  } catch (error) {
    if (!isPrismaFeatureUnavailable(error)) throw error;
    hasOverride = false;
  }
  // Without entitlement, per-channel override MUST NOT be considered a valid sender.
  if (hasOverride && !ctx.customBotEntitled) hasOverride = false;
  if (!hasGlobal && !hasOverride) {
    return {
      ok: false,
      status: 503,
      body: {
        errorCode: 'TWITCH_BOT_NOT_CONFIGURED',
        error: 'Twitch bot is not configured (missing global bot credential and no per-channel bot override).',
      },
    };
  }

  const channel = await prisma.channel.findUnique({
    where: { id: ctx.channelId },
    select: { twitchChannelId: true },
  });
  if (!channel) {
    return { ok: false, status: 404, body: { error: 'Not Found', message: 'Channel not found' } };
  }
  if (!channel.twitchChannelId) {
    return { ok: false, status: 400, body: { error: 'Bad Request', message: 'This channel is not linked to Twitch' } };
  }

  const twitchChannelId = channel.twitchChannelId;
  const twitchLogin = await getTwitchLoginByUserId(twitchChannelId);
  if (!twitchLogin) {
    return { ok: false, status: 400, body: { error: 'Bad Request', message: 'Failed to resolve twitch login' } };
  }

  return { ok: true, data: { twitchLogin, twitchChannelId } };
}

export async function applyTwitchPatch(
  ctx: BotPatchContext,
  data: { twitchLogin?: string | null; twitchChannelId?: string | null }
): Promise<BotPatchApplyResult> {
  if (ctx.enabled) {
    const login = data.twitchLogin;
    if (!login) {
      return { ok: false, status: 400, body: { error: 'Bad Request', message: 'Failed to resolve twitch login' } };
    }
    await prisma.chatBotSubscription.upsert({
      where: { channelId: ctx.channelId },
      create: { channelId: ctx.channelId, twitchLogin: login, enabled: true },
      update: { twitchLogin: login, enabled: true },
      select: { channelId: true },
    });
    return { ok: true };
  }

  const effectiveTwitchChannelId =
    data.twitchChannelId ||
    (
      await prisma.channel.findUnique({
        where: { id: ctx.channelId },
        select: { twitchChannelId: true },
      })
    )?.twitchChannelId ||
    null;
  const login = effectiveTwitchChannelId ? await getTwitchLoginByUserId(effectiveTwitchChannelId) : null;
  await prisma.chatBotSubscription.upsert({
    where: { channelId: ctx.channelId },
    create: { channelId: ctx.channelId, twitchLogin: login || '', enabled: false },
    update: { enabled: false, ...(login ? { twitchLogin: login } : {}) },
    select: { channelId: true },
  });
  return { ok: true };
}
