import { prisma } from '../../lib/prisma.js';
import {
  extractVkVideoChannelIdFromUrl,
  fetchVkVideoCurrentUser,
  getVkVideoExternalAccount,
  getValidVkVideoBotAccessToken,
} from '../../utils/vkvideoApi.js';
import { isPrismaFeatureUnavailable, extractVkVideoChannelUrls, normalizeVkVideoCurrentUserRoot } from './botIntegrationsShared.js';
import type { BotPatchApplyResult, BotPatchContext, BotPatchResult } from './botSettingsPatchTypes.js';

export async function prepareVkVideoPatch(ctx: BotPatchContext): Promise<BotPatchResult> {
  if (!ctx.enabled) return { ok: true, data: {} };

  // Ensure we have SOME sender identity configured for chat writes:
  // - either global shared bot credential (admin-linked)
  // - or per-channel bot override (VkVideoBotIntegration row)
  // We keep this as a precondition to avoid enabling a "broken" integration where commands/outbox can't talk.
  const botAccessToken = await getValidVkVideoBotAccessToken();
  let hasOverride = false;
  try {
    const override = await prisma.vkVideoBotIntegration.findUnique({
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
        errorCode: 'VKVIDEO_BOT_NOT_CONFIGURED',
        error: 'VKVideo bot is not configured (missing global bot credential and no per-channel bot override).',
      },
    };
  }

  if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };

  let vkvideoChannelId = String(ctx.body.vkvideoChannelId ?? '').trim();
  let vkvideoChannelUrl: string | null = String(ctx.body.vkvideoChannelUrl ?? '').trim() || null;

  // UX: if channelId is not provided, try to resolve it from VKVideo API using streamer's linked VKVideo account.
  if (!vkvideoChannelId) {
    const account = await getVkVideoExternalAccount(ctx.req.userId);
    if (!account?.accessToken) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message: 'vkvideoChannelId is required (or link VKVideo account and retry)',
        },
      };
    }

    const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
    if (!currentUser.ok) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message: `Failed to resolve VKVideo channel from current_user (${currentUser.error || 'unknown'})`,
        },
      };
    }

    const root = normalizeVkVideoCurrentUserRoot(currentUser.data);
    const unique = extractVkVideoChannelUrls(root);
    if (unique.length === 0) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message: 'Failed to resolve VKVideo channel: no channel.url in current_user response',
        },
      };
    }
    if (unique.length > 1) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message: 'Multiple VKVideo channels found. Please pass vkvideoChannelId explicitly.',
          channels: unique,
        },
      };
    }

    const parsed = extractVkVideoChannelIdFromUrl(unique[0]);
    if (!parsed) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message:
            'Failed to extract vkvideoChannelId from VKVideo channel.url. Please pass vkvideoChannelId explicitly.',
          channelUrl: unique[0],
        },
      };
    }
    vkvideoChannelId = parsed;
    vkvideoChannelUrl = unique[0];
  } else if (!vkvideoChannelUrl) {
    // If channelId is provided explicitly, try to resolve matching channel URL from current_user (best UX).
    const account = await getVkVideoExternalAccount(ctx.req.userId);
    if (account?.accessToken) {
      const currentUser = await fetchVkVideoCurrentUser({ accessToken: account.accessToken });
      if (currentUser.ok) {
        const root = normalizeVkVideoCurrentUserRoot(currentUser.data);
        const candidateUrls = extractVkVideoChannelUrls(root);
        const matched = candidateUrls.filter((u) => extractVkVideoChannelIdFromUrl(u) === vkvideoChannelId);
        const uniqueMatched = Array.from(new Set(matched));
        if (uniqueMatched.length === 1) {
          vkvideoChannelUrl = uniqueMatched[0];
        }
      }
    }
  }

  if (vkvideoChannelUrl) {
    const parsed = extractVkVideoChannelIdFromUrl(vkvideoChannelUrl);
    if (parsed && parsed !== vkvideoChannelId) {
      return {
        ok: false,
        status: 400,
        body: {
          error: 'Bad Request',
          message: 'vkvideoChannelUrl does not match vkvideoChannelId',
          vkvideoChannelId,
          vkvideoChannelUrl,
        },
      };
    }
  } else {
    // Without channel URL we can't resolve stream_id and websocket channel names via DevAPI.
    return {
      ok: false,
      status: 400,
      body: {
        error: 'Bad Request',
        message:
          'Failed to resolve vkvideoChannelUrl. Please pass vkvideoChannelUrl explicitly (or link VKVideo and retry).',
      },
    };
  }

  return { ok: true, data: { vkvideoChannelId, vkvideoChannelUrl } };
}

export async function applyVkVideoPatch(
  ctx: BotPatchContext,
  data: { vkvideoChannelId?: string | null; vkvideoChannelUrl?: string | null }
): Promise<BotPatchApplyResult> {
  if (ctx.enabled) {
    if (!ctx.req.userId) return { ok: false, status: 401, body: { error: 'Unauthorized' } };
    if (!data.vkvideoChannelId || !data.vkvideoChannelUrl) {
      return {
        ok: false,
        status: 400,
        body: { error: 'Bad Request', message: 'Missing vkvideoChannelId or vkvideoChannelUrl' },
      };
    }
    await prisma.vkVideoChatBotSubscription.upsert({
      where: { channelId: ctx.channelId },
      create: {
        channelId: ctx.channelId,
        userId: ctx.req.userId,
        vkvideoChannelId: data.vkvideoChannelId,
        vkvideoChannelUrl: data.vkvideoChannelUrl,
        enabled: true,
      },
      update: {
        userId: ctx.req.userId,
        vkvideoChannelId: data.vkvideoChannelId,
        vkvideoChannelUrl: data.vkvideoChannelUrl,
        enabled: true,
      },
      select: { id: true },
    });
    return { ok: true };
  }

  await prisma.vkVideoChatBotSubscription.updateMany({
    where: { channelId: ctx.channelId },
    data: { enabled: false },
  });
  return { ok: true };
}
